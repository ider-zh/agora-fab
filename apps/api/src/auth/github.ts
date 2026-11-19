import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  GitHubSignInError,
  oauthAttempts,
  signInGitHub,
  type Database,
} from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import {
  assertOrigin,
  digest,
  readCookie,
  sessionCookie,
  sessionCookieName,
  sessionTokenPattern,
} from './http.js';

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  origin: string;
  adminIds: ReadonlySet<string>;
}

interface GitHubExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export interface GitHubProvider {
  exchange(input: GitHubExchange): Promise<{
    id: string;
    login: string;
    displayName: string;
  }>;
}

const startPath = '/api/auth/github/start';
const callbackPath = '/api/auth/github/callback';
const attemptLifetimeSeconds = 10 * 60;
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function secureOrigin(origin: string) {
  const url = new URL(origin);
  if (
    origin !== url.origin ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  ) {
    throw new Error(
      'GitHub sign-in requires a canonical HTTPS or loopback HTTP origin.',
    );
  }
  return url.protocol === 'https:';
}

function stateCookie(secure: boolean, token: string, maxAge: number) {
  return `${stateCookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function stateCookieName(secure: boolean) {
  return `${secure ? '__Host-' : ''}agorafab_oauth`;
}

function queryParameter(query: URLSearchParams, key: string) {
  const values = query.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function redirect(reply: FastifyReply, location: string) {
  return reply.header('referrer-policy', 'no-referrer').redirect(location, 303);
}

function oauthUnavailable() {
  return new DomainError(
    503,
    'OAUTH_DISABLED',
    'GitHub sign-in is unavailable.',
  );
}

function invalidState() {
  return new DomainError(
    400,
    'OAUTH_STATE_INVALID',
    'Sign-in has expired or could not be verified. Start again.',
  );
}

// Bound each interval's memory and DB workload, including when all addresses differ.
function oauthRateLimit(perAddress: number) {
  let windowStart = 0;
  const counts = new Map<string, number>();
  return (address: string) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      counts.clear();
    }
    const count = counts.get(address);
    if (
      (count === undefined && counts.size >= 4096) ||
      (count ?? 0) >= perAddress
    ) {
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Too many sign-in requests. Try again shortly.',
      );
    }
    counts.set(address, (count ?? 0) + 1);
  };
}

export function createGitHubProvider(
  fetcher: typeof fetch = fetch,
): GitHubProvider {
  return {
    async exchange({
      code,
      codeVerifier,
      redirectUri,
      clientId,
      clientSecret,
    }) {
      const tokenResponse = await fetcher(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!tokenResponse.ok) throw new Error('GitHub token exchange failed.');
      const token: unknown = await tokenResponse.json();
      if (
        typeof token !== 'object' ||
        token === null ||
        !('access_token' in token) ||
        typeof token.access_token !== 'string' ||
        !/^[A-Za-z0-9._-]{1,2048}$/.test(token.access_token)
      ) {
        throw new Error('GitHub did not return a usable access token.');
      }

      const profileResponse = await fetcher('https://api.github.com/user', {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token.access_token}`,
          'user-agent': 'AgoraFab',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!profileResponse.ok) throw new Error('GitHub profile lookup failed.');
      const profile: unknown = await profileResponse.json();
      if (
        typeof profile !== 'object' ||
        profile === null ||
        !('id' in profile) ||
        typeof profile.id !== 'number' ||
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0 ||
        !('login' in profile) ||
        typeof profile.login !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(profile.login)
      ) {
        throw new Error('GitHub returned an invalid profile.');
      }
      const name =
        'name' in profile && typeof profile.name === 'string'
          ? profile.name.replace(/\p{Cc}/gu, '').trim()
          : '';
      return {
        id: String(profile.id),
        login: profile.login,
        displayName: Array.from(name || profile.login)
          .slice(0, 120)
          .join(''),
      };
    },
  };
}

export function registerGitHubRoutes(
  app: FastifyInstance,
  {
    database,
    config,
    provider = createGitHubProvider(),
  }: {
    database: Database;
    config?: GitHubConfig;
    provider?: GitHubProvider;
  },
) {
  const secure = config ? secureOrigin(config.origin) : false;
  const limitStart = oauthRateLimit(12);
  const limitCallback = oauthRateLimit(30);

  app.post(startPath, async (request, reply) => {
    reply.header('referrer-policy', 'no-referrer');
    if (!config) throw oauthUnavailable();
    assertOrigin(request, config.origin);
    limitStart(request.ip);
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const now = new Date();
    await database.db
      .delete(oauthAttempts)
      .where(lte(oauthAttempts.expiresAt, now));
    await database.db.insert(oauthAttempts).values({
      stateHash: digest(state),
      codeVerifier,
      expiresAt: new Date(now.getTime() + attemptLifetimeSeconds * 1000),
    });

    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.origin}${callbackPath}`,
      scope: '',
      state,
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    reply.header(
      'set-cookie',
      stateCookie(secure, state, attemptLifetimeSeconds),
    );
    return redirect(reply, authorize.toString());
  });

  app.get(callbackPath, { exposeHeadRoute: false }, async (request, reply) => {
    reply.header('referrer-policy', 'no-referrer');
    if (!config) throw oauthUnavailable();
    limitCallback(request.ip);
    const query = new URL(`${config.origin}${request.url}`).searchParams;
    const state = queryParameter(query, 'state');
    const fromCookie = readCookie(
      request.headers.cookie,
      stateCookieName(secure),
    );
    if (
      !state ||
      !fromCookie ||
      !secretPattern.test(state) ||
      !secretPattern.test(fromCookie) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(fromCookie))
    ) {
      throw invalidState();
    }

    const [attempt] = await database.db
      .delete(oauthAttempts)
      .where(
        and(
          eq(oauthAttempts.stateHash, digest(state)),
          gt(oauthAttempts.expiresAt, new Date()),
        ),
      )
      .returning({ codeVerifier: oauthAttempts.codeVerifier });
    if (!attempt) throw invalidState();

    const clearState = stateCookie(secure, '', 0);
    reply.header('set-cookie', clearState);
    const code = queryParameter(query, 'code');
    if (query.has('error') || !code || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) {
      return redirect(reply, '/account?error=oauth');
    }

    let profile;
    try {
      profile = await provider.exchange({
        code,
        codeVerifier: attempt.codeVerifier,
        redirectUri: `${config.origin}${callbackPath}`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
    } catch {
      request.log.warn(
        { code: 'OAUTH_EXCHANGE_FAILED' },
        'GitHub sign-in failed.',
      );
      return redirect(reply, '/account?error=oauth');
    }

    const token = randomBytes(32).toString('base64url');
    const previousToken = readCookie(
      request.headers.cookie,
      sessionCookieName(config.origin),
    );
    try {
      await signInGitHub(database, profile, {
        adminIds: config.adminIds,
        sessionHash: digest(token),
        expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
        ...(previousToken && sessionTokenPattern.test(previousToken)
          ? { previousSessionHash: digest(previousToken) }
          : {}),
      });
    } catch (error) {
      if (!(error instanceof GitHubSignInError)) throw error;
      return redirect(reply, '/account?error=oauth');
    }
    reply.header(
      'set-cookie',
      sessionCookie(config.origin, token, sessionLifetimeSeconds),
    );
    return redirect(reply, '/account');
  });
}
