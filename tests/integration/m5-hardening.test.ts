import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { communityFixture } from './community-fixture.js';

let fixture: Awaited<ReturnType<typeof communityFixture>>;
beforeAll(async () => {
  fixture = await communityFixture();
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

it('shares write limits across MCP and REST and isolates other principals', async () => {
  const scopes = ['community:write'];
  const [first, alternate, third, other] = await Promise.all([
    fixture.issue(fixture.fixtureIds.agentA, scopes),
    fixture.issue(fixture.fixtureIds.agentA, scopes),
    fixture.issue(fixture.fixtureIds.agentA, scopes),
    fixture.issue(fixture.fixtureIds.agentB, scopes),
  ]);
  let time = 120_000;
  const app = buildApp({
    database: fixture.database,
    checkDatabase: fixture.database.checkConnection,
    logger: false,
    trafficLimits: {
      writesPerPrincipal: 3,
      writesPerCredential: 2,
      searchesPerPeer: 2,
    },
    clock: () => time,
  });
  const client = new Client({
    name: 'AgoraFab rate-limit test',
    version: '1.0.0',
  });
  try {
    const endpoint = new URL(
      '/mcp',
      await app.listen({ host: '127.0.0.1', port: 0 }),
    );
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: first },
      }),
    );
    const publish = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/topics/daily-inspiration/posts',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { bodyMd: 'Rate-limit test' },
      });
    const tool = () =>
      client.callTool({
        name: 'create_post',
        arguments: {
          topicId: 'daily-inspiration',
          bodyMd: 'MCP rate-limit test',
          idempotencyKey: randomUUID(),
        },
      });
    expect((await publish(first)).statusCode).toBe(201);
    expect((await tool()).isError).not.toBe(true);
    const limited = await publish(first);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect((await tool()).structuredContent).toMatchObject({
      error: { code: 'RATE_LIMITED', retryable: true },
    });
    expect((await publish(alternate)).statusCode).toBe(201);
    expect((await publish(third)).statusCode).toBe(429);
    expect((await publish(other)).statusCode).toBe(201);
    expect(
      (await app.inject({ url: '/api/search?q=rate', headers: first }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/search?q=rate', headers: first }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/search?q=rate',
          headers: { ...first, 'x-forwarded-for': '198.51.100.10' },
        })
      ).statusCode,
    ).toBe(429);
    time += 60_000;
    expect((await publish(first)).statusCode).toBe(201);
    expect(
      (await app.inject({ url: '/api/search?q=rate', headers: first }))
        .statusCode,
    ).toBe(200);
  } finally {
    try {
      await client.close();
    } finally {
      await app.close();
    }
  }
});

it('rejects mention fanout before writing and protects Agent management records', async () => {
  const { app, admin, human } = fixture;
  expect(
    (
      await app.inject({
        url: '/api/admin/agents',
        headers: { ...human, 'x-role': 'admin' },
      })
    ).statusCode,
  ).toBe(403);
  const directory = await app.inject({
    url: '/api/admin/agents?limit=1',
    headers: admin,
  });
  expect(directory.statusCode).toBe(200);
  const { items, nextCursor } = directory.json();
  expect(items).toHaveLength(1);
  expect(nextCursor).toEqual(expect.any(String));
  expect(items[0]).toMatchObject({
    kind: 'agent',
    ownerPrincipalId: expect.any(String),
  });
  expect(directory.body).not.toMatch(/tokenHash|token_hash|credentialId/);
  const bodyMd = Array.from(
    { length: 11 },
    (_, index) => `@agent_${index}`,
  ).join(' ');
  const response = await app.inject({
    method: 'POST',
    url: '/api/topics/daily-inspiration/posts',
    headers: { ...human, 'idempotency-key': randomUUID() },
    payload: { bodyMd },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json().error.code).toBe('MENTION_LIMIT');
});
