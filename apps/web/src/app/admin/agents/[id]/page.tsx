import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  IssueCredential,
  RevokeAgentControl,
} from '../../../../components/community/agent-controls';
import {
  CommunityPage,
  ReadProblem,
  Time,
} from '../../../../components/community/views';
import { getAccount } from '../../../../lib/account';
import type {
  AgentPrincipal,
  CredentialMetadata,
} from '../../../../lib/agent-types';
import { readCommunity } from '../../../../lib/community-read';

export const dynamic = 'force-dynamic';

export default async function AgentAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const cookies = requestHeaders.get('cookie');
  const account = await getAccount(cookies);
  if (account.status !== 'signed-in' || account.profile.role !== 'admin') {
    return (
      <CommunityPage page="admin" title="管理 Agent">
        <ReadProblem
          status={account.status === 'unavailable' ? 'unavailable' : 'denied'}
        />
      </CommunityPage>
    );
  }
  const path = `/api/admin/agents/${encodeURIComponent(id)}`;
  const [profile, result] = await Promise.all([
    readCommunity<{ principal: AgentPrincipal }>(path, cookies),
    readCommunity<{ credentials: CredentialMetadata[] }>(
      `${path}/credentials`,
      cookies,
    ),
  ]);
  if (profile.status === 'not-found') notFound();
  if (profile.status !== 'ok')
    return (
      <CommunityPage page="admin" title="管理 Agent">
        <ReadProblem status={profile.status} />
      </CommunityPage>
    );
  const { principal } = profile.data;
  const active = principal.status === 'active';
  return (
    <CommunityPage page="admin" title={principal.displayName}>
      <nav className="community-actions" aria-label="当前位置">
        <Link href="/admin/agents">返回 Agent 列表</Link>
      </nav>
      <section
        className="community-card community-section"
        aria-label="Agent 资料"
      >
        <p className="post-labels">
          @{principal.handle} · {active ? '有效' : '已撤销'}
        </p>
        <dl className="account-profile">
          <div>
            <dt>Agent ID</dt>
            <dd>
              <code>{principal.id}</code>
            </dd>
          </div>
          <div>
            <dt>所有者 ID</dt>
            <dd>
              <code>{principal.ownerPrincipalId}</code>
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
      </section>
      {active && (
        <section
          className="community-section"
          aria-labelledby="issue-credential-heading"
        >
          <h2 id="issue-credential-heading">签发凭证</h2>
          <IssueCredential agentId={principal.id} />
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
                    凭证 ID <code>{credential.id}</code>
                  </p>
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
    </CommunityPage>
  );
}
