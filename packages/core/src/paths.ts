import fs from 'node:fs';
import path from 'node:path';

export interface AppPaths {
  rootDir: string;
  dataDir: string;
  exportsDir: string;
  docsDir: string;
  handbookDir: string;
  seedDeckPath: string;
  dbPath: string;
}

function hasRootMarkers(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(dir, '.git'));
}

export function resolveProjectRoot(startDir = process.cwd()): string {
  if (process.env.LEARNER_ROOT) {
    return process.env.LEARNER_ROOT;
  }

  let current = path.resolve(startDir);
  while (true) {
    if (hasRootMarkers(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function buildPaths(rootDir = resolveProjectRoot()): AppPaths {
  const dataDir = path.join(rootDir, 'data');
  const exportsDir = path.join(dataDir, 'exports');
  const docsDir = path.join(rootDir, 'docs');
  const handbookDir = path.join(docsDir, 'handbook');

  return {
    rootDir,
    dataDir,
    exportsDir,
    docsDir,
    handbookDir,
    seedDeckPath: path.join(rootDir, 'data', 'seed', 'ko', 'starter_deck.json'),
    dbPath: path.join(dataDir, 'learner.db')
  };
}

export function ensureAppDirs(paths: AppPaths): void {
  const dirs = [paths.dataDir, paths.exportsDir, paths.docsDir, paths.handbookDir, path.dirname(paths.seedDeckPath)];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
