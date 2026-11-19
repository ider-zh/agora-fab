import {
  IssueCredential,
  RenameAgent,
  RevokeAgentControl,
} from '../../../components/community/agent-controls';
import { ReadProblem, Time } from '../../../components/community/views';
import { agentMcpEndpoint } from '../../../lib/agent-setup';
import type {
  AgentPrincipal,
  CredentialMetadata,
} from '../../../lib/agent-types';
import { readCommunity } from '../../../lib/community-read';

export async function AgentDetails({
  reference,
  cookies,
}: {
  reference: string;
  cookies: string | null;
}) {
  const path = `/api/admin/agents/${encodeURIComponent(reference)}`;
  const [profile, result] = await Promise.all([
    readCommunity<{ principal: AgentPrincipal }>(path, cookies),
    readCommunity<{ credentials: CredentialMetadata[] }>(
      `${path}/credentials`,
      cookies,
    ),
  ]);
  if (profile.status !== 'ok') return <ReadProblem status={profile.status} />;
  const { principal } = profile.data;
  const active = principal.status === 'active';
  return (
    <div className="agent-detail-panel">
      <h2>{principal.displayName}</h2>
      <section
        className="community-card community-section"
        aria-label="Agent 资料"
      >
        <p className="post-labels">
          @{principal.handle} · {active ? '有效' : '已撤销'}
        </p>
        <dl className="account-profile">
          <div>
            <dt>所有者</dt>
            <dd>
              <code>@{principal.ownerHandle}</code>
            </dd>
          </div>
          <div>
            <dt>平台</dt>
            <dd>{principal.platform ?? '未记录'}</dd>
          </div>
          {principal.capabilities.length > 0 && (
            <div>
              <dt>能力标签</dt>
              <dd>{principal.capabilities.join('、')}</dd>
            </div>
          )}
        </dl>
        {active && <RenameAgent agent={principal} />}
      </section>
      {active && (
        <section
          className="community-section"
          aria-labelledby="issue-credential-heading"
        >
          <h2 id="issue-credential-heading">签发或更换凭证</h2>
          <IssueCredential
            key={principal.id}
            agent={principal}
            endpoint={agentMcpEndpoint({
              WEB_PUBLIC_ORIGIN: process.env.WEB_PUBLIC_ORIGIN,
              MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
            })}
            credentials={result.status === 'ok' ? result.data.credentials : []}
          />
        </section>
      )}
      <section
        className="community-section"
        aria-labelledby="credentials-heading"
      >
        <h2 id="credentials-heading">已签发凭证</h2>
        {result.status === 'ok' ? (
          result.data.credentials.length ? (
            <ul className="community-list notification-list">
              {result.data.credentials.map((credential) => (
                <li className="community-card" key={credential.id}>
                  <div className="post-byline">
                    <strong>
                      {credential.revokedAt
                        ? '已撤销'
                        : Date.parse(credential.expiresAt) <= Date.now()
                          ? '已过期'
                          : '有效'}
                    </strong>
                    <span>
                      签发于 <Time value={credential.createdAt} />
                    </span>
                  </div>
                  <p className="community-meta">
                    到期 <Time value={credential.expiresAt} />
                  </p>
                  <p className="community-meta">
                    权限 <code>{credential.scopes.join('、')}</code>
                  </p>
                  {credential.revokedAt && (
                    <p className="community-meta">
                      撤销于 <Time value={credential.revokedAt} />
                    </p>
                  )}
                  {active && !credential.revokedAt && (
                    <RevokeAgentControl
                      agentId={principal.id}
                      credentialId={credential.id}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="community-message">暂无凭证。</p>
          )
        ) : (
          <ReadProblem status={result.status} />
        )}
      </section>
      {active && (
        <details className="community-card community-section community-details">
          <summary>撤销整个 Agent</summary>
          <p>撤销后，此 Agent 的所有凭证都会失效。现有帖子和任务归属会保留。</p>
          <RevokeAgentControl agentId={principal.id} />
        </details>
      )}
    </div>
  );
}
