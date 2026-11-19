import { randomUUID } from 'node:crypto';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { communityFixture } from './community-fixture.js';

let fixture: Awaited<ReturnType<typeof communityFixture>>;
let endpoint: URL;

beforeAll(async () => {
  fixture = await communityFixture();
  endpoint = new URL(
    '/mcp',
    await fixture.app.listen({ host: '127.0.0.1', port: 0 }),
  );
}, 30_000);

afterAll(async () => {
  await fixture?.close();
});

async function withClient<T>(
  headers: Record<string, string>,
  run: (client: Client, transport: StreamableHTTPClientTransport) => Promise<T>,
) {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
  });
  const client = new Client({ name: 'agorafab-integration', version: '0.1.0' });
  try {
    await client.connect(transport);
    return await run(client, transport);
  } finally {
    await client.close();
  }
}

async function tool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function expectToolError(result: CallToolResult, code: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent?.error).toMatchObject({
    code,
    message: expect.any(String),
    requestId: expect.any(String),
    retryable: false,
  });
}

type Posted = { id: string; author: { id: string } };

function expectPost(result: CallToolResult, authorId: string) {
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent?.post).toMatchObject({
    id: expect.any(String),
    author: { id: authorId },
  });
  return result.structuredContent?.post as Posted;
}

const rpcHeaders = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
};
const topicId = 'daily-inspiration';

describe('official SDK clients over Streamable HTTP', () => {
  it('allows stateless tool discovery and requires Agent credentials for content', async () => {
    await withClient(
      { cookie: fixture.admin.cookie },
      async (client, transport) => {
        expect(client.getServerVersion()?.name).toBe('AgoraFab');
        expect(transport.sessionId).toBeUndefined();
        const discovery = await client.listTools();
        expect(discovery.tools.map(({ name }) => name)).toEqual(
          expect.arrayContaining([
            'list_topics',
            'get_topic_context',
            'list_posts',
            'get_post',
            'create_post',
            'reply_post',
            'get_notifications',
          ]),
        );
        for (const [name, args] of [
          ['list_topics', {}],
          ['get_topic_context', { topicId }],
          ['list_posts', { topicId }],
          ['get_post', { postId: randomUUID() }],
          ['list_tasks', { topicId: fixture.fixtureIds.project }],
        ] as const) {
          const result = await tool(client, name, args);
          expectToolError(result, 'UNAUTHORIZED');
          expect(Object.keys(result.structuredContent ?? {})).toEqual([
            'error',
          ]);
        }
        expectToolError(
          await tool(client, 'list_topics', { privateCredential: true }),
          'VALIDATION_ERROR',
        );
        expectToolError(
          await tool(client, 'create_post', {
            topicId,
            bodyMd: 'Unauthenticated request',
            idempotencyKey: randomUUID(),
          }),
          'UNAUTHORIZED',
        );
        expectToolError(
          await tool(client, 'get_notifications'),
          'UNAUTHORIZED',
        );
      },
    );
    const credential = await fixture.issue(fixture.fixtureIds.agentA, [
      'notifications:read',
    ]);
    await withClient(credential, async (client) => {
      const topics = await tool(client, 'list_topics');
      expect(topics.structuredContent?.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ slug: topicId })]),
      );
      expect(topics.content[0]).toEqual({
        type: 'text',
        text: JSON.stringify(topics.structuredContent),
      });
    });
  });

  it('uses the same authors, writes and idempotency keys as REST and isolates inboxes', async () => {
    const scopes = ['community:write', 'notifications:read'];
    const agentA = await fixture.issue(fixture.fixtureIds.agentA, scopes);
    const agentB = await fixture.issue(fixture.fixtureIds.agentB, scopes);
    await withClient(agentA, async (first) => {
      const idempotencyKey = randomUUID();
      const expectedBody = 'An MCP post verified against the same REST service';
      const input = { topicId, bodyMd: expectedBody, idempotencyKey };
      expectToolError(
        await tool(first, 'create_post', {
          ...input,
          authorId: fixture.fixtureIds.agentB,
        }),
        'VALIDATION_ERROR',
      );
      const post = expectPost(
        await tool(first, 'create_post', input),
        fixture.fixtureIds.agentA,
      );
      expect(
        expectPost(
          await tool(first, 'create_post', input),
          fixture.fixtureIds.agentA,
        ).id,
      ).toBe(post.id);
      const replay = await fixture.app.inject({
        method: 'POST',
        url: `/api/topics/${topicId}/posts`,
        headers: { ...agentA, 'idempotency-key': idempotencyKey },
        payload: { bodyMd: expectedBody },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().post).toMatchObject({
        id: post.id,
        author: { id: fixture.fixtureIds.agentA },
      });
      expectToolError(
        await tool(first, 'create_post', {
          ...input,
          bodyMd: 'Different text',
        }),
        'IDEMPOTENCY_CONFLICT',
      );
      const reply = await withClient(agentB, async (second) => {
        const result = expectPost(
          await tool(second, 'reply_post', {
            postId: post.id,
            bodyMd: 'Thank you @fixture_agent_a for your post.',
            idempotencyKey: randomUUID(),
          }),
          fixture.fixtureIds.agentB,
        );
        const otherInbox = await tool(second, 'get_notifications');
        expect(otherInbox.structuredContent?.items).toEqual([]);
        expectToolError(
          await tool(second, 'get_notifications', {
            principalId: fixture.fixtureIds.agentA,
          }),
          'VALIDATION_ERROR',
        );
        return result;
      });
      const inbox = await tool(first, 'get_notifications', { unread: true });
      expect(inbox.structuredContent?.items).toEqual([
        expect.objectContaining({ postId: reply.id }),
      ]);
      expect(
        (await tool(first, 'get_post', { postId: post.id })).structuredContent
          ?.replies,
      ).toEqual([expect.objectContaining({ id: reply.id })]);
    });
  });

  it('checks scopes and revocation at each call', async () => {
    const readonlyCredential = await fixture.app.inject({
      method: 'POST',
      url: `/api/admin/agents/${fixture.fixtureIds.agentA}/credentials`,
      headers: { ...fixture.admin, 'idempotency-key': randomUUID() },
      payload: { scopes: ['notifications:read'] },
    });
    expect(readonlyCredential.statusCode).toBe(201);
    const { token, credential } = readonlyCredential.json<{
      token: string;
      credential: { id: string };
    }>();
    await withClient({ authorization: `Bearer ${token}` }, async (client) => {
      expectToolError(
        await tool(client, 'create_post', {
          topicId,
          bodyMd: 'Scope denied',
          idempotencyKey: randomUUID(),
        }),
        'INSUFFICIENT_SCOPE',
      );
      const revoked = await fixture.app.inject({
        method: 'DELETE',
        url: `/api/admin/agents/${fixture.fixtureIds.agentA}/credentials/${credential.id}`,
        headers: fixture.admin,
      });
      expect(revoked.statusCode).toBe(204);
      await expect(tool(client, 'list_topics')).rejects.toMatchObject({
        code: 401,
      });
      await expect(tool(client, 'get_notifications')).rejects.toMatchObject({
        code: 401,
      });
    });
  });

  it('keeps context bounded and preserves paging through multibyte posts', async () => {
    const agent = await fixture.issue(fixture.fixtureIds.agentA, [
      'community:write',
    ]);
    const ids: string[] = [];
    for (const marker of ['First', 'Second', 'Third']) {
      const response = await fixture.app.inject({
        method: 'POST',
        url: `/api/topics/${topicId}/posts`,
        headers: { ...agent, 'idempotency-key': randomUUID() },
        payload: { bodyMd: `${marker} ${'🌿'.repeat(4900)}` },
      });
      expect(response.statusCode).toBe(201);
      ids.push(response.json<{ post: { id: string } }>().post.id);
    }
    await withClient(agent, async (client) => {
      const first = await tool(client, 'get_topic_context', {
        topicId,
        limit: 2,
      });
      const pack = first.structuredContent;
      expect(pack).toMatchObject({
        topic: { slug: topicId },
        recentPosts: expect.any(Array),
        pinnedPosts: expect.any(Array),
        openTasks: expect.any(Array),
        nextCursor: expect.any(String),
        hasMore: true,
        serverTime: expect.any(String),
      });
      const recent = pack?.recentPosts as {
        id: string;
        bodyMd: string;
        bodyTruncated: boolean;
      }[];
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.length).toBeLessThanOrEqual(2);
      expect(recent.map(({ id }) => id)).toEqual(
        ids.slice(-recent.length).reverse(),
      );
      expect(
        recent.every(
          ({ bodyMd, bodyTruncated }) => bodyTruncated && bodyMd.endsWith('…'),
        ),
      ).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(pack))).toBeLessThanOrEqual(
        32_768,
      );
      const next = await tool(client, 'get_topic_context', {
        topicId,
        cursor: pack?.nextCursor,
        limit: 2,
      });
      const nextRecent = next.structuredContent?.recentPosts as {
        id: string;
      }[];
      expect(nextRecent[0]?.id).toBe(ids.at(-recent.length - 1));
      expect(
        nextRecent.some(({ id }) => recent.some((prev) => prev.id === id)),
      ).toBe(false);
    });
  });
});

