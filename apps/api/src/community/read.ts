import {
  auditEvents,
  posts,
  principals,
  topics,
  type Database,
} from '@agorafab/db';
import {
  DomainError,
  requireAction,
  requirePrincipal,
  type AuthContext,
} from '@agorafab/domain';
import { expandResourceId } from '@agorafab/mcp';
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { invalidInput, requiredText, uuid } from '../http-validation.js';
import {
  cursorBoundary,
  cursorTimestamp,
  readCursor,
  slicePage,
  type ListPageOptions,
} from './cursor.js';

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const cjkPattern =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const topicColumns = {
  id: topics.id,
  slug: topics.slug,
  kind: topics.kind,
  title: topics.title,
  descriptionMd: topics.descriptionMd,
  guidelinesMd: topics.guidelinesMd,
  goalMd: topics.goalMd,
  originPostId: topics.originPostId,
  repoUrl: topics.repoUrl,
  status: topics.status,
  createdAt: cursorTimestamp(topics.createdAt),
  updatedAt: cursorTimestamp(topics.updatedAt),
};

const postColumns = {
  id: posts.id,
  topicId: posts.topicId,
  topicSlug: topics.slug,
  parentPostId: posts.parentPostId,
  kind: posts.kind,
  bodyMd: posts.bodyMd,
  createdAt: cursorTimestamp(posts.createdAt),
  updatedAt: cursorTimestamp(posts.updatedAt),
  pinnedAt: sql<string | null>`${cursorTimestamp(posts.pinnedAt)}`,
  author: {
    id: principals.id,
    handle: principals.handle,
    displayName: principals.displayName,
    kind: principals.kind,
  },
};

/** Apply wherever public post content is exposed. The caller handles Topic status. */
export function publicPostVisibility() {
  return sql`${posts.hiddenAt} is null and not exists (
    select 1 from ${posts} as hidden_ancestor
      where hidden_ancestor.id = any(${posts.ancestorIds})
        and hidden_ancestor.hidden_at is not null
  )`;
}

function topicFilter(value: string) {
  if (uuidPattern.test(value)) {
    // UUID-shaped slugs are legitimate as well. An exact ID has priority.
    return or(eq(topics.id, value.toLowerCase()), eq(topics.slug, value));
  }
  if (!slugPattern.test(value)) invalidInput();
  return eq(topics.slug, value);
}

function postNotFound(): never {
  throw new DomainError(404, 'POST_NOT_FOUND', 'Post not found.');
}

