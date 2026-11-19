import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { digest } from '../../apps/api/src/auth/http.js';
import { bootstrapLocalAdmin } from '../../apps/api/src/auth/local.js';
import { createDatabase, type Database } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');

const schema = `agorafab_local_auth_${randomUUID().replaceAll('-', '')}`;
const origin = 'https://agorafab.test';
const admin = { handle: 'local_admin', displayName: 'Local Administrator' };
const adminPassword = 'Fixture admin passphrase';
const participant = { handle: 'local_human', displayName: 'Local Participant' };
const participantPassword = 'Fixture participant passphrase';
const inviteUrl = '/api/admin/humans';
const loginUrl = '/api/auth/local/login';
const activateUrl = '/api/auth/local/activate';
let control: Database | undefined;
let database: Database;
let app: ReturnType<typeof buildApp>;

function key() {
  return { 'idempotency-key': randomUUID() };
}

type Response = Awaited<ReturnType<typeof signIn>>;

function session(response: Response) {
  expect(response.statusCode, response.body).toBe(303);
  expect(response.headers.location).toBe('/account');
  const cookies = [response.headers['set-cookie']].flat().filter(Boolean);
  const cookie = cookies.find((value) =>
    value?.startsWith('__Host-agorafab_session='),
  );
  expect(cookie).toMatch(/^__Host-agorafab_session=[A-Za-z0-9_-]{43};/);
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Secure');
  return { cookie: cookie!.split(';')[0]!, origin };
}

function expectRefused(response: Response) {
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(response.statusCode).toBeLessThan(500);
  expect(response.headers['set-cookie']).toBeUndefined();
}

function signIn(handle: string, password: string, from = origin) {
  return app.inject({
    method: 'POST',
    url: loginUrl,
    headers: { origin: from },
    payload: { handle, password },
  });
}

function activation(handle: string, activationCode: string, from = origin) {
  return app.inject({
    method: 'POST',
    url: activateUrl,
    headers: { origin: from },
    payload: { handle, activationCode, password: participantPassword },
  });
}

