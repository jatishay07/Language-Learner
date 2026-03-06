import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createTempWorkspace } from '../test-utils.js';

function runCli(args: string[], rootDir: string): string {
  return execFileSync('node', ['--import', 'tsx', 'apps/cli/src/index.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LEARNER_ROOT: rootDir
    },
    encoding: 'utf8'
  });
}

describe('cli smoke', () => {
  it('runs status/docs/export commands', () => {
    const temp = createTempWorkspace();

    const statusOut = runCli(['status'], temp.rootDir);
    expect(statusOut).toContain('Required:');

    const docsOut = runCli(['docs:sync'], temp.rootDir);
    expect(docsOut).toContain('Updated');

    const exportOut = runCli(['export'], temp.rootDir);
    expect(exportOut).toContain('Exported snapshot:');

    const latestPath = path.join(temp.rootDir, 'data', 'exports', 'latest.json');
    expect(fs.existsSync(latestPath)).toBe(true);

    temp.cleanup();
  });
});
