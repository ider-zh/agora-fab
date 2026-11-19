import { createDatabase } from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import { bootstrapLocalAdmin } from './auth/local.js';
import { ConfigurationError, loadConfig } from './config.js';

async function main() {
  const [handle, displayName, ...extra] = process.argv.slice(2);
  if (!handle || !displayName || extra.length || process.stdin.isTTY) {
    throw new Error(
      'Provide a handle and display name and read the password from standard input.',
    );
  }
  const config = loadConfig();
  if (!config.localAuthOrigin)
    throw new ConfigurationError(['LOCAL_AUTH_ENABLED']);

  let password = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    password += chunk;
    if (password.length > 130)
      throw new Error('Input exceeds the password length limit.');
  }
  const database = createDatabase(config.databaseUrl);
  try {
    const admin = await bootstrapLocalAdmin(database, {
      handle,
      displayName,
      password: password.replace(/\r?\n$/, ''),
    });
    console.log(
      JSON.stringify({ handle: admin.handle, principalId: admin.id }),
    );
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof DomainError || error instanceof ConfigurationError
      ? error.message
      : 'Administrator initialization failed. Check arguments, password input, database access and migrations.',
  );
  process.exitCode = 1;
});
