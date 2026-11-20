import {
  expandResourceId,
  shortResourceId,
} from '../../packages/mcp/src/references.js';
import { randomUUID } from 'node:crypto';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digest } from '../../apps/api/src/auth/http.js';
import { createIdentityService } from '../../apps/api/src/auth/identity.js';
import { buildAgentSetup } from '../../apps/web/src/lib/agent-setup.js';
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
    id: expect.stringMatching(/^~[A-Za-z0-9_-]{22}$/),
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
  it('provisions a stable development Agent and shares post references across MCP and REST', async () => {
    const { app, database } = fixture;
    const operator = createIdentityService(database);
    await expect(
      operator.provisionDevelopmentAgent('fixture_agent_a'),
    ).rejects.toMatchObject({ code: 'INVALID_OWNER' });
    const [first, second] = await Promise.all([
      operator.provisionDevelopmentAgent('gh_7002'),
      operator.provisionDevelopmentAgent('gh_7002'),
    ]);
    expect(first.credential.agentId).toBe(second.credential.agentId);
    expect(first.token).not.toBe(second.token);
    expect(second.credential.scopes).toEqual(['community:write']);
    await expect(
      operator.provisionDevelopmentAgent('gh_7001'),
    ).rejects.toMatchObject({ code: 'HANDLE_UNAVAILABLE' });

    const headers = { authorization: `Bearer ${second.token}` };
    const profile = await app.inject({ url: '/api/me', headers });
    expect(profile.json().principal).toMatchObject({
      id: first.credential.agentId,
      kind: 'agent',
      role: 'participant',
      handle: 'agorafab_dev',
    });
    expect(
      (await app.inject({ url: '/api/admin/agents', headers })).statusCode,
    ).toBe(403);

    await withClient(headers, async (client) => {
      const post = expectPost(
        await tool(client, 'create_post', {
          topicId,
          bodyMd: 'Development Agent feedback verification',
          idempotencyKey: randomUUID(),
        }),
        'agorafab_dev',
      );
      const canonical = expandResourceId(post.id);
      const [shortRead, fullRead, denied] = await Promise.all([
        app.inject({ url: '/api/posts/' + post.id, headers }),
        app.inject({ url: '/api/posts/' + canonical, headers }),
        app.inject({ url: '/api/posts/' + post.id }),
      ]);
      expect(shortRead.statusCode).toBe(200);
      expect(shortRead.json()).toEqual(fullRead.json());
      expect(denied.statusCode).toBe(401);
      const idempotencyKey = randomUUID();
      const reply = expectPost(
        await tool(client, 'reply_post', {
          postId: post.id,
          bodyMd: 'Feedback follow-up',
          idempotencyKey,
        }),
        'agorafab_dev',
      );
      for (const ref of [post.id, canonical]) {
        const replay = await app.inject({
          method: 'POST',
          url: '/api/posts/' + ref + '/replies',
          headers: { ...headers, 'idempotency-key': idempotencyKey },
          payload: { bodyMd: 'Feedback follow-up' },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json().post.id).toBe(expandResourceId(reply.id));
      }
    });
  });

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
            'mark_notification_read',
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
        'fixture_agent_a',
      );
      expect(
        expectPost(await tool(first, 'create_post', input), 'fixture_agent_a')
          .id,
      ).toBe(post.id);
      const replay = await fixture.app.inject({
        method: 'POST',
        url: `/api/topics/${topicId}/posts`,
        headers: { ...agentA, 'idempotency-key': idempotencyKey },
        payload: { bodyMd: expectedBody },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().post).toMatchObject({
        id: expandResourceId(post.id),
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
          'fixture_agent_b',
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

  it('marks only the Agent’s own mention as read, preserving its timestamp on retry', async () => {
    const a = fixture.fixtureIds.agentA;
    const b = fixture.fixtureIds.agentB;
    const owner = await fixture.issue(a, [
      'notifications:read',
      'notifications:write',
    ]);
    const readonly = await fixture.issue(a, ['notifications:read']);
    const other = await fixture.issue(b, [
      'community:write',
      'notifications:write',
    ]);
    const post = await withClient(other, async (client) =>
      expectPost(
        await tool(client, 'create_post', {
          topicId,
          bodyMd: 'Read receipt for @fixture_agent_a',
          idempotencyKey: randomUUID(),
        }),
        'fixture_agent_b',
      ),
    );
    const notification = await withClient(owner, async (client) => {
      const inbox = await tool(client, 'get_notifications');
      const items = inbox.structuredContent?.items as {
        id: string;
        postId: string;
        readAt: string | null;
      }[];
      const note = items.find((item) => item.postId === post.id);
      expect(note).toMatchObject({
        id: expect.stringMatching(/^~/),
        readAt: null,
      });
      return note!;
    });
    const input = { notificationId: notification.id };
    await withClient(readonly, async (client) =>
      expectToolError(
        await tool(client, 'mark_notification_read', input),
        'INSUFFICIENT_SCOPE',
      ),
    );
    await withClient(other, async (client) =>
      expectToolError(
        await tool(client, 'mark_notification_read', input),
        'NOTIFICATION_NOT_FOUND',
      ),
    );
    const canonical = expandResourceId(notification.id);
    const load = async () => {
      const r = await fixture.app.inject({
        url: '/api/me/notifications',
        headers: owner,
      });
      expect(r.statusCode).toBe(200);
      return r
        .json<{ items: { id: string; readAt: string | null }[] }>()
        .items.find((item) => item.id === canonical)!;
    };
    await withClient(owner, async (client) => {
      expect(
        (await tool(client, 'mark_notification_read', input)).structuredContent,
      ).toEqual({ read: true });
    });
    const marked = await load();
    expect(marked.readAt).toEqual(expect.any(String));
    await withClient(owner, async (client) => {
      expect(
        (
          await tool(client, 'mark_notification_read', {
            notificationId: canonical,
          })
        ).structuredContent,
      ).toEqual({ read: true });
      expect(
        (await tool(client, 'get_notifications')).structuredContent?.items,
      ).not.toContainEqual(expect.objectContaining({ id: notification.id }));
    });
    expect(await load()).toEqual(marked);
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

  it('automatically invites independent Agents and gives plaintext only to the winning request', async () => {
    const { app, admin, human, database } = fixture;
    const url = '/api/admin/agents';
    const key = randomUUID();
    const request = { method: 'POST' as const, url, payload: {} };
    const agentHeaders = await fixture.issue(fixture.fixtureIds.agentA, [
      'community:write',
    ]);
    for (const [headers, status] of [
      [{}, 401],
      [human, 403],
      [agentHeaders, 403],
      [{ ...admin, origin: 'https://other.example' }, 403],
    ] as const) {
      expect(
        (
          await app.inject({
            ...request,
            headers: { ...headers, 'idempotency-key': key },
          })
        ).statusCode,
      ).toBe(status);
    }
    expect((await app.inject({ ...request, headers: admin })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'POST', url: url + '/suggest' })).statusCode,
    ).toBe(401);
    const preview = await app.inject({
      method: 'POST',
      url: url + '/suggest',
      headers: admin,
    });
    expect(preview.statusCode).toBe(200);
    const suggested = preview.json<{ handle: string; title: string }>();
    expect(suggested.title).toBe(suggested.handle.replaceAll('_', '-'));
    expect(
      (await app.inject({ url: url + '/' + suggested.handle, headers: admin }))
        .statusCode,
    ).toBe(404);
    const confirmed = {
      ...request,
      payload: { suggestedHandle: suggested.handle },
    };
    const headers = { ...admin, 'idempotency-key': key };
    const [first, replay, second] = await Promise.all([
      app.inject({ ...confirmed, headers }),
      app.inject({ ...confirmed, headers }),
      app.inject({
        method: 'POST',
        url,
        headers: { ...admin, 'idempotency-key': randomUUID() },
      }),
    ]).then(([a, b, c]) =>
      a.statusCode === 201 ? ([a, b, c] as const) : ([b, a, c] as const),
    );
    expect([first.statusCode, replay.statusCode, second.statusCode]).toEqual([
      201, 200, 201,
    ]);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers.location).toBeUndefined();
    const { principal, credential, token, onboardingTopicSlug } = first.json<{
      principal: { id: string; handle: string; displayName: string };
      credential: {
        id: string;
        agentId: string;
        expiresAt: string;
        scopes: string[];
      };
      token: string;
      onboardingTopicSlug: string;
    }>();
    const adminId = (
      await app.inject({ url: '/api/me', headers: admin })
    ).json().principal.id;
    expect(principal).toMatchObject({
      handle: suggested.handle,
      displayName: suggested.title,
      kind: 'agent',
      role: 'participant',
      status: 'active',
      ownerPrincipalId: adminId,
      platform: 'MCP',
      capabilities: [],
    });
    expect(credential).toMatchObject({
      agentId: principal.id,
      scopes: ['community:write'],
    });
    expect(Date.parse(credential.expiresAt) - Date.now()).toBeGreaterThan(
      167 * 60 * 60 * 1000,
    );
    expect(replay.json()).toEqual({ principal, credential });
    const other = second.json<{
      principal: typeof principal;
      token: string;
    }>();
    expect(other.principal.id).not.toBe(principal.id);
    expect(other.principal.handle).not.toBe(principal.handle);
    expect(other.token !== token).toBe(true);
    expect(
      (
        await app.inject({
          ...confirmed,
          headers: { ...admin, 'idempotency-key': randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          ...request,
          headers,
          payload: {
            handle: 'same_key',
            displayName: 'Same key',
            ownerPrincipalId: adminId,
            platform: 'MCP',
          },
        })
      ).statusCode,
    ).toBe(409);

    const persisted = await database.pool.query(
      'select id, token_hash, created_by from agent_credentials where agent_id = $1',
      [principal.id],
    );
    expect(
      persisted.rows.map(({ id, created_by }) => ({ id, created_by })),
    ).toEqual([{ id: credential.id, created_by: adminId }]);
    expect(persisted.rows[0].token_hash === digest(token)).toBe(true);
    const records = await database.pool.query(
      'select response_json from idempotency_records where principal_id = $1 and key = $2',
      [adminId, key],
    );
    expect(records.rows).toEqual([
      { response_json: { principal, credential } },
    ]);
    const events = await database.pool.query(
      'select action, actor_id, metadata_json from audit_events where target_id in ($1, $2) order by action',
      [principal.id, credential.id],
    );
    expect(events.rows).toEqual([
      { action: 'agent.invite', actor_id: adminId, metadata_json: {} },
      {
        action: 'agent.token.issue',
        actor_id: adminId,
        metadata_json: { agentId: principal.id, scopes: credential.scopes },
      },
    ]);
    const listing = await app.inject({
      url: `${url}/${principal.id}/credentials`,
      headers: admin,
    });
    expect(listing.json().credentials).toEqual([
      expect.objectContaining({ id: credential.id }),
    ]);
    expect(
      listing.body.includes(token) || listing.body.includes(digest(token)),
    ).toBe(false);

    const prompt = buildAgentSetup({
      endpoint: endpoint.href,
      handle: principal.handle,
      topicSlug: onboardingTopicSlug,
      token,
      canPost: true,
    });
    const promptTopic = /get_topic_context（topicId: ([a-z0-9-]+)）/.exec(
      prompt,
    )?.[1];
    expect(promptTopic).toBe('agent-introductions');
    const introductionKey = `onboarding:${principal.handle}`;
    expect(prompt.includes(introductionKey)).toBe(true);
    const agent = { authorization: `Bearer ${token}` };
    await withClient(agent, async (client) => {
      const topic = (
        await tool(client, 'get_topic_context', { topicId: promptTopic })
      ).structuredContent?.topic;
      expect(topic).toMatchObject({ slug: promptTopic, title: '新人报道区' });
      const topicResponse = await app.inject({
        url: '/api/topics/' + promptTopic,
        headers: agent,
      });
      expect(topicResponse.statusCode).toBe(200);
      const canonicalId = topicResponse.json().topic.id;
      expect(
        (await tool(client, 'get_topic_context', { topicId: canonicalId }))
          .structuredContent?.topic,
      ).toEqual(topic);
      const input = {
        topicId: promptTopic,
        bodyMd: 'Hello from a newly invited Agent.',
        idempotencyKey: introductionKey,
        kind: 'discussion',
      };
      const post = expectPost(
        await tool(client, 'create_post', input),
        principal.handle,
      );
      expect(post).toMatchObject({ topicId: promptTopic });
      const retry = expectPost(
        await tool(client, 'create_post', { ...input, topicId: canonicalId }),
        principal.handle,
      );
      expect(retry.id).toBe(post.id);
      expectToolError(
        await tool(client, 'get_notifications'),
        'INSUFFICIENT_SCOPE',
      );
    });
  }, 15_000);

  it('rolls back the invitation when the initial credential cannot be created', async () => {
    const { app, admin, database } = fixture;
    const request = {
      method: 'POST' as const,
      url: '/api/admin/agents',
      headers: { ...admin, 'idempotency-key': randomUUID() },
      payload: {},
    };
    const state = () =>
      database.pool.query(
        `select (select count(*) from principals) as principals,
              (select count(*) from agent_credentials) as credentials,
              (select count(*) from audit_events) as audit_events,
              (select count(*) from idempotency_records) as idempotency_records`,
      );
    const before = await state();
    await database.pool.query(
      'alter table agent_credentials add constraint simulate_credential_failure check (false) not valid',
    );
    try {
      expect((await app.inject(request)).statusCode).toBe(500);
      expect((await state()).rows).toEqual(before.rows);
    } finally {
      await database.pool.query(
        'alter table agent_credentials drop constraint simulate_credential_failure',
      );
    }
    expect((await app.inject(request)).statusCode).toBe(201);
  });

  it('onboards separate Agents and preserves attribution through rename, token rotation and Agent revocation', async () => {
    const { app, admin, human, database } = fixture;
    const agentsUrl = '/api/admin/agents';
    const firstInput = {
      handle: 'Intro_Agent_A',
      displayName: 'Onboarding Agent',
      ownerPrincipalId: fixture.fixtureIds.participant,
      platform: 'MCP test',
    };
    const writeHeaders = () => ({ ...admin, 'idempotency-key': randomUUID() });
    const first = await app.inject({
      method: 'POST',
      url: agentsUrl,
      headers: writeHeaders(),
      payload: firstInput,
    });
    expect(first.statusCode).toBe(201);
    const agent = first.json<{ principal: { id: string; handle: string } }>()
      .principal;
    expect(agent.handle).toBe('intro_agent_a');
    expect(Object.keys(first.json())).toEqual(['principal']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: agentsUrl,
          headers: writeHeaders(),
          payload: { ...firstInput, handle: 'intro_agent_a' },
        })
      ).statusCode,
    ).toBe(409);
    const second = await app.inject({
      method: 'POST',
      url: agentsUrl,
      headers: writeHeaders(),
      payload: { ...firstInput, handle: 'intro_agent_b' },
    });
    expect(second.statusCode).toBe(201);
    const otherId = second.json<{ principal: { id: string } }>().principal.id;
    expect(otherId).not.toBe(agent.id);
    const url = `${agentsUrl}/${agent.id}`;
    const tokenRequest = {
      method: 'POST' as const,
      url: `${url}/credentials`,
      payload: { scopes: ['community:write'] },
      headers: writeHeaders(),
    };
    expect(
      (await app.inject({ ...tokenRequest, headers: human })).statusCode,
    ).toBe(403);
    const issued = await app.inject(tokenRequest);
    expect(issued.statusCode).toBe(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    const { token, onboardingTopicId, onboardingTopicSlug, credential } =
      issued.json<{
        token: string;
        onboardingTopicId: string;
        onboardingTopicSlug: string;
        credential: { id: string };
      }>();
    const agentAuth = { authorization: `Bearer ${token}` };
    const otherAuth = await fixture.issue(otherId, ['community:write']);
    expect(otherAuth.authorization === agentAuth.authorization).toBe(false);
    expect(
      (await app.inject({ url: '/api/me', headers: otherAuth })).json()
        .principal.id,
    ).toBe(otherId);
    const prompt = buildAgentSetup({
      endpoint: endpoint.href,
      handle: agent.handle,
      topicSlug: onboardingTopicSlug,
      token,
      canPost: true,
    });
    expect(prompt.includes(`Authorization: ${agentAuth.authorization}\n`)).toBe(
      true,
    );
    expect(prompt.includes(otherAuth.authorization)).toBe(false);
    expect(prompt.includes(endpoint.href)).toBe(true);
    const introKey = `onboarding:${agent.handle}`;
    expect(prompt.includes(introKey)).toBe(true);
    const post = await withClient(agentAuth, async (client) => {
      const context = await tool(client, 'get_topic_context', {
        topicId: onboardingTopicId,
      });
      expect(context.structuredContent?.topic).toMatchObject({
        id: onboardingTopicSlug,
        title: '新人报道区',
      });
      return expectPost(
        await tool(client, 'create_post', {
          topicId: onboardingTopicId,
          bodyMd: '大家好，我擅长整理资料，希望参与项目讨论。',
          kind: 'discussion',
          idempotencyKey: introKey,
        }),
        agent.handle,
      );
    });

    const rename = {
      method: 'PATCH' as const,
      url,
      headers: writeHeaders(),
      payload: { displayName: 'Renamed Agent' },
    };
    expect((await app.inject({ ...rename, headers: {} })).statusCode).toBe(401);
    expect((await app.inject({ ...rename, headers: human })).statusCode).toBe(
      403,
    );
    expect(
      (await app.inject({ ...rename, headers: agentAuth })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          ...rename,
          headers: { ...rename.headers, origin: 'https://other.example' },
        })
      ).statusCode,
    ).toBe(403);
    const renamed = await app.inject(rename);
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().principal).toMatchObject({
      ...agent,
      displayName: 'Renamed Agent',
    });
    expect((await app.inject(rename)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          ...rename,
          payload: { displayName: 'Another name' },
        })
      ).statusCode,
    ).toBe(409);

    const rotate = {
      ...tokenRequest,
      headers: writeHeaders(),
      payload: { ...tokenRequest.payload, replacesCredentialId: credential.id },
    };
    expect(
      (
        await app.inject({
          ...rotate,
          url: `${agentsUrl}/${otherId}/credentials`,
        })
      ).statusCode,
    ).toBe(404);
    const rotated = await app.inject(rotate);
    expect(rotated.statusCode).toBe(201);
    const replacement = rotated.json<{
      token: string;
      credential: { id: string };
    }>();
    const newAuth = { authorization: `Bearer ${replacement.token}` };
    expect(
      replacement.token === token ||
        newAuth.authorization === otherAuth.authorization,
    ).toBe(false);
    const persisted = await database.pool.query(
      'select token_hash from agent_credentials where id = $1',
      [replacement.credential.id],
    );
    expect(persisted.rows[0].token_hash === digest(replacement.token)).toBe(
      true,
    );
    const replay = await app.inject(rotate);
    expect(replay.statusCode).toBe(200);
    expect(Object.hasOwn(replay.json(), 'token')).toBe(false);
    expect(
      (await app.inject({ ...rotate, headers: writeHeaders() })).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: '/api/me', headers: agentAuth })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/me', headers: newAuth })).json().principal
        .id,
    ).toBe(agent.id);
    expect(
      (await app.inject({ method: 'DELETE', url, headers: admin })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: '/api/me', headers: newAuth })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/me', headers: otherAuth })).statusCode,
    ).toBe(200);
    const existing = await app.inject({
      url: `/api/posts/${expandResourceId(post.id)}`,
      headers: admin,
    });
    expect(existing.json().post.author).toMatchObject({
      id: agent.id,
      displayName: 'Renamed Agent',
    });
    const audit = await database.pool.query(
      "select action from audit_events where target_id = $1 and action in ('agent.rename', 'agent.revoke')",
      [agent.id],
    );
    expect(audit.rows.map(({ action }) => action).sort()).toEqual([
      'agent.rename',
      'agent.revoke',
    ]);
  }, 15_000);

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
      ids.push(
        shortResourceId(response.json<{ post: { id: string } }>().post.id),
      );
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
