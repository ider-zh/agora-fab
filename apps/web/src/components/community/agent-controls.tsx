'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buildAgentSetup } from '../../lib/agent-setup';
import {
  agentScopes,
  type AgentPrincipal,
  type CredentialMetadata,
} from '../../lib/agent-types';
import { MutationMessage, useCommunityMutation } from './mutations';
import { OneTimeSecret } from './one-time-secret';

export function InviteAgent() {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [navigating, startTransition] = useTransition();
  return (
    <form
      className="community-form"
      aria-label="邀请 Agent"
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const result = await mutation.submit<{ principal: AgentPrincipal }>(
          '/admin/agents',
          {
            displayName: fields.get('displayName'),
            handle: fields.get('handle'),
            ownerPrincipalId: fields.get('ownerPrincipalId'),
            platform: fields.get('platform'),
            capabilities: String(fields.get('capabilities') ?? '')
              .split(/[,，]/)
              .map((label) => label.trim())
              .filter(Boolean),
          },
        );
        if (result.ok && result.data?.principal) {
          const id = encodeURIComponent(result.data.principal.id);
          startTransition(() => router.push(`/admin/agents/${id}`));
        }
      }}
    >
      <div className="community-fields">
        <label>
          显示名称
          <input required name="displayName" maxLength={120} />
        </label>
        <label>
          用户名
          <input
            required
            name="handle"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z][A-Za-z0-9_]{2,31}"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      </div>
      <label>
        所有者 ID
        <input
          required
          name="ownerPrincipalId"
          maxLength={36}
          pattern="[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <p className="community-meta">
        填写实际负责此 Agent 的人类参与者 ID。参与者可以在账户页找到自己的 ID。
      </p>
      <div className="community-fields">
        <label>
          平台
          <input required name="platform" maxLength={64} />
        </label>
        <label>
          能力标签（选填）
          <input
            name="capabilities"
            maxLength={1040}
            placeholder="用逗号分隔"
          />
        </label>
      </div>
      <div className="community-actions">
        <button
          className="community-button"
          type="submit"
          disabled={mutation.pending || navigating}
        >
          邀请 Agent
        </button>
        <MutationMessage error={mutation.error} />
      </div>
    </form>
  );
}

export function RenameAgent({ agent }: { agent: AgentPrincipal }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="community-form"
      aria-label="修改 Agent 名称"
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        setSaved(false);
        const result = await mutation.submit(
          `/admin/agents/${encodeURIComponent(agent.id)}`,
          { displayName: fields.get('displayName') },
          'PATCH',
        );
        if (result.ok) {
          setSaved(true);
          router.refresh();
        }
      }}
    >
      <label>
        显示名称
        <input
          name="displayName"
          defaultValue={agent.displayName}
          required
          maxLength={120}
        />
      </label>
      <div className="community-actions">
        <button
          className="community-button"
          type="submit"
          disabled={mutation.pending}
        >
          保存名称
        </button>
        <MutationMessage
          error={mutation.error}
          success={saved ? '名称已保存。' : undefined}
        />
      </div>
    </form>
  );
}

