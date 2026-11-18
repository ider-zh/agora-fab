import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { buildApp } from '../../apps/api/src/app.js';
import { createDatabase } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { seedFixtures } from '../../packages/db/src/seed.js';

export const browserActors = {
  participant: {
    id: '7801',
    login: 'fixture-participant',
    displayName: 'Browser Participant',
  },
  admin: {
    id: '7802',
    login: 'fixture-admin',
    displayName: 'Browser Administrator',
  },
  reviewer: {
    id: '7803',
    login: 'fixture-reviewer',
    displayName: 'Browser Reviewer',
  },
} as const;

async function ephemeralPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (!address || typeof address === 'string')
    throw new Error('Cannot allocate a loopback port.');
  return address.port;
}

async function awaitHealth(child: ChildProcess, origin: string) {
  let didExit = false;
  child.once('exit', () => {
    didExit = true;
  });
  child.once('error', () => {
    didExit = true;
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !didExit) {
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => undefined);
    if (response) {
      await response.body?.cancel();
      if (response.ok) return;
    }
    await delay(100);
  }
  throw new Error(
    'The production Next.js test server did not become healthy. Run pnpm build before pnpm test:browser.',
  );
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function browserFixture() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for browser tests.');
  const webDir = fileURLToPath(new URL('../../apps/web/', import.meta.url));
  await access(join(webDir, '.next', 'BUILD_ID')).catch(() => {
    throw new Error('Run pnpm build before pnpm test:browser.');
  });
  const origin = `http://127.0.0.1:${await ephemeralPort()}`;
  const schema = `agorafab_browser_${randomUUID().replaceAll('-', '')}`;
  const control = createDatabase(url);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  const database = createDatabase(scoped.toString());
  const app = buildApp({
    database,
    checkDatabase: database.checkConnection,
    logger: false,
    github: {
      origin,
      clientId: 'browser-fixture',
      clientSecret: 'browser-fixture',
      adminIds: new Set([browserActors.admin.id]),
    },
    githubProvider: {
      async exchange({ code }) {
        const actor = Object.values(browserActors).find(
          ({ login }) => login === code,
        );
        if (actor) return actor;
        throw new Error('Unrecognized fixture code.');
      },
    },
  });
  let next: ChildProcess | undefined;
  let browser: Browser | undefined;

  async function close() {
    await Promise.allSettled([browser?.close(), stopChild(next), app.close()]);
    try {
      await database.close();
      await control.pool.query(`drop schema if exists "${schema}" cascade`);
    } finally {
      await control.close();
    }
  }

  try {
    await control.pool.query(`create schema "${schema}"`);
    await migrateDatabase(database, { migrationsSchema: schema });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
    const apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    next = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        new URL(origin).port,
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          API_INTERNAL_URL: apiOrigin,
        },
        stdio: 'ignore',
      },
    );
    await awaitHealth(next, origin);
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    });
    return { browser, origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function signIn(
  page: Page,
  origin: string,
  actor: keyof typeof browserActors,
) {
  const authorizeUrl = 'https://github.com/login/oauth/authorize';
  // Chromium Fetch interception applies to the provider request even when it
  // follows the real application's OAuth start redirect.
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const authorization = new URL(request.url);
    const state = authorization.searchParams.get('state');
    const callback = new URL('/api/auth/github/callback', origin);
    if (
      !state ||
      request.method !== 'GET' ||
      authorization.searchParams.get('redirect_uri') !== callback.href ||
      authorization.searchParams.get('code_challenge_method') !== 'S256'
    ) {
      await cdp.send('Fetch.failRequest', {
        requestId,
        errorReason: 'BlockedByClient',
      });
      return;
    }
    callback.searchParams.set('code', browserActors[actor].login);
    callback.searchParams.set('state', state);
    await cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 303,
      responseHeaders: [{ name: 'Location', value: callback.href }],
    });
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: `${authorizeUrl}?*` }],
  });
  try {
    await page.goto(`${origin}/account`);
    await page.getByRole('button', { name: '使用 GitHub 登录' }).click();
    await page
      .getByRole('heading', { name: browserActors[actor].displayName })
      .waitFor();
  } finally {
    await cdp.detach();
  }
}

export async function screenshot(page: Page, name: string) {
  const dir = process.env.BROWSER_SCREENSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}
