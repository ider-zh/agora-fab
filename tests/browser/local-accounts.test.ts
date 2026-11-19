import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from './fixture.js';

const operator = {
  handle: 'local_operator',
  displayName: 'Local Browser Admin',
  password: 'fixture-operator-password',
};
const participantPassword = 'fixture-participant-password';
let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(operator);
}, 40_000);

afterAll(async () => {
  await fixture?.close();
}, 15_000);

it('opens human and Agent accounts through the browser with GitHub disabled', async () => {
  const { browser, origin } = fixture;
  const [admin, participant] = await Promise.all([
    browser.newPage(),
    browser.newPage(),
  ]);
  admin.setDefaultTimeout(10_000);
  participant.setDefaultTimeout(10_000);
  try {
    await admin.goto(`${origin}/account`);
    expect(
      await admin.getByRole('button', { name: '使用 GitHub 登录' }).count(),
    ).toBe(0);
    const login = admin.getByRole('form', { name: '本地账户登录' });
    await login.getByLabel('用户名').fill(operator.handle);
    await login.getByLabel('密码').fill(operator.password);
    await login.getByRole('button', { name: '登录', exact: true }).click();
    await admin.getByRole('link', { name: '管理社区' }).click();

    const invite = admin.getByRole('form', { name: '开通普通账户' });
    await invite.getByLabel('用户名').fill('local_browser_user');
    await invite.getByLabel('显示名称').fill('Local Browser User');
    await invite.getByRole('button', { name: '开通账户' }).click();
    const activation = admin.getByRole('textbox', {
      name: '普通账户激活码',
      exact: true,
    });
    await activation.waitFor();
    const activationCode = await activation.inputValue();

    await participant.goto(`${origin}/account`);
    await participant.getByText('首次登录或激活账户', { exact: true }).click();
    const activate = participant.getByRole('form', { name: '激活普通账户' });
    await activate.getByLabel('待激活用户名').fill('local_browser_user');
    await activate.getByLabel('激活码').fill(activationCode);
    await activate.getByLabel('设置密码').fill(participantPassword);
    await activate.getByRole('button', { name: '激活并登录' }).click();
    await participant
      .getByRole('heading', { name: 'Local Browser User' })
      .waitFor();
    await participant.getByText('参与者', { exact: true }).waitFor();
    const ownerId = await participant.locator('dd code').textContent();
    if (!ownerId)
      throw new Error('Participant Principal ID was not displayed.');

    await participant.getByRole('button', { name: '退出登录' }).click();
    const signIn = participant.getByRole('form', { name: '本地账户登录' });
    await signIn.getByLabel('用户名').fill('local_browser_user');
    await signIn.getByLabel('密码').fill(participantPassword);
    await signIn.getByRole('button', { name: '登录', exact: true }).click();
    await participant
      .getByRole('heading', { name: 'Local Browser User' })
      .waitFor();
    await participant.goto(`${origin}/admin`);
    expect(
      await participant.getByRole('form', { name: '开通普通账户' }).count(),
    ).toBe(0);

    await admin.getByRole('link', { name: '管理 Agent' }).click();
    const agent = admin.getByRole('form', { name: '邀请 Agent' });
    await agent.getByLabel('显示名称').fill('Local Browser Agent');
    await agent.getByLabel('用户名').fill('local_browser_agent');
    await agent.getByLabel('所有者 ID').fill(ownerId);
    await agent.getByLabel('平台').fill('Browser Fixture');
    await agent.getByRole('button', { name: '邀请 Agent' }).click();
    const issue = admin.getByRole('form', { name: '签发凭证' });
    await issue.getByRole('checkbox', { name: 'community:write' }).check();
    await issue.getByRole('button', { name: '签发凭证' }).click();
    const secret = admin.getByRole('textbox', {
      name: 'Agent 凭证',
      exact: true,
    });
    await secret.waitFor();
    expect(/^agf_[A-Za-z0-9_-]{43}$/.test(await secret.inputValue())).toBe(
      true,
    );
  } finally {
    await Promise.all([admin.close(), participant.close()]);
  }
}, 60_000);
