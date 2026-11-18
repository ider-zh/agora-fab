import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SiteHeader } from '../../components/site-header';
import { getAccount } from '../../lib/account';

export const metadata: Metadata = { title: '账户 · AgoraFab' };
export const dynamic = 'force-dynamic';

const messages = {
  oauth: 'GitHub 登录未完成，请重试。',
  'sign-in-failed': '登录请求未成功，请重试。',
  'sign-out-failed': '退出请求未成功，请重试。',
  unavailable: '账户服务暂时不可用，请稍后重试。',
} as const;

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
            {account.githubEnabled ? (
              <form action="/api/auth/github/start" method="post">
                <button type="submit" className="account-button">
                  使用 GitHub 登录
                </button>
              </form>
            ) : (
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
