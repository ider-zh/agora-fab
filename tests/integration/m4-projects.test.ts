import { shortResourceId } from '../../packages/mcp/src/references.js';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

const key = () => ({ 'idempotency-key': randomUUID() });
function checked<T>(
  response: { statusCode: number; body: string; json(): unknown },
  expected: number,
) {
  expect(response.statusCode, response.body).toBe(expected);
  return response.json() as T;
}

describe('project incubation through REST and MCP', () => {
  it('preserves the idea, arbitrates a concurrent claim and takes a reviewed artifact to done', async () => {
    const { app, human, admin, fixtureIds, issue } = fixture;
    const authorA = await issue(fixtureIds.agentA, ['projects:write']);
    const authorB = await issue(fixtureIds.agentB, ['projects:write']);
    const idea = checked<{
      post: { id: string; topicId: string; bodyMd: string };
    }>(
      await app.inject({
        method: 'POST',
        url: '/api/topics/daily-inspiration/posts',
        headers: { ...human, ...key() },
        payload: {
          bodyMd: 'Proposal: build a reproducible data catalogue.',
          kind: 'idea',
        },
      }),
      201,
    ).post;
    const promote = {
      method: 'POST' as const,
      url: `/api/admin/posts/${idea.id}/promote`,
      payload: {
        slug: 'catalogue-project',
        title: 'Catalogue Project',
        descriptionMd: 'Prepare a reviewed catalogue.',
        goalMd: 'Publish the catalogue schema.',
        repoUrl: 'https://github.com/example/catalogue',
      },
    };
    expect(
      (await app.inject({ ...promote, headers: { ...human, ...key() } }))
        .statusCode,
    ).toBe(403);
    const promoteHeaders = { ...admin, ...key() };
    expect(
      (
        await app.inject({
          ...promote,
          headers: promoteHeaders,
          payload: {
            ...promote.payload,
            repoUrl: 'https://github.com.example/catalogue',
          },
        })
      ).statusCode,
    ).toBe(422);
    const project = checked<{
      topic: {
        id: string;
        kind: string;
        originPostId: string;
        repoUrl: string;
      };
    }>(await app.inject({ ...promote, headers: promoteHeaders }), 201).topic;
    expect(project).toMatchObject({
      kind: 'project',
      originPostId: idea.id,
      repoUrl: promote.payload.repoUrl,
    });
    expect(project.id).not.toBe(idea.topicId);
    expect(
      (await app.inject({ ...promote, headers: promoteHeaders })).json().topic
        .id,
    ).toBe(project.id);
    expect(
      (
        await app.inject({ url: `/api/posts/${idea.id}`, headers: human })
      ).json().post,
    ).toEqual(expect.objectContaining(idea));

    const url = `/api/projects/${project.id}/tasks`;
    const proposed = checked<{
      task: { id: string; version: number; status: string };
    }>(
      await app.inject({
        method: 'POST',
        url,
        headers: { ...human, ...key() },
        payload: {
          title: 'Draft schema',
          descriptionMd: 'Include migration evidence.',
        },
      }),
      201,
    ).task;
    expect(proposed.status).toBe('proposed');
    const base = `/api/tasks/${proposed.id}`;
    for (const path of [url, base, '/api/tasks/not-an-id']) {
      const denied = await app.inject({ url: path });
      expect(denied.statusCode, path).toBe(401);
      expect(denied.json().error.code).toBe('UNAUTHORIZED');
      expect(denied.headers['cache-control']).toBe('no-store');
    }
    expect((await app.inject({ url, headers: authorA })).json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: proposed.id })]),
    );
    const decision = `/api/admin/tasks/${proposed.id}/review`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/claim`,
          headers: { ...authorA, ...key() },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: decision,
          headers: { ...human, ...key() },
          payload: { version: proposed.version, outcome: 'approve' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: decision,
          headers: { ...admin, ...key() },
          payload: { version: proposed.version, outcome: 'approve' },
        })
      ).json().task.status,
    ).toBe('open');

    async function connect(headers: Record<string, string>) {
      const client = new Client({
        name: 'AgoraFab project test',
        version: '1.0.0',
      });
      await client.connect(
        new StreamableHTTPClientTransport(endpoint, {
          requestInit: { headers },
        }),
      );
      return client;
    }
    const [agentA, agentB] = await Promise.all([
      connect(authorA),
      connect(authorB),
    ]);
    try {
      const discovery = await agentA.listTools();
      expect(discovery.tools).toHaveLength(11);
      expect(discovery.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['list_tasks', 'claim_task', 'submit_artifact']),
      );
      const listing = await agentA.callTool({
        name: 'list_tasks',
        arguments: { topicId: project.id },
      });
      expect(listing.structuredContent).toMatchObject({
        items: [
          expect.objectContaining({
            id: shortResourceId(proposed.id),
            status: 'open',
          }),
        ],
      });
      const context = await agentA.callTool({
        name: 'get_topic_context',
        arguments: { topicId: project.id },
      });
      expect(context.structuredContent).toMatchObject({
        openTasks: [
          expect.objectContaining({ id: shortResourceId(proposed.id) }),
        ],
      });

      const claim = (client: Client) =>
        client.callTool({
          name: 'claim_task',
          arguments: {
            taskId: shortResourceId(proposed.id),
            idempotencyKey: randomUUID(),
          },
        });
      const [a, b] = await Promise.all([claim(agentA), claim(agentB)]);
      expect([a, b].filter((value) => !value.isError)).toHaveLength(1);
      const [winner, winnerHeaders, winnerId] = a.isError
        ? [agentB, authorB, fixtureIds.agentB]
        : [agentA, authorA, fixtureIds.agentA];
      const loser = a.isError ? a : b;
      expect(loser.structuredContent).toMatchObject({
        error: { code: 'TASK_STATE_CONFLICT' },
      });
      const state = (await app.inject({ url: base, headers: human })).json()
        .task;
      expect(state).toMatchObject({ status: 'claimed', assigneeId: winnerId });

      const artifact = {
        url: 'https://github.com/example/catalogue/pull/42',
        kind: 'pr',
        descriptionMd: 'Migration plus tests.',
      };
      const submissionKey = randomUUID();
      const unsafe = await app.inject({
        method: 'POST',
        url: `${base}/artifacts`,
        headers: { ...winnerHeaders, ...key() },
        payload: {
          ...artifact,
          url: 'https://github.com/example/catalogue/pull/42?token=secret-placeholder',
        },
      });
      expect(unsafe.statusCode).toBeGreaterThanOrEqual(400);
      const submitted = await winner.callTool({
        name: 'submit_artifact',
        arguments: {
          taskId: proposed.id,
          idempotencyKey: submissionKey,
          ...artifact,
        },
      });
      expect(submitted.isError).not.toBe(true);
      expect(submitted.structuredContent).toMatchObject({
        task: { status: 'submitted', assigneeId: shortResourceId(winnerId) },
        artifact: { submittedBy: shortResourceId(winnerId), url: artifact.url },
      });
      const replay = await app.inject({
        method: 'POST',
        url: `${base}/artifacts`,
        headers: { ...winnerHeaders, 'idempotency-key': submissionKey },
        payload: artifact,
      });
      expect(replay.statusCode).toBe(200);
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      const current = (await app.inject({ url: base, headers: human })).json();
      expect(current.artifacts).toHaveLength(1);
      const review = {
        method: 'POST' as const,
        url: `${base}/review`,
        payload: {
          version: current.task.version,
          note: 'Independent reviewer confirmed migration evidence.',
        },
      };
      expect(
        (
          await app.inject({
            ...review,
            headers: { ...winnerHeaders, ...key() },
          })
        ).statusCode,
      ).toBe(403);
      const reviewed = await app.inject({
        ...review,
        headers: { ...human, ...key() },
      });
      expect(reviewed.statusCode, reviewed.body).toBe(200);
      expect(reviewed.json().task.status).toBe('in_review');
      const decide = {
        method: 'POST' as const,
        url: decision,
        headers: { ...admin, ...key() },
        payload: {
          version: reviewed.json().task.version,
          outcome: 'done',
          note: 'Accepted after review.',
        },
      };
      expect(
        (
          await app.inject({
            ...decide,
            payload: { ...decide.payload, version: current.task.version },
          })
        ).statusCode,
      ).toBe(409);
      expect((await app.inject(decide)).json().task).toMatchObject({
        status: 'done',
        decisionNote: 'Accepted after review.',
      });
      expect(
        (await app.inject({ url: base, headers: human })).json().artifacts,
      ).toHaveLength(1);
    } finally {
      await Promise.all([agentA.close(), agentB.close()]);
    }
  });
});
