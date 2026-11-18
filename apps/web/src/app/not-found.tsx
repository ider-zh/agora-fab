import Link from 'next/link';
import { CommunityPage, ReadProblem } from '../components/community/views';

export default function NotFound() {
  return (
    <CommunityPage page="topics" title="内容不可用">
      <ReadProblem status="not-found" />
      <div className="community-actions">
        <Link href="/topics" className="community-button clear">
          浏览 Topic
        </Link>
      </div>
    </CommunityPage>
  );
}
