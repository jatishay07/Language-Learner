import { describe, expect, it } from 'vitest';
import { translateSentence } from '../../packages/core/src/translation.js';
import type { TranslationResult } from '../../packages/shared-types/src/index.js';

class MemoryStore {
  private readonly data = new Map<string, TranslationResult>();

  getCachedTranslation(hash: string): TranslationResult | null {
    return this.data.get(hash) || null;
  }

  saveCachedTranslation(hash: string, _inputText: string, result: TranslationResult): void {
    this.data.set(hash, result);
  }
}

describe('translateSentence routing', () => {
  it('uses local dictionary for known words and caches results', async () => {
    const store = new MemoryStore();
    const result = await translateSentence('search language settings', store);

    expect(result.source).toBe('local_dictionary');
    expect(result.confidence).toBeGreaterThan(0.55);

    const cached = await translateSentence('search language settings', store);
    expect(cached.source).toBe('cache');
  });

  it('falls back safely when OpenAI key is missing', async () => {
    const store = new MemoryStore();
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await translateSentence('quantum lexical novelty', store);

    expect(result.source).toBe('local_dictionary');

    if (previous) {
      process.env.OPENAI_API_KEY = previous;
    }
  });
});
