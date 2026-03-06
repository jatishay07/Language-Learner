import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

export interface TempWorkspace {
  rootDir: string;
  cleanup: () => void;
}

export function createTempWorkspace(): TempWorkspace {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'learner-'));
  const seedSource = path.join(process.cwd(), 'data', 'seed', 'ko', 'starter_deck.json');
  const seedTarget = path.join(rootDir, 'data', 'seed', 'ko', 'starter_deck.json');

  fs.mkdirSync(path.dirname(seedTarget), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'data', 'exports'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'docs', 'handbook'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n', 'utf8');

  fs.copyFileSync(seedSource, seedTarget);

  return {
    rootDir,
    cleanup: () => {
      rmSync(rootDir, { recursive: true, force: true });
    }
  };
}
