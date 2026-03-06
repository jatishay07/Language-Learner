import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  AttemptInputSchema,
  type AttemptInput,
  type AttemptResult,
  type DayStatus,
  type DocSyncResult,
  type EnglishGlossResult,
  type Exercise,
  type ExerciseCategory,
  type LookupResult,
  type ReviewState,
  type SaveVocabInput,
  type SessionStartResult,
  type TranslationResult,
  type VocabItem
} from '../../shared-types/src/index.js';
import {
  APP_HOST,
  APP_PORT,
  DAILY_TARGET_SECONDS,
  DEFAULT_TIMEZONE,
  MAX_DEBT_SECONDS,
  REVIEW_FEEDBACK,
  SESSION_MIX
} from './constants.js';
import { openLearnerDatabase, readSetting, writeSetting } from './db.js';
import { syncHandbook } from './docs.js';
import { getPromptMode } from './mixed-mode.js';
import type { AppPaths } from './paths.js';
import { buildPaths, ensureAppDirs, resolveProjectRoot } from './paths.js';
import { deriveRank } from './rank.js';
import { transitionReviewState } from './srs.js';
import { clampNumber, formatLocalDate, addDays, compareDateIso, nowIso } from './time.js';
import { glossToEnglish, type TranslationStore, translateSentence } from './translation.js';
import { localGlossToEnglish } from './dictionary.js';

interface LearnerEngineOptions {
  rootDir?: string;
  timezone?: string;
}

interface VocabRow {
  id: number;
  lang: 'ko' | 'ja';
  surface: string;
  meaning: string;
  example_ko: string;
  source: string;
  stage: number;
  ease: number;
  interval_days: number;
  next_due_at: string;
  lapses: number;
  seen_count: number;
}

const CATEGORY_ORDER: ExerciseCategory[] = ['review', 'new', 'sentence'];

export class LearnerEngine implements TranslationStore {
  readonly timezone: string;
  readonly paths: AppPaths;
  readonly db: Database.Database;

  constructor(options?: LearnerEngineOptions) {
    const rootDir = options?.rootDir ?? resolveProjectRoot();
    this.paths = buildPaths(rootDir);
    ensureAppDirs(this.paths);

    this.timezone = options?.timezone ?? readTimezone(options?.rootDir, options?.timezone);
    this.db = openLearnerDatabase(this.paths, this.timezone);
    this.rolloverToToday();
  }

  close(): void {
    this.db.close();
  }

  getApiBaseUrl(): string {
    return `http://${APP_HOST}:${APP_PORT}`;
  }

  getTodayStatus(referenceDate = new Date()): DayStatus {
    this.rolloverToToday(referenceDate);
    const today = formatLocalDate(referenceDate, this.timezone);

    const row = this.db.prepare(
      'SELECT date, required_seconds, completed_seconds, debt_seconds, streak, rank FROM days WHERE date = ?'
    ).get(today) as
      | {
          date: string;
          required_seconds: number;
          completed_seconds: number;
          debt_seconds: number;
          streak: number;
          rank: DayStatus['rank'];
        }
      | undefined;

    if (!row) {
      return {
        date: today,
        requiredSeconds: DAILY_TARGET_SECONDS,
        completedSeconds: 0,
        debtSeconds: 0,
        streak: Number(readSetting(this.db, 'streak_count', '0')),
        rank: deriveRank(Number(readSetting(this.db, 'streak_count', '0')))
      };
    }

    return {
      date: row.date,
      requiredSeconds: row.required_seconds,
      completedSeconds: row.completed_seconds,
      debtSeconds: row.debt_seconds,
      streak: row.streak,
      rank: row.rank
    };
  }

  startSession(): SessionStartResult {
    this.rolloverToToday();
    const status = this.getTodayStatus();
    const sessionId = randomUUID();
    const startedAt = nowIso();

    this.db
      .prepare('INSERT INTO sessions (id, date, started_at, active_seconds, completed) VALUES (?, ?, ?, 0, 0)')
      .run(sessionId, status.date, startedAt);

    return {
      sessionId,
      startedAt,
      dayStatus: status
    };
  }