describe('MCP transport boundary', () => {
  it('rejects unapproved authorities and origins, invalid credentials and unsupported methods', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    // Fetch rewrites Host to the URL authority, so use a Node HTTP request here.
    const wrongHost = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = requestHttp(
        endpoint,
        {
          method: 'POST',
          headers: {
            ...rpcHeaders,
            host: 'unapproved.example',
            'x-forwarded-host': endpoint.host,
          },
        },
        resolve,
      );
      request.once('error', reject);
      request.end(body);
    });
    wrongHost.setEncoding('utf8');
    let hostReply = '';
    for await (const chunk of wrongHost) hostReply += chunk;
    expect(wrongHost.statusCode).toBe(403);
    expect(JSON.parse(hostReply)).toMatchObject({
      error: {
        data: {
          code: 'INVALID_HOST',
          requestId: wrongHost.headers['x-request-id'],
        },
      },
    });

    for (const { headers, expectedCode, expectedStatus } of [
      {
        headers: { origin: 'https://unapproved.example' },
        expectedCode: 'INVALID_ORIGIN',
        expectedStatus: 403,
      },
      {
        headers: { authorization: 'Bearer invalid-credential' },
        expectedCode: 'UNAUTHORIZED',
        expectedStatus: 401,
      },
    ]) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...rpcHeaders, ...headers } as Record<string, string>,
        body,
      });
      expect(response.status).toBe(expectedStatus);
      const json = await response.json();
      expect(json).toMatchObject({
        error: {
          data: {
            code: expectedCode,
            requestId: response.headers.get('x-request-id'),
          },
        },
      });
      expect(JSON.stringify(json)).not.toContain('invalid-credential');
    }
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(endpoint, { method, headers: rpcHeaders });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      await response.body?.cancel();
    }
  });
});
