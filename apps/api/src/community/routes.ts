import { type Database } from '@agorafab/db';
import { requireAction } from '@agorafab/domain';
import type { FastifyInstance } from 'fastify';
import type { IdentityService } from '../auth/identity.js';
import {
  idempotencyKey,
  invalidInput,
  requiredText,
  uuid,
  verifiedObject,
} from '../http-validation.js';
import type { ListPageOptions } from './cursor.js';
import { createInbox } from './inbox.js';
import { newTopicInput, postInput, topicPatch } from './input.js';
import { createCommunityReader } from './read.js';
import { createCommunityWriter } from './write.js';

type ReadParams = { Params: { id: string }; Querystring: ListPageOptions };

export function registerCommunityRoutes(
  app: FastifyInstance,
  database: Database,
  identity: IdentityService,
) {
  const reader = createCommunityReader(database);
  const writer = createCommunityWriter(database, reader);
  const inbox = createInbox(database);

  app.get<{ Querystring: ListPageOptions }>('/api/topics', async (request) =>
    reader.listTopics(request.query),
  );
  app.get<ReadParams>('/api/topics/:id', async (request) => {
    const topic = await reader.getTopic(request.params.id);
    return { topic, pinnedPosts: await reader.listPinned(topic.id) };
  });
  app.get<ReadParams>('/api/topics/:id/posts', async (request) =>
    reader.listPosts(request.params.id, request.query),
  );
  app.get<ReadParams>('/api/posts/:id', async (request) =>
    reader.getPost(uuid(request.params.id), request.query),
  );
  app.get<{ Querystring: ListPageOptions & { q: string } }>(
    '/api/search',
    async (request) => reader.search(request.query),
  );

  app.post<ReadParams>('/api/topics/:id/posts', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'community:write');
    const topic = requiredText(request.params.id, 100);
    const { post, replay } = await writer.publish(
      auth,
      idempotencyKey(request.headers['idempotency-key']),
      { topic },
      postInput(request.body),
    );
    return reply.code(replay ? 200 : 201).send({ post });
  });

  app.post<ReadParams>('/api/posts/:id/replies', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'community:write');
    const { post, replay } = await writer.publish(
      auth,
      idempotencyKey(request.headers['idempotency-key']),
      { parent: uuid(request.params.id) },
      postInput(request.body),
    );
    return reply.code(replay ? 200 : 201).send({ post });
  });

  app.get<{ Querystring: ListPageOptions & { unread?: string } }>(
    '/api/me/notifications',
    async (request) => {
      const { unread, ...page } = request.query;
      if (unread !== undefined && unread !== '0' && unread !== '1')
        invalidInput();
      return inbox.list(await identity.authenticate(request), {
        ...page,
        unread: unread === '1',
      });
    },
  );
  app.patch<ReadParams>('/api/me/notifications/:id', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'notifications:write');
    const body = verifiedObject(request.body, ['read']);
    if (body.read !== true) invalidInput();
    await inbox.acknowledge(auth, uuid(request.params.id));
    return reply.code(204).send();
  });

  app.get<{ Querystring: ListPageOptions }>(
    '/api/admin/topics',
    async (request) => {
      requireAction(await identity.authenticate(request), 'admin');
      return reader.listTopics(request.query, true);
    },
  );
  app.post('/api/admin/topics', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'admin');
    const { topic, replay } = await writer.createTopic(
      auth,
      idempotencyKey(request.headers['idempotency-key']),
      newTopicInput(request.body),
    );
    return reply.code(replay ? 200 : 201).send({ topic });
  });
  app.patch<ReadParams>('/api/admin/topics/:id', async (request) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'admin');
    return {
      topic: await writer.updateTopic(
        auth,
        uuid(request.params.id),
        topicPatch(request.body),
      ),
    };
  });
  app.get<ReadParams>('/api/admin/posts/:id', async (request) =>
    reader.getModeratedPost(
      uuid(request.params.id),
      await identity.authenticate(request),
    ),
  );
  for (const action of ['hide', 'restore', 'pin', 'unpin'] as const) {
    app.post<ReadParams>(
      `/api/admin/posts/:id/${action}`,
      async (request, reply) => {
        const auth = await identity.authenticateMutation(request);
        requireAction(auth, 'admin');
        const body = verifiedObject(request.body ?? {}, ['reason']);
        await writer.moderatePost(
          auth,
          uuid(request.params.id),
          action,
          body.reason === undefined
            ? undefined
            : requiredText(body.reason, 300),
        );
        return reply.code(204).send();
      },
    );
  }
}