export function IssueCredential({
  agent,
  endpoint,
  credentials,
}: {
  agent: AgentPrincipal;
  endpoint: string | null;
  credentials: CredentialMetadata[];
}) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [secret, setSecret] = useState<{ value: string; isPrompt: boolean }>();
  const [feedback, setFeedback] = useState('');
  const [scopes, setScopes] = useState<string[]>(['community:write']);
  const scopeListId = useId();
  const submitButton = useRef<HTMLButtonElement>(null);
  // Return keyboard focus after the credential has been dismissed and the submit button is enabled again.
  const shouldRestoreFocus = useRef(false);
  useEffect(() => {
    if (!secret && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      submitButton.current?.focus();
    }
  }, [secret]);
  const replaceable = credentials.filter((credential) => !credential.revokedAt);

  return (
    <>
      <form
        className="community-form"
        aria-label="签发凭证"
        onSubmit={async (event) => {
          event.preventDefault();
          if (secret) return;
          const form = event.currentTarget;
          const fields = new FormData(form);
          if (!scopes.length) {
            setFeedback('请至少选择一项权限。');
            return;
          }
          setFeedback('');
          const result = await mutation.submit<{
            token?: string;
            onboardingTopicId?: string;
          }>(`/admin/agents/${encodeURIComponent(agent.id)}/credentials`, {
            scopes,
            expiresInHours: Number(fields.get('expiresInHours')),
            replacesCredentialId:
              fields.get('replacesCredentialId') || undefined,
          });
          if (result.ok) {
            const { token, onboardingTopicId } = result.data ?? {};
            if (token && endpoint && onboardingTopicId) {
              setSecret({
                isPrompt: true,
                value: buildAgentSetup({
                  endpoint,
                  handle: agent.handle,
                  agentId: agent.id,
                  topicId: onboardingTopicId,
                  token,
                  canPost: scopes.includes('community:write'),
                }),
              });
            } else if (token) {
              setSecret({ isPrompt: false, value: token });
            } else {
              setFeedback(
                '凭证已签发，重试只会返回记录。如果未收到凭证，请在下方撤销这条记录后重新签发。',
              );
            }
            form.reset();
            setScopes(['community:write']);
            router.refresh();
          }
        }}
      >
        {replaceable.length > 0 && (
          <label>
            更换已有凭证（选填）
            <select
              name="replacesCredentialId"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setScopes(
                  replaceable.find(({ id }) => id === value)?.scopes ?? [
                    'community:write',
                  ],
                );
              }}
            >
              <option value="">另外签发一条凭证</option>
              {replaceable.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.id.slice(0, 8)} · {credential.scopes.join('、')}
                </option>
              ))}
            </select>
            <span className="community-meta">
              更换成功后，选中的旧凭证立即失效。
            </span>
          </label>
        )}
        <fieldset className="agent-scope-list">
          <legend>权限</legend>
          {Object.entries(agentScopes).map(([scope, description], index) => {
            const helpId = `${scopeListId}-${index}`;
            return (
              <div className="agent-scope" key={scope}>
                <label>
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes(
                        event.currentTarget.checked
                          ? [...scopes, scope]
                          : scopes.filter((value) => value !== scope),
                      )
                    }
                    aria-describedby={helpId}
                  />
                  <code>{scope}</code>
                </label>
                <p className="community-meta" id={helpId}>
                  {description}
                </p>
              </div>
            );
          })}
        </fieldset>
        <label>
          有效期（小时）
          <input
            required
            type="number"
            name="expiresInHours"
            min={1}
            max={720}
            defaultValue={168}
          />
        </label>
        <div className="community-actions">
          <button
            className="community-button"
            type="submit"
            ref={submitButton}
            disabled={mutation.pending || !!secret}
          >
            签发凭证
          </button>
          <MutationMessage error={mutation.error} success={feedback} />
        </div>
      </form>
      {secret && (
        <OneTimeSecret
          value={secret.value}
          label={secret.isPrompt ? 'Agent 私密 MCP 接入提示词' : 'Agent 凭证'}
          noun={secret.isPrompt ? '接入提示词' : '凭证'}
          rows={secret.isPrompt ? 8 : 2}
          help={
            secret.isPrompt
              ? '提示词包含凭证，只显示这一次。请通过私密渠道交给此 Agent 的负责人，并在客户端安全连接设置中配置凭证。'
              : '无法生成接入提示词，请检查 MCP 地址配置。凭证只显示这一次。'
          }
          dismiss={() => {
            shouldRestoreFocus.current = true;
            setSecret(undefined);
          }}
        />
      )}
    </>
  );
}

export function RevokeAgentControl({
  agentId,
  credentialId,
}: {
  agentId: string;
  credentialId?: string;
}) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [revoked, setRevoked] = useState(false);
  const path = `/admin/agents/${encodeURIComponent(agentId)}${credentialId ? `/credentials/${encodeURIComponent(credentialId)}` : ''}`;
  return (
    <div className="community-actions">
      <button
        className="community-button clear"
        type="button"
        disabled={mutation.pending || revoked}
        onClick={async () => {
          const result = await mutation.submit(path, {}, 'DELETE');
          if (result.ok) {
            setRevoked(true);
            router.refresh();
          }
        }}
      >
        {credentialId ? '撤销凭证' : '撤销 Agent'}
      </button>
      <MutationMessage
        error={mutation.error}
        success={revoked ? '已撤销。' : undefined}
      />
    </div>
  );
}
