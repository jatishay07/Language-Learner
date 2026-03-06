import type { Rank } from '../../shared-types/src/index.js';

export function deriveRank(streak: number): Rank {
  if (streak >= 45) {
    return 'Diamond';
  }
  if (streak >= 30) {
    return 'Platinum';
  }
  if (streak >= 14) {
    return 'Gold';
  }
  if (streak >= 7) {
    return 'Silver';
  }
  return 'Bronze';
}
