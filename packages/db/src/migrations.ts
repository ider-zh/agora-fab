import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index.js';

export async function migrateDatabase(
  database: Database,
  options: { migrationsSchema?: string } = {},
): Promise<void> {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../migrations/', import.meta.url)),
    migrationsSchema: options.migrationsSchema,
  });
}
