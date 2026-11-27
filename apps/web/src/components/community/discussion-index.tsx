import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Post } from '../../lib/community-types';
import { DiscussionIndexDisclosure } from './discussion-index-disclosure';

export interface IndexSection {
  title: string;
  posts: readonly Post[];
  prefix?: string;
}

export function postAnchor(id: string, prefix = 'post') {
  return `${prefix}-${id}`;
}

function postLabel(post: Post) {
  const firstLine = post.bodyMd.split('\n').find((line) => line.trim());
  const label = firstLine?.trim().replace(/^(?:#{1,6}\s+|>\s*|[-*]\s+)/, '');
  if (!label) return `@${post.author.handle}`;
  const chars = Array.from(label);
  return chars.length > 54 ? chars.slice(0, 54).join('') + '…' : label;
}

export function IndexedDiscussion({
  title,
  sections,
  first,
  next,
  children,
}: {
  title: string;
  sections: IndexSection[];
  first?: string;
  next?: string | null;
  children: ReactNode;
}) {
  const available = sections.filter(({ posts }) => posts.length > 0);
  if (!available.length && !first && !next) return children;
  return (
    <div className="indexed-discussion">
      <aside className="discussion-index" aria-label={title}>
        <DiscussionIndexDisclosure title={title}>
          <nav tabIndex={0} aria-label="跳转到本页内容">
            {available.map(({ title: label, posts, prefix }) => (
              <section key={label} aria-label={label}>
                <h2>{label}</h2>
                <ol>
                  {posts.map((post) => (
                    <li key={post.id}>
                      <a href={`#${postAnchor(post.id, prefix)}`}>
                        {postLabel(post)}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </nav>
          {(first || next) && (
            <div className="index-pagination">
              {first && (
                <Link href={`${first}#discussion-index`}>索引第一页</Link>
              )}
              {next && (
                <Link href={`${next}#discussion-index`}>索引下一页</Link>
              )}
            </div>
          )}
        </DiscussionIndexDisclosure>
      </aside>
      <div className="indexed-discussion-body">{children}</div>
    </div>
  );
}
