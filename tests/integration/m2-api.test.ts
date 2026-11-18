import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digest } from '../../apps/api/src/auth/http.js';
import { communityFixture } from './community-fixture.js';

let fixture: Awaited<ReturnType<typeof communityFixture>>;
beforeAll(async () => {
  fixture = await communityFixture();
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

const feed = '/api/topics/daily-inspiration/posts';
const inbox = '/api/me/notifications';
const key = () => ({ 'idempotency-key': randomUUID() });
const discussionScopes = [
  'community:write',
  'notifications:read',
  'notifications:write',
];

describe('community API with real PostgreSQL', () => {
  it('attributes humans and two independent agent credentials, deduplicates retries and persists mention receipts', async () => {
    const { app, human, issue, fixtureIds, database } = fixture;
    const agentA = await issue(fixtureIds.agentA, discussionScopes);
    const agentB = await issue(fixtureIds.agentB, discussionScopes);
    const onlyInbox = await issue(fixtureIds.agentA, ['notifications:read']);
    const submit = {
      method: 'POST' as const,
      url: feed,
      payload: {
        kind: 'idea',
        bodyMd:
          '持久讨论 @fixture_agent_a @FIXTURE_AGENT_A in prose. `@fixture_agent_b` is an example.',
        mentions: ['fixture_agent_a'],
      },
    };
    expect((await app.inject(submit)).statusCode).toBe(401);
    expect(
      (await app.inject({ ...submit, headers: onlyInbox })).json().error.code,
    ).toBe('INSUFFICIENT_SCOPE');
    const headers = { ...human, ...key(), 'x-author-id': fixtureIds.agentA };
    expect(
      (
        await app.inject({
          ...submit,
          headers,
          payload: { ...submit.payload, authorId: fixtureIds.agentA },
        })
      ).statusCode,
    ).toBe(400);
    const results = await Promise.all([
      app.inject({ ...submit, headers }),
      app.inject({ ...submit, headers }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 201,
    ]);
    const post = results[0]?.json().post;
    expect(post.author).toMatchObject({ kind: 'human', handle: 'gh_7002' });
    expect(results[1]?.json().post.id).toBe(post.id);
    expect(
      (
        await app.inject({
          ...submit,
          headers,
          payload: { bodyMd: 'Different post' },
        })
      ).json().error.code,
    ).toBe('IDEMPOTENCY_CONFLICT');

    const firstInbox = await app.inject({
      url: `${inbox}?unread=1`,
      headers: agentA,
    });
    const note = firstInbox.json().items[0];
    expect(firstInbox.json().items).toEqual([
      expect.objectContaining({ postId: post.id, readAt: null }),
    ]);
    expect(
      (await app.inject({ url: inbox, headers: agentB })).json().items,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${inbox}/${note.id}`,
          headers: agentB,
          payload: { read: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${inbox}/${note.id}`,
          headers: onlyInbox,
          payload: { read: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${inbox}/${note.id}`,
          headers: agentA,
          payload: { read: true },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: `${inbox}?unread=1`, headers: agentA })).json()
        .items,
    ).toEqual([]);
    expect(
      (await app.inject({ url: inbox, headers: agentA })).json().items[0]
        .readAt,
    ).toEqual(expect.any(String));

    const replyA = await app.inject({
      method: 'POST',
      url: `/api/posts/${post.id}/replies`,
      headers: { ...agentA, ...key() },
      payload: { bodyMd: 'First agent reply @fixture_agent_b' },
    });
    expect(replyA.statusCode, replyA.body).toBe(201);
    const child = replyA.json().post;
    expect(child.author.id).toBe(fixtureIds.agentA);
    const replyB = await app.inject({
      method: 'POST',
      url: `/api/posts/${child.id}/replies`,
      headers: { ...agentB, ...key() },
      payload: { bodyMd: 'Second agent nested reply' },
    });
    expect(replyB.statusCode, replyB.body).toBe(201);
    expect(replyB.json().post.author.id).toBe(fixtureIds.agentB);
    expect(
      (await app.inject({ url: `/api/posts/${post.id}` }))
        .json()
        .replies.map((item: { id: string }) => item.id),
    ).toEqual([child.id, replyB.json().post.id]);
    expect(
      (await app.inject({ url: `${inbox}?unread=1`, headers: agentB })).json()
        .items,
    ).toEqual([expect.objectContaining({ postId: child.id })]);

    await database.pool.query(
      "update agent_credentials set expires_at=now() - interval '1 second' where token_hash=$1",
      [digest(agentA.authorization.slice('Bearer '.length))],
    );
    expect(
      (await app.inject({ ...submit, headers: { ...agentA, ...key() } }))
        .statusCode,
    ).toBe(401);
  });

  it('audits moderation, hides descendant and search results, and archives Topics', async () => {
    const { app, admin, human, issue, fixtureIds } = fixture;
    const recipient = await issue(fixtureIds.agentA, ['notifications:read']);
    const create = {
      method: 'POST' as const,
      url: '/api/admin/topics',
      payload: {
        kind: 'community',
        slug: 'manage-me',
        title: 'Manage me',
        guidelinesMd: 'Be civil.',
      },
    };
    expect(
      (await app.inject({ ...create, headers: { ...human, ...key() } }))
        .statusCode,
    ).toBe(403);
    const made = await app.inject({
      ...create,
      headers: { ...admin, ...key() },
    });
    expect(made.statusCode, made.body).toBe(201);
    const topic = made.json().topic;
    const post = (
      await app.inject({
        method: 'POST',
        url: `/api/topics/${topic.id}/posts`,
        headers: { ...human, ...key() },
        payload: { bodyMd: '隐藏目标 unique phrase @fixture_agent_a' },
      })
    ).json().post;
    const child = (
      await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/replies`,
        headers: { ...human, ...key() },
        payload: { bodyMd: 'Descendant unique phrase' },
      })
    ).json().post;
    const modify = (action: string, headers = admin) =>
      app.inject({
        method: 'POST',
        url: `/api/admin/posts/${post.id}/${action}`,
        headers,
        payload: { reason: 'Test moderation' },
      });
    expect((await modify('pin')).statusCode).toBe(204);
    expect(
      (await app.inject({ url: `/api/topics/${topic.slug}` })).json()
        .pinnedPosts[0].id,
    ).toBe(post.id);
    expect((await modify('hide', human)).statusCode).toBe(403);
    expect((await modify('hide')).statusCode).toBe(204);
    expect(
      (await app.inject({ url: inbox, headers: recipient }))
        .json()
        .items.some((note: { postId: string }) => note.postId === post.id),
    ).toBe(false);
    expect(
      (await app.inject({ url: `/api/posts/${post.id}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/posts/${child.id}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: '/api/search?q=unique' })).json().items,
    ).toEqual([]);
    expect(
      (await app.inject({ url: `/api/admin/posts/${post.id}`, headers: human }))
        .statusCode,
    ).toBe(403);
    const moderation = await app.inject({
      url: `/api/admin/posts/${post.id}`,
      headers: admin,
    });
    expect(moderation.json()).toMatchObject({
      post: { hiddenAt: expect.any(String) },
      events: expect.arrayContaining([
        expect.objectContaining({
          action: 'post.hide',
          metadataJson: { reason: 'Test moderation' },
        }),
      ]),
    });
    expect((await modify('restore')).statusCode).toBe(204);
    expect(
      (await app.inject({ url: `/api/posts/${child.id}` })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/topics/${topic.id}`,
          headers: admin,
          payload: { status: 'archived' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/api/topics/${topic.slug}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/posts/${child.id}` })).statusCode,
    ).toBe(404);
  });
});
