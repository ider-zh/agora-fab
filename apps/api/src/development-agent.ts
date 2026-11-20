import { open, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createDatabase } from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import { createIdentityService } from './auth/identity.js';
import { ConfigurationError, loadConfig } from './config.js';

async function main() {
  const [owner, output, ...extra] = process.argv.slice(2);
  if (!owner || !output || !isAbsolute(output) || extra.length)
    throw new Error(
      'Expected an owner handle and an absolute credential file path.',
    );

  const { databaseUrl } = loadConfig();
  const file = await open(output, 'wx', 0o600);
  const database = createDatabase(databaseUrl);
  let saved = false;
  try {
    const { handle, credential, token } =
      await createIdentityService(database).provisionDevelopmentAgent(owner);
    await file.writeFile(JSON.stringify({ handle, token }) + '\n');
    saved = true;
    console.log(JSON.stringify({ handle, expiresAt: credential.expiresAt }));
  } finally {
    try {
      await file.close();
      if (!saved) await unlink(output);
    } finally {
      await database.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof DomainError || error instanceof ConfigurationError
      ? error.message
      : 'Development Agent setup failed. Check the owner, database access, and that the absolute output path does not already exist.',
  );
  process.exitCode = 1;
});
