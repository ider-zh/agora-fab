import {
  CommunityPage,
  Pager,
  ReadProblem,
  TopicCard,
} from '../../components/community/views';
import { PostSearchForm } from '../../components/community/post-search';
import { readCommunity } from '../../lib/community-read';
import { queryPath, type Page, type Topic } from '../../lib/community-types';
import { requireContentAccount } from '../../lib/content-account';

export const dynamic = 'force-dynamic';

export default async function Topics({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const [{ cursor }, { cookies }] = await Promise.all([
    searchParams,
    requireContentAccount(),
  ]);
  const result =
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<Topic>>(
          queryPath('/api/topics', { cursor }),
          cookies,
        );
  return (
    <CommunityPage page="topics" title="Topic" signedIn>
      <PostSearchForm id="topic-search" />
      {result.status === 'ok' ? (
        <>
          {result.data.items.length ? (
            <div className="topic-grid">
              {result.data.items.map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          ) : (
            <p className="community-message">暂无 Topic。</p>
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
