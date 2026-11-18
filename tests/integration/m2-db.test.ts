import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  mentions,
  notifications,
  posts,
  type Database,
} from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { fixtureIds, seedFixtures } from '../../packages/db/src/seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests.',
  );
}

const schema = `agorafab_m2_${randomUUID().replaceAll('-', '')}`;
let control: Database | undefined;
let database: Database;

describe('M2 community persistence', () => {
  beforeAll(async () => {
    control = createDatabase(testDatabaseUrl);
    await control.pool.query(`create schema "${schema}"`);
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase(isolatedUrl.toString());
    await migrateDatabase(database, { migrationsSchema: schema });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
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

  it('accepts nested replies and rejects cross-topic or invalid ancestry', async () => {
    const originalId = randomUUID();
    const replyId = randomUUID();
    await database.db.insert(posts).values({
      id: originalId,
      topicId: fixtureIds.community,
      authorId: fixtureIds.participant,
      kind: 'idea',
      bodyMd: '# An idea',
    });
    await database.db.insert(posts).values({
      id: replyId,
      parentPostId: originalId,
      ancestorIds: [originalId],
      topicId: fixtureIds.community,
      authorId: fixtureIds.agentA,
      bodyMd: 'First reply',
    });

    const reply = {
      topicId: fixtureIds.community,
      authorId: fixtureIds.agentB,
      parentPostId: replyId,
      ancestorIds: [originalId, replyId],
      bodyMd: 'Nested reply',
    };
    const [nested] = await database.db.insert(posts).values(reply).returning();
    expect(nested).toMatchObject({
      ...reply,
      kind: 'discussion',
      hiddenAt: null,
      pinnedAt: null,
    });

    const insert = `insert into posts (topic_id, author_id, parent_post_id, ancestor_ids, body_md)
                    values ($1, $2, $3, $4, $5)`;
    const params = [
      reply.topicId,
      reply.authorId,
      reply.parentPostId,
      reply.ancestorIds,
      reply.bodyMd,
    ];
    await expect(
      database.pool.query(insert, [fixtureIds.project, ...params.slice(1)]),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'posts_parent_topic_fk',
    });
    for (const ancestry of [
      [],
      [originalId],
      [null, replyId],
      [...Array.from({ length: 8 }, () => randomUUID()), replyId],
    ]) {
      await expect(
        database.pool.query(insert, [
          reply.topicId,
          reply.authorId,
          reply.parentPostId,
          ancestry,
          reply.bodyMd,
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'posts_ancestors_check',
      });
    }
    await expect(
      database.pool.query(insert, [
        reply.topicId,
        reply.authorId,
        null,
        [replyId],
        reply.bodyMd,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'posts_ancestors_check',
    });
    await expect(
      database.pool.query(insert, [...params.slice(0, 4), '\n\t   ']),
    ).rejects.toMatchObject({ code: '23514', constraint: 'posts_body_check' });
  });

  it('allows only one mention and one notification for a recipient per post', async () => {
    const postId = randomUUID();
    const recipientId = fixtureIds.agentB;
    await database.db.insert(posts).values({
      id: postId,
      topicId: fixtureIds.community,
      authorId: fixtureIds.agentA,
      bodyMd: 'Question for @fixture_agent_b',
    });
    await database.db
      .insert(mentions)
      .values({ postId, targetPrincipalId: recipientId });
    const [notification] = await database.db
      .insert(notifications)
      .values({ postId, recipientId })
      .returning();
    expect(notification).toMatchObject({
      postId,
      recipientId,
      kind: 'mention',
      readAt: null,
    });

    await expect(
      database.pool.query(
        'insert into mentions (post_id, target_principal_id) values ($1, $2)',
        [postId, recipientId],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'mentions_post_id_target_principal_id_pk',
    });
    await expect(
      database.pool.query(
        'insert into notifications (post_id, recipient_id) values ($1, $2)',
        [postId, recipientId],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'notifications_post_recipient_unique',
    });
  });

  it('round-trips chronological cursor fields without losing timestamp precision', async () => {
    const firstId = '00000000-0000-4000-8000-000000000011';
    const secondId = '00000000-0000-4000-8000-000000000012';
    const topicId = fixtureIds.project;
    await database.pool.query(
      `insert into posts (id, topic_id, author_id, body_md, created_at)
       values ($1, $3, $4, 'First', '2026-11-18T08:00:00.123100Z'),
              ($2, $3, $4, 'Second', '2026-11-18T08:00:00.123400Z')`,
      [firstId, secondId, topicId, fixtureIds.participant],
    );
    const latest = await database.pool.query<{ position: string; id: string }>(
      'select id, created_at::text as position from posts where topic_id = $1 order by created_at desc, id desc limit 1',
      [topicId],
    );
    const cursor = latest.rows[0];
    expect(cursor?.id).toBe(secondId);
    const remaining = await database.pool.query(
      `select id from posts where topic_id = $1 and (created_at, id) < ($2, $3)
       order by created_at desc, id desc`,
      [topicId, cursor?.position, cursor?.id],
    );
    expect(remaining.rows).toEqual([{ id: firstId }]);
  });
});
