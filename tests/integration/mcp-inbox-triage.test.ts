import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { shortResourceId } from '../../packages/mcp/src/references.js';
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

async function post(
  url: string,
  headers: Record<string, string>,
  bodyMd: string,
  mentions?: string[],
) {
  const response = await fixture.app.inject({
    method: 'POST',
    url,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { bodyMd, mentions },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ post: { id: string } }>().post.id;
}

it('returns bounded mention context through REST and MCP only for the recipient while the post is visible', async () => {
  const { app, admin, human, issue, fixtureIds } = fixture;
  const reader = await issue(fixtureIds.agentA, ['notifications:read']);
  const sender = await issue(fixtureIds.agentB, [
    'community:write',
    'notifications:read',
  ]);
  const feed = '/api/topics/daily-inspiration/posts';
  const parentId = await post(feed, human, 'Parent discussion');
  const olderId = await post(feed, human, 'Earlier notice @fixture_agent_a');
  const fragment = '<b>未读内容</b>';
  const latestId = await post(
    `/api/posts/${parentId}/replies`,
    sender,
    `${fragment}\n\n${'🧭'.repeat(180)} unreachable tail`,
    ['fixture_agent_a'],
  );

  const client = new Client({ name: 'inbox-triage', version: '0.1.0' });
  const otherClient = new Client({
    name: 'inbox-triage-other',
    version: '0.1.0',
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: reader },
      }),
    );
    await otherClient.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: sender },
      }),
    );
    const first = await client.callTool({
      name: 'get_notifications',
      arguments: { limit: 1 },
    });
    const excerpt =
      fragment + ' ' + '🧭'.repeat(159 - fragment.length - 1) + '…';
    const rest = await app.inject({
      url: '/api/me/notifications?unread=1&limit=1',
      headers: reader,
    });
    expect(rest.statusCode).toBe(200);
    const { items, nextCursor } = rest.json<{
      items: Array<{ id: string; postId: string; readAt: string | null }>;
      nextCursor: string;
    }>();
    expect(items).toEqual([
      expect.objectContaining({
        postId: latestId,
        topicSlug: 'daily-inspiration',
        senderHandle: 'fixture_agent_b',
        excerpt,
        readAt: null,
      }),
    ]);
    const latestNote = items[0]!;
    expect(first.structuredContent).toEqual({
      items: [
        {
          ...latestNote,
          id: shortResourceId(latestNote.id),
          postId: shortResourceId(latestId),
        },
      ],
      nextCursor,
    });
    const second = await client.callTool({
      name: 'get_notifications',
      arguments: { limit: 1, cursor: nextCursor },
    });
    expect(second.structuredContent).toMatchObject({
      items: [
        {
          postId: shortResourceId(olderId),
          senderHandle: 'gh_7002',
          excerpt: 'Earlier notice @fixture_agent_a',
          readAt: null,
        },
      ],
      nextCursor: null,
    });
    expect(
      (await otherClient.callTool({ name: 'get_notifications' }))
        .structuredContent,
    ).toEqual({ items: [], nextCursor: null });
    expect(
      (
        await otherClient.callTool({
          name: 'get_notifications',
          arguments: { cursor: nextCursor },
        })
      ).structuredContent,
    ).toMatchObject({ error: { code: 'INVALID_CURSOR' } });

    const mark = await client.callTool({
      name: 'mark_notification_read',
      arguments: { notificationId: shortResourceId(latestNote.id) },
    });
    expect(mark.structuredContent).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    });
    const afterRead = await client.callTool({
      name: 'get_notifications',
      arguments: { limit: 1 },
    });
    expect(afterRead.structuredContent).toEqual(first.structuredContent);

    const hide = await app.inject({
      method: 'POST',
      url: `/api/admin/posts/${parentId}/hide`,
      headers: admin,
      payload: { reason: 'Test descendant visibility' },
    });
    expect(hide.statusCode).toBe(204);
    const afterHide = await client.callTool({ name: 'get_notifications' });
    expect(afterHide.structuredContent).toEqual(second.structuredContent);

    const archive = await app.inject({
      method: 'PATCH',
      url: `/api/admin/topics/${fixtureIds.community}`,
      headers: admin,
      payload: { status: 'archived' },
    });
    expect(archive.statusCode).toBe(200);
    const afterArchive = await client.callTool({ name: 'get_notifications' });
    expect(afterArchive.structuredContent).toEqual({
      items: [],
      nextCursor: null,
    });
  } finally {
    await Promise.all([client.close(), otherClient.close()]);
  }
}, 15_000);
