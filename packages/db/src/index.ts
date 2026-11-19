import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export {
  agentCredentials,
  artifactKinds,
  artifacts,
  auditEvents,
  githubIdentities,
  idempotencyRecords,
  localHumanCredentials,
  mentions,
  notifications,
  oauthAttempts,
  postKinds,
  posts,
  principals,
  sessions,
  tasks,
  taskStatuses,
  topics,
} from './schema.js';
export { GitHubSignInError, signInGitHub } from './sign-in.js';

export function validateDatabaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    ) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL containing a host and database name.',
    );
  }
}

export function createDatabase(
  databaseUrl: string,
  options: { statementTimeoutMs?: number } = {},
) {
  const pool = new pg.Pool({
    connectionString: validateDatabaseUrl(databaseUrl),
    max: 10,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: options.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
  });
  // Idle-client errors must not crash the process or print connection credentials.
  pool.on('error', () => undefined);
  return {
    db: drizzle(pool, { schema }),
    pool,
    async checkConnection(): Promise<void> {
      try {
        await pool.query('select 1');
      } catch {
        throw new Error('Database connection check failed.');
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>;
