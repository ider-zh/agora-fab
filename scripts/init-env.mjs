import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

try {
  const template = await readFile(
    new URL('../.env.example', import.meta.url),
    'utf8',
  );
  const content = template.replaceAll(
    'GENERATE_LOCAL_PASSWORD',
    randomBytes(24).toString('hex'),
  );
  await writeFile(new URL('../.env', import.meta.url), content, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    'Created .env with a generated local database password. Keep it outside git.',
  );
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('.env already exists; left unchanged.');
  } else {
    console.error(
      'Could not initialize .env. Check file permissions and .env.example.',
    );
    process.exitCode = 1;
  }
}
