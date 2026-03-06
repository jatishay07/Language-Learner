import { z } from 'zod';

export const LanguageSchema = z.enum(['ko', 'ja']);
export type LanguageCode = z.infer<typeof LanguageSchema>;

export const RankSchema = z.enum(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']);
export type Rank = z.infer<typeof RankSchema>;

export const DayStatusSchema = z.object({
  date: z.string(),
  requiredSeconds: z.number().int().nonnegative(),
  completedSeconds: z.number().int().nonnegative(),
  debtSeconds: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  rank: RankSchema
});
export type DayStatus = z.infer<typeof DayStatusSchema>;

export const ReviewStateSchema = z.object({
  ease: z.number(),
  intervalDays: z.number().int().nonnegative(),
  nextDueAt: z.string(),
  lapses: z.number().int().nonnegative()
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const VocabItemSchema = z.object({
  id: z.number().int().nonnegative(),
  lang: LanguageSchema,
  surface: z.string(),
  meaning: z.string(),
  exampleKo: z.string(),
  source: z.string(),
  stage: z.number().int().nonnegative()
});
export type VocabItem = z.infer<typeof VocabItemSchema>;

export const TranslationSourceSchema = z.enum(['local_dictionary', 'openai_fallback', 'cache']);

export const TranslationResultSchema = z.object({
  koreanSentence: z.string(),
  confidence: z.number(),
  source: TranslationSourceSchema,
  keyTerms: z.array(z.string())
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;

export const DocSyncResultSchema = z.object({
  updatedFiles: z.array(z.string()),
  sessionId: z.string().optional(),
  generatedAt: z.string()
});
export type DocSyncResult = z.infer<typeof DocSyncResultSchema>;

export const ExerciseCategorySchema = z.enum(['review', 'new', 'sentence']);
export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

export const PromptModeSchema = z.enum(['choice', 'typed']);
export type PromptMode = z.infer<typeof PromptModeSchema>;

export const ExerciseSchema = z.object({
  id: z.string(),
  vocabId: z.number().int().nonnegative(),
  category: ExerciseCategorySchema,
  mode: PromptModeSchema,
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string(),
  meaning: z.string(),
  surface: z.string(),
  exampleKo: z.string()
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const SessionStartResultSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  dayStatus: DayStatusSchema
});
export type SessionStartResult = z.infer<typeof SessionStartResultSchema>;

export const AttemptInputSchema = z.object({
  sessionId: z.string(),
  exerciseId: z.string(),
  vocabId: z.number().int().nonnegative(),
  category: ExerciseCategorySchema,
  promptMode: PromptModeSchema,
  correct: z.boolean(),
  answerText: z.string().optional(),
  responseMs: z.number().int().nonnegative(),
  activeSecondsDelta: z.number().int().positive(),
  attemptedAt: z.string().optional()
});
export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export const AttemptResultSchema = z.object({
  dayStatus: DayStatusSchema,
  reviewState: ReviewStateSchema,
  feedback: z.string(),
  gateUnlocked: z.boolean()
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

export const LookupResultSchema = z.object({
  text: z.string(),
  found: z.boolean(),
  meaning: z.string().optional(),
  exampleKo: z.string().optional()
});
export type LookupResult = z.infer<typeof LookupResultSchema>;

export const SaveVocabInputSchema = z.object({
  text: z.string(),
  meaning: z.string(),
  exampleKo: z.string().optional(),
  source: z.string().default('extension')
});
export type SaveVocabInput = z.infer<typeof SaveVocabInputSchema>;

export const TranslateSentenceInputSchema = z.object({
  text: z.string().min(1)
});
export type TranslateSentenceInput = z.infer<typeof TranslateSentenceInputSchema>;
