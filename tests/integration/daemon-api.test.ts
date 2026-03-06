import { afterEach, describe, expect, it } from 'vitest';
import { createDaemonServer } from '../../apps/daemon/src/server.js';
import { LearnerEngine } from '../../packages/core/src/engine.js';
import { createTempWorkspace } from '../test-utils.js';

describe('daemon API', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      fn?.();
    }
  });

  it('supports status, session attempts, and vocab save/lookup', async () => {
    const temp = createTempWorkspace();
    cleanups.push(temp.cleanup);

    const engine = new LearnerEngine({ rootDir: temp.rootDir, timezone: 'UTC' });
    const { fastify } = createDaemonServer({ engine });
    cleanups.push(() => {
      engine.close();
    });
    cleanups.push(() => {
      void fastify.close();
    });

    await fastify.ready();

    const health = await fastify.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const status = await fastify.inject({ method: 'GET', url: '/v1/status/today' });
    expect(status.statusCode).toBe(200);
    expect(status.json().requiredSeconds).toBeGreaterThan(0);

    const started = await fastify.inject({ method: 'POST', url: '/v1/session/start' });
    expect(started.statusCode).toBe(200);

    const sessionId = started.json().sessionId as string;
    const exercise = engine.getNextExercise(sessionId);

    const attempt = await fastify.inject({
      method: 'POST',
      url: '/v1/session/attempt',
      payload: {
        sessionId,
        exerciseId: exercise.id,
        vocabId: exercise.vocabId,
        category: exercise.category,
        promptMode: exercise.mode,
        correct: true,
        answerText: exercise.correctAnswer,
        responseMs: 1000,
        activeSecondsDelta: 60
      }
    });

    expect(attempt.statusCode).toBe(200);
    expect(attempt.json().dayStatus.completedSeconds).toBeGreaterThan(0);

    const save = await fastify.inject({
      method: 'POST',
      url: '/v1/vocab/save',
      payload: {
        text: '테스트저장',
        meaning: 'save test',
        exampleKo: '테스트저장을 저장합니다.',
        source: 'integration_test'
      }
    });

    expect(save.statusCode).toBe(200);

    const lookup = await fastify.inject({
      method: 'GET',
      url: '/v1/vocab/lookup?text=%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%A0%80%EC%9E%A5'
    });

    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().found).toBe(true);

    const toEnglish = await fastify.inject({
      method: 'POST',
      url: '/v1/translate/to-english',
      payload: {
        text: '검색 설정'
      }
    });
    expect(toEnglish.statusCode).toBe(200);
    expect(toEnglish.json().englishText).toContain('search');
  });
});
