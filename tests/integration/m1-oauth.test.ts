import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import type { GitHubProvider } from '../../apps/api/src/auth/github.js';
import { createDatabase, type Database } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL is required for GitHub OAuth integration tests.',
  );

const origin = 'https://agorafab.test';
const startPath = '/api/auth/github/start';
const callbackPath = '/api/auth/github/callback';
const schema = `agorafab_oauth_test_${randomUUID().replaceAll('-', '')}`;
const exchange = vi.fn<GitHubProvider['exchange']>();
const profile = { id: '81202', login: 'fixture', displayName: 'Fixture Human' };
let control: Database | undefined;
let database: Database | undefined;
let app: ReturnType<typeof buildApp>;

const sha256 = (value: string, encoding: 'hex' | 'base64url' = 'hex') =>
  createHash('sha256').update(value).digest(encoding);

function cookies(header: string | string[] | undefined) {
  return header ? [header].flat() : [];
}

async function start() {
  const response = await app.inject({
    method: 'POST',
    url: startPath,
    headers: { origin },
  });
  expect(response.statusCode).toBe(303);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  const authorize = new URL(response.headers.location!);
  expect(authorize.origin + authorize.pathname).toBe(
    'https://github.com/login/oauth/authorize',
  );
  expect(authorize.searchParams.get('redirect_uri')).toBe(
    origin + callbackPath,
  );
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  const state = authorize.searchParams.get('state')!;
  const cookie = cookies(response.headers['set-cookie'])[0]!;
  expect(cookie).toBe(
    `__Host-agorafab_oauth=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
  );
  return {
    state,
    challenge: authorize.searchParams.get('code_challenge'),
    stateCookie: cookie.split(';')[0]!,
    callback: `${callbackPath}?state=${state}&code=fixture-code`,
  };
}

describe('GitHub OAuth with a mocked provider and PostgreSQL', () => {
  beforeAll(async () => {
    control = createDatabase(url);
    await control.pool.query(`create schema "${schema}"`);
    const isolated = new URL(url);
    isolated.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase(isolated.toString());
    await migrateDatabase(database, { migrationsSchema: schema });
    app = buildApp({
      checkDatabase: database.checkConnection,
      logger: false,
      database,
      github: {
        origin,
        clientId: 'fixture-client-id',
        clientSecret: 'fixture-client-secret',
        adminIds: new Set([profile.id]),
      },
      githubProvider: { exchange },
    });
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (control) {
      try {
        await control.pool.query(`drop schema if exists "${schema}" cascade`);
      } finally {
        await control.close();
      }
    }
  });

  it('enables only configured login and rejects a browser request from another origin', async () => {
    const config = await app.inject('/api/auth/config');
    expect(config.json()).toEqual({ githubEnabled: true });
    expect(JSON.stringify(config.json())).not.toContain('fixture-client');

    for (const attackerOrigin of [
      undefined,
      'https://agorafab.test.attacker.test',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: startPath,
        headers: attackerOrigin ? { origin: attackerOrigin } : {},
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }

    const disabledApp = buildApp({
      checkDatabase: database!.checkConnection,
      logger: false,
      database,
    });
    try {
      expect((await disabledApp.inject('/api/auth/config')).json()).toEqual({
        githubEnabled: false,
      });
      expect(
        (await disabledApp.inject({ method: 'POST', url: startPath }))
          .statusCode,
      ).toBe(503);
    } finally {
      await disabledApp.close();
    }
  });

  it('binds state and PKCE to the browser and exchanges a callback exactly once', async () => {
    exchange.mockReset().mockResolvedValue(profile);
    const attempt = await start();
    const check = await database!.pool.query<{
      state_hash: string;
      code_verifier: string;
    }>(
      'select state_hash, code_verifier from oauth_attempts where state_hash = $1',
      [sha256(attempt.state)],
    );
    expect(check.rows).toHaveLength(1);
    expect(sha256(check.rows[0]!.code_verifier, 'base64url')).toBe(
      attempt.challenge,
    );

    expect((await app.inject(attempt.callback)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          url: `${attempt.callback}&state=${attempt.state}`,
          headers: { cookie: attempt.stateCookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'HEAD',
          url: attempt.callback,
          headers: { cookie: attempt.stateCookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(exchange).not.toHaveBeenCalled();

    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          url: attempt.callback,
          headers: { cookie: attempt.stateCookie },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      303, 400,
    ]);
    expect(exchange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: 'fixture-code',
        codeVerifier: check.rows[0]!.code_verifier,
        redirectUri: origin + callbackPath,
      }),
    );

    const accepted = responses.find((response) => response.statusCode === 303)!;
    expect(accepted.headers.location).toBe('/account');
    expect(accepted.headers['referrer-policy']).toBe('no-referrer');
    const issued = cookies(accepted.headers['set-cookie']);
    expect(issued).toContain(
      '__Host-agorafab_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
    );
    const session = issued.find((cookie) =>
      cookie.startsWith('__Host-agorafab_session='),
    )!;
    expect(session).toMatch(
      /^__Host-agorafab_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/,
    );
    const secret = session.split(';')[0]!.split('=')[1]!;
    const verified = await database!.pool.query(
      'select p.id, p.role, p.handle, s.token_hash from sessions s join principals p on s.principal_id = p.id where s.token_hash = $1 and s.expires_at > now()',
      [sha256(secret)],
    );
    expect(verified.rows).toEqual([
      expect.objectContaining({
        handle: 'gh_81202',
        token_hash: sha256(secret),
        role: 'admin',
      }),
    ]);

    const next = await start();
    exchange.mockResolvedValue({
      ...profile,
      login: 'renamed',
      displayName: 'Updated name',
    });
    const rotated = await app.inject({
      url: next.callback,
      headers: { cookie: `${next.stateCookie}; ${session.split(';')[0]}` },
    });
    expect(rotated.statusCode).toBe(303);
    expect(
      await database!.pool.query(
        'select 1 from sessions where token_hash = $1',
        [sha256(secret)],
      ),
    ).toMatchObject({ rowCount: 0 });
    const samePrincipal = await database!.pool.query(
      'select id, display_name from principals where handle = $1',
      ['gh_81202'],
    );
    expect(samePrincipal.rows).toEqual([
      { id: verified.rows[0]!.id, display_name: 'Updated name' },
    ]);
  });

  it('rejects expiry and safely handles provider rejection without exposing errors', async () => {
    exchange
      .mockReset()
      .mockRejectedValue(
        new Error('fixture provider token from an upstream error'),
      );
    const expired = await start();
    await database!.pool.query(
      "update oauth_attempts set expires_at = now() - interval '1 minute' where state_hash = $1",
      [sha256(expired.state)],
    );
    expect(
      (
        await app.inject({
          url: expired.callback,
          headers: { cookie: expired.stateCookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(exchange).not.toHaveBeenCalled();

    const rejected = await start();
    const response = await app.inject({
      url: rejected.callback,
      headers: { cookie: rejected.stateCookie },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/account?error=oauth');
    expect(response.body).not.toContain('fixture provider token');
    expect(
      cookies(response.headers['set-cookie']).some((cookie) =>
        cookie.includes('_session='),
      ),
    ).toBe(false);
    expect(
      (
        await app.inject({
          url: rejected.callback,
          headers: { cookie: rejected.stateCookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
});
