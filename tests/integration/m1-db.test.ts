import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentCredentials,
  auditEvents,
  createDatabase,
  githubIdentities,
  idempotencyRecords,
  oauthAttempts,
  principals,
  sessions,
  signInGitHub,
  type Database,
} from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { fixtureIds, seedFixtures } from '../../packages/db/src/seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests.',
  );
}

const schema = `agorafab_m1_${randomUUID().replaceAll('-', '')}`;
let control: Database | undefined;
let database: Database;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signInOptions(
  token: string,
  adminIds: string[] = [],
  previousToken?: string,
) {
  return {
    adminIds: new Set(adminIds),
    sessionHash: hash(token),
    expiresAt: new Date(Date.now() + 60_000),
    previousSessionHash: previousToken && hash(previousToken),
  };
}

describe('M1 identity persistence', () => {
  beforeAll(async () => {
    control = createDatabase(testDatabaseUrl);
    await control.pool.query(`create schema "${schema}"`);
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase(isolatedUrl.toString());
    await migrateDatabase(database, { migrationsSchema: schema });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
  }, 30_000);

  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      if (control) {
        try {
          await control.pool.query(`drop schema if exists "${schema}" cascade`);
        } finally {
          await control.close();
        }
      }
    }
  });

  it('serializes concurrent first sign-ins and stores only hashed sessions', async () => {
    const profile = { id: '123456', login: 'alice', displayName: 'Same Name' };
    const first = signInOptions('first-secret');
    const second = signInOptions('second-secret');

    await Promise.all([
      signInGitHub(database, profile, first),
      signInGitHub(database, profile, second),
    ]);

    const { rows: identities } = await database.pool.query(
      `select p.id, p.handle, p.display_name, p.role, p.capabilities
       from principals p join github_identities g on g.principal_id = p.id
       where g.github_id = $1`,
      [profile.id],
    );
    expect(identities).toEqual([
      {
        id: expect.any(String),
        handle: 'gh_123456',
        display_name: 'Same Name',
        role: 'participant',
        capabilities: [],
      },
    ]);
    const { rows: persisted } = await database.pool.query(
      'select token_hash, expires_at from sessions where principal_id = $1',
      [identities[0].id],
    );
    expect(persisted).toHaveLength(2);
    expect(persisted).toEqual(
      expect.arrayContaining([
        { token_hash: first.sessionHash, expires_at: first.expiresAt },
        { token_hash: second.sessionHash, expires_at: second.expiresAt },
      ]),
    );
  });

  it('keeps stable identities through provider renames and shared display names', async () => {
    const first = {
      id: '223456',
      login: 'old-login',
      displayName: 'Same Name',
    };
    await signInGitHub(database, first, signInOptions('before-rename'));
    const { rows: before } = await database.pool.query(
      'select principal_id from github_identities where github_id = $1',
      [first.id],
    );
    await signInGitHub(
      database,
      { ...first, login: 'new-login' },
      signInOptions('after-rename', [], 'before-rename'),
    );
    await signInGitHub(
      database,
      { ...first, id: '323456' },
      signInOptions('unrelated-same-display-name'),
    );
    const { rows: after } = await database.pool.query(
      `select g.github_id, g.principal_id, p.handle
       from github_identities g join principals p on p.id = g.principal_id
       where g.github_id in ('223456', '323456') order by g.github_id`,
    );
    expect(after[0]).toMatchObject({
      principal_id: before[0].principal_id,
      handle: 'gh_223456',
    });
    expect(after[1].principal_id).not.toBe(before[0].principal_id);
    const { rows: active } = await database.pool.query(
      'select token_hash from sessions where principal_id = $1',
      [before[0].principal_id],
    );
    expect(active).toEqual([{ token_hash: hash('after-rename') }]);
  });

  it('audits role changes and rolls back a failed session rotation', async () => {
    const profile = { id: '423456', login: 'owner', displayName: 'Owner' };
    await signInGitHub(database, profile, signInOptions('owner-first'));
    const { rows: before } = await database.pool.query(
      'select principal_id from github_identities where github_id = $1',
      [profile.id],
    );
    const id = before[0].principal_id;

    // The session digest belongs to a different profile, so the insert conflicts.
    await database.db.insert(sessions).values({
      tokenHash: hash('existing-session'),
      principalId: fixtureIds.admin,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      signInGitHub(
        database,
        profile,
        signInOptions('existing-session', [profile.id], 'owner-first'),
      ),
    ).rejects.toThrow();
    const { rows: afterFailure } = await database.pool.query(
      `select p.role, s.token_hash
       from principals p join sessions s on s.principal_id = p.id
       where p.id = $1`,
      [id],
    );
    expect(afterFailure).toEqual([
      { role: 'participant', token_hash: hash('owner-first') },
    ]);

    await signInGitHub(
      database,
      profile,
      signInOptions('owner-promoted', [profile.id], 'owner-first'),
    );
    await signInGitHub(
      database,
      profile,
      signInOptions('owner-still-admin', [profile.id], 'owner-promoted'),
    );
    await signInGitHub(
      database,
      profile,
      signInOptions('owner-demoted', [], 'owner-still-admin'),
    );
    const { rows: audit } = await database.pool.query(
      `select actor_id, action, metadata_json from audit_events
       where target_id = $1 order by created_at`,
      [id],
    );
    expect(audit).toEqual([
      {
        actor_id: id,
        action: 'principal.role_synced',
        metadata_json: {
          previousRole: 'participant',
          role: 'admin',
          source: 'github_admin_allowlist',
        },
      },
      {
        actor_id: id,
        action: 'principal.role_synced',
        metadata_json: {
          previousRole: 'admin',
          role: 'participant',
          source: 'github_admin_allowlist',
        },
      },
    ]);
  });

  it('rejects revoked or expired sign-ins without changing identity', async () => {
    const profile = { id: '523456', login: 'revoked', displayName: 'Revoked' };
    await signInGitHub(database, profile, signInOptions('before-revoke'));
    const { rows } = await database.pool.query(
      'select principal_id from github_identities where github_id = $1',
      [profile.id],
    );
    const id = rows[0].principal_id;
    await database.pool.query(
      "update principals set status = 'revoked' where id = $1",
      [id],
    );
    await expect(
      signInGitHub(
        database,
        profile,
        signInOptions('after-revoke', [profile.id]),
      ),
    ).rejects.toMatchObject({ code: 'PRINCIPAL_REVOKED' });
    await expect(
      signInGitHub(database, profile, {
        ...signInOptions('expired-at-creation'),
        expiresAt: new Date(0),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    const { rows: persisted } = await database.pool.query(
      'select token_hash from sessions where principal_id = $1',
      [id],
    );
    expect(persisted).toEqual([{ token_hash: hash('before-revoke') }]);
  });

  it('enforces identities, attribution and digest constraints', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await expect(
      database.db.insert(sessions).values({
        tokenHash: 'plaintext-session',
        principalId: fixtureIds.admin,
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      database.db.insert(githubIdentities).values({
        githubId: 'mutable-login',
        principalId: fixtureIds.admin,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      database.db.insert(oauthAttempts).values({
        stateHash: 'plaintext-state',
        codeVerifier: 'v'.repeat(43),
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    const credential = {
      tokenHash: hash('agent-token'),
      agentId: fixtureIds.agentA,
      scopes: ['posts:write'],
      expiresAt,
      createdBy: fixtureIds.admin,
    };
    await database.db.insert(agentCredentials).values(credential);
    await expect(
      database.db.insert(agentCredentials).values(credential),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      database.db
        .insert(agentCredentials)
        .values({ ...credential, tokenHash: 'plaintext-token' }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });

    await expect(
      database.db.insert(auditEvents).values({
        actorId: randomUUID(),
        action: 'agent.created',
        targetType: 'agent',
        targetId: fixtureIds.agentA,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(
      database.db.insert(principals).values({
        kind: 'agent',
        handle: 'too_many_capabilities',
        displayName: 'Exceeds limit',
        ownerPrincipalId: fixtureIds.admin,
        capabilities: Array.from({ length: 17 }, (_, index) => `cap_${index}`),
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('scopes the same idempotency key to principal and operation', async () => {
    const record = {
      principalId: fixtureIds.admin,
      operation: 'agent.create',
      key: 'm1-retry',
      requestHash: hash('validated request'),
      responseJson: { id: fixtureIds.agentA },
    };
    await database.db.insert(idempotencyRecords).values(record);
    await expect(
      database.db.insert(idempotencyRecords).values(record),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await database.db.insert(idempotencyRecords).values([
      { ...record, principalId: fixtureIds.participant },
      { ...record, operation: 'topic.create' },
    ]);
  });
});
