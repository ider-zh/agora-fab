import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiHealth } from './health';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Web dependency health', () => {
  it('accepts a successful readiness response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok' })),
    );
    expect(await getApiHealth()).toBe(true);
  });

  it.each([
    Response.json({ status: 'ok' }, { status: 503 }),
    Response.json({ status: 'unavailable' }),
    Response.json(null),
    new Response('not JSON'),
  ])(
    'reports unavailable for failed or malformed readiness: %s',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      expect(await getApiHealth()).toBe(false);
    },
  );

  it('handles network failures and invalid server configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection failed')),
    );
    expect(await getApiHealth()).toBe(false);
    vi.stubEnv('API_INTERNAL_URL', 'invalid-url');
    expect(await getApiHealth()).toBe(false);
  });
});
