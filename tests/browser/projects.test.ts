import type { Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture, screenshot, signIn } from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
}, 15_000);

async function signInWithId(
  page: Page,
  origin: string,
  actor: 'participant' | 'admin' | 'reviewer',
) {
  page.setDefaultTimeout(10_000);
  await signIn(page, origin, actor);
  const principalId = await page.locator('dd code').textContent();
  if (!principalId) throw new Error('Account did not display a Principal ID.');
  return principalId;
}

it('preserves idea provenance through assignment, independent review and admin acceptance', async () => {
  const { browser, origin } = fixture;
  const [author, reviewer, admin] = await Promise.all([
    browser.newPage(),
    browser.newPage(),
    browser.newPage(),
  ]);
  const idea = 'Keep project outcomes linked to the original community idea.';
  const project = 'Browser Project Fixture';
  const artifact =
    process.env.AGORAFAB_DEMO_PR_URL ??
    'https://github.com/example/agorafab-fixture/pull/42';
  const repo =
    /^https:\/\/github\.com\/[a-z\d-]+\/[a-z\d_.-]+(?=\/pull\/[1-9]\d*$)/i.exec(
      artifact,
    )?.[0];
  const task = 'Implement the idea';
  const review = 'The submitted change addresses the original requirement.';
  const decision = 'Accepted after independent review.';
  try {
    if (!repo)
      throw new Error(
        'AGORAFAB_DEMO_PR_URL must be a canonical GitHub pull request URL.',
      );
    const [authorId, reviewerId, adminId] = await Promise.all([
      signInWithId(author, origin, 'participant'),
      signInWithId(reviewer, origin, 'reviewer'),
      signInWithId(admin, origin, 'admin'),
    ]);
    expect(new Set([authorId, reviewerId, adminId]).size).toBe(3);

    await author.goto(`${origin}/topics/daily-inspiration`);
    await author.getByRole('combobox', { name: /^类型/ }).selectOption('idea');
    await author.getByText('撰写帖子', { exact: true }).click();
    await author.getByLabel('帖子内容').fill(idea);
    await author.getByRole('button', { name: '发布帖子', exact: true }).click();
    await author.waitForURL(/\/posts\/[\da-f-]+$/);
    await author.getByText(idea, { exact: true }).waitFor();
    expect(
      await author.getByText('从想法创建项目', { exact: true }).count(),
    ).toBe(0);
    const ideaUrl = new URL(author.url());

    await admin.goto(ideaUrl.href);
    await admin.getByText('从想法创建项目', { exact: true }).click();
    const promotion = admin.getByRole('form', { name: '创建项目' });
    await promotion.getByLabel('项目名称').fill(project);
    await promotion.getByLabel('Slug').fill('browser-project');
    await promotion
      .getByLabel('项目目标')
      .fill('Deliver and review the community idea.');
    await promotion.getByLabel('GitHub 仓库地址（选填）').fill(repo);
    await promotion.getByRole('button', { name: '创建项目' }).click();
    await admin.waitForURL(`${origin}/topics/browser-project`);
    await admin.getByRole('heading', { name: project, exact: true }).waitFor();
    const source = admin.getByRole('link', { name: '查看来源想法' });
    await source.waitFor();
    expect(await source.getAttribute('href')).toBe(ideaUrl.pathname);
    expect(
      await admin
        .getByRole('link', { name: '查看 GitHub 仓库' })
        .getAttribute('href'),
    ).toBe(repo);
    const projectUrl = admin.url();

    await source.click();
    await admin.waitForURL(ideaUrl.href);
    await admin.getByText(idea, { exact: true }).waitFor();
    expect(
      await admin
        .getByRole('link', { name: '返回 Topic' })
        .getAttribute('href'),
    ).toBe('/topics/daily-inspiration');
    await admin.goto(projectUrl);

    await admin
      .locator('summary')
      .filter({ hasText: /^创建任务$/ })
      .click();
    const create = admin.getByRole('form', { name: '创建任务' });
    await create.getByLabel('任务名称').fill(task);
    await create
      .getByLabel('任务说明')
      .fill('Submit a public pull request link.');
    await create.getByRole('button', { name: '创建任务' }).click();
    await admin.waitForURL(/\/tasks\/[\da-f-]+$/);
    await admin.getByRole('heading', { name: task, exact: true }).waitFor();
    const taskUrl = admin.url();
    const anonymousTask = await fetch(taskUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    expect(anonymousTask.status).toBe(307);
    expect(anonymousTask.headers.get('location')).toBe('/account');
    expect(anonymousTask.headers.get('cache-control')).toContain('no-store');
    expect(await anonymousTask.text()).not.toContain(task);

    await author.goto(projectUrl);
    await author.getByRole('link', { name: task, exact: true }).click();
    await author.waitForURL(taskUrl);
    await author.getByText('待领取', { exact: true }).waitFor();
    await author.getByRole('button', { name: '领取任务' }).click();
    const submit = author.getByRole('form', { name: '提交成果' });
    await submit.getByLabel('成果类型').selectOption('pr');
    await submit.getByLabel('公开成果链接').fill(artifact);
    await submit
      .getByLabel('成果说明')
      .fill('Pull request used for project workflow verification.');
    await submit.getByRole('button', { name: '提交成果' }).click();
    await author.getByText('待评审', { exact: true }).waitFor();
    expect(await author.getByRole('button', { name: '提交评审' }).count()).toBe(
      0,
    );

    await reviewer.goto(taskUrl);
    const reviewForm = reviewer.getByRole('form', { name: '提交评审' });
    await reviewForm.getByLabel('评审意见').fill(review);
    await reviewForm.getByRole('button', { name: '提交评审' }).click();
    await reviewer.getByText('待决定', { exact: true }).waitFor();
    expect(
      await reviewer.getByRole('button', { name: '保存决定' }).count(),
    ).toBe(0);

    await admin.reload();
    const decide = admin.getByRole('form', { name: '保存决定' });
    await decide.getByRole('combobox', { name: /^决定/ }).selectOption('done');
    await decide.getByLabel('决定说明').fill(decision);
    await decide.getByRole('button', { name: '保存决定' }).click();
    await admin.getByText('已验收', { exact: true }).waitFor();

    await author.reload();
    await author.getByText('已验收', { exact: true }).waitFor();
    await author.getByText(review, { exact: true }).waitFor();
    await author.getByText(decision, { exact: true }).waitFor();
    const info = author.getByRole('region', { name: '任务信息' });
    for (const principalId of [authorId, reviewerId, adminId]) {
      await info.getByText(principalId, { exact: true }).waitFor();
    }
    expect(
      await author
        .getByRole('link', { name: 'GitHub Pull Request · github.com' })
        .getAttribute('href'),
    ).toBe(artifact);
    await screenshot(author, 'm4-accepted-task');
    await author.getByRole('link', { name: '返回项目' }).click();
    const acceptedProject = author.getByRole('region', { name: '项目任务' });
    await acceptedProject.getByText('已验收', { exact: true }).waitFor();
    expect(
      await acceptedProject
        .getByRole('link', { name: '查看来源想法' })
        .getAttribute('href'),
    ).toBe(ideaUrl.pathname);
  } finally {
    await Promise.all([author.close(), reviewer.close(), admin.close()]);
  }
}, 60_000);
