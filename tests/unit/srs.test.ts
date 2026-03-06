import { describe, expect, it } from 'vitest';
import { transitionReviewState } from '../../packages/core/src/srs.js';

describe('transitionReviewState', () => {
  it('increases interval and keeps lapses when answer is correct', () => {
    const next = transitionReviewState(
      {
        ease: 2.5,
        intervalDays: 2,
        nextDueAt: new Date().toISOString(),
        lapses: 1
      },
      true,
      new Date('2026-03-05T00:00:00.000Z')
    );

    expect(next.intervalDays).toBeGreaterThanOrEqual(2);
    expect(next.ease).toBeGreaterThan(2.5);
    expect(next.lapses).toBe(1);
  });

  it('resets interval and increments lapses when answer is incorrect', () => {
    const next = transitionReviewState(
      {
        ease: 2.5,
        intervalDays: 5,
        nextDueAt: new Date().toISOString(),
        lapses: 0
      },
      false,
      new Date('2026-03-05T00:00:00.000Z')
    );

    expect(next.intervalDays).toBe(0);
    expect(next.lapses).toBe(1);
    expect(next.ease).toBeLessThan(2.5);
  });
});
