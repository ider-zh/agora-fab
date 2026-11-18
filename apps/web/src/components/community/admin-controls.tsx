'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Topic, type Post } from '../../lib/community-types';
import { MutationMessage, useCommunityMutation } from './mutations';

export function TopicForm({ topic }: { topic?: Topic }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [kind, setKind] = useState(topic?.kind ?? 'community');
  const [feedback, setFeedback] = useState('');
  return (
    <form
      className="community-form"
      aria-label={topic ? `编辑 ${topic.title}` : '创建 Topic'}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        setFeedback('');
        const result = await mutation.submit<{ topic: Topic }>(
          topic
            ? `/admin/topics/${encodeURIComponent(topic.id)}`
            : '/admin/topics',
          {
            title: fields.get('title'),
            descriptionMd: fields.get('descriptionMd'),
            guidelinesMd: fields.get('guidelinesMd'),
            ...(kind === 'project' ? { goalMd: fields.get('goalMd') } : {}),
            ...(topic
              ? { status: fields.get('status') }
              : { slug: fields.get('slug'), kind }),
          },
          topic ? 'PATCH' : 'POST',
        );
        if (result.ok) {
          if (!topic) {
            form.reset();
            setKind('community');
          }
          setFeedback(topic ? '修改已保存。' : '已创建 Topic。');
          router.refresh();
        }
      }}
    >
      <label>
        名称
        <input
          name="title"
          defaultValue={topic?.title}
          required
          maxLength={200}
        />
      </label>
      {!topic && (
        <div className="community-fields">
          <label>
            Slug
            <input
              name="slug"
              required
              maxLength={100}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="daily-inspiration"
            />
          </label>
          <label>
            类型
            <select
              name="kind"
              value={kind}
              onChange={(event) =>
                setKind(
                  event.target.value === 'project' ? 'project' : 'community',
                )
              }
            >
              <option value="community">社区</option>
              <option value="project">项目</option>
            </select>
          </label>
        </div>
      )}
      <label>
        简介
        <textarea
          name="descriptionMd"
          rows={3}
          defaultValue={topic?.descriptionMd}
          maxLength={4000}
        />
      </label>
      <label>
        讨论指南
        <textarea
          name="guidelinesMd"
          rows={3}
          defaultValue={topic?.guidelinesMd}
          maxLength={4000}
        />
      </label>
      {kind === 'project' && (
        <label>
          项目目标
          <textarea
            name="goalMd"
            rows={3}
            defaultValue={topic?.goalMd ?? ''}
            required
            maxLength={4000}
          />
        </label>
      )}
      {topic && (
        <label>
          状态
          <select name="status" defaultValue={topic.status}>
            <option value="active">公开</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      )}
      <div className="community-actions">
        <button
          type="submit"
          className="community-button"
          disabled={mutation.pending}
        >
          {topic ? '保存修改' : '创建 Topic'}
        </button>
        <MutationMessage error={mutation.error} success={feedback} />
      </div>
    </form>
  );
}

const actions = {
  hide: '隐藏帖子',
  restore: '恢复帖子',
  pin: '置顶帖子',
  unpin: '取消置顶',
} as const;
type Action = keyof typeof actions;

export function ModerationForm({ post }: { post: Post }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [feedback, setFeedback] = useState('');
  const visibility: Action = post.hiddenAt ? 'restore' : 'hide';
  const placement: Action | null = post.pinnedAt
    ? 'unpin'
    : post.hiddenAt || post.parentPostId
      ? null
      : 'pin';
  return (
    <form
      className="community-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const action =
          submitter instanceof HTMLButtonElement ? submitter.value : '';
        if (action !== visibility && action !== placement) return;
        const form = event.currentTarget;
        const reason = String(new FormData(form).get('reason') ?? '').trim();
        setFeedback('');
        const result = await mutation.submit(
          `/admin/posts/${encodeURIComponent(post.id)}/${action}`,
          reason ? { reason } : {},
        );
        if (result.ok) {
          form.reset();
          setFeedback(`${actions[action]}成功。`);
          router.refresh();
        }
      }}
    >
      <label>
        原因（选填）
        <input name="reason" maxLength={300} />
      </label>
      <div className="community-actions">
        <button
          className="community-button"
          value={visibility}
          type="submit"
          disabled={mutation.pending}
        >
          {actions[visibility]}
        </button>
        {placement && (
          <button
            className="community-button clear"
            value={placement}
            type="submit"
            disabled={mutation.pending}
          >
            {actions[placement]}
          </button>
        )}
        <MutationMessage error={mutation.error} success={feedback} />
      </div>
    </form>
  );
}
