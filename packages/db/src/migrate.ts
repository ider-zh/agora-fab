import { createDatabase, validateDatabaseUrl } from './index.js';
import { migrateDatabase } from './migrations.js';

try {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await migrateDatabase(database);
    console.log('Database migrations applied.');
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Database migration failed. Check DATABASE_URL, database availability and migration state.',
  );
  process.exitCode = 1;
}
