import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCommunityReader } from '../../apps/api/src/community/read.js';
import { createDatabase, type Database } from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required.');

const schema = `agorafab_community_reads_${randomUUID().replaceAll('-', '')}`;
const authorId = randomUUID();
const topicId = randomUUID();
const archivedTopicId = randomUUID();
const root = randomUUID();
const older = '00000000-0000-0000-0000-000000000001';
const sameTime = '00000000-0000-0000-0000-000000000002';
const hidden = randomUUID();
const hiddenChild = randomUUID();
const visibleChild = randomUUID();
const visibleGrandchild = randomUUID();
const newest = randomUUID();
const archive = randomUUID();

let control: Database | undefined;
let database: Database;
let reader: ReturnType<typeof createCommunityReader>;

async function addPost(
  id: string,
  createdAt: string,
  attributes: {
    body?: string;
    topic?: string;
    parents?: string[];
    pinned?: boolean;
    hidden?: boolean;
  } = {},
) {
  const {
    body = 'Observable project idea',
    topic = topicId,
    parents = [],
    pinned = false,
    hidden = false,
  } = attributes;
  await database.pool.query(
    `insert into posts (id, topic_id, author_id, parent_post_id, ancestor_ids, body_md, created_at, pinned_at, hidden_at)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8 then $7::timestamptz end, case when $9 then $7::timestamptz end)`,
    [
      id,
      topic,
      authorId,
      parents.at(-1) ?? null,
      parents,
      body,
      createdAt,
      pinned,
      hidden,
    ],
  );
}

