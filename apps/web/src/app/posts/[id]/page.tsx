import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAccount } from '../../../lib/account';
import { readCommunity } from '../../../lib/community-read';
import { queryPath, type Post, type Topic } from '../../../lib/community-types';
import { PostComposer } from '../../../components/community/mutations';
import { PromoteIdea } from '../../../components/community/project-controls';
import {
  CommunityPage,
  Pager,
  PostCard,
  ReadProblem,
} from '../../../components/community/views';

export const dynamic = 'force-dynamic';

function ReplyList({
  posts,
  rootId,
  path,
  signedIn,
  admin,
}: {
  posts: Post[];
  rootId: string;
  path: string;
  signedIn: boolean;
  admin: boolean;
}) {
  const ids = new Set(posts.map((post) => post.id));
  const byParent = new Map<string, Post[]>();
  for (const post of posts) {
    const parentId =
      post.parentPostId && ids.has(post.parentPostId)
        ? post.parentPostId
        : rootId;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(post);
    byParent.set(parentId, siblings);
  }

  function list(parentId: string, depth = 1) {
    const children = byParent.get(parentId);
    if (!children?.length || depth > 8) return null;
    return (
      <ol
        className={
          depth === 1 ? 'reply-list community-list' : 'reply-list reply-nested'
        }
      >
        {children.map((post) => (
          <li key={post.id}>
            <PostCard post={post} admin={admin}>
              {depth === 1 &&
                post.parentPostId &&
                post.parentPostId !== rootId && (
                  <p className="community-meta">
                    回复于{' '}
                    <Link
                      href={`/posts/${encodeURIComponent(post.parentPostId)}`}
                    >
                      上一层帖子
                    </Link>
                  </p>
                )}
              {signedIn && (
                <details className="community-details">
                  <summary>回复 @{post.author.handle}</summary>
                  <PostComposer
                    path={`/posts/${encodeURIComponent(post.id)}/replies`}
                    reply
                    signedIn
                    returnTo={path}
                  />
                </details>
              )}
            </PostCard>
            {list(post.id, depth + 1)}
          </li>
        ))}
      </ol>
    );
  }
  return list(rootId);
}

export default async function Thread({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const [{ id }, { cursor }, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const path = `/posts/${encodeURIComponent(id)}`;
  const [result, account] = await Promise.all([
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : readCommunity<{
          post: Post;
          replies: Post[];
          nextCursor: string | null;
        }>(queryPath(`/api${path}`, { cursor })),
    getAccount(requestHeaders.get('cookie')),
  ]);
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok')
    return (
      <CommunityPage page="topics" title="讨论">
        <ReadProblem status={result.status} reset={path} />
      </CommunityPage>
    );
  const { post, replies, nextCursor } = result.data;
  const signedIn = account.status === 'signed-in';
  const admin = signedIn && account.profile.role === 'admin';
  const topic =
    admin && post.kind === 'idea'
      ? await readCommunity<{ topic: Topic }>(
          `/api/topics/${encodeURIComponent(post.topicId)}`,
        )
      : null;
  return (
    <CommunityPage page="topics" title="讨论">
      <nav className="community-actions" aria-label="当前位置">
        <Link href={`/topics/${encodeURIComponent(post.topicSlug)}`}>
          返回 Topic
        </Link>
        {post.parentPostId && (
          <Link href={`/posts/${encodeURIComponent(post.parentPostId)}`}>
            查看上层帖子
          </Link>
        )}
      </nav>
      <div className="community-section">
        <PostCard post={post} admin={admin} linkToThread={false} />
      </div>
      {topic?.status === 'ok' && topic.data.topic.kind === 'community' && (
        <PromoteIdea postId={post.id} />
      )}
      <section className="community-section">
        <h2>回复帖子</h2>
        <PostComposer
          path={`${path}/replies`}
          reply
          signedIn={signedIn}
          returnTo={path}
        />
      </section>
      <section className="community-section">
        <h2>回复</h2>
        {replies.length ? (
          <ReplyList
            posts={replies}
            rootId={post.id}
            path={path}
            signedIn={signedIn}
            admin={admin}
          />
        ) : (
          <p className="community-message">暂无回复。</p>
        )}
        <Pager
          first={cursor ? path : undefined}
          next={nextCursor && queryPath(path, { cursor: nextCursor })}
        />
      </section>
    </CommunityPage>
  );
}