  getNextExercise(sessionId: string): Exercise {
    this.assertSessionExists(sessionId);

    const category = this.pickNextCategory(sessionId);
    const vocab = this.pickVocabForCategory(category);

    if (!vocab) {
      throw new Error('No vocabulary entries available. Check starter deck loading.');
    }

    const mode = category === 'sentence' ? 'choice' : getPromptMode(vocab.stage, vocab.seen_count);
    const exerciseId = randomUUID();

    if (mode === 'typed') {
      return {
        id: exerciseId,
        vocabId: vocab.id,
        category,
        mode,
        prompt: `다음 뜻에 맞는 한국어 단어를 입력하세요: ${vocab.meaning}`,
        correctAnswer: vocab.surface,
        meaning: vocab.meaning,
        surface: vocab.surface,
        exampleKo: vocab.example_ko
      };
    }

    const options = this.buildChoiceOptions(vocab.meaning, vocab.id);
    const prompt =
      category === 'sentence'
        ? `문장 읽기: ${vocab.example_ko}\n"${vocab.surface}"의 가장 가까운 뜻은?`
        : `"${vocab.surface}"의 뜻은?`;

    return {
      id: exerciseId,
      vocabId: vocab.id,
      category,
      mode,
      prompt,
      options,
      correctAnswer: vocab.meaning,
      meaning: vocab.meaning,
      surface: vocab.surface,
      exampleKo: vocab.example_ko
    };
  }

