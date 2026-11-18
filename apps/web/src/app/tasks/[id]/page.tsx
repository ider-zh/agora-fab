import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Markdown } from '../../../components/community/markdown';
import { TaskActions } from '../../../components/community/project-controls';
import {
  CommunityPage,
  Pager,
  ReadProblem,
  Time,
} from '../../../components/community/views';
import { getAccount } from '../../../lib/account';
import { readCommunity } from '../../../lib/community-read';
import { queryPath } from '../../../lib/community-types';
import {
  artifactKinds,
  httpsLink,
  taskStates,
  type Artifact,
  type Task,
} from '../../../lib/project-types';

export const dynamic = 'force-dynamic';

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const [{ id }, { cursor }, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const path = `/tasks/${encodeURIComponent(id)}`;
  const [result, account] = await Promise.all([
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : readCommunity<{
          task: Task;
          artifacts: Artifact[];
          artifactsNextCursor?: string | null;
        }>(queryPath(`/api${path}`, { cursor })),
    getAccount(requestHeaders.get('cookie')),
  ]);
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok')
    return (
      <CommunityPage page="topics" title="项目任务">
        <ReadProblem status={result.status} reset={path} />
      </CommunityPage>
    );
  const { task, artifacts, artifactsNextCursor } = result.data;
  return (
    <CommunityPage page="topics" title={task.title}>
      <nav className="community-actions" aria-label="当前位置">
        <Link
          href={`/topics/${encodeURIComponent(task.topicId)}#project-tasks`}
        >
          返回项目
        </Link>
        {task.sourcePostId && (
          <Link href={`/posts/${encodeURIComponent(task.sourcePostId)}`}>
            查看来源帖子
          </Link>
        )}
      </nav>
      <section
        className="community-card community-section"
        aria-label="任务信息"
      >
        <p className="post-labels">{taskStates[task.status]}</p>
        <Markdown>{task.descriptionMd}</Markdown>
        <dl className="account-profile">
          <div>
            <dt>创建者 ID</dt>
            <dd>
              <code>{task.createdBy}</code>
            </dd>
          </div>
          <div>
            <dt>领取者 ID</dt>
            <dd>
              {task.assigneeId ? <code>{task.assigneeId}</code> : '尚未领取'}
            </dd>
          </div>
          {task.reviewerId && (
            <div>
              <dt>评审者 ID</dt>
              <dd>
                <code>{task.reviewerId}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>最后更新</dt>
            <dd>
              <Time value={task.updatedAt} />
            </dd>
          </div>
        </dl>
      </section>
      <section className="community-section" aria-labelledby="artifacts-title">
        <h2 id="artifacts-title">提交的成果</h2>
        {artifacts.length ? (
          <ul className="community-list notification-list">
            {artifacts.map((artifact) => {
              const href = httpsLink(artifact.url);
              const label = artifactKinds[artifact.kind];
              return (
                <li key={artifact.id} className="community-card">
                  <h3>
                    {href ? (
                      <a href={href} rel="nofollow ugc noreferrer">
                        {label} · {new URL(href).hostname}
                      </a>
                    ) : (
                      label
                    )}
                  </h3>
                  <Markdown>{artifact.descriptionMd}</Markdown>
                  <p className="community-meta">
                    提交者 ID <code>{artifact.submittedBy}</code>
                  </p>
                  <p className="community-meta">
                    提交版本 {artifact.taskVersion} ·{' '}
                    <Time value={artifact.createdAt} />
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="community-message">暂无成果链接。</p>
        )}
        <Pager
          first={cursor ? `${path}#artifacts-title` : undefined}
          next={
            artifactsNextCursor &&
            `${queryPath(path, { cursor: artifactsNextCursor })}#artifacts-title`
          }
        />
      </section>
      {(task.reviewNote || task.decisionNote) && (
        <section className="community-section" aria-labelledby="review-title">
          <h2 id="review-title">评审与决定</h2>
          <div className="community-card">
            {task.reviewNote && (
              <div>
                <h3>评审意见</h3>
                <Markdown>{task.reviewNote}</Markdown>
              </div>
            )}
            {task.decisionNote && (
              <div>
                <h3>管理员决定说明</h3>
                <Markdown>{task.decisionNote}</Markdown>
              </div>
            )}
          </div>
        </section>
      )}
      {account.status === 'signed-in' ? (
        <TaskActions
          task={task}
          actor={{ id: account.profile.id, role: account.profile.role }}
        />
      ) : (
        <p className="community-message">
          <Link href="/account">登录</Link>后参与任务。
        </p>
      )}
    </CommunityPage>
  );
}