beforeAll(async () => {
  control = createDatabase(databaseUrl);
  await control.pool.query(`create schema "${schema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  database = createDatabase(scoped.toString());
  await migrateDatabase(database, { migrationsSchema: schema });
  await bootstrapLocalAdmin(database, { ...admin, password: adminPassword });
  app = buildApp({
    database,
    checkDatabase: database.checkConnection,
    logger: false,
    localAuthOrigin: origin,
  });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
  if (control) {
    try {
      await control.pool.query(`drop schema if exists "${schema}" cascade`);
    } finally {
      await control.close();
    }
  }
});

describe('administrator-provisioned accounts with GitHub sign-in disabled', () => {
  it('resolves a bootstrapped administrator and invalidates their session at logout', async () => {
    expect((await app.inject('/api/auth/config')).json()).toMatchObject({
      githubEnabled: false,
      localEnabled: true,
    });
    const crossOrigin = await signIn(
      admin.handle,
      adminPassword,
      'https://other.example',
    );
    expect(crossOrigin.statusCode).toBe(403);
    expectRefused(crossOrigin);
    const wrong = await signIn(admin.handle, 'Incorrect fixture password');
    const unknown = await signIn('unknown_human', adminPassword);
    expectRefused(wrong);
    expectRefused(unknown);
    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(unknown.json().error.code).toBe(wrong.json().error.code);

    const headers = session(await signIn(admin.handle, adminPassword));
    const me = await app.inject({ url: '/api/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().principal).toMatchObject({
      ...admin,
      kind: 'human',
      role: 'admin',
    });
    const token = headers.cookie.split('=')[1]!;
    const stored = await database.pool.query(
      'select principal_id, token_hash from sessions where token_hash = $1',
      [digest(token)],
    );
    expect(stored.rows).toEqual([
      { principal_id: me.json().principal.id, token_hash: digest(token) },
    ]);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers,
    });
    expect(logout.statusCode).toBe(303);
    expect([logout.headers['set-cookie']].flat().join(';')).toContain(
      'Max-Age=0',
    );
    expect((await app.inject({ url: '/api/me', headers })).statusCode).toBe(
      401,
    );
  });

  it('rejects an expired activation code even when it matches the stored digest', async () => {
    const adminHeaders = session(await signIn(admin.handle, adminPassword));
    const handle = 'expired_human';
    const created = await app.inject({
      method: 'POST',
      url: inviteUrl,
      headers: { ...adminHeaders, ...key() },
      payload: { handle, displayName: 'Expired Invite' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { principal, activationCode } = created.json();
    await database.pool.query(
      "update local_human_credentials set activation_expires_at = now() - interval '1 second' where principal_id = $1",
      [principal.id],
    );
    expectRefused(await activation(handle, activationCode));
    expectRefused(await signIn(handle, participantPassword));
  });

  it('issues a human activation code once and binds it to the participant Principal', async () => {
    const adminHeaders = session(await signIn(admin.handle, adminPassword));
    const invite = {
      method: 'POST' as const,
      url: inviteUrl,
      headers: { ...adminHeaders, ...key() },
      payload: participant,
    };
    expect(
      (await app.inject({ ...invite, headers: { origin, ...key() } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          ...invite,
          headers: { ...invite.headers, origin: 'https://other.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          ...invite,
          payload: { ...participant, role: 'admin' },
        })
      ).statusCode,
    ).toBe(400);

    const responses = await Promise.all([
      app.inject(invite),
      app.inject(invite),
    ]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([
      200, 201,
    ]);
    const { activationCode, principal, expiresAt } = responses
      .find(({ statusCode }) => statusCode === 201)!
      .json();
    const replay = responses.find(({ statusCode }) => statusCode === 200)!;
    expect(replay.json()).toEqual({ principal, expiresAt });
    expect(activationCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    expect(principal).toMatchObject({
      ...participant,
      kind: 'human',
      role: 'participant',
    });
    expectRefused(await signIn(participant.handle, participantPassword));

    const pending = await database.pool.query(
      'select password_hash, activation_digest, activation_expires_at from local_human_credentials where principal_id = $1',
      [principal.id],
    );
    expect(pending.rows).toEqual([
      {
        password_hash: null,
        activation_digest: digest(activationCode),
        activation_expires_at: new Date(expiresAt),
      },
    ]);
    const stored = await database.pool.query(
      'select response_json from idempotency_records where key = $1',
      [invite.headers['idempotency-key']],
    );
    expect(stored.rows).toEqual([{ response_json: { principal, expiresAt } }]);
    const audit = await database.pool.query(
      'select actor_id from audit_events where target_id = $1',
      [principal.id],
    );
    const adminMe = await app.inject({ url: '/api/me', headers: adminHeaders });
    expect(audit.rows).toEqual([{ actor_id: adminMe.json().principal.id }]);

    expectRefused(await activation(admin.handle, activationCode));
    expectRefused(
      await activation(
        participant.handle,
        randomBytes(32).toString('base64url'),
      ),
    );
    expect(
      (
        await activation(
          participant.handle,
          activationCode,
          'https://other.example',
        )
      ).statusCode,
    ).toBe(403);
    const activationRace = await Promise.all([
      activation(participant.handle, activationCode),
      activation(participant.handle, activationCode),
    ]);
    const accepted = activationRace.filter(
      ({ statusCode }) => statusCode === 303,
    );
    expect(accepted).toHaveLength(1);
    for (const response of activationRace.filter(
      ({ statusCode }) => statusCode !== 303,
    )) {
      expectRefused(response);
    }
    expectRefused(await activation(participant.handle, activationCode));
    const activated = await database.pool.query(
      'select password_hash, activation_digest, activation_expires_at from local_human_credentials where principal_id = $1',
      [principal.id],
    );
    expect(activated.rows).toEqual([
      {
        password_hash: expect.stringMatching(/scrypt/),
        activation_digest: null,
        activation_expires_at: null,
      },
    ]);
    expect(activated.rows[0].password_hash).not.toContain(participantPassword);
    for (const headers of [
      session(accepted[0]!),
      session(await signIn(participant.handle, participantPassword)),
    ]) {
      const me = await app.inject({ url: '/api/me', headers });
      expect(me.json().principal).toEqual(principal);
      expect(
        (await app.inject({ ...invite, headers: { ...headers, ...key() } }))
          .statusCode,
      ).toBe(403);
    }
  });

  it('uses the existing Agent credential path with local administrators and owners', async () => {
    const adminHeaders = session(await signIn(admin.handle, adminPassword));
    const ownerAccount = {
      handle: 'local_owner',
      displayName: 'Local Agent Owner',
    };
    const createdOwner = await app.inject({
      method: 'POST',
      url: inviteUrl,
      headers: { ...adminHeaders, ...key() },
      payload: ownerAccount,
    });
    expect(createdOwner.statusCode, createdOwner.body).toBe(201);
    const { principal: owner, activationCode } = createdOwner.json();
    const ownerHeaders = session(
      await activation(owner.handle, activationCode),
    );
    const createdAgent = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      headers: { ...adminHeaders, ...key() },
      payload: {
        handle: 'local_agent',
        displayName: 'Local Agent',
        platform: 'fixture',
        ownerPrincipalId: owner.id,
      },
    });
    expect(createdAgent.statusCode, createdAgent.body).toBe(201);
    const agent = createdAgent.json().principal;
    expect(agent).toMatchObject({ kind: 'agent', ownerPrincipalId: owner.id });
    const issued = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${agent.id}/credentials`,
      headers: { ...adminHeaders, ...key() },
      payload: { scopes: ['community:write'] },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const agentHeaders = { authorization: `Bearer ${issued.json().token}` };
    const agentMe = await app.inject({ url: '/api/me', headers: agentHeaders });
    expect(agentMe.json().principal).toEqual(agent);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: inviteUrl,
          headers: { ...agentHeaders, ...key() },
          payload: ownerAccount,
        })
      ).statusCode,
    ).toBe(403);

    const newTopic = await app.inject({
      method: 'POST',
      url: '/api/admin/topics',
      headers: { ...adminHeaders, ...key() },
      payload: {
        kind: 'community',
        slug: 'local-account-test',
        title: 'Local accounts',
      },
    });
    expect(newTopic.statusCode, newTopic.body).toBe(201);
    for (const { actor, headers } of [
      { actor: owner, headers: ownerHeaders },
      { actor: agent, headers: agentHeaders },
    ]) {
      const posted = await app.inject({
        method: 'POST',
        url: `/api/topics/${newTopic.json().topic.id}/posts`,
        headers: { ...headers, ...key() },
        payload: { bodyMd: `Fixture post by ${actor.handle}` },
      });
      expect(posted.statusCode, posted.body).toBe(201);
      expect(posted.json().post.author.id).toBe(actor.id);
    }
  });
});
