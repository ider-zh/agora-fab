import {
  artifactKinds,
  artifacts,
  auditEvents,
  posts,
  tasks,
  taskStatuses,
  topics,
  type Database,
} from '@agorafab/db';
import { DomainError, requireAction, type AuthContext } from '@agorafab/domain';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  cursorBoundary,
  cursorTimestamp,
  readCursor,
  slicePage,
  type ListPageOptions,
} from '../community/cursor.js';
import { createCommunityReader } from '../community/read.js';
import {
  idempotencyKey,
  invalidInput,
  requiredText,
  uuid,
  verifiedObject,
} from '../http-validation.js';
import { idempotent, type Transaction } from '../idempotency.js';

const taskColumns = {
  id: tasks.id,
  topicId: tasks.topicId,
  sourcePostId: tasks.sourcePostId,
  title: tasks.title,
  descriptionMd: tasks.descriptionMd,
  status: tasks.status,
  createdBy: tasks.createdBy,
  assigneeId: tasks.assigneeId,
  reviewerId: tasks.reviewerId,
  reviewNote: tasks.reviewNote,
  decisionNote: tasks.decisionNote,
  version: tasks.version,
  createdAt: cursorTimestamp(tasks.createdAt),
  updatedAt: cursorTimestamp(tasks.updatedAt),
};
const artifactColumns = {
  id: artifacts.id,
  taskId: artifacts.taskId,
  submittedBy: artifacts.submittedBy,
  url: artifacts.url,
  kind: artifacts.kind,
  descriptionMd: artifacts.descriptionMd,
  taskVersion: artifacts.taskVersion,
  createdAt: cursorTimestamp(artifacts.createdAt),
};

export type Task = Omit<
  typeof tasks.$inferSelect,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string;
  updatedAt: string;
};
export type Artifact = Omit<typeof artifacts.$inferSelect, 'createdAt'> & {
  createdAt: string;
};

type TaskStatus = (typeof taskStatuses)[number];
type ArtifactKind = (typeof artifactKinds)[number];
type TaskPermission = 'projects:write' | 'admin';
type Decision =
  'done' | 'changes_requested' | 'cancelled' | 'reopen' | 'approve';
type TaskEdit = { version: number; title?: string; descriptionMd?: string };
type TaskPatch = Partial<
  Pick<
    typeof tasks.$inferInsert,
    | 'title'
    | 'descriptionMd'
    | 'status'
    | 'assigneeId'
    | 'reviewerId'
    | 'reviewNote'
    | 'decisionNote'
  >
>;

export interface ArtifactSubmission {
  url: string;
  kind: ArtifactKind;
  descriptionMd: string;
}

function markdown(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 4_000 ||
    value.includes('\u0000')
  )
    invalidInput();
  return value.trim();
}

function positiveVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value >= 2_147_483_647)
    invalidInput();
  return value;
}

function invalidUrl(): never {
  throw new DomainError(
    422,
    'INVALID_ARTIFACT_URL',
    'Use an HTTPS URL without credentials, a query or fragment.',
  );
}

export function submitArtifactInput(value: unknown): ArtifactSubmission {
  const body = verifiedObject(value, ['url', 'kind', 'descriptionMd']);
  const raw = requiredText(body.url, 2_048);
  const kind = body.kind ?? 'other';
  if (typeof kind !== 'string' || !artifactKinds.includes(kind as ArtifactKind))
    invalidInput();
  // Reject before parsing so an empty userinfo, query or fragment cannot be
  // silently normalized away. Artifact links are displayed, never fetched.
  if (!/^https:\/\/[^/@]+/i.test(raw) || /[?#\s\\\p{Cc}]/u.test(raw))
    invalidUrl();
  const authority = raw.slice('https://'.length).split('/', 1)[0];
  if (!authority || authority.includes('@')) invalidUrl();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalidUrl();
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href.length > 2_048
  )
    invalidUrl();
  if (
    kind === 'pr' &&
    (url.hostname !== 'github.com' ||
      url.port ||
      url.pathname !== raw.slice('https://'.length + authority.length) ||
      !/^\/[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d_.-]{1,100}\/pull\/[1-9]\d{0,19}$/i.test(
        url.pathname,
      ))
  ) {
    throw new DomainError(
      422,
      'INVALID_PR_URL',
      'Use a GitHub pull request URL ending in /pull/<number>.',
    );
  }
  return {
    url: url.href,
    kind: kind as ArtifactKind,
    descriptionMd: markdown(body.descriptionMd ?? ''),
  };
}

const activeProject = and(
  eq(topics.kind, 'project'),
  eq(topics.status, 'active'),
);
const emptyReview = { reviewerId: null, reviewNote: null, decisionNote: null };

function missingProject(): never {
  throw new DomainError(404, 'PROJECT_NOT_FOUND', 'Project Topic not found.');
}

function missingTask(): never {
  throw new DomainError(404, 'TASK_NOT_FOUND', 'Task not found.');
}

function stateConflict(message: string): never {
  throw new DomainError(409, 'TASK_STATE_CONFLICT', message);
}

function versionConflict(): never {
  throw new DomainError(
    409,
    'TASK_VERSION_CONFLICT',
    'The task changed. Reload it and try again.',
  );
}

function requireVersion(task: Task, expected: number) {
  if (task.version !== expected) versionConflict();
}

function requireState(task: Task, status: TaskStatus) {
  if (task.status !== status)
    stateConflict('This transition is unavailable in the current task state.');
}

function requireDifferentReviewer(task: Task, actorId: string) {
  if (actorId === task.assigneeId) {
    throw new DomainError(
      403,
      'SELF_REVIEW_FORBIDDEN',
      'The assignee cannot review or accept their own submission.',
    );
  }
}

async function lockProject(tx: Transaction, topicId: string) {
  const [project] = await tx
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), activeProject))
    .for('share');
  if (!project) missingProject();
}

