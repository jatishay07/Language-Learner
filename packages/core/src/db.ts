import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DAILY_TARGET_SECONDS } from './constants.js';
import type { AppPaths } from './paths.js';
import { ensureAppDirs } from './paths.js';
import { formatLocalDate, nowIso } from './time.js';

export interface SeedItem {
  surface: string;
  meaning: string;
  exampleKo: string;
  source?: string;
}

export function openLearnerDatabase(paths: AppPaths, timezone: string): Database.Database {
  ensureAppDirs(paths);

  const db = new Database(paths.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  initializeSettings(db, timezone);
  seedStarterDeck(db, paths.seedDeckPath);

  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS days (
      date TEXT PRIMARY KEY,
      required_seconds INTEGER NOT NULL,
      completed_seconds INTEGER NOT NULL DEFAULT 0,
      debt_seconds INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      rank TEXT NOT NULL DEFAULT 'Bronze',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vocab (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      surface TEXT NOT NULL,
      meaning TEXT NOT NULL,
      example_ko TEXT NOT NULL,
      source TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      next_due_at TEXT NOT NULL,
      lapses INTEGER NOT NULL DEFAULT 0,
      seen_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(lang, surface)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      vocab_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      prompt_mode TEXT NOT NULL,
      correct INTEGER NOT NULL,
      answer_text TEXT,
      response_ms INTEGER NOT NULL,
      active_seconds_delta INTEGER NOT NULL,
      attempted_at TEXT NOT NULL,
      FOREIGN KEY(vocab_id) REFERENCES vocab(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS translation_cache (
      hash TEXT PRIMARY KEY,
      input_text TEXT NOT NULL,
      korean_sentence TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      key_terms_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS handbook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vocab_due ON vocab(next_due_at, seen_count);
    CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
    CREATE INDEX IF NOT EXISTS idx_days_updated ON days(updated_at);
  `);
}

function initializeSettings(db: Database.Database, timezone: string): void {
  const now = nowIso();
  const today = formatLocalDate(new Date(), timezone);

  const defaults: Array<[string, string]> = [
    ['timezone', timezone],
    ['current_debt_seconds', '0'],
    ['streak_count', '0'],
    ['last_rollover_date', today],
    ['daily_target_seconds', String(DAILY_TARGET_SECONDS)]
  ];

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);

  const tx = db.transaction(() => {
    for (const [key, value] of defaults) {
      upsert.run(key, value, now);
    }
  });

  tx();
}

function seedStarterDeck(db: Database.Database, seedPath: string): void {
  const vocabCount = db.prepare('SELECT COUNT(*) as count FROM vocab').get() as { count: number };
  if (vocabCount.count > 0) {
    return;
  }

  if (!fs.existsSync(seedPath)) {
    throw new Error(`Starter deck not found at ${seedPath}`);
  }

  const raw = fs.readFileSync(seedPath, 'utf8');
  const parsed = JSON.parse(raw) as SeedItem[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO vocab (
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
    ) VALUES (
      @lang,
      @surface,
      @meaning,
      @example_ko,
      @source,
      0,
      2.5,
      0,
      @next_due_at,
      0,
      0,
      @created_at,
      @updated_at
    )
  `);

  const now = nowIso();
  const tx = db.transaction(() => {
    for (const item of parsed) {
      insert.run({
        lang: 'ko',
        surface: item.surface,
        meaning: item.meaning,
        example_ko: item.exampleKo,
        source: item.source || 'starter_deck',
        next_due_at: now,
        created_at: now,
        updated_at: now
      });
    }
  });

  tx();
}

export function readSetting(db: Database.Database, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined;
  return row?.value ?? fallback;
}

export function writeSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

export function ensureDataPathExists(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
