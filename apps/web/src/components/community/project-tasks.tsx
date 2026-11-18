import Link from 'next/link';
import type { Topic, Page } from '../../lib/community-types';
import { queryPath } from '../../lib/community-types';
import { readCommunity } from '../../lib/community-read';
import { httpsLink, taskStates, type Task } from '../../lib/project-types';
import { Markdown } from './markdown';
import { NewTask } from './project-controls';
import { Pager, ReadProblem } from './views';

export async function ProjectTasks({
  topic,
  admin,
  signedIn,
  taskCursor,
  cursor,
}: {
  topic: Topic;
  admin: boolean;
  signedIn: boolean;
  taskCursor?: string | string[];
  cursor?: string;
}) {
  const result =
    typeof taskCursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<Task>>(
          queryPath(`/api/projects/${encodeURIComponent(topic.id)}/tasks`, {
            cursor: taskCursor,
          }),
        );
  const repo = httpsLink(topic.repoUrl, true);
  const topicPath = `/topics/${encodeURIComponent(topic.slug)}`;
  const first = `${queryPath(topicPath, { cursor })}#project-tasks`;
  return (
    <section
      className="community-section"
      aria-labelledby="project-task-heading"
      id="project-tasks"
    >
      <h2 id="project-task-heading">项目任务</h2>
      {(topic.originPostId || repo) && (
        <div className="community-actions">
          {topic.originPostId && (
            <Link href={`/posts/${encodeURIComponent(topic.originPostId)}`}>
              查看来源想法
            </Link>
          )}
          {repo && (
            <a href={repo} rel="nofollow ugc noreferrer">
              查看 GitHub 仓库
            </a>
          )}
        </div>
      )}
      {signedIn ? (
        <NewTask topicId={topic.id} admin={admin} />
      ) : (
        <p className="community-message">
          <Link href="/account">登录</Link>后建议或领取任务。
        </p>
      )}
      {result.status === 'ok' ? (
        <>
          {result.data.items.length ? (
            <ul className="community-list notification-list">
              {result.data.items.map((task) => (
                <li key={task.id} className="community-card">
                  <h3>
                    <Link href={`/tasks/${encodeURIComponent(task.id)}`}>
                      {task.title}
                    </Link>
                  </h3>
                  <p className="community-meta">{taskStates[task.status]}</p>
                  <Markdown>{task.descriptionMd}</Markdown>
                  {task.assigneeId && (
                    <p className="community-meta">
                      领取者 ID <code>{task.assigneeId}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="community-message">暂无项目任务。</p>
          )}
          <Pager
            first={taskCursor ? first : undefined}
            next={
              result.data.nextCursor &&
              `${queryPath(topicPath, { cursor, taskCursor: result.data.nextCursor })}#project-tasks`
            }
          />
        </>
      ) : (
        <ReadProblem status={result.status} reset={first} />
      )}
    </section>
  );
}
