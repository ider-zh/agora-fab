import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JoinPrompt } from '../../../components/community/join-prompt';
import {
  IndexedDiscussion,
  postAnchor,
} from '../../../components/community/discussion-index';
import { Markdown } from '../../../components/community/markdown';
import { PostComposer } from '../../../components/community/mutations';
import { PostSearchForm } from '../../../components/community/post-search';
import { ProjectTasks } from '../../../components/community/project-tasks';
import {
  CommunityPage,
  Pager,
  PostCard,
  ReadProblem,
} from '../../../components/community/views';
import { requireContentAccount } from '../../../lib/content-account';
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
  searchParams: Promise<{
    cursor?: string | string[];
    taskCursor?: string | string[];
  }>;
}) {
  const [{ slug }, { cursor, taskCursor }, { cookies, profile }] =
    await Promise.all([params, searchParams, requireContentAccount()]);
  const ref = encodeURIComponent(slug);
  const path = `/topics/${ref}`;
  const apiPath = `/api${path}`;
  const [result, posts] = await Promise.all([
    readCommunity<{ topic: Topic; pinnedPosts?: Post[] }>(apiPath, cookies),
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : readCommunity<Page<Post>>(
          queryPath(`${apiPath}/posts`, { cursor }),
          cookies,
        ),
  ]);
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok')
    return (
      <CommunityPage page="topics" title="Topic" signedIn>
        <ReadProblem status={result.status} />
      </CommunityPage>
    );
  const { topic, pinnedPosts = [] } = result.data;
  const join = buildJoinPrompt(topic);
  const admin = profile.role === 'admin';
  const projectCursor = typeof taskCursor === 'string' ? taskCursor : undefined;
  const first = cursor
    ? queryPath(path, { taskCursor: projectCursor })
    : undefined;
  const next =
    posts.status === 'ok' && posts.data.nextCursor
      ? queryPath(path, {
          cursor: posts.data.nextCursor,
          taskCursor: projectCursor,
        })
      : undefined;
  const recentPosts = posts.status === 'ok' ? posts.data.items : [];
  return (
    <CommunityPage page="topics" title={topic.title} signedIn>
      <nav className="community-actions" aria-label="当前位置">
        <Link href="/topics">全部 Topic</Link>
        {admin && <Link href={`/admin#topic-${topic.id}`}>编辑此 Topic</Link>}
      </nav>
      <IndexedDiscussion
        title="帖子索引"
        sections={[
          { title: '置顶帖子', posts: pinnedPosts },
          { title: '本页讨论', posts: recentPosts, prefix: 'discussion' },
        ]}
        first={first}
        next={next}
      >
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
        {topic.kind === 'project' && (
          <ProjectTasks
            topic={topic}
            taskCursor={taskCursor}
            cursor={typeof cursor === 'string' ? cursor : undefined}
            admin={admin}
            cookies={cookies}
          />
        )}
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
        <details className="community-details community-section">
          <summary>撰写帖子</summary>
          <PostComposer path={`${path}/posts`} signedIn />
        </details>
        <section className="community-section">
          <h2>讨论</h2>
          <PostSearchForm
            id="scope-topic-search"
            scope={{ kind: 'topic', value: topic.slug }}
          />
          {posts.status === 'ok' ? (
            <>
              {posts.data.items.length ? (
                <div className="community-list">
                  {posts.data.items.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      admin={admin}
                      anchorId={postAnchor(post.id, 'discussion')}
                    />
                  ))}
                </div>
              ) : (
                <p className="community-message">暂无帖子。</p>
              )}
              <Pager first={first} next={next} />
            </>
          ) : (
            <ReadProblem status={posts.status} reset={path} />
          )}
        </section>
      </IndexedDiscussion>
    </CommunityPage>
  );
}
