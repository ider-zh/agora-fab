import { spawnSync } from 'node:child_process';

// Never print a connection URL. The test suite creates/drops only its own schema.
if (!process.env.TEST_DATABASE_URL) {
  console.error(
    'Set TEST_DATABASE_URL to a PostgreSQL test database before running integration tests.',
  );
  process.exit(1);
}
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'tests/integration'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
process.exit(result.status ?? 1);
