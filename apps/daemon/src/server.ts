import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AttemptInputSchema,
  SaveVocabInputSchema,
  TranslateSentenceInputSchema
} from '../../../packages/shared-types/src/index.js';
import { APP_HOST, APP_PORT, LearnerEngine } from '../../../packages/core/src/index.js';

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
