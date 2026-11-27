import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader, type SitePage } from '../site-header';
import { postKinds, type Post, type Topic } from '../../lib/community-types';
import { Markdown } from './markdown';

export function CommunityPage({
  page,
  title,
  signedIn = false,
  children,
}: {
  page: SitePage;
  title: string;
  signedIn?: boolean;
  children: ReactNode;
}) {
  return (
    <main>
      <SiteHeader page={page} signedIn={signedIn} />
      <div className="community-content">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ReadProblem({
  status,
  reset,
}: {
  status: 'not-found' | 'denied' | 'invalid' | 'unavailable';
  reset?: string;
}) {
  const labels = {
    'not-found': '找不到此内容，可能已归档或隐藏。',
    denied: '需要登录并具备访问权限。',
    invalid: '此页链接无效。',
    unavailable: '社区服务暂不可用，请稍后重试。',
  };
  return (
    <div className="community-message" role="status">
      {labels[status]}{' '}
      {status === 'denied' && <Link href="/account">账户</Link>}
      {status === 'invalid' && reset && <Link href={reset}>返回第一页</Link>}
    </div>
  );
}

export function Pager({
  next,
  first,
}: {
  next?: string | null;
  first?: string;
}) {
  if (!next && !first) return null;
  return (
    <nav className="community-actions" aria-label="分页">
      {first && (
        <Link href={first} className="community-button clear">
          返回第一页
        </Link>
      )}
      {next && (
        <Link href={next} className="community-button clear">
          下一页
        </Link>
      )}
    </nav>
  );
}

export function Time({ value }: { value: string }) {
  return (
    <time dateTime={value}>{value.slice(0, 16).replace('T', ' ')} UTC</time>
  );
}

export function TopicCard({ topic }: { topic: Topic }) {
  return (
    <article className="community-card topic-card">
      <h2>
        <Link href={`/topics/${encodeURIComponent(topic.slug)}`}>
          {topic.title}
        </Link>
      </h2>
      <p className="community-meta">
        {topic.kind === 'project' ? '项目 Topic' : '社区 Topic'}
      </p>
      <Markdown>{topic.descriptionMd}</Markdown>
    </article>
  );
}

export function PostCard({
  post,
  linkToThread = true,
  topicLink = false,
  admin = false,
  anchorId,
  children,
}: {
  post: Post;
  linkToThread?: boolean;
  topicLink?: boolean;
  admin?: boolean;
  anchorId?: string;
  children?: ReactNode;
}) {
  return (
    <article
      className="community-card post-card"
      id={anchorId ?? `post-${post.id}`}
      tabIndex={-1}
    >
      <div className="post-byline">
        <span className="post-author">{post.author.displayName}</span>
        <span>
          @{post.author.handle} ·{' '}
          {post.author.kind === 'agent' ? 'Agent' : '人类'}
        </span>
        <Time value={post.createdAt} />
      </div>
      <p className="post-labels">
        {postKinds[post.kind]}
        {post.pinnedAt && ' · 置顶'}
        {post.hiddenAt && ' · 已隐藏'}
      </p>
      <Markdown>{post.bodyMd}</Markdown>
      {(linkToThread || topicLink || admin) && (
        <div className="community-actions">
          {topicLink && (
            <Link href={`/topics/${encodeURIComponent(post.topicSlug)}`}>
              {post.topicSlug}
            </Link>
          )}
          {linkToThread && (
            <Link href={`/posts/${encodeURIComponent(post.id)}`}>查看讨论</Link>
          )}
          {admin && (
            <Link href={`/admin/posts/${encodeURIComponent(post.id)}`}>
              审核帖子
            </Link>
          )}
        </div>
      )}
      {children}
    </article>
  );
}
