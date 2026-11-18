import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ClientCall, ClientResult } from './types.js';

export async function callCodex(
  configDir: string,
  endpoint: string,
  token: string,
  calls: ClientCall[],
): Promise<ClientResult[]> {
  const child = spawn(
    process.env.AGORAFAB_CODEX_BINARY ?? 'codex',
    [
      'app-server',
      '--stdio',
      '-c',
      `mcp_servers={agorafab={url=${JSON.stringify(endpoint)},bearer_token_env_var="AGORAFAB_CLIENT_TOKEN",required=true}}`,
      '-c',
      'model_provider="fixture"',
      '-c',
      'model_providers.fixture.name="AgoraFab Client Fixture"',
      '-c',
      'model_providers.fixture.base_url="http://127.0.0.1:1/v1"',
    ],
    {
      cwd: configDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NO_PROXY: 'localhost,127.0.0.1,::1',
        AGORAFAB_CLIENT_TOKEN: token,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );

  // App-server interleaves status notifications with JSON-RPC replies.
  const terminal = new Promise<void>((resolve) => {
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
  const input = child.stdin;
  input.on('error', () => undefined);
  const output = createInterface({ input: child.stdout });
  const lines = output[Symbol.asyncIterator]();
  const timer = setTimeout(() => child.kill('SIGKILL'), 35_000).unref();
  let id = 0;

  async function rpc<T>(method: string, params: object): Promise<T> {
    id += 1;
    input.write(`${JSON.stringify({ id, method, params })}\n`);
    for (;;) {
      const next = await lines.next();
      if (next.done)
        throw new Error(`Codex app-server stopped during ${method}.`);
      const msg: { id?: number; result?: T; error?: { code?: number } } =
        JSON.parse(next.value);
      if (msg.id !== id) continue;
      if (msg.result === undefined || msg.error)
        throw new Error(
          `Codex app-server rejected ${method} (RPC ${msg.error?.code ?? 'unknown'}).`,
        );
      return msg.result;
    }
  }

  try {
    await rpc('initialize', {
      clientInfo: {
        name: 'agorafab_mcp_parity',
        title: 'AgoraFab compatibility test',
        version: '1.0.0',
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    input.write('{"method":"initialized"}\n');
    const { thread } = await rpc<{ thread: { id: string } }>('thread/start', {
      cwd: configDir,
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
    });
    const results: ClientResult[] = [];
    for (const call of calls) {
      results.push(
        await rpc<ClientResult>('mcpServer/tool/call', {
          threadId: thread.id,
          server: 'agorafab',
          tool: call.name,
          arguments: call.arguments,
        }),
      );
    }
    return results;
  } finally {
    output.close();
    input.end();
    child.kill('SIGTERM');
    await terminal;
    clearTimeout(timer);
  }
}
