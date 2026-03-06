import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDERS, renderPlist } from '../../scripts/install-reminders.js';

describe('reminder configuration', () => {
  it('renders deterministic plist output for idempotent writes', () => {
    const rootDir = '/tmp/language-learner';
    const first = renderPlist(DEFAULT_REMINDERS[0], rootDir);
    const second = renderPlist(DEFAULT_REMINDERS[0], rootDir);

    expect(first).toBe(second);
    expect(first).toContain('<key>StartCalendarInterval</key>');
  });
});
