import Link from 'next/link';
import { headers } from 'next/headers';
import {
  InboxPoll,
  ReadButton,
} from '../../components/community/inbox-controls';
import {
  CommunityPage,
  Pager,
  ReadProblem,
  Time,
} from '../../components/community/views';
import { getAccount } from '../../lib/account';
import { readCommunity } from '../../lib/community-read';
import {
  queryPath,
  type Notification,
  type Page,
} from '../../lib/community-types';

export const dynamic = 'force-dynamic';

export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    unread?: string | string[];
  }>;
}) {
  const [{ cursor, unread }, requestHeaders] = await Promise.all([
    searchParams,
    headers(),
  ]);
  const cookies = requestHeaders.get('cookie');
  const account = await getAccount(cookies);
  if (account.status !== 'signed-in')
    return (
      <CommunityPage page="notifications" title="通知">
        <ReadProblem
          status={account.status === 'unavailable' ? 'unavailable' : 'denied'}
        />
      </CommunityPage>
    );
  const unreadOnly = unread === '1' ? '1' : undefined;
  const path = queryPath('/notifications', { unread: unreadOnly });
  const result =
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<Notification>>(
          queryPath('/api/me/notifications', { cursor, unread: unreadOnly }),
          cookies,
        );
  return (
    <CommunityPage page="notifications" title="通知" signedIn>
      <nav className="community-actions" aria-label="筛选通知">
        <Link
          href="/notifications"
          aria-current={!unreadOnly ? 'page' : undefined}
        >
          全部
        </Link>
        <Link
          href="/notifications?unread=1"
          aria-current={unreadOnly ? 'page' : undefined}
        >
          未读
        </Link>
      </nav>
      {result.status === 'ok' ? (
        <>
          {!cursor && <InboxPoll />}
          {result.data.items.length ? (
            <ul className="community-list notification-list">
              {result.data.items.map((item) => (
                <li key={item.id} className="community-card">
                  <div className="post-byline">
                    <strong>{item.readAt ? '已读提及' : '未读提及'}</strong>
                    <Time value={item.createdAt} />
                  </div>
                  <Link
                    className="community-link"
                    href={`/posts/${encodeURIComponent(item.postId)}`}
                  >
                    查看提及你的帖子
                  </Link>
                  {' · '}
                  <Link
                    className="community-link"
                    href={`/topics/${encodeURIComponent(item.topicSlug)}`}
                  >
                    {item.topicSlug}
                  </Link>
                  {!item.readAt && <ReadButton id={item.id} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="community-message">
              {unreadOnly ? '没有未读通知。' : '暂无通知。'}
            </p>
          )}
          <Pager
            first={cursor ? path : undefined}
            next={
              result.data.nextCursor &&
              queryPath('/notifications', {
                cursor: result.data.nextCursor,
                unread: unreadOnly,
              })
            }
          />
        </>
      ) : (
        <ReadProblem status={result.status} reset={path} />
      )}
    </CommunityPage>
  );
}
