import {
  auditEvents,
  mentions,
  notifications,
  posts,
  principals,
  topics,
  type Database,
} from '@agorafab/db';
import { DomainError, requireAction, type AuthContext } from '@agorafab/domain';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { idempotent } from '../idempotency.js';
import type { AuthorizeMutation } from '../traffic.js';
import type { newTopicInput, PostInput, topicPatch } from './input.js';
import type { createCommunityReader } from './read.js';

function missingTopic() {
  return new DomainError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
}

function missingPost() {
  return new DomainError(404, 'POST_NOT_FOUND', 'Post not found.');
}

export function createCommunityWriter(
  database: Database,
  reader: ReturnType<typeof createCommunityReader>,
  authorize: AuthorizeMutation = requireAction,
) {
  async function publish(
    auth: AuthContext | null,
    key: string,
    target: { topic: string } | { parent: string },
    input: PostInput,
  ) {
    const actor = authorize(auth, 'community:write');
    const resolvedTarget =
      'topic' in target
        ? { topic: (await reader.getTopic(auth, target.topic)).id }
        : target;
    const result = await idempotent(
      database,
      actor.id,
      'community.post',
      key,
      { target: resolvedTarget, ...input },
      async (tx) => {
        const [parent] =
          'parent' in target
            ? await tx
                .select({
                  id: posts.id,
                  topicId: posts.topicId,
                  ancestorIds: posts.ancestorIds,
                })
                .from(posts)
                .where(eq(posts.id, target.parent))
            : [];
        if ('parent' in target && !parent) throw missingPost();
        const topicId =
          'topic' in resolvedTarget ? resolvedTarget.topic : parent?.topicId;
        if (!topicId) throw missingTopic();
        const [topic] = await tx
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.id, topicId), eq(topics.status, 'active')))
          .for('share');
        if (!topic) throw missingTopic();
        const ancestorIds = parent ? [...parent.ancestorIds, parent.id] : [];
        if (ancestorIds.length) {
          const ancestors = await tx
            .select({ id: posts.id, hiddenAt: posts.hiddenAt })
            .from(posts)
            .where(
              and(eq(posts.topicId, topic.id), inArray(posts.id, ancestorIds)),
            )
            .orderBy(posts.id)
            .for('share');
          if (
            ancestors.length !== ancestorIds.length ||
            ancestors.some((post) => post.hiddenAt)
          )
            throw missingPost();
        }
        if (ancestorIds.length > 8)
          throw new DomainError(
            422,
            'REPLY_DEPTH_LIMIT',
            'This thread has reached the reply depth limit.',
          );
        const [row] = await tx
          .insert(posts)
          .values({
            topicId: topic.id,
            parentPostId: parent?.id ?? null,
            ancestorIds,
            authorId: actor.id,
            kind: input.kind,
            bodyMd: input.bodyMd,
          })
          .returning({ id: posts.id });
        if (!row) throw new Error('Post insert failed.');
        const targets = input.mentions.length
          ? await tx
              .select({ id: principals.id })
              .from(principals)
              .where(
                and(
                  eq(principals.status, 'active'),
                  inArray(principals.handle, input.mentions),
                ),
              )
          : [];
        if (targets.length) {
          await tx.insert(mentions).values(
            targets.map(({ id }) => ({
              postId: row.id,
              targetPrincipalId: id,
            })),
          );
          await tx.insert(notifications).values(
            targets.map(({ id }) => ({
              postId: row.id,
              recipientId: id,
              kind: 'mention' as const,
            })),
          );
        }
        return { stored: { postId: row.id } };
      },
    );
    const { post } = await reader.getPost(auth, result.response.postId, {
      limit: 1,
    });
    return { post, replay: result.replay };
  }

  async function createTopic(
    auth: AuthContext | null,
    key: string,
    input: ReturnType<typeof newTopicInput>,
  ) {
    const actor = authorize(auth, 'admin');
    const result = await idempotent(
      database,
      actor.id,
      'topic.create',
      key,
      input,
      async (tx) => {
        const [row] = await tx
          .insert(topics)
          .values({ ...input, createdBy: actor.id })
          .onConflictDoNothing({ target: topics.slug })
          .returning({ id: topics.id });
        if (!row)
          throw new DomainError(
            409,
            'TOPIC_SLUG_IN_USE',
            'This Topic URL is already in use.',
          );
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'topic.create',
          targetType: 'topic',
          targetId: row.id,
        });
        return { stored: { topicId: row.id } };
      },
    );
    return {
      topic: await reader.getTopic(auth, result.response.topicId, true),
      replay: result.replay,
    };
  }

  async function updateTopic(
    auth: AuthContext | null,
    topicId: string,
    patch: ReturnType<typeof topicPatch>,
  ) {
    const actor = authorize(auth, 'admin');
    await database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(topics)
        .where(eq(topics.id, topicId))
        .for('update');
      if (!current) throw missingTopic();
      if ((patch.goalMd || patch.repoUrl != null) && current.kind !== 'project')
        throw new DomainError(
          422,
          'PROJECT_FIELDS_ONLY',
          'Goals and repositories belong to Project Topics.',
        );
      if (
        Object.entries(patch).every(
          ([key, value]) => current[key as keyof typeof patch] === value,
        )
      )
        return;
      await tx
        .update(topics)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(topics.id, topicId));
      const action =
        patch.status && patch.status !== current.status
          ? `topic.${patch.status === 'archived' ? 'archive' : 'restore'}`
          : 'topic.update';
      await tx.insert(auditEvents).values({
        actorId: actor.id,
        action,
        targetType: 'topic',
        targetId: topicId,
        metadataJson: { fields: Object.keys(patch) },
      });
    });
    return reader.getTopic(auth, topicId, true);
  }

  async function moderatePost(
    auth: AuthContext | null,
    postId: string,
    action: 'hide' | 'restore' | 'pin' | 'unpin',
    reason?: string,
  ) {
    const actor = authorize(auth, 'admin');
    await database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .for('update');
      if (!current) throw missingPost();
      const field =
        action === 'hide' || action === 'restore' ? 'hiddenAt' : 'pinnedAt';
      const set = action === 'hide' || action === 'pin';
      if (Boolean(current[field]) === set) return;
      if (action === 'pin' && (current.parentPostId || current.hiddenAt)) {
        throw new DomainError(
          422,
          'PIN_NOT_ALLOWED',
          'Pin a visible top-level post.',
        );
      }
      if (action === 'restore' && current.ancestorIds.length) {
        const [hiddenParent] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              inArray(posts.id, current.ancestorIds),
              isNotNull(posts.hiddenAt),
            ),
          )
          .limit(1);
        if (hiddenParent)
          throw new DomainError(
            409,
            'PARENT_HIDDEN',
            'Restore the hidden ancestor before restoring this post.',
          );
      }
      await tx
        .update(posts)
        .set({ [field]: set ? new Date() : null, updatedAt: new Date() })
        .where(eq(posts.id, postId));
      await tx.insert(auditEvents).values({
        actorId: actor.id,
        action: `post.${action}`,
        targetType: 'post',
        targetId: postId,
        metadataJson: reason ? { reason } : {},
      });
    });
  }

  return { publish, createTopic, updateTopic, moderatePost };
}
