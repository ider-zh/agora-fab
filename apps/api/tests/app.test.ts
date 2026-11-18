import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: FastifyInstance[] = [];
function createApp(checkDatabase = vi.fn(async () => {})) {
  const app = buildApp({ checkDatabase, logger: false });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('API health and error boundary', () => {
  it('is live independently of database availability', async () => {
    const checkDatabase = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const response = await createApp(checkDatabase).inject('/health/live');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('checks the database for each readiness request', async () => {
    const checkDatabase = vi.fn(async () => {});
    const app = createApp(checkDatabase);
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.inject('/health/ready');
    expect(checkDatabase).toHaveBeenCalledTimes(2);
  });

  it('returns a traceable sanitized 503 when the database is unavailable', async () => {
    const response = await createApp(
      vi.fn(async () => {
        throw new Error('postgresql://admin:private-password@db/private');
      }),
    ).inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Service is not ready.',
        requestId: response.headers['x-request-id'],
      },
    });
    expect(response.body).not.toContain('private');
  });

  it('does not echo unmatched paths and rejects caller-supplied request IDs', async () => {
    const app = createApp();
    const response = await app.inject({
      url: '/secret-path?token=private-token',
      headers: { 'request-id': 'forged-id', 'x-request-id': 'forged-id' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId: response.headers['x-request-id'],
      },
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toMatch(/private|secret|forged/);
    const second = await app.inject('/missing');
    expect(second.headers['x-request-id']).not.toBe(
      response.headers['x-request-id'],
    );
  });

  it('sanitizes unexpected failures', async () => {
    const app = createApp();
    app.get('/fail', async () => {
      throw new Error('postgresql://admin:private-password@db/private');
    });
    const response = await app.inject('/fail');
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: response.headers['x-request-id'],
      },
    });
    expect(response.body).not.toContain('private');
  });

  it('returns stable validation errors without echoing schema or request values', async () => {
    const app = createApp();
    app.post(
      '/validate',
      {
        schema: {
          body: {
            type: 'object',
            properties: { count: { type: 'integer' } },
            required: ['count'],
          },
        },
      },
      async () => ({ status: 'ok' }),
    );
    for (const payload of [
      { count: 'private-token' },
      '{invalid-private-token',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/validate',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request.',
        requestId: response.headers['x-request-id'],
      });
      expect(response.body).not.toContain('private-token');
    }
  });

  it('limits request body size with the structured error format', async () => {
    const app = createApp();
    app.post('/body', async () => ({ status: 'ok' }));
    const response = await app.inject({
      method: 'POST',
      url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ value: 'x'.repeat(64 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('keeps request credentials, URLs, cookies and dependency messages out of logs', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = buildApp({
      checkDatabase: async () => {
        throw new Error('postgresql://private-db-secret@db/private');
      },
      logStream,
    });
    apps.push(app);
    app.get('/fail', async () => {
      throw new Error('private-exception-message');
    });
    await app.inject({
      url: '/health/ready?token=private-query',
      headers: {
        authorization: 'Bearer private-auth',
        cookie: 'session=private-cookie',
      },
    });
    await app.inject('/fail?token=private-query');
    await app.inject('/private-unmatched');
    await app.close();
    const output = lines.join('');
    expect(output).not.toContain('private-');
    expect(output).toContain('DEPENDENCY_UNAVAILABLE');
    expect(output).toContain('INTERNAL_ERROR');
    expect(output).toContain('reqId');
  });
});
