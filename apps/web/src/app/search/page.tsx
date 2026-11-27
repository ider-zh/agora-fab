import Link from 'next/link';
import {
  PostSearchForm,
  type PostSearchScope,
} from '../../components/community/post-search';
import {
  CommunityPage,
  Pager,
  PostCard,
  ReadProblem,
} from '../../components/community/views';
import { readCommunity } from '../../lib/community-read';
import { queryPath, type Page, type Post } from '../../lib/community-types';
import { requireContentAccount } from '../../lib/content-account';

export const dynamic = 'force-dynamic';

const topicPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const threadPattern =
  /^(?:~[A-Za-z0-9_-]{22}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
const searchKeys = ['q', 'topic', 'thread', 'cursor'];

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { cookies }] = await Promise.all([
    searchParams,
    requireContentAccount(),
  ]);
  const { q: raw, cursor, topic, thread } = params;
  const q = typeof raw === 'string' ? raw.trim() : '';
  const validTopic =
    typeof topic === 'string' &&
    topic.length <= 100 &&
    topicPattern.test(topic);
  const validThread = typeof thread === 'string' && threadPattern.test(thread);
  const invalidScope =
    (topic !== undefined && !validTopic) ||
    (thread !== undefined && !validThread) ||
    (topic !== undefined && thread !== undefined);
  const scope: PostSearchScope | undefined =
    !invalidScope && validTopic
      ? { kind: 'topic', value: topic }
      : !invalidScope && validThread
        ? { kind: 'thread', value: thread }
        : undefined;
  const scopeQuery = scope ? { [scope.kind]: scope.value } : {};
  const search = { q, ...scopeQuery };
  const first = queryPath('/search', search);
  const validQuery = q.length <= 120 && !q.includes('\u0000');
  const retry = validQuery ? first : queryPath('/search', scopeQuery);
  const invalid =
    invalidScope ||
    Object.keys(params).some((key) => !searchKeys.includes(key)) ||
    Array.isArray(raw) ||
    !validQuery ||
    (cursor !== undefined && (typeof cursor !== 'string' || !cursor || !q));
  const result = invalid
    ? { status: 'invalid' as const }
    : q
      ? await readCommunity<Page<Post>>(
          queryPath('/api/search', {
            ...search,
            cursor: typeof cursor === 'string' ? cursor : undefined,
          }),
          cookies,
        )
      : undefined;
  const backPath = scope?.kind === 'thread' ? '/posts' : '/topics';

  return (
    <CommunityPage page="search" title="搜索帖子" signedIn>
      <PostSearchForm id="query" query={q.slice(0, 120)} scope={scope} />
      {scope && (
        <nav className="post-search-options" aria-label="搜索范围">
          <Link
            className="community-button clear"
            href={`${backPath}/${encodeURIComponent(scope.value)}`}
          >
            {scope.kind === 'topic' ? '返回此 Topic' : '返回此讨论串'}
          </Link>
          <Link
            className="community-button clear"
            href={queryPath('/search', { q })}
          >
            改为全站搜索
          </Link>
        </nav>
      )}
      {result?.status === 'ok' && (
        <section className="community-section">
          <h2>搜索结果</h2>
          {result.data.items.length ? (
            <div className="community-list">
              {result.data.items.map((post) => (
                <PostCard key={post.id} post={post} topicLink />
              ))}
            </div>
          ) : (
            <p className="community-message">没有匹配的帖子。</p>
          )}
          <Pager
            first={cursor ? first : undefined}
            next={
              result.data.nextCursor &&
              queryPath('/search', {
                ...search,
                cursor: result.data.nextCursor,
              })
            }
          />
        </section>
      )}
      {result && result.status !== 'ok' && (
        <ReadProblem status={result.status} reset={retry} />
      )}
    </CommunityPage>
  );
}
