import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { canShowLocalAuth, getAccount } from '../../lib/account';

export const metadata: Metadata = { title: '账户 · AgoraFab' };
export const dynamic = 'force-dynamic';

const messages = {
  oauth: 'GitHub 登录未完成，请重试。',
  'sign-in-failed': '登录请求未成功，请重试。',
  'local-sign-in-failed': '登录未成功，请检查用户名和密码。',
  'activation-failed': '激活未成功，请检查用户名、激活码和密码。',
  'too-many-attempts': '尝试次数过多，请稍后重试。',
  'sign-out-failed': '退出请求未成功，请重试。',
  unavailable: '账户服务暂时不可用，请稍后重试。',
} as const;

function LocalAccountForm({ activate = false }: { activate?: boolean }) {
  return (
    <form
      className="community-form account-local-form"
      action={activate ? '/api/auth/local/activate' : '/api/auth/local/login'}
      method="post"
      aria-label={activate ? '激活普通账户' : '本地账户登录'}
    >
      <label>
        {activate ? '待激活用户名' : '用户名'}
        <input
          name="handle"
          minLength={3}
          maxLength={32}
          pattern="[a-z][a-z0-9_]{2,31}"
          autoComplete={activate ? 'section-activate username' : 'username'}
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </label>
      {activate && (
        <label>
          激活码
          <input
            name="activationCode"
            type="password"
            minLength={43}
            maxLength={43}
            autoComplete="one-time-code"
            required
          />
        </label>
      )}
      <label>
        {activate ? '设置密码' : '密码'}
        <input
          name="password"
          type="password"
          minLength={activate ? 12 : undefined}
          maxLength={128}
          autoComplete={activate ? 'new-password' : 'current-password'}
          required
        />
      </label>
      {activate && (
        <p className="community-meta">密码长度为 12 至 128 个字符。</p>
      )}
      <button className="account-button" type="submit">
        {activate ? '激活并登录' : '登录'}
      </button>
    </form>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const [{ error }, requestHeaders] = await Promise.all([
    searchParams,
    headers(),
  ]);
  const message =
    typeof error === 'string' && Object.hasOwn(messages, error)
      ? messages[error as keyof typeof messages]
      : undefined;
  const account = await getAccount(requestHeaders.get('cookie'));
  const localAvailable =
    account.status === 'signed-out' &&
    account.localEnabled &&
    canShowLocalAuth(requestHeaders);

  return (
    <main>
      <SiteHeader page="account" />
      <section className="account" aria-labelledby="account-title">
        <h1 id="account-title">账户</h1>
        {message && (
          <p className="account-error" role="alert">
            {message}
          </p>
        )}
        {account.status === 'signed-in' && (
          <div className="account-card">
            <h2>{account.profile.displayName}</h2>
            <dl className="account-profile">
              <div>
                <dt>用户名</dt>
                <dd>@{account.profile.handle}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>
                  {account.profile.role === 'admin' ? '管理员' : '参与者'}
                </dd>
              </div>
              <div>
                <dt>身份 ID</dt>
                <dd>
                  <code>{account.profile.id}</code>
                </dd>
              </div>
            </dl>
            {account.profile.role === 'admin' && (
              <Link className="community-button clear" href="/admin">
                管理社区
              </Link>
            )}
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="account-button account-button-secondary"
              >
                退出登录
              </button>
            </form>
          </div>
        )}
        {account.status === 'signed-out' && (
          <div className="account-card">
            <h2>登录 AgoraFab</h2>
            {localAvailable && (
              <>
                <LocalAccountForm />
                <details
                  className="account-activation"
                  open={error === 'activation-failed'}
                >
                  <summary>首次登录或激活账户</summary>
                  <LocalAccountForm activate />
                </details>
              </>
            )}
            {account.githubEnabled && (
              <form action="/api/auth/github/start" method="post">
                <button type="submit" className="account-button">
                  使用 GitHub 登录
                </button>
              </form>
            )}
            {account.localEnabled && !localAvailable && (
              <p role="status">请通过部署配置的登录地址访问账户页。</p>
            )}
            {!account.localEnabled && !account.githubEnabled && (
              <p role="status">此部署尚未启用 GitHub 登录。</p>
            )}
          </div>
        )}
        {account.status === 'unavailable' && error !== 'unavailable' && (
          <p role="status">暂时无法加载账户状态，请稍后刷新。</p>
        )}
      </section>
    </main>
  );
}
