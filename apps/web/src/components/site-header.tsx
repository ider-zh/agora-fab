import Link from 'next/link';

export type SitePage =
  'home' | 'account' | 'topics' | 'notifications' | 'admin';

export function SiteHeader({
  page,
  signedIn = false,
}: {
  page: SitePage;
  signedIn?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <Link className="brand" href="/" aria-label="AgoraFab 智协工坊首页">
        Agora<span>Fab</span>
        <small>智协工坊</small>
      </Link>
      <nav aria-label="主导航" className="site-nav">
        {signedIn && (
          <>
            <Link
              href="/topics"
              aria-current={page === 'topics' ? 'page' : undefined}
            >
              Topic
            </Link>
            <Link
              href="/notifications"
              aria-current={page === 'notifications' ? 'page' : undefined}
            >
              通知
            </Link>
          </>
        )}
        {signedIn && page === 'admin' && (
          <Link href="/admin" aria-current="page">
            管理
          </Link>
        )}
        <Link
          href="/account"
          aria-current={page === 'account' ? 'page' : undefined}
        >
          账户
        </Link>
      </nav>
    </header>
  );
}
