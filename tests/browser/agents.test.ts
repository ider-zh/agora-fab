import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkPage } from './accessibility.js';
import { browserFixture, screenshot, signIn } from './fixture.js';

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
    browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['clipboard-read', 'clipboard-write'],
    }),
  ]);
  const admin = await adminContext.newPage();
  owner.setDefaultTimeout(10_000);
  admin.setDefaultTimeout(10_000);
  try {
    await signIn(owner, origin, 'participant');
    const ownerId = await owner.locator('dd code').textContent();
    if (!ownerId)
      throw new Error('Owner account did not display its Principal ID.');
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
    await invite.getByLabel('用户名').fill('mobile_qa_agent');
    await invite.getByLabel('所有者 ID').fill(ownerId);
    await invite.getByLabel('平台').fill('QA Fixture');
    await invite.getByLabel('能力标签（选填）').fill('browser-testing');
    await invite.getByRole('button', { name: '邀请 Agent' }).click();
    await admin.waitForURL(/\/admin\/agents\/[\da-f-]+$/);
    await admin
      .getByRole('heading', { name: 'Mobile QA Agent', exact: true })
      .waitFor();
    await admin.getByText(ownerId, { exact: true }).waitFor();
    const principalId = new URL(admin.url()).pathname.split('/').at(-1);
    if (!principalId)
      throw new Error('Agent detail did not expose its Principal ID.');
    await admin.getByText(principalId, { exact: true }).waitFor();
    const rename = admin.getByRole('form', { name: '修改 Agent 名称' });
    await rename.getByLabel('显示名称').fill('Renamed QA Agent');
    await rename.getByRole('button', { name: '保存名称' }).click();
    await admin.getByRole('heading', { name: 'Renamed QA Agent' }).waitFor();
    expect(admin.url().endsWith(`/${principalId}`)).toBe(true);
    await admin.getByText(/@mobile_qa_agent/).waitFor();

    await owner.goto(admin.url());
    expect(
      await owner.getByRole('form', { name: '修改 Agent 名称' }).count(),
    ).toBe(0);
    expect(await owner.getByRole('form', { name: '签发凭证' }).count()).toBe(0);

    const issue = admin.getByRole('form', { name: '签发凭证' });
    await issue.getByRole('checkbox', { name: 'community:write' }).check();
    await issue.getByRole('checkbox', { name: 'notifications:read' }).check();
    await issue.getByLabel('有效期（小时）').fill('2');
    await issue.getByRole('button', { name: '签发凭证' }).click();
    const secret = admin.getByRole('textbox', {
      name: 'Agent 私密 MCP 接入提示词',
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
        const value = control.value ?? '';
        return (
          control.tagName === 'TEXTAREA' &&
          control.readOnly === true &&
          /^Authorization: Bearer agf_[A-Za-z0-9_-]{43}$/m.test(value) &&
          value.includes('Streamable HTTP MCP：http://127.0.0.1:3001/mcp') &&
          value.includes('@mobile_qa_agent') &&
          value.includes('新人报道区') &&
          value.includes('create_post')
        );
      }),
    ).toBe(true);
    await admin.getByRole('button', { name: '复制接入提示词' }).click();
    await admin.getByText('接入提示词已复制。').waitFor();
    expect(
      await secret.evaluate(async (element) => {
        const { clipboard } = navigator as unknown as {
          clipboard: {
            readText(): Promise<string>;
            writeText(text: string): Promise<void>;
          };
        };
        const same =
          (await clipboard.readText()) === (element as { value: string }).value;
        await clipboard.writeText('');
        return same;
      }),
    ).toBe(true);
    await admin.getByRole('button', { name: '关闭接入提示词显示' }).click();
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
    await screenshot(admin, 'agent-management-metadata');
    const rotate = issue.getByLabel('更换已有凭证（选填）');
    await rotate.selectOption({ index: 1 });
    expect(
      await issue
        .getByRole('checkbox', { name: 'notifications:read' })
        .isChecked(),
    ).toBe(true);
    await issue.getByRole('button', { name: '签发凭证' }).click();
    await secret.waitFor();
    await admin.getByRole('button', { name: '关闭接入提示词显示' }).click();
    await metadata.getByText('已撤销', { exact: true }).waitFor();
    await revoke.click();
    await revoke.waitFor({ state: 'hidden' });
    await admin.reload();
    expect(await revoke.count()).toBe(0);
    expect(await metadata.getByText('已撤销', { exact: true }).count()).toBe(2);

    await admin.getByText('撤销整个 Agent', { exact: true }).click();
    await admin
      .getByRole('button', { name: '撤销 Agent', exact: true })
      .click();
    await issue.waitFor({ state: 'hidden' });
    await admin.reload();
    const profile = admin.getByRole('region', { name: 'Agent 资料' });
    await profile.getByText(/已撤销/).waitFor();
    await profile.getByText(ownerId, { exact: true }).waitFor();
  } finally {
    await Promise.all([owner.close(), adminContext.close()]);
  }
}, 60_000);
