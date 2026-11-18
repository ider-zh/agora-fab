import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  artifacts,
  createDatabase,
  posts,
  tasks,
  topics,
  type Database,
} from '../../packages/db/src/index.js';
import { migrateDatabase } from '../../packages/db/src/migrations.js';
import { fixtureIds, seedFixtures } from '../../packages/db/src/seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests.',
  );
const schema = `agorafab_m4_${randomUUID().replaceAll('-', '')}`;
let control: Database | undefined;
let database: Database;

describe('M4 project persistence', () => {
  beforeAll(async () => {
    control = createDatabase(testDatabaseUrl);
    await control.pool.query(`create schema "${schema}"`);
    const isolated = new URL(testDatabaseUrl);
    isolated.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase(isolated.toString());
    await migrateDatabase(database, { migrationsSchema: schema });
    await seedFixtures(database, { SEED_MODE: 'fixture', NODE_ENV: 'test' });
  }, 30_000);

  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      if (control) {
        try {
          await control.pool.query(`drop schema if exists "${schema}" cascade`);
        } finally {
          await control.close();
        }
      }
    }
  });

  it('links a Project Topic to its community idea and constrains task sources to the Project Topic', async () => {
    const idea = {
      id: randomUUID(),
      topicId: fixtureIds.community,
      authorId: fixtureIds.participant,
      bodyMd: 'Provenance example',
      kind: 'idea' as const,
    };
    await database.db.insert(posts).values(idea);
    const project = {
      id: randomUUID(),
      slug: 'provenance-project',
      title: 'Promoted Idea',
      kind: 'project' as const,
      goalMd: 'Verify the original remains in the community Topic.',
      originPostId: idea.id,
      repoUrl: 'https://github.com/example/project',
      createdBy: fixtureIds.admin,
    };
    const [promoted] = await database.db
      .insert(topics)
      .values(project)
      .returning();
    expect(promoted).toMatchObject(project);
    const original = await database.pool.query(
      'select topic_id, body_md from posts where id = $1',
      [idea.id],
    );
    expect(original.rows).toEqual([
      { topic_id: idea.topicId, body_md: idea.bodyMd },
    ]);
    await expect(
      database.pool.query(
        'update topics set origin_post_id = $1 where id = $2',
        [idea.id, fixtureIds.community],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'topics_project_provenance_check',
    });
    await expect(
      database.pool.query(
        "update topics set repo_url = 'http://example.org/project' where id = $1",
        [project.id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'topics_repo_url_check',
    });

    const task = {
      topicId: project.id,
      title: 'Implement the idea',
      createdBy: fixtureIds.admin,
    };
    await expect(
      database.pool.query(
        'insert into tasks (topic_id, title, created_by, source_post_id) values ($1, $2, $3, $4)',
        [task.topicId, task.title, task.createdBy, idea.id],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'tasks_source_post_topic_fk',
    });
    const sourcePostId = randomUUID();
    await database.db.insert(posts).values({
      id: sourcePostId,
      topicId: project.id,
      authorId: fixtureIds.participant,
      bodyMd: 'A discussion in the project',
    });
    const [created] = await database.db
      .insert(tasks)
      .values({ ...task, sourcePostId })
      .returning();
    expect(created).toMatchObject({
      ...task,
      sourcePostId,
      status: 'open',
      version: 1,
      assigneeId: null,
      reviewerId: null,
    });
  });

  it('enforces workflow assignments and retains one artifact per submission version', async () => {
    const taskId = randomUUID();
    const assigneeId = fixtureIds.agentA;
    const reviewerId = fixtureIds.agentB;
    await database.db.insert(tasks).values({
      id: taskId,
      topicId: fixtureIds.project,
      title: 'Review an external artifact',
      createdBy: fixtureIds.admin,
    });
    await expect(
      database.pool.query('update tasks set assignee_id = $1 where id = $2', [
        assigneeId,
        taskId,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'tasks_unassigned_status_check',
    });
    await expect(
      database.pool.query("update tasks set status = 'claimed' where id = $1", [
        taskId,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'tasks_assignee_required_check',
    });
    await database.pool.query(
      "update tasks set status = 'submitted', assignee_id = $1, version = 3 where id = $2",
      [assigneeId, taskId],
    );
    await expect(
      database.pool.query(
        "update tasks set status = 'in_review' where id = $1",
        [taskId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'tasks_reviewer_required_check',
    });
    await expect(
      database.pool.query(
        "update tasks set status = 'in_review', reviewer_id = $1 where id = $2",
        [assigneeId, taskId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'tasks_review_independence_check',
    });

    const artifact = {
      taskId,
      submittedBy: assigneeId,
      taskVersion: 3,
      kind: 'pr' as const,
      url: 'https://github.com/example/project/pull/1',
    };
    const [submission] = await database.db
      .insert(artifacts)
      .values(artifact)
      .returning();
    expect(submission).toMatchObject(artifact);
    const insert =
      'insert into artifacts (task_id, submitted_by, url, task_version) values ($1, $2, $3, $4)';
    await expect(
      database.pool.query(insert, [taskId, assigneeId, artifact.url, 3]),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'artifacts_task_version_unique',
    });

    await database.pool.query(
      "update tasks set status = 'changes_requested', reviewer_id = $1, version = 5 where id = $2",
      [reviewerId, taskId],
    );
    await database.pool.query(
      "update tasks set status = 'submitted', reviewer_id = null, version = 6 where id = $1",
      [taskId],
    );
    await expect(
      database.pool.query(insert, [taskId, assigneeId, 'file:///example', 6]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'artifacts_url_check',
    });
    await database.db.insert(artifacts).values({ ...artifact, taskVersion: 6 });
    const versions = await database.pool.query(
      'select task_version from artifacts where task_id = $1 order by task_version',
      [taskId],
    );
    expect(versions.rows).toEqual([{ task_version: 3 }, { task_version: 6 }]);
  });
});
