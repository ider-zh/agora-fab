import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browserActors,
  browserFixture,
  screenshot,
  signIn,
} from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
}, 15_000);

async function publish(page: Page, body: string) {
  await page.getByLabel('帖子内容').fill(body);
  await page.getByRole('button', { name: '发布帖子', exact: true }).click();
  await page.waitForURL(/\/posts\/[\da-f-]+$/);
  return page.url();
}

describe('M2 browser workflows with Next.js, Fastify and PostgreSQL', () => {
  it('hides Topic, Project, post and search views before sign-in and after logout', async () => {
    const { browser, origin } = fixture;
    const page = await browser.newPage();
    const privateBody = 'Authenticated content browser check';
    try {
      await page.goto(origin);
      expect(
        await page.getByRole('link', { name: 'Topic', exact: true }).count(),
      ).toBe(0);
      await page.getByRole('link', { name: '登录后浏览' }).click();
      await page.waitForURL(`${origin}/account`);
      await signIn(page, origin, 'participant');
      await page.goto(`${origin}/topics/fixture-project`);
      await page.getByRole('heading', { name: 'Example Project' }).waitFor();
      await page.goto(`${origin}/topics/daily-inspiration`);
      const post = await publish(page, privateBody);
      await page.getByText(privateBody, { exact: true }).waitFor();
      await page.goto(`${origin}/account`);
      await page.getByRole('button', { name: '退出登录' }).click();
      await page.getByRole('button', { name: '使用 GitHub 登录' }).waitFor();
      for (const path of [
        '/topics',
        '/topics/daily-inspiration',
        '/topics/fixture-project',
        '/topics/not-found',
        new URL(post).pathname,
        '/tasks/invalid',
        '/search?q=Authenticated',
      ]) {
        const response = await page.request.get(`${origin}${path}`, {
          maxRedirects: 0,
        });
        expect(response.status(), path).toBe(307);
        expect(response.headers().location).toBe('/account');
        expect(response.headers()['cache-control']).toContain('no-store');
        expect(await response.text()).not.toMatch(
          /Daily Inspiration|Example Project|Authenticated content browser check/,
        );
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it('lets a participant sign in, publish Markdown, reply and acknowledge a durable mention', async () => {
    const { browser, origin } = fixture;
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await signIn(page, origin, 'participant');
      await page.goto(`${origin}/topics`);
      await page
        .getByRole('link', { name: 'Daily Inspiration', exact: true })
        .click();
      const postUrl = await publish(
        page,
        [
          '**Browser Markdown check**',
          `<span data-raw-fixture="unsafe">Raw HTML fixture</span>`,
          `Thanks @gh_${browserActors.participant.id} for testing durable mentions.`,
        ].join('\n\n'),
      );
      await page
        .locator('strong')
        .filter({ hasText: /^Browser Markdown check$/ })
        .waitFor();
      expect(await page.locator('[data-raw-fixture]').count()).toBe(0);

      await page
        .getByLabel('回复内容')
        .first()
        .fill('Browser reply to the discussion.');
      await page
        .getByRole('button', { name: '发布回复', exact: true })
        .first()
        .click();
      await page
        .getByText('Browser reply to the discussion.', { exact: true })
        .waitFor();
      const replyCard = page.getByRole('article').filter({
        hasText: 'Browser reply to the discussion.',
      });
      await replyCard
        .getByText(`回复 @gh_${browserActors.participant.id}`, { exact: true })
        .click();
      await replyCard
        .getByLabel('回复内容')
        .fill('Nested reply to the first reply.');
      await replyCard
        .getByRole('button', { name: '发布回复', exact: true })
        .click();
      const replyItem = page.getByRole('listitem').filter({ has: replyCard });
      await replyItem
        .getByText('Nested reply to the first reply.', { exact: true })
        .waitFor();
      await screenshot(page, 'm2-browser-mobile-thread');

      await page.goto(`${origin}/notifications`);
      const mention = page.getByRole('link', { name: '查看提及你的帖子' });
      await mention.waitFor();
      const mentionPath = await mention.getAttribute('href');
      expect(mentionPath).toBe(new URL(postUrl).pathname);
      const markRead = page.getByRole('button', {
        name: '标为已读',
        exact: true,
      });
      await markRead.click();
      await markRead.waitFor({ state: 'hidden' });
      await page.reload();
      await mention.waitFor();
      expect(await markRead.count()).toBe(0);
      await screenshot(page, 'm2-browser-notifications');

      await page.goto(`${origin}/account`);
      await page.getByRole('button', { name: '退出登录' }).click();
      await page.getByRole('button', { name: '使用 GitHub 登录' }).waitFor();
    } finally {
      await page.close();
    }
  }, 45_000);

  it('lets an administrator create and archive a Topic and hide or restore a post', async () => {
    const { browser, origin } = fixture;
    const page = await browser.newPage();
    try {
      await signIn(page, origin, 'admin');
      await page.goto(`${origin}/admin`);
      const createButton = page.getByRole('button', {
        name: '创建 Topic',
        exact: true,
      });
      const create = page.locator('form').filter({ has: createButton });
      await create.getByLabel('名称').fill('Browser Admin Topic');
      await create.getByLabel('Slug').fill('browser-admin-topic');
      await create
        .getByLabel('讨论指南')
        .fill('Keep the browser test discussions in this Topic.');
      await createButton.click();
      await page
        .getByText('Browser Admin Topic · 公开', { exact: true })
        .waitFor();

      await page.goto(`${origin}/topics/browser-admin-topic`);
      const postUrl = await publish(
        page,
        'A post for the browser moderation test.',
      );
      await page.getByRole('link', { name: '审核帖子', exact: true }).click();
      await page.getByLabel('原因（选填）').fill('Browser moderation evidence');
      await page.getByRole('button', { name: '隐藏帖子', exact: true }).click();
      await page
        .getByRole('button', { name: '恢复帖子', exact: true })
        .waitFor();
      await page
        .getByText('Browser moderation evidence', { exact: true })
        .waitFor();
      await screenshot(page, 'm2-browser-moderation');

      const participant = await browser.newPage();
      try {
        await signIn(participant, origin, 'participant');
        await participant.goto(postUrl);
        expect(
          await participant
            .getByText('A post for the browser moderation test.', {
              exact: true,
            })
            .count(),
        ).toBe(0);
        await page
          .getByRole('button', { name: '恢复帖子', exact: true })
          .click();
        await page
          .getByRole('button', { name: '隐藏帖子', exact: true })
          .waitFor();
        expect((await participant.reload())?.status()).toBe(200);
        await participant
          .getByText('A post for the browser moderation test.', { exact: true })
          .waitFor();
      } finally {
        await participant.close();
      }

      await page.goto(`${origin}/admin`);
      const topicLabel = page.getByText('Browser Admin Topic · 公开', {
        exact: true,
      });
      await topicLabel.click();
      const topicEditor = page.locator('details').filter({ has: topicLabel });
      await topicEditor.getByLabel('状态').selectOption('archived');
      await topicEditor
        .getByRole('button', { name: '保存修改', exact: true })
        .click();
      await page
        .getByText('Browser Admin Topic · 已归档', { exact: true })
        .waitFor();
      await page.goto(`${origin}/topics`);
      expect(
        await page
          .getByRole('link', { name: 'Browser Admin Topic', exact: true })
          .count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  }, 45_000);
});
