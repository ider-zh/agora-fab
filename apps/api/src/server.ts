import { createDatabase } from '@agorafab/db';
import { buildApp } from './app.js';
import { ConfigurationError, loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const app = buildApp({
    checkDatabase: () => database.checkConnection(),
    database,
    github: config.github,
  });
  app.addHook('onClose', async () => database.close());

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
    } catch {
      app.log.error({ code: 'SHUTDOWN_FAILED' }, 'API shutdown failed.');
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    await shutdown();
    throw new Error('API startup failed.');
  }
}

void main().catch((error: unknown) => {
  // Startup failures may include connection strings; never serialize the original error.
  console.error(
    JSON.stringify({
      level: 'error',
      code:
        error instanceof ConfigurationError
          ? 'INVALID_CONFIG'
          : 'STARTUP_FAILED',
      message:
        error instanceof ConfigurationError
          ? error.message
          : 'API startup failed.',
    }),
  );
  process.exitCode = 1;
});
