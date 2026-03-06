import type { ReviewState } from '../../shared-types/src/index.js';

export function transitionReviewState(previous: ReviewState, correct: boolean, now = new Date()): ReviewState {
  if (!correct) {
    return {
      ease: Math.max(1.3, Number((previous.ease - 0.2).toFixed(2))),
      intervalDays: 0,
      nextDueAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      lapses: previous.lapses + 1
    };
  }

  const nextEase = Number((previous.ease + 0.05).toFixed(2));
  const base = previous.intervalDays <= 0 ? 1 : previous.intervalDays;
  const nextInterval = Math.max(1, Math.round(base * nextEase));

  const nextDue = new Date(now);
  nextDue.setUTCDate(nextDue.getUTCDate() + nextInterval);

  return {
    ease: nextEase,
    intervalDays: nextInterval,
    nextDueAt: nextDue.toISOString(),
    lapses: previous.lapses
  };
}
