import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { DocSyncResult } from '../../shared-types/src/index.js';
import type { AppPaths } from './paths.js';
import { nowIso } from './time.js';

interface ProgressMetrics {
  streak: number;
  rank: string;
  requiredSeconds: number;
  completedSeconds: number;
  debtSeconds: number;
  sevenDayAccuracy: number;
  attempts7d: number;
  weakWords: Array<{ surface: string; lapses: number }>;
}

function computeProgressMetrics(db: Database.Database): ProgressMetrics {
  const today = db
    .prepare('SELECT streak, rank, required_seconds, completed_seconds, debt_seconds FROM days ORDER BY date DESC LIMIT 1')
    .get() as
    | {
        streak: number;
        rank: string;
        required_seconds: number;
        completed_seconds: number;
        debt_seconds: number;
      }
    | undefined;

  const attempts = db
    .prepare(`
      SELECT
        COALESCE(SUM(a.correct), 0) as correct,
        COUNT(*) as total
      FROM attempts a
      JOIN sessions s ON s.id = a.session_id
      WHERE s.date >= date('now', '-6 day')
    `)
    .get() as { correct: number; total: number };

  const weakWords = db
    .prepare(`
      SELECT surface, lapses
      FROM vocab
      WHERE lapses > 0
      ORDER BY lapses DESC, updated_at DESC
      LIMIT 5
    `)
    .all() as Array<{ surface: string; lapses: number }>;

  const accuracy = attempts.total > 0 ? Math.round((attempts.correct / attempts.total) * 100) : 0;

  return {
    streak: today?.streak ?? 0,
    rank: today?.rank ?? 'Bronze',
    requiredSeconds: today?.required_seconds ?? 1800,
    completedSeconds: today?.completed_seconds ?? 0,
    debtSeconds: today?.debt_seconds ?? 0,
    sevenDayAccuracy: accuracy,
    attempts7d: attempts.total,
    weakWords
  };
}

function renderMasterPlan(): string {
  return `# Master Plan\n\n## Scope\n- Local-only Korean trainer CLI with strict daily gate.\n- Local daemon API shared by CLI and Chrome extension.\n- Chrome extension for all-site Korean reading immersion with lookup/save.\n- SQLite primary storage with JSON mirror exports.\n- Auto-updated handbook to guide iteration.\n\n## Locked Product Rules\n- Daily target: 1800 active seconds.\n- Debt carryover cap: 5400 seconds.\n- Session mix: 70% review, 20% new, 10% sentence drills.\n- Mixed progression: choice early, typed recall later.\n- Korean-only content in v1; language-neutral internals for future expansion.\n\n## Interfaces\n- CLI: start, status, daemon, reminders install, export, docs sync, import.\n- Daemon: health, status, session start/attempt, vocab save/lookup, sentence translation, docs sync.\n`;
}

function renderLearnerProgress(metrics: ProgressMetrics): string {
  const completionPct = Math.round((metrics.completedSeconds / Math.max(metrics.requiredSeconds, 1)) * 100);
  const weakLines =
    metrics.weakWords.length > 0
      ? metrics.weakWords.map((word, index) => `${index + 1}. ${word.surface} (lapses: ${word.lapses})`).join('\n')
      : '1. No repeated weak terms yet.';

  return `# Learner Progress\n\n- Streak: **${metrics.streak}**\n- Rank: **${metrics.rank}**\n- Today completion: **${metrics.completedSeconds}/${metrics.requiredSeconds} sec** (${completionPct}%)\n- Debt: **${metrics.debtSeconds} sec**\n- 7-day retention accuracy: **${metrics.sevenDayAccuracy}%** across **${metrics.attempts7d} attempts**\n\n## Weak Areas\n${weakLines}\n\n## Weekly Trend\n- Track consistency and retention first; volume is secondary.\n- If debt rises for 2+ days, reduce new-item introduction next session.\n`;
}

function renderAdaptationNotes(metrics: ProgressMetrics): string {
  const adaptation = metrics.sevenDayAccuracy < 70
    ? '- Accuracy below target. Reduce new cards by 40% and increase review repetition.'
    : '- Accuracy stable. Keep current ratio and increase typed recall pressure gradually.';

  const debtRule = metrics.debtSeconds > 0
    ? '- Debt exists. Prioritize debt clearance before introducing optional drills.'
    : '- No debt. Allow one bonus sentence drill block after gate completion.';

  return `# Adaptation Notes\n\n## Rules\n${adaptation}\n${debtRule}\n- If same vocab lapses 3+ times, insert cue sentence before next typed prompt.\n- Promote from choice to typed when seen_count >= 3 or stage >= 2.\n`;
}

