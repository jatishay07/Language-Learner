import { describe, expect, it } from 'vitest';
import { getPromptMode } from '../../packages/core/src/mixed-mode.js';

describe('getPromptMode', () => {
  it('returns choice for early exposures', () => {
    expect(getPromptMode(0, 0)).toBe('choice');
    expect(getPromptMode(1, 2)).toBe('choice');
  });

  it('returns typed for advanced exposures', () => {
    expect(getPromptMode(2, 1)).toBe('typed');
    expect(getPromptMode(1, 3)).toBe('typed');
  });
});
