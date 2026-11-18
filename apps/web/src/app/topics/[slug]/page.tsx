import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JoinPrompt } from '../../../components/community/join-prompt';
import { Markdown } from '../../../components/community/markdown';
import { PostComposer } from '../../../components/community/mutations';
import {
  CommunityPage,
  Pager,
  PostCard,
  ReadProblem,
} from '../../../components/community/views';
import { getAccount } from '../../../lib/account';
import { buildJoinPrompt } from '../../../lib/join-prompt';
import { readCommunity } from '../../../lib/community-read';
import {
  queryPath,
  type Page,
  type Post,
  type Topic,
} from '../../../lib/community-types';

export const dynamic = 'force-dynamic';

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const [{ slug }, { cursor }, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const ref = encodeURIComponent(slug);
  const path = `/topics/${ref}`;
  const apiPath = `/api${path}`;
  const [result, posts, account] = await Promise.all([
    readCommunity<{ topic: Topic; pinnedPosts?: Post[] }>(apiPath),
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : readCommunity<Page<Post>>(queryPath(`${apiPath}/posts`, { cursor })),
    getAccount(requestHeaders.get('cookie')),
  ]);
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok')
    return (
      <CommunityPage page="topics" title="Topic">
        <ReadProblem status={result.status} />
      </CommunityPage>
    );
  const { topic, pinnedPosts = [] } = result.data;
  const join = buildJoinPrompt(topic, {
    WEB_PUBLIC_ORIGIN: process.env.WEB_PUBLIC_ORIGIN,
    MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
  });
  const admin =
    account.status === 'signed-in' && account.profile.role === 'admin';
  return (
    <CommunityPage page="topics" title={topic.title}>
      <nav className="community-actions" aria-label="当前位置">
        <Link href="/topics">全部 Topic</Link>
        {admin && <Link href={`/admin#topic-${topic.id}`}>编辑此 Topic</Link>}
      </nav>
      <p className="community-meta">
        {topic.kind === 'project' ? '项目 Topic' : '社区 Topic'}
      </p>
      <Markdown>{topic.descriptionMd}</Markdown>
      {topic.goalMd && (
        <section className="community-section">
          <h2>项目目标</h2>
          <Markdown>{topic.goalMd}</Markdown>
        </section>
      )}
      {topic.guidelinesMd && (
        <section className="community-card community-section">
          <h2>讨论指南</h2>
          <Markdown>{topic.guidelinesMd}</Markdown>
        </section>
      )}
      {join && <JoinPrompt prompt={join} />}
      {pinnedPosts.length > 0 && (
        <section className="community-section">
          <h2>置顶帖子</h2>
          <div className="community-list">
            {pinnedPosts.map((post) => (
              <PostCard key={post.id} post={post} admin={admin} />
            ))}
          </div>
        </section>
      )}
      <section className="community-section">
        <h2>发布帖子</h2>
        <PostComposer
          path={`${path}/posts`}
          signedIn={account.status === 'signed-in'}
        />
      </section>
      <section className="community-section">
        <h2>讨论</h2>
        {posts.status === 'ok' ? (
          <>
            {posts.data.items.length ? (
              <div className="community-list">
                {posts.data.items.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    admin={admin}
                    domId={false}
                  />
                ))}
              </div>
            ) : (
              <p className="community-message">暂无帖子。</p>
            )}
            <Pager
              first={cursor ? path : undefined}
              next={
                posts.data.nextCursor &&
                queryPath(path, { cursor: posts.data.nextCursor })
              }
            />
          </>
        ) : (
          <ReadProblem status={posts.status} reset={path} />
        )}
      </section>
    </CommunityPage>
  );
}
