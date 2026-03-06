import type { PromptMode } from '../../shared-types/src/index.js';

export function getPromptMode(stage: number, seenCount: number): PromptMode {
  if (stage >= 2 || seenCount >= 3) {
    return 'typed';
  }
  return 'choice';
}
