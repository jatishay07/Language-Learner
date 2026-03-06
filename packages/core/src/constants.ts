export const DAILY_TARGET_SECONDS = 1800;
export const MAX_DEBT_SECONDS = 5400;

export const SESSION_MIX = {
  review: 0.7,
  new: 0.2,
  sentence: 0.1
} as const;

export const REMINDER_TIMES = ['19:00', '22:30'] as const;

export const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

export const APP_PORT = 4317;
export const APP_HOST = '127.0.0.1';

export const REVIEW_FEEDBACK = {
  correct: 'Correct. Keep pressure high and keep moving.',
  incorrect: 'Not correct. Tighten recall and try again in review soon.'
} as const;
