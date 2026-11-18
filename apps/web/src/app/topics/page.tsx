import {
  CommunityPage,
  Pager,
  ReadProblem,
  TopicCard,
} from '../../components/community/views';
import { readCommunity } from '../../lib/community-read';
import { queryPath, type Page, type Topic } from '../../lib/community-types';

export const dynamic = 'force-dynamic';

export default async function Topics({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { cursor } = await searchParams;
  const result =
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<Topic>>(queryPath('/api/topics', { cursor }));
  return (
    <CommunityPage page="topics" title="Topic">
      <form className="community-search" action="/search">
        <label htmlFor="topic-search">搜索帖子</label>
        <div className="community-actions">
          <input
            id="topic-search"
            name="q"
            required
            maxLength={120}
            type="search"
          />
          <button className="community-button" type="submit">
            搜索
          </button>
        </div>
      </form>
      {result.status === 'ok' ? (
        <>
          {result.data.items.length ? (
            <div className="topic-grid">
              {result.data.items.map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          ) : (
            <p className="community-message">暂无公开 Topic。</p>
          )}
          <Pager
            first={cursor ? '/topics' : undefined}
            next={
              result.data.nextCursor &&
              queryPath('/topics', { cursor: result.data.nextCursor })
            }
          />
        </>
      ) : (
        <ReadProblem status={result.status} reset="/topics" />
      )}
    </CommunityPage>
  );
}
