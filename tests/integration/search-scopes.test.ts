import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { shortResourceId } from '../../packages/mcp/src/references.js';
import { communityFixture } from './community-fixture.js';

let fixture: Awaited<ReturnType<typeof communityFixture>>;
beforeAll(async () => {
  fixture = await communityFixture();
}, 30_000);
afterAll(async () => {
  await fixture?.close();
});

it('keeps scoped search on visible posts and binds cursors to the query and scope', async () => {
  const { app, human, admin } = fixture;
  const needle = 'scopedneedle';
  const feed = '/api/topics/daily-inspiration/posts';

  async function publish(url: string, bodyMd: string) {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { ...human, 'idempotency-key': randomUUID() },
      payload: { bodyMd },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ post: { id: string } }>().post.id;
  }

  const root = await publish(feed, `${needle} root`);
  const reply = await publish(`/api/posts/${root}/replies`, `${needle} reply`);
  const hidden = await publish(
    `/api/posts/${root}/replies`,
    `${needle} hidden`,
  );
  await publish(`/api/posts/${hidden}/replies`, `${needle} hidden descendant`);
  const elsewhere = await publish(feed, `${needle} other thread`);
  const projectPost = await publish(
    '/api/topics/fixture-project/posts',
    needle,
  );
  const hide = await app.inject({
    method: 'POST',
    url: `/api/admin/posts/${hidden}/hide`,
    headers: { ...admin, 'idempotency-key': randomUUID() },
    payload: { reason: 'Search scope visibility fixture' },
  });
  expect(hide.statusCode).toBe(204);

  const url = `/api/search?q=${needle}`;
  expect((await app.inject({ url: `${url}&thread=${root}` })).statusCode).toBe(
    401,
  );
  async function matches(path: string) {
    const response = await app.inject({ url: path, headers: human });
    expect(response.statusCode).toBe(200);
    const { items, nextCursor } = response.json<{
      items: { id: string }[];
      nextCursor: string | null;
    }>();
    return { ids: items.map(({ id }) => id), nextCursor };
  }

  expect((await matches(url)).ids).toEqual([
    projectPost,
    elsewhere,
    reply,
    root,
  ]);
  const topic = `${url}&topic=daily-inspiration`;
  expect((await matches(topic)).ids).toEqual([elsewhere, reply, root]);
  expect((await matches(`${url}&thread=${hidden}`)).ids).toEqual([]);

  const { ids, nextCursor } = await matches(
    `${url}&thread=${shortResourceId(root)}&limit=1`,
  );
  expect(ids).toEqual([reply]);
  expect(nextCursor).toEqual(expect.any(String));
  expect(
    (await matches(`${url}&thread=${root}&cursor=${nextCursor}`)).ids,
  ).toEqual([root]);

  for (const suffix of [
    `&topic=daily-inspiration&thread=${root}`,
    `&thread=${root}&thread=${root}`,
    '&scope=unsafe',
    '&thread=not-a-post-reference',
  ]) {
    const response = await app.inject({ url: url + suffix, headers: human });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  }
  const crossScope = await app.inject({
    url: `${topic}&cursor=${nextCursor}`,
    headers: human,
  });
  expect(crossScope.statusCode).toBe(400);
  expect(crossScope.json().error.code).toBe('INVALID_CURSOR');
});
