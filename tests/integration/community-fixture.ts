import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { digest } from '../../apps/api/src/auth/http.js';
import { createDatabase, signInGitHub } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { fixtureIds, seedFixtures } from '../../packages/db/src/seed.js';

export async function communityFixture() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required.');
  const schema = `agorafab_community_${randomUUID().replaceAll('-', '')}`;
  const control = createDatabase(url);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  const database = createDatabase(scoped.toString());
  const origin = 'https://agorafab.example';
  const github = {
    origin,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    adminIds: new Set(['7001']),
  };
  const app = buildApp({
    database,
    checkDatabase: database.checkConnection,
    logger: false,
    github,
  });

  async function close() {
    await app.close();
    await database.close();
    try {
      await control.pool.query(`drop schema if exists "${schema}" cascade`);
    } finally {
      await control.close();
    }
  }

  async function session(id: string) {
    const token = randomBytes(32).toString('base64url');
    await signInGitHub(
      database,
      { id, login: `actor${id}`, displayName: 'Test Actor' },
      {
        adminIds: github.adminIds,
        sessionHash: digest(token),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    );
    return { cookie: `__Host-agorafab_session=${token}`, origin };
  }

  try {
    await control.pool.query(`create schema "${schema}"`);
    await migrateDatabase(database, { migrationsSchema: schema });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
    const [admin, human] = await Promise.all([
      session('7001'),
      session('7002'),
    ]);

    async function issue(agentId: string, scopes: string[]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/agents/${agentId}/credentials`,
        headers: { ...admin, 'idempotency-key': randomUUID() },
        payload: { scopes },
      });
      if (response.statusCode !== 201)
        throw new Error(
          `Fixture credential issuance failed: ${response.statusCode}`,
        );
      return { authorization: `Bearer ${response.json().token as string}` };
    }

    return { database, app, admin, human, issue, close, fixtureIds };
  } catch (error) {
    await close();
    throw error;
  }
}
