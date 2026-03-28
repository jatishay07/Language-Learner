import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AttemptInputSchema,
  SaveVocabInputSchema,
  TranslateSentenceInputSchema,
  TranslateToEnglishInputSchema
} from '../../../packages/shared-types/src/index.js';
import { APP_HOST, APP_PORT, LearnerEngine } from '../../../packages/core/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Shared response type ──────────────────────────────────────────────────────

interface TutorResponse {
  tutorMessage: string;
  romanization: string;
  feedbackNote: string;
  vocabWord: unknown;
  xpDelta: number;
  bonusXp: number;
  streakMaintained: boolean;
  achievement: unknown;
  miniChallenge: unknown;
  _backend?: string;
}

const FALLBACK_RESPONSE: TutorResponse = {
  tutorMessage: '죄송해요, 다시 말씀해 주세요.',
  romanization: 'joesonghaeyo, dasi malsseum hae juseyo.',
  feedbackNote: '',
  vocabWord: null,
  xpDelta: 5,
  bonusXp: 0,
  streakMaintained: true,
  achievement: null,
  miniChallenge: null
};

function parseTutorJson(raw: string): TutorResponse {
  try {
    return JSON.parse(raw) as TutorResponse;
  } catch {
    return { ...FALLBACK_RESPONSE, tutorMessage: raw || FALLBACK_RESPONSE.tutorMessage };
  }
}

// ── Anthropic call ────────────────────────────────────────────────────────────

async function callAnthropic(
  messages: Array<{ role: string; content: string }>,
  romLevel: number,
  apiKey: string
): Promise<TutorResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: buildTutorSystemPrompt(romLevel),
      messages
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const raw = data.content.find(b => b.type === 'text')?.text ?? '{}';
  return { ...parseTutorJson(raw), _backend: 'claude' };
}

// ── Ollama call ───────────────────────────────────────────────────────────────

const OLLAMA_BASE = 'http://localhost:11434';
const PREFERRED_MODELS = ['qwen2.5', 'llama3.1', 'llama3', 'gemma2', 'mistral', 'llama2'];

async function pickOllamaModel(): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error('Ollama is not running. Install from ollama.ai then run: ollama pull qwen2.5');
  const data = await res.json() as { models: Array<{ name: string }> };
  if (!data.models?.length) throw new Error('No Ollama models installed. Run: ollama pull qwen2.5');
  const names = data.models.map(m => m.name);
  return PREFERRED_MODELS.find(p => names.some(n => n.startsWith(p))) ?? names[0];
}

async function callOllama(
  messages: Array<{ role: string; content: string }>,
  romLevel: number
): Promise<TutorResponse> {
  const model = await pickOllamaModel();

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildTutorSystemPrompt(romLevel) },
        ...messages
      ],
      stream: false,
      format: 'json'   // Ollama native JSON mode
    })
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json() as { message: { content: string } };
  return { ...parseTutorJson(data.message?.content ?? '{}'), _backend: `ollama:${model}` };
}

// ── Router: Anthropic first, Ollama fallback ──────────────────────────────────

