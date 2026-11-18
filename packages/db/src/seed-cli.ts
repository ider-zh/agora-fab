import { createDatabase, validateDatabaseUrl } from './index.js';
import { assertFixtureMode, seedFixtures } from './seed.js';

try {
  assertFixtureMode(process.env);
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await seedFixtures(database, process.env);
    console.log('Credential-free fixture profiles and Topics seeded.');
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Fixture seed failed. Requires SEED_MODE=fixture, non-production NODE_ENV and a migrated DATABASE_URL.',
  );
  process.exitCode = 1;
}
