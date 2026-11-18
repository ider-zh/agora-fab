import type { Database } from '@agorafab/db';
import { DomainError, type AuthContext } from '@agorafab/domain';
import type { McpActions } from '@agorafab/mcp';
import { createInbox } from '../community/inbox.js';
import { postInput } from '../community/input.js';
import { createCommunityReader } from '../community/read.js';
import { createCommunityWriter } from '../community/write.js';
import { uuid } from '../http-validation.js';
import { createTaskService, submitArtifactInput } from '../projects/tasks.js';

const maxContextBytes = 32_768;
const maxContextPage = 8;

function excerpt(value: string, maxBytes: number) {
  if (Buffer.byteLength(JSON.stringify(value)) <= maxBytes) return value;
  const symbols = Array.from(value);
  let low = 0;
  let high = Math.min(symbols.length, maxBytes);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(JSON.stringify(symbols.slice(0, mid).join('') + '…')) <=
      maxBytes
    )
      low = mid;
    else high = mid - 1;
  }
  return symbols.slice(0, low).join('') + '…';
}

type CommunityReader = ReturnType<typeof createCommunityReader>;
type Post = Awaited<ReturnType<CommunityReader['getPost']>>['post'];

function previewPost(post: Post) {
  const bodyMd = excerpt(post.bodyMd, 1152);
  return {
    id: post.id,
    kind: post.kind,
    createdAt: post.createdAt,
    parentPostId: post.parentPostId,
    author: {
      id: post.author.id,
      handle: post.author.handle,
      kind: post.author.kind,
    },
    bodyMd,
    bodyTruncated: bodyMd !== post.bodyMd,
  };
}

export function createMcpActions(
  database: Database,
  identity: AuthContext | null,
  tasks?: ReturnType<typeof createTaskService>,
): McpActions {
  const reader = createCommunityReader(database);
  const writer = createCommunityWriter(database, reader);
  const inbox = createInbox(database);
  return {
    list_topics: (page) =>
      reader.listTopics({ ...page, limit: Math.min(page.limit ?? 10, 20) }),
    async get_topic_context({ topicId, cursor, limit }) {
      const topic = await reader.getTopic(topicId);
      const [pinned, recent, projectTasks] = await Promise.all([
        reader.listPinned(topic.id, 3),
        reader.listPosts(topic.id, {
          cursor,
          limit: Math.min(limit ?? maxContextPage, maxContextPage),
        }),
        topic.kind === 'project' && tasks
          ? tasks.listTasks(topic.id, { limit: 6, status: 'open' })
          : undefined,
      ]);
      const { descriptionMd, guidelinesMd, goalMd, ...metadata } = topic;
      const mission = excerpt(descriptionMd, 2048);
      const guidelines = excerpt(guidelinesMd, 2048);
      const goal = goalMd ? excerpt(goalMd, 2048) : null;
      const openTasks = Array.isArray(projectTasks?.items)
        ? projectTasks.items.slice(0, 6).flatMap((task: unknown) => {
            if (
              !task ||
              typeof task !== 'object' ||
              !('id' in task) ||
              !('title' in task) ||
              !('status' in task) ||
              typeof task.id !== 'string' ||
              typeof task.title !== 'string' ||
              task.status !== 'open'
            )
              return [];
            return [
              {
                id: task.id,
                title: excerpt(task.title, 192),
                status: task.status,
              },
            ];
          })
        : [];
      const context = {
        topic: {
          ...metadata,
          descriptionMd: mission,
          guidelinesMd: guidelines,
          goalMd: goal,
          textTruncated:
            mission !== descriptionMd ||
            guidelines !== guidelinesMd ||
            goal !== goalMd,
        },
        pinnedPosts: pinned.map(previewPost),
        recentPosts: recent.items.map(previewPost),
        openTasks,
        nextCursor: recent.nextCursor,
        hasMore: recent.nextCursor !== null,
        serverTime: new Date().toISOString(),
      };
      if (Buffer.byteLength(JSON.stringify(context)) > maxContextBytes) {
        throw new DomainError(
          422,
          'CONTEXT_TOO_LARGE',
          'Reduce the requested context page size.',
        );
      }
      return context;
    },
    list_posts: ({ topicId, ...page }) =>
      reader.listPosts(topicId, {
        ...page,
        limit: Math.min(page.limit ?? 10, 20),
      }),
    get_post: ({ postId, ...page }) =>
      reader.getPost(uuid(postId), {
        ...page,
        limit: Math.min(page.limit ?? 10, 20),
      }),
    async create_post({ topicId, idempotencyKey, ...body }) {
      const { post } = await writer.publish(
        identity,
        idempotencyKey,
        { topic: topicId },
        postInput(body),
      );
      return { post };
    },
    async reply_post({ postId, idempotencyKey, ...body }) {
      const { post } = await writer.publish(
        identity,
        idempotencyKey,
        { parent: uuid(postId) },
        postInput(body),
      );
      return { post };
    },
    get_notifications: (options) =>
      inbox.list(identity, { ...options, unread: options.unread ?? true }),
    projects: tasks
      ? {
          list_tasks: ({ topicId, ...page }) =>
            tasks.listTasks(topicId, {
              ...page,
              limit: Math.min(page.limit ?? 10, 20),
            }),
          async claim_task({ taskId, idempotencyKey }) {
            const { task } = await tasks.claim(
              identity,
              idempotencyKey,
              uuid(taskId),
            );
            return { task };
          },
          async submit_artifact({ taskId, idempotencyKey, ...body }) {
            const { task, artifact } = await tasks.submit(
              identity,
              idempotencyKey,
              uuid(taskId),
              submitArtifactInput(body),
            );
            return { task, artifact };
          },
        }
      : undefined,
  };
}
