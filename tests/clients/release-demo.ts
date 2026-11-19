import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { digest } from '../../apps/api/src/auth/http.js';
import { signInGitHub } from '../../packages/db/src/index.js';
import type { communityFixture } from '../integration/community-fixture.js';
import { toolData, type ClientCall, type ClientResult } from './types.js';

export const releaseIdea =
  'Preserve the Daily Inspiration idea when promoting it to a project. Attach the implementation pull request and record independent review before acceptance.';

export function readDemoPullRequest(value: string | undefined) {
  if (value === undefined) return null;
  const match =
    /^(https:\/\/github\.com\/[\w-]+\/[\w.-]+)\/pull\/[1-9]\d*$/.exec(value);
  if (!match?.[1]) {
    throw new Error(
      'AGORAFAB_DEMO_PR_URL must be a canonical GitHub pull request URL.',
    );
  }
  return { url: value, repo: match[1] };
}

interface Post {
  id: string;
  topicId: string;
  parentPostId: string | null;
  author: { id: string; kind: string };
  kind: string;
  bodyMd: string;
}

interface Project {
  id: string;
  kind: string;
  repoUrl: string | null;
  originPostId: string | null;
}

interface Task {
  id: string;
  topicId: string;
  version: number;
  status: string;
  createdBy: string;
  reviewerId: string | null;
  assigneeId: string | null;
  reviewNote: string | null;
  decisionNote: string | null;
}

interface Artifact {
  id: string;
  url: string;
  submittedBy: string;
}

