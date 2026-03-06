import { describe, expect, it } from 'vitest';
import { glossToEnglish, translateSentence } from '../../packages/core/src/translation.js';
import { localGlossToEnglish } from '../../packages/core/src/dictionary.js';
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

describe('localGlossToEnglish', () => {
  it('returns english gloss for known korean terms', () => {
    const gloss = localGlossToEnglish('검색 설정 언어');
    expect(gloss?.meaning).toContain('search');
    expect(gloss?.meaning).toContain('settings');
    expect(gloss?.meaning).toContain('language');
  });
});

describe('glossToEnglish', () => {
  it('returns identity for english text', async () => {
    const result = await glossToEnglish('settings');
    expect(result.englishText).toBe('settings');
    expect(result.source).toBe('identity');
  });

  it('returns english for hangul terms with local gloss', async () => {
    const result = await glossToEnglish('검색 설정');
    expect(result.englishText).toContain('search');
    expect(result.englishText).toContain('settings');
    expect(result.source).toBe('local_gloss');
  });
});
