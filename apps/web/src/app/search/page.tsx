import Link from 'next/link';
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

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; cursor?: string | string[] }>;
}) {
  const [{ q: raw, cursor }, { cookies }] = await Promise.all([
    searchParams,
    requireContentAccount(),
  ]);
  const q = typeof raw === 'string' ? raw.trim() : '';
  const result = !q
    ? undefined
    : q.length > 120 || typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<Post>>(
          queryPath('/api/search', { q, cursor }),
          cookies,
        );
  return (
    <CommunityPage page="topics" title="搜索帖子" signedIn>
      <Link className="community-link" href="/topics">
        全部 Topic
      </Link>
      <form className="community-search" action="/search">
        <label htmlFor="query">关键词</label>
        <div className="community-actions">
          <input
            id="query"
            name="q"
            type="search"
            defaultValue={q.slice(0, 120)}
            required
            maxLength={120}
          />
          <button className="community-button" type="submit">
            搜索
          </button>
        </div>
      </form>
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
            first={cursor ? queryPath('/search', { q }) : undefined}
            next={
              result.data.nextCursor &&
              queryPath('/search', { q, cursor: result.data.nextCursor })
            }
          />
        </section>
      )}
      {result && result.status !== 'ok' && (
        <ReadProblem status={result.status} reset="/search" />
      )}
    </CommunityPage>
  );
}
