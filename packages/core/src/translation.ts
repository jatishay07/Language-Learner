import { createHash } from 'node:crypto';
import type { EnglishGlossResult, TranslationResult } from '../../shared-types/src/index.js';
import { localGlossToEnglish, normalizeSentence, localTranslateSentence } from './dictionary.js';

export interface TranslationStore {
  getCachedTranslation(hash: string): TranslationResult | null;
  saveCachedTranslation(hash: string, inputText: string, result: TranslationResult): void;
}

interface OpenAiOutput {
  koreanSentence: string;
  confidence: number;
  keyTerms: string[];
}

interface OpenAiEnglishOutput {
  englishText: string;
  confidence: number;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function safeParseJson(content: string): OpenAiOutput | null {
  try {
    const parsed = JSON.parse(content) as Partial<OpenAiOutput>;
    if (!parsed.koreanSentence || !Array.isArray(parsed.keyTerms)) {
      return null;
    }
    return {
      koreanSentence: String(parsed.koreanSentence),
      confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0.7,
      keyTerms: parsed.keyTerms.map((term) => String(term))
    };
  } catch {
    return null;
  }
}

function safeParseEnglishJson(content: string): OpenAiEnglishOutput | null {
  try {
    const parsed = JSON.parse(content) as Partial<OpenAiEnglishOutput>;
    if (!parsed.englishText) {
      return null;
    }
    return {
      englishText: String(parsed.englishText),
      confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0.7
    };
  } catch {
    return null;
  }
}

async function requestOpenAiTranslation(text: string): Promise<OpenAiOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const payload = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Translate user text into natural Korean for learning. Return JSON with keys: koreanSentence (string), confidence (0-1), keyTerms (array of Korean words).'
      },
      {
        role: 'user',
        content: text
      }
    ]
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  return safeParseJson(content);
}

async function requestOpenAiEnglishGloss(text: string): Promise<OpenAiEnglishOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const payload = {
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Translate user text into concise natural English for vocabulary lookup. Return JSON with keys: englishText (string), confidence (0-1).'
      },
      {
        role: 'user',
        content: text
      }
    ]
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  return safeParseEnglishJson(content);
}

async function requestPublicEnglishGloss(text: string): Promise<OpenAiEnglishOutput | null> {
  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'ko');
    url.searchParams.set('tl', 'en');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const response = await fetch(url, {
      method: 'GET'
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      return null;
    }

    const segments = payload[0] as unknown[];
    const translated = segments
      .map((segment) => (Array.isArray(segment) ? segment[0] : ''))
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!translated) {
      return null;
    }

    return {
      englishText: translated,
      confidence: 0.7
    };
  } catch {
    return null;
  }
}

function containsHangul(text: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(text);
}

export async function translateSentence(text: string, store: TranslationStore): Promise<TranslationResult> {
  const normalized = normalizeSentence(text);
  const hash = hashText(normalized);

  const cached = store.getCachedTranslation(hash);
  if (cached) {
    return {
      ...cached,
      source: 'cache'
    };
  }

  const local = localTranslateSentence(text);
  if (local.confidence >= 0.55) {
    const result: TranslationResult = {
      koreanSentence: local.koreanSentence,
      confidence: local.confidence,
      keyTerms: local.keyTerms,
      source: 'local_dictionary'
    };
    store.saveCachedTranslation(hash, normalized, result);
    return result;
  }

  const ai = await requestOpenAiTranslation(text);
  if (ai) {
    const result: TranslationResult = {
      koreanSentence: ai.koreanSentence,
      confidence: Math.max(0, Math.min(1, ai.confidence)),
      keyTerms: ai.keyTerms,
      source: 'openai_fallback'
    };
    store.saveCachedTranslation(hash, normalized, result);
    return result;
  }

  const fallback: TranslationResult = {
    koreanSentence: local.koreanSentence,
    confidence: local.confidence,
    keyTerms: local.keyTerms,
    source: 'local_dictionary'
  };
  store.saveCachedTranslation(hash, normalized, fallback);
  return fallback;
}

export async function glossToEnglish(text: string): Promise<EnglishGlossResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      englishText: '',
      confidence: 0,
      source: 'identity'
    };
  }

  if (!containsHangul(trimmed)) {
    return {
      englishText: trimmed,
      confidence: 1,
      source: 'identity'
    };
  }

  const local = localGlossToEnglish(trimmed);
  if (local && local.confidence >= 0.5) {
    return {
      englishText: local.meaning,
      confidence: local.confidence,
      source: 'local_gloss'
    };
  }

  const ai = await requestOpenAiEnglishGloss(trimmed);
  if (ai) {
    return {
      englishText: ai.englishText,
      confidence: Math.max(0, Math.min(1, ai.confidence)),
      source: 'openai_fallback'
    };
  }

  const publicFallback = await requestPublicEnglishGloss(trimmed);
  if (publicFallback) {
    return {
      englishText: publicFallback.englishText,
      confidence: publicFallback.confidence,
      source: 'public_fallback'
    };
  }

  return {
    englishText: local?.meaning || trimmed,
    confidence: local?.confidence || 0.2,
    source: local ? 'local_gloss' : 'identity'
  };
}
