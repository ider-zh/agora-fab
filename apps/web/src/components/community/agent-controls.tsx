'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { agentScopes, type AgentPrincipal } from '../../lib/agent-types';
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
            pattern="[a-z][a-z0-9_]{2,31}"
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

export function IssueCredential({ agentId }: { agentId: string }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState('');
  const scopeListId = useId();
  const submitButton = useRef<HTMLButtonElement>(null);
  // Return keyboard focus after the credential has been dismissed and the submit button is enabled again.
  const shouldRestoreFocus = useRef(false);
  useEffect(() => {
    if (!token && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      submitButton.current?.focus();
    }
  }, [token]);

  return (
    <>
      <form
        className="community-form"
        aria-label="签发凭证"
        onSubmit={async (event) => {
          event.preventDefault();
          if (token) return;
          const fields = new FormData(event.currentTarget);
          const scopes = fields.getAll('scope');
          if (!scopes.length) {
            setFeedback('请至少选择一项权限。');
            return;
          }
          setFeedback('');
          const result = await mutation.submit<{ token?: string }>(
            `/admin/agents/${encodeURIComponent(agentId)}/credentials`,
            { scopes, expiresInHours: Number(fields.get('expiresInHours')) },
          );
          if (result.ok) {
            const issued = result.data?.token;
            if (typeof issued === 'string' && issued) setToken(issued);
            else
              setFeedback(
                '凭证已签发，重试只会返回记录。如果未收到凭证，请在下方撤销这条记录后重新签发。',
              );
            router.refresh();
          }
        }}
      >
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
            disabled={mutation.pending || !!token}
          >
            签发凭证
          </button>
          <MutationMessage error={mutation.error} success={feedback} />
        </div>
      </form>
      {token && (
        <OneTimeSecret
          value={token}
          label="Agent 凭证"
          noun="凭证"
          help="凭证只显示这一次。请将它保存在 Agent 客户端的安全设置中。"
          dismiss={() => {
            shouldRestoreFocus.current = true;
            setToken('');
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
