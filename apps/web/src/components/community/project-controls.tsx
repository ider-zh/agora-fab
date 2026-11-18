'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Topic } from '../../lib/community-types';
import { artifactKinds, type Task } from '../../lib/project-types';
import { MutationMessage, useCommunityMutation } from './mutations';

function field(form: FormData, name: string) {
  return String(form.get(name) ?? '');
}

function ProjectForm<T>({
  label,
  path,
  payload,
  destination,
  method = 'POST',
  children,
}: {
  label: string;
  path: string;
  payload: (fields: FormData) => object;
  destination?: (result: T) => string;
  method?: 'POST' | 'PATCH';
  children?: ReactNode;
}) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [refreshing, startTransition] = useTransition();
  const [feedback, setFeedback] = useState('');
  return (
    <form
      className="community-form"
      aria-label={label}
      onSubmit={async (event) => {
        event.preventDefault();
        setFeedback('');
        const form = event.currentTarget;
        const result = await mutation.submit<T>(
          path,
          payload(new FormData(form)),
          method,
        );
        if (!result.ok || !result.data) return;
        const target = destination?.(result.data);
        setFeedback('已保存。');
        startTransition(() => {
          if (target) router.push(target);
          else router.refresh();
        });
      }}
    >
      {children}
      <div className="community-actions">
        <button
          className="community-button"
          type="submit"
          disabled={mutation.pending || refreshing}
        >
          {label}
        </button>
        <MutationMessage error={mutation.error} success={feedback} />
      </div>
    </form>
  );
}

export function PromoteIdea({ postId }: { postId: string }) {
  return (
    <details className="community-card community-section community-details">
      <summary>从想法创建项目</summary>
      <ProjectForm<{ topic: Topic }>
        label="创建项目"
        path={`/admin/posts/${encodeURIComponent(postId)}/promote`}
        destination={({ topic }) => `/topics/${encodeURIComponent(topic.slug)}`}
        payload={(fields) => ({
          slug: field(fields, 'slug'),
          title: field(fields, 'title'),
          descriptionMd: field(fields, 'descriptionMd'),
          guidelinesMd: field(fields, 'guidelinesMd'),
          goalMd: field(fields, 'goalMd'),
          ...(field(fields, 'repoUrl').trim()
            ? { repoUrl: field(fields, 'repoUrl').trim() }
            : {}),
        })}
      >
        <label>
          项目名称
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Slug
          <input
            name="slug"
            required
            maxLength={100}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          项目目标
          <textarea name="goalMd" rows={3} required maxLength={4000} />
        </label>
        <label>
          简介
          <textarea name="descriptionMd" rows={3} maxLength={4000} />
        </label>
        <label>
          讨论指南
          <textarea name="guidelinesMd" rows={3} maxLength={4000} />
        </label>
        <label>
          GitHub 仓库地址（选填）
          <input
            type="url"
            name="repoUrl"
            maxLength={2048}
            placeholder="https://github.com/owner/repository"
          />
        </label>
      </ProjectForm>
    </details>
  );
}

export function NewTask({
  topicId,
  admin,
}: {
  topicId: string;
  admin: boolean;
}) {
  const label = admin ? '创建任务' : '建议任务';
  return (
    <details className="community-details community-section">
      <summary>{label}</summary>
      <ProjectForm<{ task: Task }>
        label={label}
        path={`${admin ? '/admin' : ''}/projects/${encodeURIComponent(topicId)}/tasks`}
        destination={({ task }) => `/tasks/${encodeURIComponent(task.id)}`}
        payload={(fields) => ({
          title: field(fields, 'title'),
          descriptionMd: field(fields, 'descriptionMd'),
          ...(field(fields, 'sourcePostId').trim()
            ? { sourcePostId: field(fields, 'sourcePostId').trim() }
            : {}),
        })}
      >
        <label>
          任务名称
          <input name="title" required maxLength={200} />
        </label>
        <label>
          任务说明
          <textarea name="descriptionMd" rows={4} maxLength={4000} />
        </label>
        <label>
          来源帖子 ID（选填）
          <input
            name="sourcePostId"
            pattern="[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
            maxLength={36}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      </ProjectForm>
    </details>
  );
}

