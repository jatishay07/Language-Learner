import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LearnerEngine } from '../../packages/core/src/engine.js';
import { addDays, formatLocalDate } from '../../packages/core/src/time.js';
import { writeSetting } from '../../packages/core/src/db.js';
import { createTempWorkspace } from '../test-utils.js';

function submitCorrectAttempt(engine: LearnerEngine, sessionId: string, activeSecondsDelta = 120) {
  const exercise = engine.getNextExercise(sessionId);
  return engine.recordAttempt({
    sessionId,
    exerciseId: exercise.id,
    vocabId: exercise.vocabId,
    category: exercise.category,
    promptMode: exercise.mode,
    correct: true,
    answerText: exercise.correctAnswer,
    responseMs: 1000,
    activeSecondsDelta
  });
}

describe('e2e scenarios', () => {
  it('caps debt at 3 missed days after 4 misses', () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const today = formatLocalDate(new Date(), 'UTC');
    const fourDaysAgo = addDays(today, -4);
    engine.db.prepare('DELETE FROM days').run();
    writeSetting(engine.db, 'last_rollover_date', fourDaysAgo);
    writeSetting(engine.db, 'current_debt_seconds', '0');
    writeSetting(engine.db, 'streak_count', '0');

    const status = engine.getTodayStatus();
    expect(status.debtSeconds).toBe(5400);
    expect(status.requiredSeconds).toBe(7200);

    engine.close();
    temp.cleanup();
  });

  it('unlocks gate with chunked attempts summing required time', () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const session = engine.startSession();
    let unlocked = false;

    for (let i = 0; i < 30; i += 1) {
      const result = submitCorrectAttempt(engine, session.sessionId, 120);
      if (result.gateUnlocked) {
        unlocked = true;
        break;
      }
    }

    const status = engine.getTodayStatus();
    expect(unlocked).toBe(true);
    expect(status.completedSeconds).toBeGreaterThanOrEqual(status.requiredSeconds);

    engine.close();
    temp.cleanup();
  });

  it('saved unknown word can appear in next review queue', () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const saved = engine.saveVocab({
      text: '확장단어',
      meaning: 'extension word',
      exampleKo: '확장단어를 문장에서 연습합니다.',
      source: 'extension_test'
    });

    engine.db
      .prepare('UPDATE vocab SET seen_count = 1, next_due_at = ?, stage = 2 WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), saved.id);

    const session = engine.startSession();
    const exercise = engine.getNextExercise(session.sessionId);

    expect(exercise.vocabId).toBe(saved.id);

    engine.close();
    temp.cleanup();
  });

  it('works without OpenAI key for translation fallback', async () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await engine.translateSentenceInput('novel lexicon for browser overlay');
    expect(result.source).toBe('local_dictionary');

    if (previous) {
      process.env.OPENAI_API_KEY = previous;
    }

    engine.close();
    temp.cleanup();
  });

  it('writes JSON mirror after gate completion', () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const session = engine.startSession();

    for (let i = 0; i < 30; i += 1) {
      const result = submitCorrectAttempt(engine, session.sessionId, 120);
      if (result.gateUnlocked) {
        break;
      }
    }

    const latestPath = path.join(temp.rootDir, 'data', 'exports', 'latest.json');
    expect(fs.existsSync(latestPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as { dayStatus?: { requiredSeconds: number; completedSeconds: number } };
    expect(payload.dayStatus?.completedSeconds).toBeGreaterThanOrEqual(payload.dayStatus?.requiredSeconds || 0);

    engine.close();
    temp.cleanup();
  });
});
