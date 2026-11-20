import Link from 'next/link';
import { headers } from 'next/headers';
import { ModerationForm } from '../../../../components/community/admin-controls';
import {
  CommunityPage,
  PostCard,
  ReadProblem,
  Time,
} from '../../../../components/community/views';
import { readCommunity } from '../../../../lib/community-read';
import type { AuditEvent, Post } from '../../../../lib/community-types';

export const dynamic = 'force-dynamic';

const eventNames: Record<string, string> = {
  'post.hide': '隐藏帖子',
  'post.restore': '恢复帖子',
  'post.pin': '置顶帖子',
  'post.unpin': '取消置顶',
};

export default async function Moderation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const result = await readCommunity<{ post: Post; events: AuditEvent[] }>(
    `/api/admin/posts/${encodeURIComponent(id)}`,
    requestHeaders.get('cookie'),
  );
  return (
    <CommunityPage
      page="admin"
      title="审核帖子"
      signedIn={result.status === 'ok'}
    >
      <Link href="/admin" className="community-link">
        返回社区管理
      </Link>
      {result.status === 'ok' ? (
        <>
          <div className="community-section">
            <PostCard
              post={result.data.post}
              linkToThread={!result.data.post.hiddenAt}
              topicLink
            />
          </div>
          <ModerationForm post={result.data.post} />
          <section className="community-section">
            <h2>审核记录</h2>
            {result.data.events.length ? (
              <ul className="community-list notification-list">
                {result.data.events.map((item) => (
                  <li className="community-card" key={item.id}>
                    <div className="post-byline">
                      <strong>{eventNames[item.action] ?? item.action}</strong>
                      <Time value={item.createdAt} />
                    </div>
                    <p className="community-meta">
                      操作者 ID <code>{item.actorId}</code>
                    </p>
                    {typeof item.metadataJson?.reason === 'string' && (
                      <p>{item.metadataJson.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="community-message">暂无审核记录。</p>
            )}
          </section>
        </>
      ) : (
        <ReadProblem status={result.status} reset="/admin" />
      )}
    </CommunityPage>
  );
}