function renderScienceDeepDive(): string {
  return `# Language Science Deep Dive\n\n| Method | Mechanism | Evidence Quality | App Mapping |\n|---|---|---|---|\n| Spaced Repetition | Expands intervals to improve long-term retention. | High | SRS in vocab scheduling with ease and interval updates. |\n| Retrieval Practice | Recall strengthens memory traces. | High | Typed recall prompts after early exposures. |\n| Interleaving | Mixed topics improve discrimination. | Moderate-High | Review/new/sentence ratio in each session. |\n| Desirable Difficulties | Productive challenge improves transfer. | Moderate | Hard gate + typed mode progression. |\n| Feynman Technique | Explain simply to reveal knowledge gaps. | Moderate | Future: short self-explanation prompts for missed items. |\n| Elaborative Interrogation | Linking why/how deepens encoding. | Moderate | Concise feedback note per attempt. |\n| Dual Coding | Text + meaning pairing improves recall. | Moderate | Surface/meaning/example triad in each vocab item. |\n| Immediate vs Delayed Feedback | Timing affects correction and retention. | Moderate | Immediate correctness + due-soon retries on misses. |\n| Habit Reinforcement | Consistent cue-routine-reward stabilizes behavior. | Moderate | Midnight gate, reminders, streak + rank system. |\n\n## Practical Guidance\n- Optimize for consistent daily completion first, then ramp new content.\n- Preserve productive friction; avoid making all prompts easy.\n`;
}

function renderDecisions(): string {
  return `# Decisions\n\n1. Korean-first content in v1 with multi-language internal schemas.\n2. Local-only core with optional OpenAI fallback for translation quality.\n3. Shared SQLite through local daemon API to sync CLI and extension.\n4. Hard-gated 30-minute daily requirement with debt cap at 3 days.\n5. Full handbook docs auto-updated after session completion.\n`;
}

function renderExperiments(): string {
  return `# Experiments\n\n## Active Hypotheses\n1. Increasing typed prompts after 3 successful recognitions will improve 7-day retention above 80%.\n2. Two reminders (19:00, 22:30 local) will reduce missed-day rate versus one reminder.\n3. Sentence-level immersion overlay will reduce unknown-word frequency over 30 days.\n\n## Logging Format\n- Hypothesis\n- Date range\n- Metrics\n- Result\n- Action\n`;
}

function renderNextActions(metrics: ProgressMetrics): string {
  const priority = metrics.debtSeconds > 0
    ? 'Clear debt and hold new items until debt reaches zero.'
    : 'Maintain no-debt state and expand sentence drill quality.';

  return `# Next Actions\n\n1. ${priority}\n2. Add targeted sentence sets for weak words with high lapses.\n3. Extend extension dictionary coverage for common web vocabulary.\n4. Add Japanese content pack scaffolding without enabling UI yet.\n`;
}

function appendWorklog(worklogPath: string, sessionId?: string, trigger = 'manual_sync'): void {
  const timestamp = nowIso();
  const line = `- ${timestamp} | trigger=${trigger}${sessionId ? ` | session=${sessionId}` : ''}\n`;

  if (!fs.existsSync(worklogPath)) {
    fs.writeFileSync(worklogPath, '# Agent Worklog\n\n', 'utf8');
  }

  fs.appendFileSync(worklogPath, line, 'utf8');
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function syncHandbook(
  db: Database.Database,
  paths: AppPaths,
  options?: { sessionId?: string; trigger?: string }
): DocSyncResult {
  const metrics = computeProgressMetrics(db);

  const files: Array<{ name: string; content: string }> = [
    { name: '00_MASTER_PLAN.md', content: renderMasterPlan() },
    { name: '02_LEARNER_PROGRESS.md', content: renderLearnerProgress(metrics) },
    { name: '03_ADAPTATION_NOTES.md', content: renderAdaptationNotes(metrics) },
    { name: '04_LANGUAGE_SCIENCE_DEEP_DIVE.md', content: renderScienceDeepDive() },
    { name: '05_DECISIONS.md', content: renderDecisions() },
    { name: '06_EXPERIMENTS.md', content: renderExperiments() },
    { name: '07_NEXT_ACTIONS.md', content: renderNextActions(metrics) }
  ];

  const updatedFiles: string[] = [];

  for (const file of files) {
    const target = path.join(paths.handbookDir, file.name);
    writeFile(target, file.content);
    updatedFiles.push(target);
  }

  const worklog = path.join(paths.handbookDir, '01_AGENT_WORKLOG.md');
  appendWorklog(worklog, options?.sessionId, options?.trigger);
  updatedFiles.push(worklog);

  db.prepare('INSERT INTO handbook_events (event_type, payload_json, created_at) VALUES (?, ?, ?)').run(
    options?.trigger || 'manual_sync',
    JSON.stringify({ sessionId: options?.sessionId ?? null, updatedFiles }),
    nowIso()
  );

  return {
    updatedFiles,
    sessionId: options?.sessionId,
    generatedAt: nowIso()
  };
}
