import { describe, expect, it } from 'vitest';
import { LearnerEngine } from '../../packages/core/src/engine.js';
import { writeSetting } from '../../packages/core/src/db.js';
import { addDays, formatLocalDate } from '../../packages/core/src/time.js';
import { createTempWorkspace } from '../test-utils.js';

describe('debt rollover and cap', () => {
  it('caps debt at 3 missed days equivalent', () => {
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
});