describe('M2 community reader on PostgreSQL', () => {
  beforeAll(async () => {
    control = createDatabase(testDatabaseUrl);
    await control.pool.query(`create schema "${schema}"`);
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase(isolatedUrl.toString());
    await migrateDatabase(database, { migrationsSchema: schema });
    await database.pool.query(
      `insert into principals (id, kind, handle, display_name, role)
      values ($1, 'human', 'reader_fixture', 'Test Author', 'admin')`,
      [authorId],
    );
    await database.pool.query(
      `insert into topics (id, slug, title, kind, status, created_by)
      values ($1, 'readers-corner', 'Readers Corner', 'community', 'active', $3),
             ($2, 'closed-corner', 'Closed Corner', 'community', 'archived', $3)`,
      [topicId, archivedTopicId, authorId],
    );
    await addPost(root, '2026-01-01T00:00:00.123900Z', {
      body: 'Observable project idea, 一个值得讨论的项目',
      pinned: true,
    });
    await addPost(sameTime, '2026-01-01T00:00:00.123800Z');
    await addPost(older, '2026-01-01T00:00:00.123800Z');
    await addPost(hidden, '2026-01-01T00:00:00.123901Z', {
      body: 'Confidential project branch',
      parents: [root],
      hidden: true,
      pinned: true,
    });
    await addPost(hiddenChild, '2026-01-01T00:00:00.123902Z', {
      body: 'Confidential project comment',
      parents: [root, hidden],
      pinned: true,
    });
    await addPost(visibleChild, '2026-01-01T00:00:00.123903Z', {
      body: 'Observable project comment',
      parents: [root],
    });
    await addPost(visibleGrandchild, '2026-01-01T00:00:00.123904Z', {
      body: 'Follow-up comment',
      parents: [root, visibleChild],
    });
    await addPost(archive, '2026-01-01T00:00:00.124000Z', {
      body: 'Confidential project in archived Topic',
      topic: archivedTopicId,
      pinned: true,
    });
    await database.pool.query(
      `insert into audit_events (actor_id, action, target_type, target_id, metadata_json)
      values ($1, 'post.hide', 'post', $2, '{"reason":"Test moderation"}')`,
      [authorId, hidden],
    );
    reader = createCommunityReader(database);
  }, 30_000);

  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      if (control) {
        try {
          await control.pool.query(`drop schema if exists "${schema}" cascade`);
        } finally {
          await control.close();
        }
      }
    }
  });

  it('lists active Topics and looks them up by stable ID or slug', async () => {
    const { items } = await reader.listTopics();
    expect(items.map((topic) => topic.slug).sort()).toEqual([
      'agent-introductions',
      'readers-corner',
    ]);
    expect(await reader.getTopic('readers-corner')).toEqual(
      await reader.getTopic(topicId),
    );
    await expect(reader.getTopic(archivedTopicId)).rejects.toMatchObject({
      statusCode: 404,
    });
    const all = await reader.listTopics({}, true);
    expect(all.items.map((topic) => topic.id)).toEqual(
      expect.arrayContaining([topicId, archivedTopicId]),
    );
  });

  it('keeps exact timestamps and UUID ties in feed cursors across concurrent insertion', async () => {
    const first = await reader.listPosts(topicId, { limit: '1' });
    expect(first.items.map((post) => post.id)).toEqual([root]);
    expect(first.items[0]?.createdAt).toBe('2026-01-01T00:00:00.123900Z');
    if (!first.nextCursor) throw new Error('Expected a continuation cursor.');
    await addPost(newest, '2026-01-01T00:00:00.124100Z', {
      body: 'Inserted after first page',
    });

    const second = await reader.listPosts('readers-corner', {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((post) => post.id)).toEqual([sameTime]);
    if (!second.nextCursor) throw new Error('Expected a continuation cursor.');
    const third = await reader.listPosts(topicId, {
      limit: 1,
      cursor: second.nextCursor,
    });
    expect(third.items.map((post) => post.id)).toEqual([older]);
    expect(third.nextCursor).toBeNull();
    expect((await reader.listPosts(topicId, { limit: 1 })).items[0]?.id).toBe(
      newest,
    );
    await expect(
      reader.listTopics({ cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      reader.listPosts(topicId, { cursor: 'not-valid' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('hides moderated descendants and archived Topic content from every public read', async () => {
    const thread = await reader.getPost(root, { limit: 1 });
    expect(thread.post.author).toEqual({
      id: authorId,
      handle: 'reader_fixture',
      displayName: 'Test Author',
      kind: 'human',
    });
    expect(thread.replies.map((post) => post.id)).toEqual([visibleChild]);
    if (!thread.nextCursor) throw new Error('Expected a reply cursor.');
    const next = await reader.getPost(root, { cursor: thread.nextCursor });
    expect(next.replies.map((post) => post.id)).toEqual([visibleGrandchild]);
    expect(next.replies[0]?.parentPostId).toBe(visibleChild);
    expect(next.nextCursor).toBeNull();
    await expect(
      reader.getPost(visibleChild, { cursor: thread.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    for (const id of [hidden, hiddenChild, archive]) {
      await expect(reader.getPost(id)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
    expect((await reader.listPinned(topicId)).map((post) => post.id)).toEqual([
      root,
    ]);
    expect(await reader.listPinned(archivedTopicId)).toEqual([]);
    expect((await reader.search({ q: 'Confidential' })).items).toEqual([]);
    expect(
      (await reader.search({ q: '值得讨论' })).items.map((post) => post.id),
    ).toEqual([root]);
    const search = await reader.search({ q: 'project', limit: 1 });
    expect(search.items.map((post) => post.id)).toEqual([visibleChild]);
    if (!search.nextCursor) throw new Error('Expected a continuation cursor.');
    await expect(
      reader.search({ q: 'observable', cursor: search.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('shows hidden posts and their audit only to administrators', async () => {
    const principal = {
      id: authorId,
      kind: 'human' as const,
      handle: 'reader_fixture',
      displayName: 'Test Author',
      status: 'active' as const,
      ownerPrincipalId: null,
      platform: null,
      capabilities: [],
    };
    await expect(reader.getModeratedPost(hidden, null)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      reader.getModeratedPost(hidden, {
        method: 'session',
        principal: { ...principal, role: 'participant' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const moderated = await reader.getModeratedPost(hidden, {
      method: 'session',
      principal: { ...principal, role: 'admin' },
    });
    expect(moderated.post.bodyMd).toBe('Confidential project branch');
    expect(moderated.post.hiddenAt).toBe('2026-01-01T00:00:00.123901Z');
    expect(moderated.events).toMatchObject([
      { action: 'post.hide', metadataJson: { reason: 'Test moderation' } },
    ]);
  });
});
