import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccount } from './account';
import { proxyAuth } from './auth-proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const origin = 'https://community.example.test';

describe('browser auth proxy', () => {
  it('allows only known operations and their configured methods', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const request = new Request(origin);

    expect((await proxyAuth(request, ['unknown'])).status).toBe(404);
    expect((await proxyAuth(request, ['github/start'])).status).toBe(404);
    const wrongMethod = await proxyAuth(request, ['github', 'start']);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards Origin and only auth cookies, and returns the GitHub redirect', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.example.test:3001');
    const destination =
      'https://github.com/login/oauth/authorize?client_id=app&state=challenge';
    const oauthCookie =
      '__Host-agorafab_oauth=challenge; Secure; HttpOnly; Path=/';
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 303,
        headers: { location: destination, 'set-cookie': oauthCookie },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const response = await proxyAuth(
      new Request(`${origin}/api/auth/github/start?unexpected=1`, {
        method: 'POST',
        headers: {
          origin,
          cookie: 'unrelated=value; __Host-agorafab_session=fixture-session',
          authorization: 'Bearer unrelated',
        },
      }),
      ['github', 'start'],
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      'http://api.example.test:3001/api/auth/github/start',
    );
    expect(init).toMatchObject({ redirect: 'manual', method: 'POST' });
    expect(Object.fromEntries(init.headers)).toEqual({
      origin,
      cookie: '__Host-agorafab_session=fixture-session',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(destination);
    expect(response.headers.getSetCookie()).toEqual([oauthCookie]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('preserves the callback query and multiple application cookies', async () => {
    const clear = 'agorafab_oauth=; HttpOnly; Path=/; Max-Age=0';
    const session = 'agorafab_session=fixture-session; HttpOnly; Path=/';
    const headers = new Headers({ location: '/account' });
    headers.append('set-cookie', clear);
    headers.append('set-cookie', session);
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 303, headers }));
    vi.stubGlobal('fetch', fetch);
    const response = await proxyAuth(
      new Request(`${origin}/api/auth/github/callback?code=a&state=b&state=c`, {
        headers: { cookie: 'agorafab_oauth=b; another=ignored' },
      }),
      ['github', 'callback'],
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.search).toBe('?code=a&state=b&state=c');
    expect(init.headers.get('cookie')).toBe('agorafab_oauth=b');
    expect(response.headers.getSetCookie()).toEqual([clear, session]);
    expect(response.headers.get('location')).toBe('/account');
  });

  it.each([
    ['github/start', 'https://github.com.example.test/login/oauth/authorize'],
    ['github/start', 'https://github.com/settings'],
    ['github/callback', '//example.test/account'],
    ['github/callback', '/account?error=oauth&token=private'],
  ])(
    'rejects unsafe redirect locations for %s',
    async (operation, location) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(null, {
            status: 303,
            headers: { location, 'set-cookie': 'agorafab_session=private' },
          }),
        ),
      );
      const response = await proxyAuth(
        new Request(`${origin}/api/auth/${operation}`, {
          method: operation.endsWith('start') ? 'POST' : 'GET',
        }),
        operation.split('/'),
      );
      expect(response.headers.get('location')).toBe(
        '/account?error=unavailable',
      );
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );
});

describe('account state', () => {
  it('checks whether sign-in is enabled after an expired session', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ githubEnabled: false }));
    vi.stubGlobal('fetch', fetch);
    expect(await getAccount('agorafab_session=fixture')).toEqual({
      status: 'signed-out',
      githubEnabled: false,
    });
    expect(fetch.mock.calls[0]?.[0].pathname).toBe('/api/me');
    expect(fetch.mock.calls[1]?.[0].pathname).toBe('/api/auth/config');
  });

  it('returns only the account display fields for a verified human', async () => {
    const profile = {
      id: 'id',
      displayName: 'Fixture User',
      handle: 'gh_42',
      role: 'admin',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          principal: {
            ...profile,
            kind: 'human',
            status: 'active',
            ignored: true,
          },
        }),
      ),
    );
    expect(await getAccount('__Host-agorafab_session=fixture')).toEqual({
      status: 'signed-in',
      profile,
    });
  });
});
