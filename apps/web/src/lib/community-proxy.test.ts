import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyCommunity } from './community-proxy';

const origin = 'https://community.example.test';
const id = '11111111-2222-4333-a444-555555555555';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function fixture(body = '{}', extra: HeadersInit = {}, method = 'POST') {
  return new Request(`${origin}/api/community/example?ignored=1`, {
    method,
    headers: {
      origin,
      cookie: 'other=value; __Host-agorafab_session=fixture',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'idempotency-key': 'submit-one',
      authorization: 'Bearer discarded',
      ...extra,
    },
    body,
  });
}

describe('community browser mutation boundary', () => {
  it('relays human provisioning only at the configured local auth origin', async () => {
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', origin);
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { principal: { id }, activationCode: 'fixture' },
          { status: 201 },
        ),
      );
    vi.stubGlobal('fetch', fakeFetch);
    const route = ['admin', 'humans'];
    const body = JSON.stringify({
      handle: 'participant',
      displayName: 'Fixture',
    });
    expect(
      (
        await proxyCommunity(
          fixture(body, { origin: 'http://192.168.1.220:3100' }),
          route,
        )
      ).status,
    ).toBe(403);
    const success = await proxyCommunity(fixture(body), route);
    expect(success.status).toBe(201);
    expect(success.headers.get('cache-control')).toBe('no-store');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(fakeFetch.mock.calls[0]?.[0].pathname).toBe('/api/admin/humans');
    expect(fakeFetch.mock.calls[0]?.[1].headers.get('idempotency-key')).toBe(
      'submit-one',
    );
  });
  it('forwards only the named Agent mutations with session cookies and disables credential caching', async () => {
    const fakeFetch = vi
      .fn()
      .mockImplementation(() =>
        Response.json({ credential: { id } }, { status: 201 }),
      );
    vi.stubGlobal('fetch', fakeFetch);
    for (const [method, route] of [
      ['POST', ['admin', 'agents']],
      ['POST', ['admin', 'agents', id, 'credentials']],
      ['DELETE', ['admin', 'agents', id]],
      ['DELETE', ['admin', 'agents', id, 'credentials', id]],
    ] as const) {
      const response = await proxyCommunity(fixture('{}', {}, method), [
        ...route,
      ]);
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(fakeFetch).toHaveBeenCalledTimes(4);
    for (const [, options] of fakeFetch.mock.calls) {
      expect(options.headers.has('authorization')).toBe(false);
      expect(options.headers.get('cookie')).toBe(
        '__Host-agorafab_session=fixture',
      );
    }
  });

  it('permits only known project writes with the matching method', async () => {
    const fakeFetch = vi
      .fn()
      .mockImplementation(() => Response.json({ task: { id } }));
    vi.stubGlobal('fetch', fakeFetch);
    for (const [method, route] of [
      ['POST', ['projects', id, 'tasks']],
      ['POST', ['tasks', id, 'claim']],
      ['POST', ['tasks', id, 'artifacts']],
      ['POST', ['tasks', id, 'review']],
      ['POST', ['admin', 'posts', id, 'promote']],
      ['POST', ['admin', 'projects', id, 'tasks']],
      ['POST', ['admin', 'tasks', id, 'review']],
      ['PATCH', ['admin', 'tasks', id]],
    ] as const) {
      expect(
        (await proxyCommunity(fixture('{}', {}, method), [...route])).status,
      ).toBe(200);
    }
    expect(
      (await proxyCommunity(fixture(), ['admin', 'tasks', id, 'artifacts']))
        .status,
    ).toBe(404);
    expect(
      (await proxyCommunity(fixture(), ['projects', 'bad/id', 'tasks'])).status,
    ).toBe(404);
    expect(
      (await proxyCommunity(fixture(), ['admin', 'tasks', id])).status,
    ).toBe(405);
    expect(fakeFetch).toHaveBeenCalledTimes(8);
  });

  it('only forwards approved mutable routes and the fields required by Fastify', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.example.test:3001');
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { post: { id } },
          { status: 201, headers: { 'Set-Cookie': 'unrelated=never-forward' } },
        ),
      );
    vi.stubGlobal('fetch', fakeFetch);
    const body = JSON.stringify({ bodyMd: 'Hello' });
    const response = await proxyCommunity(fixture(body), [
      'topics',
      'daily-inspiration',
      'posts',
    ]);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ post: { id } });
    expect(response.headers.get('set-cookie')).toBeNull();
    const [url, options] = fakeFetch.mock.calls[0]!;
    expect(String(url)).toBe(
      'http://api.example.test:3001/api/topics/daily-inspiration/posts',
    );
    expect(Object.fromEntries(options.headers)).toEqual({
      origin,
      cookie: '__Host-agorafab_session=fixture',
      'content-type': 'application/json',
      'idempotency-key': 'submit-one',
    });
    expect(options).toMatchObject({ body, method: 'POST', redirect: 'manual' });
  });

  it('does not forward cross-origin, anonymous, credential or path traversal requests', async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal('fetch', fakeFetch);
    const route = ['posts', id, 'replies'];
    expect(
      (
        await proxyCommunity(
          fixture('{}', { 'sec-fetch-site': 'same-site' }),
          route,
        )
      ).status,
    ).toBe(403);
    expect(
      (await proxyCommunity(fixture('{}', { cookie: 'unrelated=abc' }), route))
        .status,
    ).toBe(401);
    expect(
      (
        await proxyCommunity(fixture(), [
          'admin',
          'agents',
          id,
          'credentials',
          '../token',
        ])
      ).status,
    ).toBe(404);
    expect(
      (await proxyCommunity(fixture(), ['topics', 'x/../admin', 'posts']))
        .status,
    ).toBe(404);
    expect(
      (await proxyCommunity(fixture(), ['me', 'notifications', id])).status,
    ).toBe(405);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('bounds the actual JSON payload and rejects unsupported form types', async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal('fetch', fakeFetch);
    const route = ['posts', id, 'replies'];
    expect(
      (
        await proxyCommunity(
          fixture('{}', { 'content-type': 'text/plain' }),
          route,
        )
      ).status,
    ).toBe(415);
    expect((await proxyCommunity(fixture('{'), route)).status).toBe(400);
    expect((await proxyCommunity(fixture('[]'), route)).status).toBe(400);
    expect(
      (
        await proxyCommunity(
          fixture(JSON.stringify({ bodyMd: '字'.repeat(23_000) })),
          route,
        )
      ).status,
    ).toBe(413);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('preserves acknowledgement status and suppresses upstream redirects and errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response('internal', {
            status: 303,
            headers: { location: 'https://elsewhere.test' },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ unexpected: 'private' }, { status: 502 }),
        ),
    );
    const route = ['me', 'notifications', id];
    const ack = () =>
      proxyCommunity(fixture('{"read":true}', {}, 'PATCH'), route);
    expect((await ack()).status).toBe(204);
    expect((await ack()).headers.get('location')).toBeNull();
    const upstreamError = await ack();
    expect(upstreamError.status).toBe(503);
    expect(await upstreamError.json()).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});