const decisions = {
  approve: '批准并开放领取',
  done: '验收通过',
  changes_requested: '要求修改',
  cancelled: '取消任务',
  reopen: '重新开放领取',
};

function decisionOptions(
  status: Task['status'],
  assignee: boolean,
): (keyof typeof decisions)[] {
  if (status === 'proposed') return ['approve', 'cancelled'];
  if (status === 'in_review' && !assignee)
    return ['done', 'changes_requested', 'cancelled'];
  if (status === 'cancelled' || status === 'done') return ['reopen'];
  return ['cancelled'];
}

export function TaskActions({
  task,
  actor,
}: {
  task: Task;
  actor: { id: string; role: 'admin' | 'participant' };
}) {
  const ref = encodeURIComponent(task.id);
  const base = `/tasks/${ref}`;
  const adminBase = `/admin/tasks/${ref}`;
  const assignee = task.assigneeId === actor.id;
  const canClaim =
    task.status === 'open' || (task.status === 'changes_requested' && assignee);
  const canSubmit =
    assignee && ['claimed', 'changes_requested'].includes(task.status);
  const canReview =
    !!task.assigneeId && !assignee && task.status === 'submitted';
  const admin = actor.role === 'admin';
  const options = decisionOptions(task.status, assignee);

  if (!canClaim && !canSubmit && !canReview && !admin) return null;
  return (
    <section className="community-section" aria-label="任务操作">
      <h2>任务操作</h2>
      <div className="community-list">
        {canClaim && (
          <ProjectForm
            label="领取任务"
            path={`${base}/claim`}
            payload={() => ({})}
          />
        )}
        {canSubmit && (
          <ProjectForm
            label="提交成果"
            path={`${base}/artifacts`}
            payload={(fields) => ({
              kind: field(fields, 'kind'),
              url: field(fields, 'url'),
              descriptionMd: field(fields, 'descriptionMd'),
            })}
          >
            <label>
              成果类型
              <select name="kind">
                {Object.entries(artifactKinds).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              公开成果链接
              <input
                type="url"
                name="url"
                required
                maxLength={2048}
                placeholder="https://github.com/owner/repository/pull/1"
              />
            </label>
            <label>
              成果说明
              <textarea name="descriptionMd" rows={3} maxLength={4000} />
            </label>
          </ProjectForm>
        )}
        {canReview && (
          <ProjectForm
            label="提交评审"
            path={`${base}/review`}
            payload={(fields) => ({
              version: task.version,
              note: field(fields, 'note'),
            })}
          >
            <label>
              评审意见
              <textarea required name="note" rows={4} maxLength={4000} />
            </label>
          </ProjectForm>
        )}
        {admin && (
          <>
            <ProjectForm
              key={`decision-${task.version}`}
              label="保存决定"
              path={`${adminBase}/review`}
              payload={(fields) => ({
                version: task.version,
                outcome: field(fields, 'outcome'),
                note: field(fields, 'note'),
              })}
            >
              <label>
                决定
                <select name="outcome">
                  {options.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {decisions[outcome]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                决定说明
                <textarea name="note" rows={3} maxLength={4000} />
              </label>
            </ProjectForm>
            {!['done', 'cancelled'].includes(task.status) && (
              <details className="community-details">
                <summary>编辑任务</summary>
                <ProjectForm
                  key={`edit-${task.version}`}
                  label="保存任务修改"
                  path={adminBase}
                  method="PATCH"
                  payload={(fields) => ({
                    version: task.version,
                    title: field(fields, 'title'),
                    descriptionMd: field(fields, 'descriptionMd'),
                  })}
                >
                  <label>
                    任务名称
                    <input
                      name="title"
                      required
                      maxLength={200}
                      defaultValue={task.title}
                    />
                  </label>
                  <label>
                    任务说明
                    <textarea
                      name="descriptionMd"
                      rows={4}
                      maxLength={4000}
                      defaultValue={task.descriptionMd}
                    />
                  </label>
                </ProjectForm>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
