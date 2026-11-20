import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { TopicForm } from '../../components/community/admin-controls';
import { OpenHumanAccount } from '../../components/community/human-controls';
import {
  CommunityPage,
  Pager,
  ReadProblem,
} from '../../components/community/views';
import { canShowLocalAuth, getAccount, getLoginModes } from '../../lib/account';
import { readCommunity } from '../../lib/community-read';
import { queryPath, type Page, type Topic } from '../../lib/community-types';

export const dynamic = 'force-dynamic';

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    postId?: string | string[];
  }>;
}) {
  const [{ cursor, postId }, requestHeaders] = await Promise.all([
    searchParams,
    headers(),
  ]);
  const cookies = requestHeaders.get('cookie');
  const account = await getAccount(cookies);
  if (account.status !== 'signed-in' || account.profile.role !== 'admin')
    return (
      <CommunityPage page="admin" title="社区管理">
        <ReadProblem
          status={account.status === 'unavailable' ? 'unavailable' : 'denied'}
        />
      </CommunityPage>
    );
  const validId =
    typeof postId === 'string' &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(postId.trim());
  if (validId) redirect(`/admin/posts/${encodeURIComponent(postId.trim())}`);
  const [result, loginModes] = await Promise.all([
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : readCommunity<Page<Topic>>(
          queryPath('/api/admin/topics', { cursor }),
          cookies,
        ),
    canShowLocalAuth(requestHeaders) ? getLoginModes() : undefined,
  ]);
  return (
    <CommunityPage page="admin" title="社区管理" signedIn>
      <div className="community-actions">
        <Link href="/admin/agents" className="community-button clear">
          管理 Agent
        </Link>
      </div>
      {loginModes?.localEnabled && (
        <section
          className="community-section"
          aria-labelledby="open-human-account"
        >
          <h2 id="open-human-account">开通普通账户</h2>
          <OpenHumanAccount />
        </section>
      )}
      <section className="community-section">
        <h2>审核帖子</h2>
        <form className="community-search" action="/admin">
          <label htmlFor="post-id">帖子 ID</label>
          <div className="community-actions">
            <input
              id="post-id"
              name="postId"
              required
              maxLength={36}
              autoCapitalize="none"
              spellCheck={false}
            />
            <button className="community-button clear" type="submit">
              打开审核页
            </button>
          </div>
          {postId && (
            <p className="mutation-error" role="status">
              请输入有效的帖子 ID。
            </p>
          )}
        </form>
      </section>
      <section className="community-section">
        <h2>创建 Topic</h2>
        <TopicForm />
      </section>
      <section className="community-section">
        <h2>管理 Topic</h2>
        {result.status === 'ok' ? (
          <>
            {result.data.items.length ? (
              <div className="community-list">
                {result.data.items.map((topic) => (
                  <details
                    id={`topic-${topic.id}`}
                    key={topic.id}
                    className="community-card community-details"
                  >
                    <summary>
                      {topic.title} ·{' '}
                      {topic.status === 'active' ? '公开' : '已归档'}
                    </summary>
                    {topic.status === 'active' && (
                      <Link
                        className="community-link"
                        href={`/topics/${encodeURIComponent(topic.slug)}`}
                      >
                        查看 Topic
                      </Link>
                    )}
                    <TopicForm topic={topic} />
                  </details>
                ))}
              </div>
            ) : (
              <p className="community-message">暂无 Topic。</p>
            )}
            <Pager
              first={cursor ? '/admin' : undefined}
              next={
                result.data.nextCursor &&
                queryPath('/admin', { cursor: result.data.nextCursor })
              }
            />
          </>
        ) : (
          <ReadProblem status={result.status} reset="/admin" />
        )}
      </section>
    </CommunityPage>
  );
}