async function lockTask(
  tx: Transaction,
  taskId: string,
  topicId: string,
): Promise<Task> {
  await lockProject(tx, topicId);
  const [task] = await tx
    .select(taskColumns)
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.topicId, topicId)))
    .for('update');
  if (!task) missingTask();
  return task;
}

async function lockVisibleSource(
  tx: Transaction,
  sourcePostId: string,
  topicId: string,
) {
  function hiddenSource(): never {
    throw new DomainError(
      404,
      'SOURCE_POST_NOT_FOUND',
      'Visible source post not found in this Project Topic.',
    );
  }
  const [source] = await tx
    .select({ ancestorIds: posts.ancestorIds })
    .from(posts)
    .where(and(eq(posts.id, sourcePostId), eq(posts.topicId, topicId)));
  if (!source) hiddenSource();
  const ids = [sourcePostId, ...source.ancestorIds];
  const branch = await tx
    .select({ hiddenAt: posts.hiddenAt })
    .from(posts)
    .where(and(eq(posts.topicId, topicId), inArray(posts.id, ids)))
    .orderBy(asc(posts.id))
    .for('share');
  if (
    branch.length !== ids.length ||
    branch.some(({ hiddenAt }) => hiddenAt !== null)
  )
    hiddenSource();
}

async function updateTask(
  tx: Transaction,
  current: Task,
  patch: TaskPatch,
): Promise<Task> {
  if (current.version >= 2_147_483_647)
    stateConflict('This task reached its version limit.');
  const [task] = await tx
    .update(tasks)
    .set({ ...patch, version: current.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.id, current.id),
        eq(tasks.version, current.version),
        eq(tasks.status, current.status),
      ),
    )
    .returning(taskColumns);
  if (!task) versionConflict();
  return task;
}

async function recordTransition(
  tx: Transaction,
  actorId: string,
  action: string,
  task: Task,
  previous: Task | null,
  details: Record<string, unknown> = {},
) {
  await tx.insert(auditEvents).values({
    actorId,
    action: `task.${action}`,
    targetType: 'task',
    targetId: task.id,
    metadataJson: {
      fromStatus: previous?.status ?? null,
      status: task.status,
      version: task.version,
      ...details,
    },
  });
}

function decisionChange(
  current: Task,
  actorId: string,
  outcome: Decision,
  note: string,
): { action: string; patch: TaskPatch } {
  switch (outcome) {
    case 'approve':
      requireState(current, 'proposed');
      return { action: 'approve', patch: { status: 'open' } };
    case 'done':
    case 'changes_requested':
      requireState(current, 'in_review');
      requireDifferentReviewer(current, actorId);
      return {
        action: outcome === 'done' ? 'accept' : 'request_changes',
        patch: { status: outcome, decisionNote: note },
      };
    case 'cancelled':
      if (current.status === 'done' || current.status === 'cancelled')
        stateConflict('Only an unfinished task can be cancelled.');
      return {
        action: 'cancel',
        patch: { status: 'cancelled', decisionNote: note },
      };
    case 'reopen':
      if (current.status !== 'done' && current.status !== 'cancelled')
        stateConflict('Only a completed or cancelled task can be reopened.');
      return {
        action: 'reopen',
        patch: { status: 'open', assigneeId: null, ...emptyReview },
      };
    default:
      return invalidInput();
  }
}

