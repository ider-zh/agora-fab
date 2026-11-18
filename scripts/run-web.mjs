import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Loading through Node's CLI causes Next dev to forward --env-file into
// NODE_OPTIONS for workers, where Node rejects it. Load before spawning instead.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Cannot load the root .env file. Check file permissions.');
    process.exit(1);
  }
}

const executable = fileURLToPath(
  new URL('../apps/web/node_modules/next/dist/bin/next', import.meta.url),
);
const child = spawn(process.execPath, [executable, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', () => {
  console.error('Unable to start the Web process.');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode =
    code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
});