  recordAttempt(input: AttemptInput): AttemptResult {
    const parsed = AttemptInputSchema.parse(input);
    this.rolloverToToday();

    const session = this.db
      .prepare('SELECT id, date, completed FROM sessions WHERE id = ?')
      .get(parsed.sessionId) as { id: string; date: string; completed: number } | undefined;

    if (!session) {
      throw new Error(`Session not found: ${parsed.sessionId}`);
    }

    const now = parsed.attemptedAt || nowIso();
    const activeDelta = clampNumber(parsed.activeSecondsDelta, 5, 120);

    const vocab = this.db
      .prepare('SELECT * FROM vocab WHERE id = ?')
      .get(parsed.vocabId) as VocabRow | undefined;

    if (!vocab) {
      throw new Error(`Vocab not found: ${parsed.vocabId}`);
    }

    const previousState: ReviewState = {
      ease: vocab.ease,
      intervalDays: vocab.interval_days,
      nextDueAt: vocab.next_due_at,
      lapses: vocab.lapses
    };

    const nextState = transitionReviewState(previousState, parsed.correct, new Date(now));
    const nextStage = parsed.correct ? Math.min(vocab.stage + 1, 10) : Math.max(vocab.stage - 1, 0);
    const nextSeen = vocab.seen_count + 1;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attempts (
            session_id,
            exercise_id,
            vocab_id,
            category,
            prompt_mode,
            correct,
            answer_text,
            response_ms,
            active_seconds_delta,
            attempted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parsed.sessionId,
          parsed.exerciseId,
          parsed.vocabId,
          parsed.category,
          parsed.promptMode,
          parsed.correct ? 1 : 0,
          parsed.answerText || null,
          parsed.responseMs,
          activeDelta,
          now
        );

      this.db
        .prepare(
          `UPDATE vocab
           SET stage = ?,
               ease = ?,
               interval_days = ?,
               next_due_at = ?,
               lapses = ?,
               seen_count = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(nextStage, nextState.ease, nextState.intervalDays, nextState.nextDueAt, nextState.lapses, nextSeen, now, vocab.id);

      this.db
        .prepare('UPDATE sessions SET active_seconds = active_seconds + ? WHERE id = ?')
        .run(activeDelta, parsed.sessionId);

      this.db
        .prepare(
          `UPDATE days
           SET completed_seconds = completed_seconds + ?,
               updated_at = ?
           WHERE date = ?`
        )
        .run(activeDelta, now, session.date);
    });

    tx();

    const dayStatus = this.getTodayStatus();
    const gateUnlocked = dayStatus.completedSeconds >= dayStatus.requiredSeconds;

    if (gateUnlocked && session.completed === 0) {
      this.db.prepare('UPDATE sessions SET completed = 1, ended_at = ? WHERE id = ?').run(nowIso(), parsed.sessionId);
      this.exportData();
      this.syncDocs({ sessionId: parsed.sessionId, trigger: 'session_completed' });
    }

    return {
      dayStatus,
      reviewState: nextState,
      feedback: parsed.correct ? REVIEW_FEEDBACK.correct : REVIEW_FEEDBACK.incorrect,
      gateUnlocked
    };
  }

  saveVocab(input: SaveVocabInput): VocabItem {
    const normalizedSurface = input.text.trim();
    const now = nowIso();

    if (!normalizedSurface) {
      throw new Error('Cannot save empty vocabulary surface.');
    }

    this.db
      .prepare(
        `INSERT INTO vocab (
          lang,
          surface,
          meaning,
          example_ko,
          source,
          stage,
          ease,
          interval_days,
          next_due_at,
          lapses,
          seen_count,
          created_at,
          updated_at
        ) VALUES ('ko', ?, ?, ?, ?, 0, 2.5, 0, ?, 0, 0, ?, ?)
        ON CONFLICT(lang, surface) DO UPDATE SET
          meaning = excluded.meaning,
          example_ko = excluded.example_ko,
          source = excluded.source,
          updated_at = excluded.updated_at`
      )
      .run(
        normalizedSurface,
        input.meaning.trim(),
        (input.exampleKo || `${normalizedSurface}를 복습합니다.`).trim(),
        input.source || 'extension',
        now,
        now,
        now
      );

    const row = this.db
      .prepare(
        'SELECT id, lang, surface, meaning, example_ko, source, stage FROM vocab WHERE lang = ? AND surface = ?'
      )
      .get('ko', normalizedSurface) as {
      id: number;
      lang: 'ko' | 'ja';
      surface: string;
      meaning: string;
      example_ko: string;
      source: string;
      stage: number;
    };

    return {
      id: row.id,
      lang: row.lang,
      surface: row.surface,
      meaning: row.meaning,
      exampleKo: row.example_ko,
      source: row.source,
      stage: row.stage
    };
  }

  lookupVocab(text: string): LookupResult {
    const normalized = text.trim();

    const row = this.db
      .prepare('SELECT surface, meaning, example_ko FROM vocab WHERE lang = ? AND surface = ? COLLATE NOCASE LIMIT 1')
      .get('ko', normalized) as { surface: string; meaning: string; example_ko: string } | undefined;

    if (!row) {
      const gloss = localGlossToEnglish(normalized);
      if (gloss) {
        return {
          text: normalized,
          found: true,
          meaning: gloss.meaning
        };
      }
      return {
        text: normalized,
        found: false
      };
    }

    return {
      text: row.surface,
      found: true,
      meaning: row.meaning,
      exampleKo: row.example_ko
    };
  }

  async translateSentenceInput(text: string): Promise<TranslationResult> {
    return translateSentence(text, this);
  }

  async translateToEnglishInput(text: string): Promise<EnglishGlossResult> {
    return glossToEnglish(text);
  }

  getCachedTranslation(hash: string): TranslationResult | null {
    const row = this.db
      .prepare('SELECT korean_sentence, confidence, source, key_terms_json FROM translation_cache WHERE hash = ?')
      .get(hash) as
      | {
          korean_sentence: string;
          confidence: number;
          source: TranslationResult['source'];
          key_terms_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      koreanSentence: row.korean_sentence,
      confidence: row.confidence,
      source: row.source,
      keyTerms: parseJsonArray(row.key_terms_json)
    };
  }

  saveCachedTranslation(hash: string, inputText: string, result: TranslationResult): void {
    this.db
      .prepare(
        `INSERT INTO translation_cache (hash, input_text, korean_sentence, confidence, source, key_terms_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO UPDATE SET
           input_text = excluded.input_text,
           korean_sentence = excluded.korean_sentence,
           confidence = excluded.confidence,
           source = excluded.source,
           key_terms_json = excluded.key_terms_json,
           created_at = excluded.created_at`
      )
      .run(
        hash,
        inputText,
        result.koreanSentence,
        result.confidence,
        result.source,
        JSON.stringify(result.keyTerms),
        nowIso()
      );
  }

  exportData(): string {
    const payload = {
      generatedAt: nowIso(),
      dayStatus: this.getTodayStatus(),
      settings: this.db.prepare('SELECT key, value FROM settings ORDER BY key').all(),
      days: this.db.prepare('SELECT * FROM days ORDER BY date DESC LIMIT 90').all(),
      vocab: this.db
        .prepare('SELECT id, lang, surface, meaning, example_ko, source, stage, seen_count, lapses, next_due_at FROM vocab ORDER BY id')
        .all(),
      sessions: this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 200').all(),
      attempts: this.db
        .prepare('SELECT * FROM attempts ORDER BY attempted_at DESC LIMIT 2000')
        .all()
    };

    const stamp = nowIso().replace(/[:.]/g, '-');
    const filePath = path.join(this.paths.exportsDir, `snapshot-${stamp}.json`);
    const latestPath = path.join(this.paths.exportsDir, 'latest.json');

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');

    return filePath;
  }

  syncDocs(options?: { sessionId?: string; trigger?: string }): DocSyncResult {
    return syncHandbook(this.db, this.paths, options);
  }

  importCsv(filePath: string): { imported: number; skipped: number } {
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    let imported = 0;
    let skipped = 0;

    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const [surface, meaning, exampleKo] = line.split(',').map((cell) => cell?.trim() || '');
        if (!surface || !meaning) {
          skipped += 1;
          continue;
        }

        const existing = this.db
          .prepare('SELECT id FROM vocab WHERE lang = ? AND surface = ?')
          .get('ko', surface) as { id: number } | undefined;

        if (existing) {
          skipped += 1;
          continue;
        }

        this.saveVocab({
          text: surface,
          meaning,
          exampleKo: exampleKo || `${surface}를 연습합니다.`,
          source: 'csv_import'
        });
        imported += 1;
      }
    });

    tx();

    return { imported, skipped };
  }

  private assertSessionExists(sessionId: string): void {
    const row = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }

  private pickNextCategory(sessionId: string): ExerciseCategory {
    const rows = this.db
      .prepare('SELECT category, COUNT(*) as count FROM attempts WHERE session_id = ? GROUP BY category')
      .all(sessionId) as Array<{ category: ExerciseCategory; count: number }>;

    const counts: Record<ExerciseCategory, number> = { review: 0, new: 0, sentence: 0 };
    for (const row of rows) {
      counts[row.category] = row.count;
    }

    const total = counts.review + counts.new + counts.sentence;

    const availability: Record<ExerciseCategory, boolean> = {
      review: this.hasReviewItems(),
      new: this.hasNewItems(),
      sentence: this.hasSentenceItems()
    };

    let selected: ExerciseCategory | null = null;
    let bestGap = Number.NEGATIVE_INFINITY;

    for (const category of CATEGORY_ORDER) {
      if (!availability[category]) {
        continue;
      }
      const expected = (total + 1) * SESSION_MIX[category];
      const gap = expected - counts[category];
      if (gap > bestGap) {
        bestGap = gap;
        selected = category;
      }
    }

    if (selected) {
      return selected;
    }

    return 'review';
  }

  private hasReviewItems(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM vocab WHERE seen_count > 0 AND next_due_at <= ?')
      .get(nowIso()) as { count: number };
    return row.count > 0;
  }

  private hasNewItems(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM vocab WHERE seen_count = 0').get() as { count: number };
    return row.count > 0;
  }

  private hasSentenceItems(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM vocab WHERE seen_count > 0').get() as { count: number };
    return row.count > 0;
  }

  private pickVocabForCategory(category: ExerciseCategory): VocabRow | undefined {
    if (category === 'review') {
      return this.db
        .prepare('SELECT * FROM vocab WHERE seen_count > 0 AND next_due_at <= ? ORDER BY next_due_at ASC LIMIT 1')
        .get(nowIso()) as VocabRow | undefined;
    }

    if (category === 'new') {
      return this.db
        .prepare('SELECT * FROM vocab WHERE seen_count = 0 ORDER BY RANDOM() LIMIT 1')
        .get() as VocabRow | undefined;
    }

    return this.db
      .prepare('SELECT * FROM vocab WHERE seen_count > 0 ORDER BY RANDOM() LIMIT 1')
      .get() as VocabRow | undefined;
  }

  private buildChoiceOptions(correctMeaning: string, vocabId: number): string[] {
    const distractors = this.db
      .prepare('SELECT meaning FROM vocab WHERE id != ? ORDER BY RANDOM() LIMIT 3')
      .all(vocabId) as Array<{ meaning: string }>;

    const options = [correctMeaning, ...distractors.map((row) => row.meaning)];

    for (let i = options.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    return options;
  }

  private rolloverToToday(referenceDate = new Date()): void {
    const today = formatLocalDate(referenceDate, this.timezone);
    let lastRollover = readSetting(this.db, 'last_rollover_date', today);
    let debt = Number(readSetting(this.db, 'current_debt_seconds', '0'));
    let streak = Number(readSetting(this.db, 'streak_count', '0'));

    if (compareDateIso(lastRollover, today) > 0) {
      lastRollover = today;
      debt = 0;
      streak = 0;
    }

    while (compareDateIso(lastRollover, today) < 0) {
      const dayRow = this.ensureDayRow(lastRollover, debt, streak);
      const unresolved = Math.max(0, dayRow.required_seconds - dayRow.completed_seconds);

      if (unresolved === 0) {
        streak += 1;
      } else {
        streak = 0;
      }

      debt = Math.min(MAX_DEBT_SECONDS, unresolved);
      lastRollover = addDays(lastRollover, 1);
    }

    const todayRow = this.ensureDayRow(today, debt, streak);
    const expectedRank = deriveRank(streak);

    if (todayRow.rank !== expectedRank || todayRow.streak !== streak || todayRow.debt_seconds !== debt) {
      this.db
        .prepare('UPDATE days SET streak = ?, rank = ?, debt_seconds = ?, updated_at = ? WHERE date = ?')
        .run(streak, expectedRank, debt, nowIso(), today);
    }

    writeSetting(this.db, 'current_debt_seconds', String(debt));
    writeSetting(this.db, 'streak_count', String(streak));
    writeSetting(this.db, 'last_rollover_date', today);
  }

  private ensureDayRow(dateIso: string, debt: number, streak: number): {
    date: string;
    required_seconds: number;
    completed_seconds: number;
    debt_seconds: number;
    streak: number;
    rank: string;
  } {
    const existing = this.db
      .prepare('SELECT date, required_seconds, completed_seconds, debt_seconds, streak, rank FROM days WHERE date = ?')
      .get(dateIso) as
      | {
          date: string;
          required_seconds: number;
          completed_seconds: number;
          debt_seconds: number;
          streak: number;
          rank: string;
        }
      | undefined;

    if (existing) {
      return existing;
    }

    const required = DAILY_TARGET_SECONDS + debt;
    const rank = deriveRank(streak);

    this.db
      .prepare(
        'INSERT INTO days (date, required_seconds, completed_seconds, debt_seconds, streak, rank, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
      )
      .run(dateIso, required, debt, streak, rank, nowIso());

    return {
      date: dateIso,
      required_seconds: required,
      completed_seconds: 0,
      debt_seconds: debt,
      streak,
      rank
    };
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((value) => String(value));
  } catch {
    return [];
  }
}

function readTimezone(rootDir?: string, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (rootDir) {
    // explicit rootDir currently unused but kept for callsite clarity.
    void rootDir;
  }
  return DEFAULT_TIMEZONE;
}
