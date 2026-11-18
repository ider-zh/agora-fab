import { notifications, posts, topics, type Database } from '@agorafab/db';
import { DomainError, requireAction, type AuthContext } from '@agorafab/domain';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  cursorBoundary,
  cursorTimestamp,
  readCursor,
  slicePage,
  type ListPageOptions,
} from './cursor.js';
import { publicPostVisibility } from './read.js';

export function createInbox(database: Database) {
  async function list(
    auth: AuthContext | null,
    options: ListPageOptions & { unread?: boolean },
  ) {
    const actor = requireAction(auth, 'notifications:read');
    const scope = `notifications:${actor.id}:${options.unread ? 'unread' : 'all'}`;
    const { limit, position } = readCursor(options, scope);
    const rows = await database.db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        postId: notifications.postId,
        topicSlug: topics.slug,
        createdAt: cursorTimestamp(notifications.createdAt),
        readAt: notifications.readAt,
      })
      .from(notifications)
      .innerJoin(posts, eq(posts.id, notifications.postId))
      .innerJoin(topics, eq(topics.id, posts.topicId))
      .where(
        and(
          eq(notifications.recipientId, actor.id),
          options.unread ? isNull(notifications.readAt) : undefined,
          eq(topics.status, 'active'),
          publicPostVisibility(),
          cursorBoundary(
            position,
            notifications.createdAt,
            notifications.id,
            'desc',
          ),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    return slicePage(rows, limit, scope);
  }

  async function acknowledge(auth: AuthContext | null, id: string) {
    const actor = requireAction(auth, 'notifications:write');
    const [row] = await database.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(
        and(
          eq(notifications.recipientId, actor.id),
          eq(notifications.id, id),
          sql`exists (
        select 1 from ${posts} inner join ${topics} on ${topics.id} = ${posts.topicId}
        where ${posts.id} = ${notifications.postId} and ${topics.status} = 'active' and ${publicPostVisibility()}
      )`,
        ),
      )
      .returning({ id: notifications.id });
    if (!row)
      throw new DomainError(
        404,
        'NOTIFICATION_NOT_FOUND',
        'Notification not found.',
      );
  }

  return { list, acknowledge };
}
