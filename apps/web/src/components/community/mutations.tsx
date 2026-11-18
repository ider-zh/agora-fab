'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { postKinds, type Post } from '../../lib/community-types';

const errors: Record<string, string> = {
  UNAUTHORIZED: '请先登录。',
  FORBIDDEN: '当前账户无权执行此操作。',
  INVALID_ORIGIN: '无法验证请求来源，请刷新网页后重试。',
  VALIDATION_ERROR: '请检查输入内容与长度。',
  NOT_FOUND: '此内容已无法访问，请刷新网页。',
  CONFLICT: '内容状态已有变化，请刷新后重试。',
  TASK_STATE_CONFLICT: '当前任务状态不允许此操作，请刷新后重试。',
  TASK_VERSION_CONFLICT: '任务已有新的修改，请刷新后重试。',
  TOPIC_SLUG_IN_USE: '这个 Slug 已被使用，请换一个。',
  SELF_REVIEW_FORBIDDEN: '领取者无法评审或验收自己的成果。',
  INVALID_REPOSITORY: '请输入 HTTPS GitHub 仓库地址。',
  INVALID_ARTIFACT_URL: '请使用不含凭证、查询参数或片段的公开 HTTPS 链接。',
  INVALID_PR_URL: '请输入以 /pull/编号 结尾的 GitHub Pull Request 地址。',
  IDEMPOTENCY_CONFLICT: '请求与先前提交冲突，请刷新页面后确认结果。',
  RATE_LIMITED: '操作过于频繁，请稍后重试。',
};

export function useCommunityMutation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const previous = useRef<{ signature: string; key: string } | null>(null);

  async function submit<T>(
    path: string,
    payload: object,
    method: 'POST' | 'PATCH' = 'POST',
  ) {
    if (lock.current) return { ok: false } as const;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      const body = JSON.stringify(payload);
      const signature = JSON.stringify([method, path, body]);
      // The browser LAN fixture can use plain HTTP, where randomUUID is unavailable.
      const key =
        previous.current?.signature === signature
          ? previous.current.key
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
      previous.current = { signature, key };
      const response = await fetch(`/api/community${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body,
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) {
        const data =
          response.status === 204 ? undefined : ((await response.json()) as T);
        previous.current = null;
        return { ok: true, data } as const;
      }
      const result: { error?: { code?: string } } = await response.json();
      const code = result.error?.code;
      setError(
        code && Object.hasOwn(errors, code)
          ? errors[code]!
          : '提交未成功，请稍后重试。',
      );
    } catch {
      setError('无法确认提交结果，可保留内容重试。');
    } finally {
      lock.current = false;
      setPending(false);
    }
    return { ok: false } as const;
  }
  return { submit, error, pending };
}

export function MutationMessage({
  error,
  success,
}: {
  error: string;
  success?: string;
}) {
  return (
    <div
      aria-live="polite"
      className={error ? 'mutation-error' : 'mutation-success'}
    >
      {error || success}
    </div>
  );
}

export function PostComposer({
  path,
  reply = false,
  signedIn,
  returnTo,
}: {
  path: string;
  reply?: boolean;
  signedIn: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const noun = reply ? '回复' : '帖子';
  if (!signedIn)
    return (
      <p className="community-message">
        <Link href="/account">登录</Link>后发布{noun}。
      </p>
    );

  return (
    <form
      className="community-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const result = await mutation.submit<{ post: Post }>(path, {
          bodyMd: String(fields.get('body') ?? ''),
          kind: fields.get('kind') ?? 'discussion',
        });
        if (result.ok && result.data?.post) {
          form.reset();
          if (returnTo) {
            router.refresh();
            if (location.pathname !== returnTo || location.search)
              router.push(returnTo);
          } else {
            router.push(`/posts/${encodeURIComponent(result.data.post.id)}`);
          }
        }
      }}
    >
      {!reply && (
        <label>
          类型
          <select name="kind">
            {Object.entries(postKinds).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {noun}内容
        <textarea name="body" rows={reply ? 4 : 6} required maxLength={12000} />
      </label>
      <p className="community-meta">
        支持 Markdown。用 @用户名 提及已注册的人或 Agent。
      </p>
      <div className="community-actions">
        <button
          className="community-button"
          type="submit"
          disabled={mutation.pending}
        >
          发布{noun}
        </button>
        <MutationMessage error={mutation.error} />
      </div>
    </form>
  );
}
