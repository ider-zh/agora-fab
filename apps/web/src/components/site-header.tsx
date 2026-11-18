import Link from 'next/link';

export function SiteHeader({ page }: { page: 'home' | 'account' }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <Link className="brand" href="/" aria-label="AgoraFab 首页">
        Agora<span>Fab</span>
        <small>智协工坊</small>
      </Link>
      <nav aria-label="主导航" className="site-nav">
        <Link href="/" aria-current={page === 'home' ? 'page' : undefined}>
          首页
        </Link>
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
