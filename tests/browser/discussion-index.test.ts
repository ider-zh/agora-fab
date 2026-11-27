import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture, screenshot, signIn } from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
});

it('indexes paginated posts and replies and preserves the location after posting on a later page', async () => {
  const { browser, origin } = fixture;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await signIn(page, origin, 'participant');
    async function post(path: string, bodyMd: string) {
      const response = await page.request.post(
        origin + '/api/community' + path,
        {
          headers: { origin, 'idempotency-key': randomUUID() },
          data: { bodyMd },
        },
      );
      expect(response.status()).toBe(201);
      return (await response.json()).post.id as string;
    }
    const topic = '/topics/daily-inspiration';
    const root = await post(topic + '/posts', 'Index first root');
    let pinned = '';
    for (let i = 1; i <= 21; i++) {
      const id = await post(topic + '/posts', 'Index root ' + i);
      if (i === 10) pinned = id;
      await post('/posts/' + root + '/replies', 'Index reply ' + i);
    }
    const admin = await browser.newPage();
    try {
      await signIn(admin, origin, 'admin');
      const response = await admin.request.post(
        origin + '/api/community/admin/posts/' + pinned + '/pin',
        { headers: { origin, 'idempotency-key': randomUUID() }, data: {} },
      );
      expect(response.status()).toBe(204);
    } finally {
      await admin.close();
    }
    await page.goto(origin + topic);
    const postIndex = page.getByRole('complementary', { name: '帖子索引' });
    const postDisclosure = postIndex.getByText('帖子索引', { exact: true });
    expect(await postIndex.getByRole('navigation').isVisible()).toBe(false);
    await postDisclosure.focus();
    await page.keyboard.press('Enter');
    const links = postIndex.getByRole('link', {
      name: 'Index root 10',
      exact: true,
    });
    expect(await links.count()).toBe(2);
    expect(await links.first().getAttribute('href')).not.toBe(
      await links.last().getAttribute('href'),
    );
    const jump = links.last();
    await jump.focus();
    await page.keyboard.press('Enter');
    await page
      .locator('article:target')
      .getByText('Index root 10', { exact: true })
      .waitFor();
    const scrollPane = postIndex.getByRole('navigation');
    expect(
      await scrollPane.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await screenshot(page, 'frontend-mobile-topic-index');
    await postIndex.getByRole('link', { name: '索引下一页' }).click();
    await postIndex
      .getByRole('link', { name: 'Index first root', exact: true })
      .waitFor();
    expect(new URL(page.url()).searchParams.has('cursor')).toBe(true);

    await page.goto(origin + '/posts/' + root);
    const replyIndex = page.getByRole('complementary', { name: '讨论索引' });
    await replyIndex.getByText('讨论索引', { exact: true }).click();
    await replyIndex.getByRole('link', { name: '索引下一页' }).click();
    await page.waitForURL((url) => url.searchParams.has('cursor'));
    const cursor = new URL(page.url()).searchParams.get('cursor');
    expect(cursor).toBeTruthy();
    await replyIndex
      .getByRole('link', { name: 'Index reply 21', exact: true })
      .click();
    await page
      .locator('article:target')
      .getByText('Index reply 21', { exact: true })
      .waitFor();
    await page
      .getByLabel('回复内容')
      .first()
      .fill('New reply after the first page');
    await page
      .getByRole('button', { name: '发布回复', exact: true })
      .first()
      .click();
    const success = page.getByRole('link', { name: '查看刚发布的回复' });
    await success.waitFor();
    expect(new URL(page.url()).searchParams.get('cursor')).toBe(cursor);
    const replyUrl = await success.getAttribute('href');
    expect(replyUrl).toMatch(/^\/posts\//);
    await page.route('**/api/community/posts/*/replies', (route) =>
      route.fulfill({
        status: 400,
        json: { error: { code: 'VALIDATION_ERROR' } },
      }),
    );
    await page.getByLabel('回复内容').first().fill('A second submission');
    await page
      .getByRole('button', { name: '发布回复', exact: true })
      .first()
      .click();
    await page.getByText('请检查输入内容与长度。').waitFor();
    expect(await success.count()).toBe(0);
    await page.goto(origin + replyUrl);
    await page
      .getByRole('article')
      .getByText('New reply after the first page', { exact: true })
      .waitFor();
    await page.getByRole('link', { name: '查看上层帖子' }).waitFor();
  } finally {
    await page.close();
  }
}, 45_000);