export function createTaskService(database: Database) {
  const reader = createCommunityReader(database);

  async function findTask(taskId: string): Promise<Task> {
    const [task] = await database.db
      .select(taskColumns)
      .from(tasks)
      .innerJoin(topics, eq(topics.id, tasks.topicId))
      .where(and(eq(tasks.id, taskId), activeProject));
    if (!task) missingTask();
    return task;
  }

  async function listTasks(
    topicIdOrSlug: string,
    options: ListPageOptions & { status?: string } = {},
  ) {
    const { status } = options;
    if (status !== undefined && !taskStatuses.includes(status as TaskStatus))
      invalidInput();
    const project = await reader.getTopic(topicIdOrSlug);
    if (project.kind !== 'project') missingProject();
    const scope = `tasks:${project.id}:${status ?? 'all'}`;
    const { position, limit } = readCursor(options, scope);
    const rows: Task[] = await database.db
      .select(taskColumns)
      .from(tasks)
      .innerJoin(topics, eq(topics.id, tasks.topicId))
      .where(
        and(
          activeProject,
          eq(tasks.topicId, project.id),
          status === undefined
            ? undefined
            : eq(tasks.status, status as TaskStatus),
          cursorBoundary(position, tasks.createdAt, tasks.id, 'desc'),
        ),
      )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit + 1);
    return slicePage(rows, limit, scope);
  }

  async function getTask(taskId: string, artifactPage: ListPageOptions = {}) {
    const id = uuid(taskId);
    const task = await findTask(id);
    const scope = `task_artifacts:${id}`;
    const { position, limit } = readCursor(artifactPage, scope, 50);
    const rows: Artifact[] = await database.db
      .select(artifactColumns)
      .from(artifacts)
      .innerJoin(tasks, eq(tasks.id, artifacts.taskId))
      .innerJoin(topics, eq(topics.id, tasks.topicId))
      .where(
        and(
          activeProject,
          eq(artifacts.taskId, id),
          cursorBoundary(position, artifacts.createdAt, artifacts.id, 'desc'),
        ),
      )
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
      .limit(limit + 1);
    const page = slicePage(rows, limit, scope);
    return {
      task,
      artifacts: page.items,
      artifactsNextCursor: page.nextCursor,
    };
  }

  async function mutate<T extends { task: Task }>(
    auth: AuthContext | null,
    permission: TaskPermission,
    operation: string,
    key: string,
    taskId: string,
    input: Record<string, unknown>,
    change: (tx: Transaction, current: Task, actorId: string) => Promise<T>,
  ) {
    const actor = requireAction(auth, permission);
    const { id, topicId } = await findTask(uuid(taskId));
    const { response, replay } = await idempotent(
      database,
      actor.id,
      `task.${operation}`,
      idempotencyKey(key),
      { taskId: id, ...input },
      async (tx) => {
        const current = await lockTask(tx, id, topicId);
        return { stored: await change(tx, current, actor.id) };
      },
    );
    return { ...response, replay };
  }

  async function create(
    auth: AuthContext | null,
    key: string,
    input: {
      topicId: string;
      sourcePostId?: string;
      title: string;
      descriptionMd: string;
      proposed: boolean;
    },
  ) {
    if (typeof input.proposed !== 'boolean') invalidInput();
    const actor = requireAction(
      auth,
      input.proposed ? 'projects:write' : 'admin',
    );
    const project = await reader.getTopic(input.topicId);
    if (project.kind !== 'project') missingProject();
    const data = {
      topicId: project.id,
      sourcePostId:
        input.sourcePostId === undefined ? null : uuid(input.sourcePostId),
      title: requiredText(input.title, 200),
      descriptionMd: markdown(input.descriptionMd),
      status: input.proposed ? ('proposed' as const) : ('open' as const),
    };
    const { response, replay } = await idempotent(
      database,
      actor.id,
      'task.create',
      idempotencyKey(key),
      data,
      async (tx) => {
        await lockProject(tx, project.id);
        if (data.sourcePostId)
          await lockVisibleSource(tx, data.sourcePostId, project.id);
        const [task] = await tx
          .insert(tasks)
          .values({ ...data, createdBy: actor.id })
          .returning(taskColumns);
        if (!task) throw new Error('Task insert failed.');
        await recordTransition(
          tx,
          actor.id,
          input.proposed ? 'propose' : 'create',
          task,
          null,
        );
        return { stored: { task } };
      },
    );
    return { task: response.task, replay };
  }

  function claim(auth: AuthContext | null, key: string, taskId: string) {
    return mutate(
      auth,
      'projects:write',
      'claim',
      key,
      taskId,
      {},
      async (tx, current, actorId) => {
        const reclaimed =
          current.status === 'changes_requested' &&
          current.assigneeId === actorId;
        if (!reclaimed && current.status !== 'open')
          stateConflict('This task cannot be claimed.');
        const task = await updateTask(tx, current, {
          status: 'claimed',
          assigneeId: actorId,
          ...emptyReview,
        });
        await recordTransition(
          tx,
          actorId,
          reclaimed ? 'reclaim' : 'claim',
          task,
          current,
        );
        return { task };
      },
    );
  }

  function submit(
    auth: AuthContext | null,
    key: string,
    taskId: string,
    input: ArtifactSubmission,
  ) {
    const submission = submitArtifactInput(input);
    return mutate(
      auth,
      'projects:write',
      'submit',
      key,
      taskId,
      { ...submission },
      async (tx, current, actorId) => {
        if (
          current.status !== 'claimed' &&
          current.status !== 'changes_requested'
        )
          stateConflict('This task is not accepting submissions.');
        if (current.assigneeId !== actorId)
          throw new DomainError(
            403,
            'NOT_TASK_ASSIGNEE',
            'Only the assignee can submit an artifact.',
          );
        const task = await updateTask(tx, current, {
          status: 'submitted',
          ...emptyReview,
        });
        const [artifact] = await tx
          .insert(artifacts)
          .values({
            ...submission,
            taskId: task.id,
            submittedBy: actorId,
            taskVersion: task.version,
          })
          .returning(artifactColumns);
        if (!artifact) throw new Error('Artifact insert failed.');
        await recordTransition(tx, actorId, 'submit', task, current, {
          artifactId: artifact.id,
        });
        return { task, artifact };
      },
    );
  }

  function review(
    auth: AuthContext | null,
    key: string,
    taskId: string,
    input: { version: number; note: string },
  ) {
    const data = {
      version: positiveVersion(input.version),
      note: requiredText(input.note, 4_000),
    };
    return mutate(
      auth,
      'projects:write',
      'review',
      key,
      taskId,
      data,
      async (tx, current, actorId) => {
        requireVersion(current, data.version);
        requireState(current, 'submitted');
        requireDifferentReviewer(current, actorId);
        const task = await updateTask(tx, current, {
          status: 'in_review',
          reviewerId: actorId,
          reviewNote: data.note,
        });
        await recordTransition(tx, actorId, 'review', task, current, {
          note: data.note,
        });
        return { task };
      },
    );
  }

  function decide(
    auth: AuthContext | null,
    key: string,
    taskId: string,
    input: { version: number; outcome: Decision; note: string },
  ) {
    const data = {
      version: positiveVersion(input.version),
      outcome: input.outcome,
      note: markdown(input.note),
    };
    return mutate(
      auth,
      'admin',
      'decide',
      key,
      taskId,
      data,
      async (tx, current, actorId) => {
        requireVersion(current, data.version);
        const { action, patch } = decisionChange(
          current,
          actorId,
          data.outcome,
          data.note,
        );
        const task = await updateTask(tx, current, patch);
        await recordTransition(tx, actorId, action, task, current, {
          note: data.note,
        });
        return { task };
      },
    );
  }

  async function edit(
    auth: AuthContext | null,
    taskId: string,
    input: TaskEdit,
  ) {
    const actor = requireAction(auth, 'admin');
    const version = positiveVersion(input.version);
    const patch = {
      ...(input.title === undefined
        ? {}
        : { title: requiredText(input.title, 200) }),
      ...(input.descriptionMd === undefined
        ? {}
        : { descriptionMd: markdown(input.descriptionMd) }),
    };
    if (!Object.keys(patch).length) invalidInput();
    const { id, topicId } = await findTask(uuid(taskId));
    return database.db.transaction(async (tx) => {
      const current = await lockTask(tx, id, topicId);
      requireVersion(current, version);
      const task = await updateTask(tx, current, patch);
      await recordTransition(tx, actor.id, 'edit', task, current, {
        fields: Object.keys(patch),
      });
      return task;
    });
  }

  return { listTasks, getTask, create, claim, submit, review, decide, edit };
}
