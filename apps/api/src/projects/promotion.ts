import { auditEvents, posts, topics, type Database } from '@agorafab/db';
import { DomainError, requireAction, type AuthContext } from '@agorafab/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { newTopicInput } from '../community/input.js';
import { createCommunityReader } from '../community/read.js';
import { verifiedObject } from '../http-validation.js';
import { idempotent } from '../idempotency.js';
import { repositoryUrl } from './repository.js';

export function promotionInput(value: unknown) {
  const body = verifiedObject(value, [
    'slug',
    'title',
    'descriptionMd',
    'guidelinesMd',
    'goalMd',
    'repoUrl',
  ]);
  const { repoUrl, ...fields } = body;
  return {
    ...newTopicInput({ ...fields, kind: 'project' }),
    kind: 'project' as const,
    repoUrl: repoUrl == null ? null : repositoryUrl(repoUrl),
  };
}

export function createPromotionService(database: Database) {
  const reader = createCommunityReader(database);

  async function promote(
    auth: AuthContext | null,
    key: string,
    postId: string,
    input: ReturnType<typeof promotionInput>,
  ) {
    const actor = requireAction(auth, 'admin');
    const result = await idempotent(
      database,
      actor.id,
      'project.promote',
      key,
      { postId, ...input },
      async (tx) => {
        const [source] = await tx
          .select({
            topicId: posts.topicId,
            kind: posts.kind,
            ancestorIds: posts.ancestorIds,
          })
          .from(posts)
          .where(eq(posts.id, postId));
        if (!source)
          throw new DomainError(404, 'POST_NOT_FOUND', 'Post not found.');
        const [sourceTopic] = await tx
          .select({ id: topics.id, kind: topics.kind })
          .from(topics)
          .where(
            and(eq(topics.id, source.topicId), eq(topics.status, 'active')),
          )
          .for('share');
        if (!sourceTopic)
          throw new DomainError(404, 'POST_NOT_FOUND', 'Post not found.');
        const branch = [...source.ancestorIds, postId];
        const ancestors = await tx
          .select({ hiddenAt: posts.hiddenAt })
          .from(posts)
          .where(
            and(eq(posts.topicId, source.topicId), inArray(posts.id, branch)),
          )
          .orderBy(posts.id)
          .for('share');
        if (
          ancestors.length !== branch.length ||
          ancestors.some((post) => post.hiddenAt)
        )
          throw new DomainError(404, 'POST_NOT_FOUND', 'Post not found.');
        if (source.kind !== 'idea' || sourceTopic.kind !== 'community')
          throw new DomainError(
            422,
            'IDEA_REQUIRED',
            'Promote a visible idea in a Community Topic.',
          );

        const [project] = await tx
          .insert(topics)
          .values({ ...input, originPostId: postId, createdBy: actor.id })
          .onConflictDoNothing({ target: topics.slug })
          .returning({ id: topics.id });
        if (!project)
          throw new DomainError(
            409,
            'TOPIC_SLUG_IN_USE',
            'This Topic URL is already in use.',
          );
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'project.promote',
          targetType: 'topic',
          targetId: project.id,
          metadataJson: {
            originPostId: postId,
            sourceTopicId: source.topicId,
          },
        });
        return { stored: { topicId: project.id } };
      },
    );
    return {
      topic: await reader.getTopic(result.response.topicId, true),
      replay: result.replay,
    };
  }

  return { promote };
}
