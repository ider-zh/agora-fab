// Run from the repository root with TEST_DATABASE_URL set, a Codex CLI on PATH,
// HERMES_AGENT_DIR set to the Hermes checkout, and HERMES_PYTHON set to its runtime.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communityFixture } from '../integration/community-fixture.js';
import { callCodex } from './codex.js';
import { toolData, type ClientCall, type ClientResult } from './types.js';

async function callHermes(
  configDir: string,
  endpoint: string,
  token: string,
  calls: ClientCall[],
) {
  const cwd = process.env.HERMES_AGENT_DIR;
  const python = process.env.HERMES_PYTHON;
  if (!cwd || !python)
    throw new Error(
      'Set HERMES_AGENT_DIR and HERMES_PYTHON before running the client compatibility check.',
    );
  const child = spawn(
    python,
    ['-B', fileURLToPath(new URL('./hermes.py', import.meta.url))],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HERMES_HOME: configDir,
        PYTHONPATH: cwd,
        NO_PROXY: 'localhost,127.0.0.1,::1',
        AGORAFAB_CLIENT_TOKEN: token,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify({ endpoint, calls }));
  const done = new Promise<number | null>((resolve) => {
    child.once('close', resolve);
    child.once('error', () => resolve(null));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000).unref();
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of child.stdout) {
      chunks.push(chunk);
    }
    const status = await done;
    if (status !== 0)
      throw new Error(
        `Hermes MCP client exited before returning its results (status ${status ?? 'unavailable'}).`,
      );
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ClientResult[];
  } finally {
    clearTimeout(timer);
  }
}

interface Topic {
  id: string;
  slug: string;
}
interface Post {
  id: string;
  author: { id: string; kind: string };
  parentPostId: string | null;
}
interface Notification {
  postId: string;
  readAt: string | null;
}
interface Page<T> {
  items: T[];
}

async function verifyRest(origin: string, post: Post, expectedAuthor: string) {
  assert.equal(post.author.id, expectedAuthor);
  assert.equal(post.author.kind, 'agent');
  const response = await fetch(`${origin}/api/posts/${post.id}`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const { post: rest } = (await response.json()) as { post: Post };
  assert.equal(rest.author.id, expectedAuthor);
  assert.equal(rest.parentPostId, post.parentPostId);
}

async function main() {
  const configDir = await mkdtemp(join(tmpdir(), 'agorafab-mcp-clients-'));
  try {
    const fixture = await communityFixture();
    try {
      const origin = await fixture.app.listen({ host: '127.0.0.1', port: 0 });
      const endpoint = `${origin}/mcp`;
      const scopes = ['community:write', 'notifications:read'];
      const agentA = (
        await fixture.issue(fixture.fixtureIds.agentA, scopes)
      ).authorization.slice('Bearer '.length);
      const agentB = (
        await fixture.issue(fixture.fixtureIds.agentB, scopes)
      ).authorization.slice('Bearer '.length);
      const topicId = fixture.fixtureIds.community;
      const results = await callCodex(configDir, endpoint, agentA, [
        { name: 'list_topics', arguments: {} },
        { name: 'get_topic_context', arguments: { topicId } },
        {
          name: 'create_post',
          arguments: {
            topicId,
            kind: 'idea',
            bodyMd: 'Codex client compatibility idea.',
            idempotencyKey: randomUUID(),
          },
        },
      ]);
      const topics = toolData<Page<Topic>>(results[0], 'Codex list_topics');
      assert.ok(topics.items.some(({ slug }) => slug === 'daily-inspiration'));
      const codexContext = toolData<Record<string, unknown>>(
        results[1],
        'Codex get_topic_context',
      );
      assert.ok(JSON.stringify(codexContext).includes(topicId));
      const post = toolData<{ post: Post }>(
        results[2],
        'Codex create_post',
      ).post;
      await verifyRest(origin, post, fixture.fixtureIds.agentA);
      console.log(
        'Codex app-server discovered the Topic, read bounded context and posted as Agent A.',
      );

      const hermes = await callHermes(configDir, endpoint, agentB, [
        { name: 'list_topics', arguments: {} },
        {
          name: 'reply_post',
          arguments: {
            postId: post.id,
            bodyMd: 'Hermes verified the idea. @fixture_agent_a',
            mentions: ['fixture_agent_a'],
            idempotencyKey: randomUUID(),
          },
        },
      ]);
      assert.ok(
        toolData<Page<Topic>>(hermes[0], 'Hermes list_topics').items.some(
          ({ id }) => id === topicId,
        ),
      );
      const reply = toolData<{ post: Post }>(
        hermes[1],
        'Hermes reply_post',
      ).post;
      assert.equal(reply.parentPostId, post.id);
      await verifyRest(origin, reply, fixture.fixtureIds.agentB);
      console.log(
        'Hermes Agent read the Topic and replied as Agent B. REST confirmed both attributions.',
      );

      const reconnect = await callCodex(configDir, endpoint, agentA, [
        { name: 'get_notifications', arguments: {} },
      ]);
      const notifications = toolData<Page<Notification>>(
        reconnect[0],
        'Codex get_notifications',
      );
      assert.deepEqual(
        notifications.items.map(({ postId, readAt }) => ({ postId, readAt })),
        [{ postId: reply.id, readAt: null }],
      );
      console.log(
        'A fresh Codex app-server connection received exactly one unread notification for the Hermes reply.',
      );
    } finally {
      await fixture.close();
    }
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  // Assertion failures can contain arbitrary client output. Keep diagnostics to
  // phase labels or our own bounded error messages, never process output.
  if (
    error instanceof Error &&
    /^(Codex app-server|Hermes MCP client|Set HERMES|[a-zA-Z]+ (?:list_topics|get_topic_context|create_post|reply_post|get_notifications) )/.test(
      error.message,
    )
  ) {
    console.error(error.message);
  } else {
    console.error('MCP client compatibility verification failed.');
  }
  process.exitCode = 1;
}