export function createCommunityReader(database: Database) {
  const { db } = database;
  const activeTopic = eq(topics.status, 'active');

  function publicPosts() {
    return db
      .select(postColumns)
      .from(posts)
      .innerJoin(topics, eq(posts.topicId, topics.id))
      .innerJoin(principals, eq(posts.authorId, principals.id));
  }

  async function listTopics(
    auth: AuthContext | null,
    options: ListPageOptions = {},
    includeArchived = false,
  ) {
    if (includeArchived) requireAction(auth, 'admin');
    else requirePrincipal(auth);
    const scope = includeArchived ? 'topics:all' : 'topics:active';
    const { limit, position } = readCursor(options, scope);
    const rows = await db
      .select(topicColumns)
      .from(topics)
      .where(
        and(
          includeArchived ? undefined : activeTopic,
          cursorBoundary(position, topics.createdAt, topics.id, 'desc'),
        ),
      )
      .orderBy(desc(topics.createdAt), desc(topics.id))
      .limit(limit + 1);
    return slicePage(rows, limit, scope);
  }

  async function getTopic(
    auth: AuthContext | null,
    idOrSlug: string,
    includeArchived = false,
  ) {
    if (includeArchived) requireAction(auth, 'admin');
    else requirePrincipal(auth);
    const value = requiredText(idOrSlug, 100);
    const [topic] = await db
      .select(topicColumns)
      .from(topics)
      .where(and(topicFilter(value), includeArchived ? undefined : activeTopic))
      .orderBy(sql`(${topics.id}::text = ${value.toLowerCase()}) desc`)
      .limit(1);
    if (!topic)
      throw new DomainError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
    return topic;
  }

  async function listPosts(
    auth: AuthContext | null,
    topicIdOrSlug: string,
    options: ListPageOptions = {},
  ) {
    const topic = await getTopic(auth, topicIdOrSlug);
    const scope = `posts:${topic.id}`;
    const { limit, position } = readCursor(options, scope);
    const rows = await publicPosts()
      .where(
        and(
          activeTopic,
          eq(posts.topicId, topic.id),
          isNull(posts.parentPostId),
          publicPostVisibility(),
          cursorBoundary(position, posts.createdAt, posts.id, 'desc'),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    return slicePage(rows, limit, scope);
  }

  async function getPost(
    auth: AuthContext | null,
    postId: string,
    options: ListPageOptions = {},
  ) {
    requirePrincipal(auth);
    const id = uuid(expandResourceId(postId));
    const scope = `replies:${id}`;
    const { limit, position } = readCursor(options, scope);
    const [post] = await publicPosts().where(
      and(activeTopic, eq(posts.id, id), publicPostVisibility()),
    );
    if (!post) postNotFound();
    const rows = await publicPosts()
      .where(
        and(
          activeTopic,
          eq(posts.topicId, post.topicId),
          sql`${posts.ancestorIds} @> ARRAY[${post.id}::uuid]`,
          publicPostVisibility(),
          cursorBoundary(position, posts.createdAt, posts.id, 'asc'),
        ),
      )
      .orderBy(asc(posts.createdAt), asc(posts.id))
      .limit(limit + 1);
    const { items, nextCursor } = slicePage(rows, limit, scope);
    return { post, replies: items, nextCursor };
  }

  async function search(
    auth: AuthContext | null,
    { q, ...options }: ListPageOptions & { q: string },
  ) {
    requirePrincipal(auth);
    const query = requiredText(q, 120);
    const scope = `search:${query}`;
    const { limit, position } = readCursor(options, scope);
    const fullTextMatch = sql`to_tsvector('simple', ${posts.bodyMd}) @@ plainto_tsquery('simple', ${query})`;
    const match = cjkPattern.test(query)
      ? or(
          fullTextMatch,
          sql`strpos(lower(${posts.bodyMd}), lower(${query})) > 0`,
        )
      : fullTextMatch;
    const rows = await publicPosts()
      .where(
        and(
          activeTopic,
          publicPostVisibility(),
          match,
          cursorBoundary(position, posts.createdAt, posts.id, 'desc'),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    return slicePage(rows, limit, scope);
  }

  async function listPinned(
    auth: AuthContext | null,
    topicId: string,
    requestedLimit?: number,
  ) {
    requirePrincipal(auth);
    const id = uuid(topicId);
    const { limit } = readCursor({ limit: requestedLimit }, `pinned:${id}`, 5);
    return publicPosts()
      .where(
        and(
          activeTopic,
          eq(posts.topicId, id),
          isNotNull(posts.pinnedAt),
          publicPostVisibility(),
        ),
      )
      .orderBy(desc(posts.pinnedAt), desc(posts.id))
      .limit(limit);
  }

  async function getModeratedPost(postId: string, auth: AuthContext | null) {
    requireAction(auth, 'admin');
    const id = uuid(postId);
    const [post] = await db
      .select({
        ...postColumns,
        hiddenAt: sql<string | null>`${cursorTimestamp(posts.hiddenAt)}`,
      })
      .from(posts)
      .innerJoin(topics, eq(posts.topicId, topics.id))
      .innerJoin(principals, eq(posts.authorId, principals.id))
      .where(eq(posts.id, id));
    if (!post) postNotFound();
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetType, 'post'), eq(auditEvents.targetId, id)),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(100);
    return { post, events };
  }

  return {
    listTopics,
    getTopic,
    listPosts,
    getPost,
    search,
    listPinned,
    getModeratedPost,
  };
}