async function callTutor(
  messages: Array<{ role: string; content: string }>,
  romLevel: number
): Promise<TutorResponse & { error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (apiKey) {
    try {
      return await callAnthropic(messages, romLevel, apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fall through to Ollama on auth/quota errors or any network failure
      console.error(`[chat] Anthropic failed (${msg}) — trying Ollama`);
    }
  }

  try {
    return await callOllama(messages, romLevel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...FALLBACK_RESPONSE, error: `All backends failed. ${msg}` };
  }
}

function buildTutorSystemPrompt(romLevel: number): string {
  return `You are a warm, encouraging Korean language tutor for a beginner learner.
Goals: understand K-dramas, converse with Korean speakers, travel to Korea, read Korean webnovels.
Current level: Beginner (knows Hangul alphabet and basic vocabulary, not yet conversational).
Learning style: gamified, fun, challenge-based.

CONVERSATION RULES:
- Speak mostly in Korean at a beginner level. Keep sentences short and clear.
- Gently correct errors inline (e.g. "좋아요! But actually: 저는 학생이에요").
- Weave in K-drama, food, travel, and daily life topics.
- Occasionally use dramatic webnovel-style phrasing for fun.
- If user writes in English, respond in Korean with the English meaning in parentheses.

ROMANIZATION: Current romanizationLevel is ${romLevel}%.
- If level >= 40: include the "romanization" field.
- If level < 40: set "romanization" to "".

MINI-CHALLENGES: Every 5–7 messages, insert a miniChallenge to test something practiced.
Example: { "question": "Quick! How do you say 'I want to eat ramen'? (+10 XP!)", "correctAnswer": "라면을 먹고 싶어요", "xpReward": 10 }
Otherwise set miniChallenge to null.

XP: xpDelta = 8–15 based on message effort. bonusXp = 5 for correct grammar, 5 for new vocab used, 3 for long sentence.
streakMaintained = true if no major grammar error, false if significant mistake.

RESPONSE FORMAT: Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "tutorMessage": "Korean text of your response",
  "romanization": "romanization of tutorMessage (or empty string if level < 40)",
  "feedbackNote": "one-line note with emoji (e.g. '✅ Correct subject marker!' or '💡 Use 에서 for locations')",
  "vocabWord": { "hangul": "word", "romanization": "rom", "meaning": "English", "example": "example sentence" },
  "xpDelta": 10,
  "bonusXp": 0,
  "streakMaintained": true,
  "achievement": null,
  "miniChallenge": null
}
vocabWord should be null if no word is worth highlighting this turn.`
}

export interface DaemonServerOptions {
  engine?: LearnerEngine;
}

export function createDaemonServer(options?: DaemonServerOptions) {
  const fastify = Fastify({ logger: false });
  const engine = options?.engine ?? new LearnerEngine();

  fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS']
  });

  // ── Web UI ──────────────────────────────────────────────────────────────────

  fastify.get('/', async (request, reply) => {
    try {
      const html = readFileSync(join(__dirname, '../../web/index.html'), 'utf8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.status(404).type('text/plain').send(
        'Web UI not found. Make sure apps/web/index.html exists and you started the daemon from the repo root.'
      );
    }
  });

  // ── Chat endpoint (Anthropic → Ollama fallback) ───────────────────────────────

  fastify.post('/v1/chat', async (request) => {
    const { messages, romanizationLevel = 100 } = request.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      romanizationLevel?: number;
    };
    return callTutor(messages, romanizationLevel);
  });

  // ── Chat activity (credits session time without needing a vocab exercise) ───

  fastify.post('/v1/session/chat-activity', async (request, reply) => {
    const { sessionId, activeSeconds } = request.body as {
      sessionId: string;
      activeSeconds?: number;
    };
    try {
      return engine.recordChatActivity(sessionId, activeSeconds ?? 30);
    } catch (error) {
      reply.status(400);
      return { error: error instanceof Error ? error.message : 'Failed to record chat activity' };
    }
  });

  fastify.get('/health', async () => ({
    ok: true,
    service: 'language-learner-daemon',
    port: APP_PORT
  }));

  fastify.get('/v1/status/today', async () => {
    return engine.getTodayStatus();
  });

  fastify.post('/v1/session/start', async () => {
    return engine.startSession();
  });

  fastify.post('/v1/session/attempt', async (request, reply) => {
    try {
      const parsed = AttemptInputSchema.parse(request.body);
      return engine.recordAttempt(parsed);
    } catch (error) {
      reply.status(400);
      return {
        error: error instanceof Error ? error.message : 'Invalid attempt payload'
      };
    }
  });

  fastify.post('/v1/vocab/save', async (request, reply) => {
    try {
      const parsed = SaveVocabInputSchema.parse(request.body);
      return engine.saveVocab(parsed);
    } catch (error) {
      reply.status(400);
      return {
        error: error instanceof Error ? error.message : 'Invalid vocab payload'
      };
    }
  });

  fastify.get('/v1/vocab/lookup', async (request, reply) => {
    const query = request.query as { text?: string };
    if (!query.text) {
      reply.status(400);
      return { error: 'Missing query parameter: text' };
    }
    return engine.lookupVocab(query.text);
  });

  fastify.post('/v1/translate/sentence', async (request, reply) => {
    try {
      const parsed = TranslateSentenceInputSchema.parse(request.body);
      return await engine.translateSentenceInput(parsed.text);
    } catch (error) {
      reply.status(400);
      return {
        error: error instanceof Error ? error.message : 'Invalid translation payload'
      };
    }
  });

  fastify.post('/v1/translate/to-english', async (request, reply) => {
    try {
      const parsed = TranslateToEnglishInputSchema.parse(request.body);
      return await engine.translateToEnglishInput(parsed.text);
    } catch (error) {
      reply.status(400);
      return {
        error: error instanceof Error ? error.message : 'Invalid english translation payload'
      };
    }
  });

  fastify.post('/v1/docs/sync', async (request) => {
    const body = (request.body || {}) as { sessionId?: string; trigger?: string };
    return engine.syncDocs({
      sessionId: body.sessionId,
      trigger: body.trigger || 'manual_sync'
    });
  });

  fastify.addHook('onClose', async () => {
    engine.close();
  });

  return { fastify, engine };
}

export async function startDaemon(): Promise<void> {
  const { fastify } = createDaemonServer();

  await fastify.listen({
    host: APP_HOST,
    port: APP_PORT
  });

  // eslint-disable-next-line no-console
  console.log(`Daemon listening at http://${APP_HOST}:${APP_PORT}`);
}
