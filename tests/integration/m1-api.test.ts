import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { digest } from '../../apps/api/src/auth/http.js';
import {
  createDatabase,
  signInGitHub,
  type Database,
} from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const schema = `agorafab_m1_api_${randomUUID().replaceAll('-', '')}`;
const origin = 'https://agorafab.example';
const github = {
  origin,
  adminIds: new Set(['101']),
  clientId: 'test-client',
  clientSecret: 'test-secret',
};
let control: Database | undefined;
let database: Database;
let app: ReturnType<typeof buildApp>;
let adminCookie: string;
let participantCookie: string;

async function createTestSession(id: string) {
  const token = randomBytes(32).toString('base64url');
  await signInGitHub(
    database,
    { id, login: `person${id}`, displayName: 'Same name' },
    {
      adminIds: github.adminIds,
      sessionHash: digest(token),
      expiresAt: new Date(Date.now() + 60_000),
    },
  );
  return `__Host-agorafab_session=${token}`;
}

beforeAll(async () => {
  control = createDatabase(testDatabaseUrl);
  await control.pool.query(`create schema "${schema}"`);
  const isolated = new URL(testDatabaseUrl);
  isolated.searchParams.set('options', `-c search_path=${schema}`);
  database = createDatabase(isolated.toString());
  await migrateDatabase(database, { migrationsSchema: schema });
  app = buildApp({
    database,
    checkDatabase: database.checkConnection,
    logger: false,
    github,
  });
  adminCookie = await createTestSession('101');
  participantCookie = await createTestSession('202');
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

describe('M1 identity API against PostgreSQL', () => {
  it('rejects anonymous, participant and cross-origin admin writes', async () => {
    const route = { method: 'POST' as const, url: '/api/admin/agents' };
    expect((await app.inject(route)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          ...route,
          headers: { cookie: participantCookie, origin },
        })
      ).statusCode,
    ).toBe(403);
    const unsafe = await app.inject({
      ...route,
      headers: { cookie: adminCookie, origin: 'https://other.example' },
    });
    expect(unsafe.json().error.code).toBe('INVALID_ORIGIN');
  });

  it('persists stable owner-linked agents and revokes scope-limited credentials without replaying plaintext', async () => {
    const me = await app.inject({
      url: '/api/me',
      headers: {
        cookie: participantCookie,
        'x-user-id': '101',
        'x-role': 'admin',
      },
    });
    const participant = me.json().principal;
    expect(participant).toMatchObject({
      kind: 'human',
      role: 'participant',
      handle: 'gh_202',
    });
    const invite = {
      method: 'POST' as const,
      url: '/api/admin/agents',
      headers: { cookie: adminCookie, origin, 'idempotency-key': 'invite-one' },
      payload: {
        displayName: 'Same name',
        handle: 'test_agent',
        platform: 'fixture',
        ownerPrincipalId: participant.id,
        capabilities: ['research'],
      },
    };
    expect(
      (
        await app.inject({
          ...invite,
          payload: { ...invite.payload, role: 'admin' },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject(invite);
    expect(created.statusCode, created.body).toBe(201);
    const { principal } = created.json();
    expect(principal).toMatchObject({
      role: 'participant',
      kind: 'agent',
      ownerPrincipalId: participant.id,
    });
    expect(principal.id).not.toBe(participant.id);
    const replayInvite = await app.inject(invite);
    expect(replayInvite.statusCode).toBe(200);
    expect(replayInvite.json()).toEqual(created.json());
    const conflict = await app.inject({
      ...invite,
      payload: { ...invite.payload, handle: 'a_different_handle' },
    });
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');

    const url = `/api/admin/agents/${principal.id}/credentials`;
    const request = {
      method: 'POST' as const,
      url,
      headers: {
        cookie: adminCookie,
        origin,
        'idempotency-key': 'credential-one',
      },
      payload: { scopes: ['community:write'], expiresInHours: 1 },
    };
    expect(
      (await app.inject({ ...request, payload: { scopes: ['admin'] } }))
        .statusCode,
    ).toBe(400);
    const pair = await Promise.all([app.inject(request), app.inject(request)]);
    const issued = pair.find((response) => response.statusCode === 201);
    const replay = pair.find((response) => response.statusCode === 200);
    expect(pair.map((result) => result.statusCode).sort()).toEqual([200, 201]);
    if (!issued) throw new Error('Credential was not issued.');
    const { credential, token } = issued.json();
    expect(token).toMatch(/^agf_/);
    expect(replay?.json()).toEqual({ credential });

    const headers = {
      authorization: `Bearer ${token}`,
      'x-user-id': participant.id,
    };
    const agentMe = await app.inject({ url: '/api/me', headers });
    expect(agentMe.json().principal).toEqual(principal);
    expect(agentMe.body).not.toContain(token);
    expect((await app.inject({ url, headers })).statusCode).toBe(403);
    const listed = await app.inject({ url, headers: { cookie: adminCookie } });
    expect(listed.json().credentials).toHaveLength(1);
    expect(listed.body).not.toContain(token);
    expect(listed.body).not.toContain(digest(token));
    const hash = await database.pool.query(
      'select token_hash from agent_credentials where id=$1',
      [credential.id],
    );
    expect(hash.rows[0]?.token_hash).toBe(digest(token));

    const revoke = {
      method: 'DELETE' as const,
      url: `${url}/${credential.id}`,
      headers: { cookie: adminCookie, origin },
    };
    expect((await app.inject(revoke)).statusCode).toBe(204);
    expect((await app.inject(revoke)).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me', headers })).statusCode).toBe(
      401,
    );
    const audit = await database.pool.query(
      'select action, metadata_json from audit_events where target_id=$1 order by created_at',
      [credential.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'agent.token.issue',
      'agent.token.revoke',
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(token);
    expect(
      JSON.stringify(
        (
          await database.pool.query(
            'select response_json from idempotency_records',
          )
        ).rows,
      ),
    ).not.toContain(token);

    const expiring = await app.inject({
      ...request,
      headers: { ...request.headers, 'idempotency-key': 'credential-two' },
    });
    await database.pool.query(
      "update agent_credentials set expires_at=now() - interval '1 second' where id=$1",
      [expiring.json().credential.id],
    );
    expect(
      (
        await app.inject({
          url: '/api/me',
          headers: { authorization: `Bearer ${expiring.json().token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('removes a prior admin grant from an existing session and closes it on logout', async () => {
    const reduced = buildApp({
      database,
      logger: false,
      checkDatabase: database.checkConnection,
      github: { ...github, adminIds: new Set() },
    });
    try {
      const response = await reduced.inject({
        url: '/api/me',
        headers: { cookie: adminCookie },
      });
      expect(response.json().principal.role).toBe('participant');
    } finally {
      await reduced.close();
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { cookie: participantCookie, origin },
        })
      ).statusCode,
    ).toBe(303);
    expect(
      (
        await app.inject({
          url: '/api/me',
          headers: { cookie: participantCookie },
        })
      ).statusCode,
    ).toBe(401);
  });
});
