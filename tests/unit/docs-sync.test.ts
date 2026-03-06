import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LearnerEngine } from '../../packages/core/src/engine.js';
import { createTempWorkspace } from '../test-utils.js';

describe('handbook sync', () => {
  it('writes all handbook files', () => {
    const temp = createTempWorkspace();
    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });

    const result = engine.syncDocs({ trigger: 'manual_sync' });

    expect(result.updatedFiles.length).toBeGreaterThanOrEqual(8);
    const masterPlan = path.join(temp.rootDir, 'docs', 'handbook', '00_MASTER_PLAN.md');
    const content = fs.readFileSync(masterPlan, 'utf8');
    expect(content).toContain('Master Plan');

    engine.close();
    temp.cleanup();
  });
});
