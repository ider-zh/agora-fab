import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { shortResourceId } from '../../packages/mcp/src/references.js';
import { checkPage, tabTo } from './accessibility.js';
import { browserFixture, signIn } from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
}, 15_000);

it('lets a participant reach and narrow discussion search on a phone', async () => {
  const { browser, origin } = fixture;
  const context = await browser.newContext({
    viewport: { width: 320, height: 760 },
  });
  const page = await context.newPage();
  const searchLink = page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '搜索', exact: true });
  const needle = 'browserneedle';
  const rootText = `${needle} Discussion root`;
  const otherText = `${needle} Separate topic`;

  async function post(path: string, bodyMd: string) {
    const response = await page.request.post(`${origin}/api/community${path}`, {
      headers: { origin, 'idempotency-key': randomUUID() },
      data: { bodyMd },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { post: { id: string } }).post.id;
  }

  try {
    await page.goto(origin);
    expect(await searchLink.count()).toBe(0);
    await signIn(page, origin, 'participant');
    const root = await post('/topics/daily-inspiration/posts', rootText);
    await post('/topics/fixture-project/posts', otherText);

    await page.goto(`${origin}/topics/daily-inspiration`);
    await tabTo(page, searchLink);
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/search`);
    expect(await searchLink.getAttribute('aria-current')).toBe('page');
    const globalSearch = page.getByRole('searchbox', { name: '全站搜索帖子' });
    for (const control of [
      searchLink,
      globalSearch,
      page.getByRole('button', { name: '搜索', exact: true }),
    ]) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await tabTo(page, globalSearch);
    await page.keyboard.type(needle);
    await page.keyboard.press('Enter');
    await page.getByText(rootText, { exact: true }).waitFor();
    await page.getByText(otherText, { exact: true }).waitFor();
    await checkPage(page, 'Global search at 320 CSS pixels');

    await page.goto(`${origin}/topics/daily-inspiration`);
    const topicSearch = page.getByRole('searchbox', {
      name: '搜索此 Topic 的帖子',
    });
    await topicSearch.fill(needle);
    await topicSearch.press('Enter');
    await page.waitForURL(
      (url) => url.searchParams.get('topic') === 'daily-inspiration',
    );
    await page.getByText(rootText, { exact: true }).waitFor();
    expect(await page.getByText(otherText, { exact: true }).count()).toBe(0);
    await page.getByRole('link', { name: '改为全站搜索' }).click();
    await page.getByText(otherText, { exact: true }).waitFor();

    await page.goto(`${origin}/posts/${shortResourceId(root)}`);
    const threadSearch = page.getByRole('searchbox', { name: '搜索此讨论串' });
    await threadSearch.fill(needle);
    await threadSearch.press('Enter');
    await page.waitForURL(
      (url) => url.searchParams.get('thread') === shortResourceId(root),
    );
    await page.getByText(rootText, { exact: true }).waitFor();
    expect(await page.getByText(otherText, { exact: true }).count()).toBe(0);
    const url = new URL(page.url());
    expect(url.searchParams.get('thread')).toBe(shortResourceId(root));
    expect(url.searchParams.get('q')).toBe(needle);
    await checkPage(page, 'Thread search at 320 CSS pixels');
  } finally {
    await context.close();
  }
}, 45_000);
