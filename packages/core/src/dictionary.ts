import { clampNumber } from './time.js';

const PHRASE_MAP: Record<string, string> = {
  search: '검색',
  home: '홈',
  settings: '설정',
  account: '계정',
  update: '업데이트',
  language: '언어',
  lesson: '학습',
  word: '단어',
  sentence: '문장',
  read: '읽기',
  practice: '연습',
  save: '저장',
  open: '열기',
  close: '닫기',
  submit: '제출',
  next: '다음',
  previous: '이전',
  translate: '번역',
  dictionary: '사전',
  example: '예문',
  morning: '아침',
  night: '밤',
  friend: '친구',
  school: '학교',
  food: '음식',
  water: '물',
  coffee: '커피',
  thank: '감사',
  hello: '안녕하세요',
  goodbye: '안녕히 가세요'
};

export interface LocalTranslation {
  koreanSentence: string;
  confidence: number;
  keyTerms: string[];
}

export function normalizeSentence(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function localTranslateSentence(text: string): LocalTranslation {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      koreanSentence: text,
      confidence: 0,
      keyTerms: []
    };
  }

  let known = 0;
  const keyTerms: string[] = [];
  const translatedTokens = tokens.map((token) => {
    const mapped = PHRASE_MAP[token];
    if (mapped) {
      known += 1;
      keyTerms.push(mapped);
      return mapped;
    }
    return token;
  });

  const confidence = clampNumber(known / tokens.length, 0, 1);

  const koreanSentence = translatedTokens
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    koreanSentence: koreanSentence.length > 0 ? koreanSentence : text,
    confidence,
    keyTerms: Array.from(new Set(keyTerms))
  };
}
