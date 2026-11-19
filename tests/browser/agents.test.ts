import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkPage } from './accessibility.js';
import { browserFixture, signIn } from './fixture.js';

let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  fixture = await browserFixture();
}, 40_000);
afterAll(async () => {
  await fixture?.close();
}, 15_000);

it('lets an administrator invite an owned Agent and manage its one-time credentials', async () => {
  const { browser, origin } = fixture;
  const [owner, adminContext] = await Promise.all([
    browser.newPage(),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
  ]);
  const admin = await adminContext.newPage();
  owner.setDefaultTimeout(10_000);
  admin.setDefaultTimeout(10_000);
  try {
    await signIn(owner, origin, 'participant');
    const ownerHandle = 'gh_7801';
    await owner.getByText('@' + ownerHandle, { exact: true }).waitFor();
    await owner.goto(`${origin}/admin/agents`);
    expect(await owner.getByRole('form', { name: '邀请 Agent' }).count()).toBe(
      0,
    );

    await signIn(admin, origin, 'admin');
    await admin.goto(`${origin}/admin`);
    await admin.getByRole('link', { name: '管理 Agent' }).click();
    await admin.waitForURL(`${origin}/admin/agents`);
    const invite = admin.getByRole('form', { name: '邀请 Agent' });
    await invite.waitFor();
    await checkPage(admin, 'Agent invitation');
    await invite.getByLabel('显示名称').fill('Mobile QA Agent');
    await invite.getByLabel('用户名', { exact: true }).fill('mobile_qa_agent');
    await invite.getByLabel('所有者用户名').fill(ownerHandle);
    await invite.getByLabel('平台').fill('QA Fixture');
    await invite.getByLabel('能力标签（选填）').fill('browser-testing');
    await invite.getByRole('button', { name: '邀请 Agent' }).click();
    await admin.waitForURL(/\/admin\/agents\/mobile_qa_agent$/);
    await admin
      .getByRole('heading', { name: 'Mobile QA Agent', exact: true })
      .waitFor();
    await admin.getByText('@' + ownerHandle, { exact: true }).waitFor();
    expect(await admin.getByText('Agent ID', { exact: true }).count()).toBe(0);

    const issue = admin.getByRole('form', { name: '签发凭证' });
    await issue.getByRole('checkbox', { name: 'community:write' }).check();
    await issue.getByRole('checkbox', { name: 'notifications:read' }).check();
    await issue.getByLabel('有效期（小时）').fill('2');
    await issue.getByRole('button', { name: '签发凭证' }).click();
    const secret = admin.getByRole('textbox', {
      name: 'Agent 凭证',
      exact: true,
    });
    await secret.waitFor();
    // Only a boolean leaves the browser. Forbid token and digest shapes in
    // the public metadata view after the one-time display closes.
    expect(
      await secret.evaluate((element) => {
        const control = element as {
          tagName: string;
          readOnly?: boolean;
          value?: string;
        };
        return (
          control.tagName === 'TEXTAREA' &&
          control.readOnly === true &&
          /^agf_[A-Za-z0-9_-]{43}$/.test(control.value ?? '')
        );
      }),
    ).toBe(true);
    await admin.getByRole('button', { name: '关闭凭证显示' }).click();
    await secret.waitFor({ state: 'hidden' });
    await admin.reload();
    expect(await secret.count()).toBe(0);
    expect(
      await admin
        .locator('body')
        .evaluate((body) =>
          /agf_[A-Za-z0-9_-]{43}|\b[a-f\d]{64}\b/.test(body.textContent ?? ''),
        ),
    ).toBe(false);

    const metadata = admin.getByRole('region', { name: '已签发凭证' });
    const revoke = metadata.getByRole('button', {
      name: '撤销凭证',
      exact: true,
    });
    await revoke.waitFor();
    await metadata
      .getByText('community:write、notifications:read', { exact: true })
      .waitFor();
    await metadata.getByText('有效', { exact: true }).waitFor();
    await checkPage(admin, 'Agent credential metadata');
    await revoke.click();
    await revoke.waitFor({ state: 'hidden' });
    await admin.reload();
    expect(await revoke.count()).toBe(0);
    await metadata.getByText('已撤销', { exact: true }).waitFor();

    await admin.getByText('撤销整个 Agent', { exact: true }).click();
    await admin
      .getByRole('button', { name: '撤销 Agent', exact: true })
      .click();
    await issue.waitFor({ state: 'hidden' });
    await admin.reload();
    const profile = admin.getByRole('region', { name: 'Agent 资料' });
    await profile.getByText(/已撤销/).waitFor();
    await profile.getByText('@' + ownerHandle, { exact: true }).waitFor();
  } finally {
    await Promise.all([owner.close(), adminContext.close()]);
  }
}, 60_000);
