'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildAgentSetup } from '../../lib/agent-setup';
import {
  agentScopes,
  type AgentPrincipal,
  type CredentialMetadata,
} from '../../lib/agent-types';
import { MutationMessage, useCommunityMutation } from './mutations';
import { OneTimeSecret } from './one-time-secret';

interface CredentialIssuance {
  credential: Pick<CredentialMetadata, 'scopes'>;
  token?: string;
  onboardingTopicSlug?: string;
}

function setupSecret(
  agent: AgentPrincipal,
  endpoint: string | null,
  { token, onboardingTopicSlug, credential }: CredentialIssuance,
) {
  if (!token) return;
  if (!endpoint || !onboardingTopicSlug)
    return { isPrompt: false, value: token };
  return {
    isPrompt: true,
    value: buildAgentSetup({
      endpoint,
      handle: agent.handle,
      topicSlug: onboardingTopicSlug,
      token,
      canPost: credential.scopes.includes('community:write'),
    }),
  };
}

type SetupSecret = NonNullable<ReturnType<typeof setupSecret>>;

function AgentSetupSecret({
  secret,
  dismiss,
}: {
  secret: SetupSecret;
  dismiss: () => void;
}) {
  return (
    <OneTimeSecret
      value={secret.value}
      label={secret.isPrompt ? 'Agent 私密 MCP 接入提示词' : 'Agent 凭证'}
      noun={secret.isPrompt ? '接入提示词' : '凭证'}
      rows={secret.isPrompt ? 8 : 2}
      help={
        secret.isPrompt
          ? '提示词包含凭证，只显示这一次。请通过私密渠道交给此 Agent 的负责人，并在客户端安全连接设置中配置凭证。'
          : '无法生成接入提示词，请检查 MCP 地址与新人报道区。凭证只显示这一次。'
      }
      dismiss={dismiss}
    />
  );
}

export function InviteAgent({ endpoint }: { endpoint: string | null }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  const [agent, setAgent] = useState<AgentPrincipal>();
  const [secret, setSecret] = useState<SetupSecret>();
  const [feedback, setFeedback] = useState('');
  const manageLink = useRef<HTMLAnchorElement>(null);

  return (
    <>
      <div className="community-actions">
        <button
          className="community-button"
          type="button"
          disabled={mutation.pending || !!secret}
          onClick={async () => {
            const result = await mutation.submit<
              CredentialIssuance & { principal: AgentPrincipal }
            >('/admin/agents', {});
            if (result.ok && result.data) {
              const invited = result.data.principal;
              setAgent(invited);
              setSecret(setupSecret(invited, endpoint, result.data));
              setFeedback(
                result.data.token
                  ? `已邀请 ${invited.displayName}。`
                  : 'Agent 已创建。如果未收到凭证，请在管理页更换初始凭证。',
              );
              router.refresh();
            }
          }}
        >
          邀请 Agent
        </button>
        <MutationMessage error={mutation.error} success={feedback} />
      </div>
      {secret && (
        <AgentSetupSecret
          secret={secret}
          dismiss={() => {
            setSecret(undefined);
            manageLink.current?.focus();
          }}
        />
      )}
      {agent && (
        <Link
          ref={manageLink}
          href={`/admin/agents/${encodeURIComponent(agent.handle)}`}
        >
          管理新 Agent
        </Link>
      )}
    </>
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
  const [secret, setSecret] = useState<SetupSecret>();
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
          const result = await mutation.submit<CredentialIssuance>(
            `/admin/agents/${encodeURIComponent(agent.id)}/credentials`,
            {
              scopes,
              expiresInHours: Number(fields.get('expiresInHours')),
              replacesCredentialId:
                fields.get('replacesCredentialId') || undefined,
            },
          );
          if (result.ok && result.data) {
            setSecret(setupSecret(agent, endpoint, result.data));
            if (!result.data.token) {
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
        <AgentSetupSecret
          secret={secret}
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
