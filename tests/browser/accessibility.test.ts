import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkPage, tabTo } from './accessibility.js';
import { browserFixture, signIn } from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
}, 15_000);

it('keeps sign-in and Topic navigation usable by keyboard at 390 CSS pixels', async () => {
  const { browser, origin } = fixture;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  try {
    await page.goto(origin);
    await checkPage(page, 'Home');
    const nav = page.getByRole('navigation', { name: '主导航' });
    expect(
      await nav.getByRole('link', { name: 'Topic', exact: true }).count(),
    ).toBe(0);
    await tabTo(page, nav.getByRole('link', { name: '账户', exact: true }));
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/account`);
    const login = page.getByRole('button', { name: '使用 GitHub 登录' });
    await tabTo(page, login);
    expect(
      await login.evaluate((element) => element.matches(':focus-visible')),
    ).toBe(true);
    await checkPage(page, 'Signed-out account');

    await signIn(page, origin, 'participant');
    await tabTo(page, nav.getByRole('link', { name: 'Topic', exact: true }));
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/topics`);
    await checkPage(page, 'Topic list');

    await tabTo(
      page,
      page.getByRole('link', { name: 'Daily Inspiration', exact: true }),
    );
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/topics/daily-inspiration`);
    await page
      .getByRole('heading', { name: 'Daily Inspiration', level: 1 })
      .waitFor();
    const composer = page.getByLabel('帖子内容');
    expect(await composer.isVisible()).toBe(false);
    await tabTo(page, page.getByText('撰写帖子', { exact: true }));
    await page.keyboard.press('Enter');
    await composer.waitFor({ state: 'visible' });
    await tabTo(page, composer);
    await page.getByText('撰写帖子', { exact: true }).click();
    await tabTo(page, page.getByText('分享给 Agent', { exact: true }));
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('textbox', { name: '加入指引' }));
    await checkPage(page, 'Topic detail');
  } finally {
    await context.close();
  }
}, 45_000);

it('keeps the signed-in account and administrator forms labeled at a narrow viewport', async () => {
  const { browser, origin } = fixture;
  const context = await browser.newContext({
    viewport: { width: 320, height: 760 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  try {
    await signIn(page, origin, 'admin');
    await checkPage(page, 'Signed-in account');
    await page.goto(`${origin}/admin`);
    await page.getByRole('heading', { name: '社区管理', level: 1 }).waitFor();
    await tabTo(page, page.getByLabel('帖子 ID'));
    await checkPage(page, 'Community administration');
  } finally {
    await context.close();
  }
}, 45_000);