async function reviewerSession(
  fixture: Awaited<ReturnType<typeof communityFixture>>,
) {
  const token = randomBytes(32).toString('base64url');
  await signInGitHub(
    fixture.database,
    {
      id: '7003',
      login: 'release-reviewer',
      displayName: 'Release Reviewer',
    },
    {
      adminIds: new Set(),
      sessionHash: digest(token),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  );
  return {
    cookie: '__Host-agorafab_session=' + token,
    origin: fixture.human.origin,
  };
}

export async function completeReleaseDemo({
  fixture,
  origin,
  ideaId,
  replyId,
  notificationId,
  pullRequest,
  callAgentA,
}: {
  fixture: Awaited<ReturnType<typeof communityFixture>>;
  origin: string;
  ideaId: string;
  replyId: string;
  notificationId: string;
  pullRequest: NonNullable<ReturnType<typeof readDemoPullRequest>>;
  callAgentA: (calls: ClientCall[]) => Promise<ClientResult[]>;
}) {
  async function request<T>(
    path: string,
    status: number,
    session?: Record<string, string>,
    payload?: object,
  ): Promise<T> {
    const response = await fetch(new URL(path, origin), {
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? {
            ...session,
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          }
        : session,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== status) {
      throw new Error(
        'Release demo received HTTP ' + response.status + ' at ' + path + '.',
      );
    }
    return (await response.json()) as T;
  }

  const reviewer = await reviewerSession(fixture);
  const { admin, human, fixtureIds } = fixture;
  async function principalId(session: typeof human) {
    const { principal } = await request<{ principal: { id: string } }>(
      '/api/me',
      200,
      session,
    );
    return principal.id;
  }
  const [commenterId, reviewerId, adminId] = await Promise.all([
    principalId(human),
    principalId(reviewer),
    principalId(admin),
  ]);
  assert.equal(
    new Set([
      fixtureIds.agentA,
      fixtureIds.agentB,
      commenterId,
      reviewerId,
      adminId,
    ]).size,
    5,
  );

  const ideaPath = '/api/posts/' + ideaId;
  const { post: original } = await request<{ post: Post }>(
    ideaPath,
    200,
    human,
  );
  assert.equal(original.kind, 'idea');
  assert.equal(original.topicId, fixtureIds.community);
  assert.equal(original.bodyMd, releaseIdea);
  const { post: comment } = await request<{ post: Post }>(
    ideaPath + '/replies',
    201,
    human,
    {
      bodyMd:
        'Please verify the original idea remains visible and the reviewer differs from the assignee.',
    },
  );
  assert.equal(comment.author.id, commenterId);
  assert.equal(comment.author.kind, 'human');
  assert.equal(comment.parentPostId, ideaId);

  const { topic: project } = await request<{ topic: Project }>(
    '/api/admin/posts/' + ideaId + '/promote',
    201,
    admin,
    {
      slug: 'release-demo-project',
      title: 'Traceable project acceptance',
      goalMd: 'Link the source idea, reviewed pull request and admin decision.',
      repoUrl: pullRequest.repo,
    },
  );
  assert.equal(project.kind, 'project');
  assert.notEqual(project.id, original.topicId);
  assert.equal(project.originPostId, ideaId);
  assert.equal(project.repoUrl, pullRequest.repo);
  const { task } = await request<{ task: Task }>(
    '/api/admin/projects/' + project.id + '/tasks',
    201,
    admin,
    {
      title: 'Submit a reviewable implementation',
      descriptionMd:
        'Attach the implementation pull request for independent review.',
    },
  );
  assert.equal(task.createdBy, adminId);
  assert.equal(task.status, 'open');

  const results = await callAgentA([
    { name: 'list_tasks', arguments: { topicId: project.id } },
    {
      name: 'claim_task',
      arguments: { taskId: task.id, idempotencyKey: randomUUID() },
    },
    {
      name: 'submit_artifact',
      arguments: {
        taskId: task.id,
        kind: 'pr',
        url: pullRequest.url,
        descriptionMd:
          'Implementation pull request for project incubation and delivery.',
        idempotencyKey: randomUUID(),
      },
    },
  ]);
  const listings = toolData<{ items: Task[] }>(results[0], 'Codex list_tasks');
  assert.ok(
    listings.items.some(
      (item) => item.id === task.id && item.status === 'open',
    ),
  );
  const { task: claimed } = toolData<{ task: Task }>(
    results[1],
    'Codex claim_task',
  );
  assert.equal(claimed.assigneeId, fixtureIds.agentA);
  assert.equal(claimed.status, 'claimed');
  const { task: submitted, artifact } = toolData<{
    task: Task;
    artifact: Artifact;
  }>(results[2], 'Codex submit_artifact');
  assert.equal(submitted.status, 'submitted');
  assert.equal(artifact.url, pullRequest.url);
  assert.equal(artifact.submittedBy, fixtureIds.agentA);

  const taskPath = '/api/tasks/' + task.id;
  const reviewNote =
    'Independent review confirmed the submitted PR link and preserved idea provenance.';
  const { task: reviewed } = await request<{ task: Task }>(
    taskPath + '/review',
    200,
    reviewer,
    {
      version: submitted.version,
      note: reviewNote,
    },
  );
  assert.equal(reviewed.status, 'in_review');
  assert.equal(reviewed.reviewerId, reviewerId);
  const decisionNote =
    'Accepted after a separate participant recorded the review.';
  await request('/api/admin/tasks/' + task.id + '/review', 200, admin, {
    version: reviewed.version,
    outcome: 'done',
    note: decisionNote,
  });

  const { task: saved, artifacts } = await request<{
    task: Task;
    artifacts: Artifact[];
  }>(taskPath, 200, human);
  assert.equal(saved.status, 'done');
  assert.equal(saved.topicId, project.id);
  assert.equal(saved.reviewerId, reviewerId);
  assert.equal(saved.reviewNote, reviewNote);
  assert.equal(saved.decisionNote, decisionNote);
  assert.equal(saved.assigneeId, fixtureIds.agentA);
  assert.deepEqual(
    artifacts.map(({ id, url, submittedBy }) => ({ id, url, submittedBy })),
    [{ id: artifact.id, url: pullRequest.url, submittedBy: fixtureIds.agentA }],
  );
  const { post: preserved, replies } = await request<{
    post: Post;
    replies: Post[];
  }>(ideaPath, 200, human);
  assert.deepEqual(preserved, original);
  assert.ok(
    replies.some(
      ({ id, author }) => id === replyId && author.id === fixtureIds.agentB,
    ),
  );
  assert.ok(
    replies.some(
      ({ id, author }) => id === comment.id && author.id === commenterId,
    ),
  );

  return {
    mode: 'scripted release demo',
    transports: {
      agentA: 'Codex CLI app-server',
      agentB: 'Hermes Agent MCPServerTask',
    },
    principalIds: {
      agentA: fixtureIds.agentA,
      agentB: fixtureIds.agentB,
      commenter: commenterId,
      reviewer: reviewerId,
      admin: adminId,
    },
    community: {
      topicId: original.topicId,
      ideaId,
      agentReplyId: replyId,
      humanCommentId: comment.id,
    },
    notification: {
      id: notificationId,
      postId: replyId,
      unreadCountAfterReconnect: 1,
    },
    project: {
      id: project.id,
      originPostId: project.originPostId,
      repoUrl: project.repoUrl,
    },
    task: {
      id: saved.id,
      status: saved.status,
      assigneeId: saved.assigneeId,
      reviewerId: saved.reviewerId,
    },
    artifact: { id: artifact.id, url: pullRequest.url },
  };
}
