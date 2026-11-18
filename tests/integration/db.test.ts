import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { fixtureIds, seedFixtures } from '../../packages/db/src/seed.js';

// Each run owns a unique schema. No pre-existing table/schema/database is cleared.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests.',
  );
}
const schemaName = `agorafab_test_${randomUUID().replaceAll('-', '')}`;
let control: Database | undefined;
let database: Database;

describe('PostgreSQL migration and fixtures', () => {
  beforeAll(async () => {
    control = createDatabase(testDatabaseUrl!);
    await control.pool.query(`create schema "${schemaName}"`);
    const isolatedUrl = new URL(testDatabaseUrl!);
    isolatedUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    database = createDatabase(isolatedUrl.toString());
    await migrateDatabase(database, { migrationsSchema: schemaName });
    await migrateDatabase(database, { migrationsSchema: schemaName });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
  }, 30_000);

  afterAll(async () => {
    if (database) await database.close();
    if (control) {
      try {
        await control.pool.query(
          `drop schema if exists "${schemaName}" cascade`,
        );
      } finally {
        await control.close();
      }
    }
  });

  it('migrates and seeds twice without duplicate identities or Topics', async () => {
    await expect(database.checkConnection()).resolves.toBeUndefined();
    const profiles = await database.pool.query<{
      id: string;
      kind: string;
      role: string;
      owner_principal_id: string | null;
    }>('select * from principals order by id');
    expect(profiles.rows).toHaveLength(4);
    expect(profiles.rows[0]).toMatchObject({
      id: fixtureIds.admin,
      kind: 'human',
      role: 'admin',
    });
    expect(profiles.rows[2]).toMatchObject({
      id: fixtureIds.agentA,
      owner_principal_id: fixtureIds.admin,
    });
    expect(profiles.rows[3]).toMatchObject({
      id: fixtureIds.agentB,
      owner_principal_id: fixtureIds.participant,
    });
    const workspaces = await database.pool.query(
      'select * from topics order by id',
    );
    expect(workspaces.rows).toHaveLength(2);
    expect(workspaces.rows[0]).toMatchObject({
      slug: 'daily-inspiration',
      kind: 'community',
    });
    expect(workspaces.rows[1]).toMatchObject({
      id: fixtureIds.project,
      kind: 'project',
    });
    expect(workspaces.rows[1].goal_md).toBeTruthy();
    const migrations = await database.pool.query(
      'select count(*)::int as count from __drizzle_migrations',
    );
    expect(migrations.rows[0].count).toBe(1);
  });

  it('enforces stable identity, normalized unique handles and human-only admins', async () => {
    await expect(
      database.pool.query(
        "insert into principals (kind, handle, display_name) values ('human', 'Fixture_Admin', 'Invalid')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "insert into principals (kind, handle, display_name) values ('human', 'fixture_admin', 'Duplicate')",
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.pool.query(
        "insert into principals (kind, handle, display_name, role, owner_principal_id) values ('agent', 'bad_admin', 'Invalid', 'admin', $1)",
        [fixtureIds.admin],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "insert into principals (kind, handle, display_name) values ('agent', 'unowned_agent', 'Invalid')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "insert into principals (kind, handle, display_name, owner_principal_id) values ('agent', 'unknown_owner', 'Invalid', $1)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces unique Topic slugs, project goals and stable creator references', async () => {
    await expect(
      database.pool.query(
        "insert into topics (slug, kind, title, created_by) values ('daily-inspiration', 'community', 'Duplicate', $1)",
        [fixtureIds.admin],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.pool.query(
        "insert into topics (slug, kind, title, created_by) values ('bad-project', 'project', 'Missing goal', $1)",
        [fixtureIds.admin],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "insert into topics (slug, kind, title, created_by) values ('unknown-creator', 'community', 'Invalid', $1)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
