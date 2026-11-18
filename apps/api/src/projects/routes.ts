import type { Database } from '@agorafab/db';
import { requireAction } from '@agorafab/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IdentityService } from '../auth/identity.js';
import type { AuthorizeMutation } from '../traffic.js';
import type { ListPageOptions } from '../community/cursor.js';
import {
  idempotencyKey,
  invalidInput,
  requiredText,
  uuid,
  verifiedObject,
} from '../http-validation.js';
import { createPromotionService, promotionInput } from './promotion.js';
import { createTaskService, submitArtifactInput } from './tasks.js';

function markdown(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 4000 ||
    value.includes('\u0000')
  )
    invalidInput();
  return value.trim();
}

function version(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value >= 2_147_483_647
  )
    invalidInput();
  return value;
}

function key(request: FastifyRequest) {
  return idempotencyKey(request.headers['idempotency-key']);
}

type TaskParams = { Params: { id: string }; Querystring: ListPageOptions };
const outcomes = [
  'done',
  'changes_requested',
  'cancelled',
  'reopen',
  'approve',
] as const;
type Outcome = (typeof outcomes)[number];

export function registerProjectRoutes(
  app: FastifyInstance,
  database: Database,
  identity: IdentityService,
  tasks: ReturnType<typeof createTaskService>,
  authorize: AuthorizeMutation,
) {
  const { promote } = createPromotionService(database, authorize);

  app.post<TaskParams>(
    '/api/admin/posts/:id/promote',
    async (request, reply) => {
      const auth = await identity.authenticateMutation(request);
      requireAction(auth, 'admin');
      const { topic, replay } = await promote(
        auth,
        key(request),
        uuid(request.params.id),
        promotionInput(request.body),
      );
      return reply.code(replay ? 200 : 201).send({ topic });
    },
  );

  app.get<TaskParams>('/api/projects/:id/tasks', async (request) =>
    tasks.listTasks(request.params.id, request.query),
  );
  app.get<TaskParams>('/api/tasks/:id', async (request) =>
    tasks.getTask(uuid(request.params.id), request.query),
  );

  for (const proposed of [true, false]) {
    app.post<TaskParams>(
      `${proposed ? '/api' : '/api/admin'}/projects/:id/tasks`,
      async (request, reply) => {
        const auth = await identity.authenticateMutation(request);
        requireAction(auth, proposed ? 'projects:write' : 'admin');
        const body = verifiedObject(request.body, [
          'title',
          'descriptionMd',
          'sourcePostId',
        ]);
        const { task, replay } = await tasks.create(auth, key(request), {
          topicId: requiredText(request.params.id, 100),
          title: requiredText(body.title, 200),
          descriptionMd: markdown(body.descriptionMd ?? ''),
          ...(body.sourcePostId === undefined
            ? {}
            : { sourcePostId: uuid(body.sourcePostId) }),
          proposed,
        });
        return reply.code(replay ? 200 : 201).send({ task });
      },
    );
  }

  app.post<TaskParams>('/api/tasks/:id/claim', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'projects:write');
    verifiedObject(request.body ?? {}, []);
    const { task } = await tasks.claim(
      auth,
      key(request),
      uuid(request.params.id),
    );
    return reply.code(200).send({ task });
  });

  app.post<TaskParams>('/api/tasks/:id/artifacts', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'projects:write');
    const { task, artifact, replay } = await tasks.submit(
      auth,
      key(request),
      uuid(request.params.id),
      submitArtifactInput(request.body),
    );
    return reply.code(replay ? 200 : 201).send({ task, artifact });
  });

  app.post<TaskParams>('/api/tasks/:id/review', async (request) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'projects:write');
    const body = verifiedObject(request.body, ['version', 'note']);
    const { task } = await tasks.review(
      auth,
      key(request),
      uuid(request.params.id),
      { version: version(body.version), note: requiredText(body.note, 4000) },
    );
    return { task };
  });

  app.post<TaskParams>('/api/admin/tasks/:id/review', async (request) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'admin');
    const body = verifiedObject(request.body, ['version', 'outcome', 'note']);
    if (
      typeof body.outcome !== 'string' ||
      !outcomes.includes(body.outcome as Outcome)
    )
      invalidInput();
    const { task } = await tasks.decide(
      auth,
      key(request),
      uuid(request.params.id),
      {
        version: version(body.version),
        outcome: body.outcome as Outcome,
        note: markdown(body.note ?? ''),
      },
    );
    return { task };
  });

  app.patch<TaskParams>('/api/admin/tasks/:id', async (request) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'admin');
    const body = verifiedObject(request.body, [
      'version',
      'title',
      'descriptionMd',
    ]);
    if (body.title === undefined && body.descriptionMd === undefined)
      invalidInput();
    return {
      task: await tasks.edit(auth, uuid(request.params.id), {
        version: version(body.version),
        ...(body.title === undefined
          ? {}
          : { title: requiredText(body.title, 200) }),
        ...(body.descriptionMd === undefined
          ? {}
          : { descriptionMd: markdown(body.descriptionMd) }),
      }),
    };
  });
}
