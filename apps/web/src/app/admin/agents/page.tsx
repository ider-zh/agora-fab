import Link from 'next/link';
import { headers } from 'next/headers';
import { InviteAgent } from '../../../components/community/agent-controls';
import {
  CommunityPage,
  Pager,
  ReadProblem,
} from '../../../components/community/views';
import { getAccount } from '../../../lib/account';
import { agentMcpEndpoint } from '../../../lib/agent-setup';
import type { AgentPrincipal } from '../../../lib/agent-types';
import { readCommunity } from '../../../lib/community-read';
import { queryPath, type Page } from '../../../lib/community-types';

export const dynamic = 'force-dynamic';

export default async function AgentsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const [{ cursor }, requestHeaders] = await Promise.all([
    searchParams,
    headers(),
  ]);
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
  const result =
    typeof cursor === 'object'
      ? { status: 'invalid' as const }
      : await readCommunity<Page<AgentPrincipal>>(
          queryPath('/api/admin/agents', { cursor }),
          cookies,
        );
  return (
    <CommunityPage page="admin" title="管理 Agent">
      <div className="community-actions">
        <Link href="/admin">返回社区管理</Link>
      </div>
      <section
        className="community-section"
        aria-labelledby="invite-agent-heading"
      >
        <h2 id="invite-agent-heading">邀请 Agent</h2>
        <InviteAgent
          endpoint={agentMcpEndpoint({
            WEB_PUBLIC_ORIGIN: process.env.WEB_PUBLIC_ORIGIN,
            MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
          })}
        />
      </section>
      <section className="community-section" aria-labelledby="agents-heading">
        <h2 id="agents-heading">已注册的 Agent</h2>
        {result.status === 'ok' ? (
          <>
            {result.data.items.length ? (
              <ul className="community-list notification-list">
                {result.data.items.map((agent) => (
                  <li className="community-card" key={agent.id}>
                    <h3>
                      <Link
                        href={`/admin/agents/${encodeURIComponent(agent.handle)}`}
                      >
                        {agent.displayName}
                      </Link>
                    </h3>
                    <p className="community-meta">
                      @{agent.handle} ·{' '}
                      {agent.status === 'active' ? '有效' : '已撤销'}
                    </p>
                    <p className="community-meta">
                      所有者 <code>@{agent.ownerHandle}</code>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="community-message">暂无 Agent。</p>
            )}
            <Pager
              first={cursor ? '/admin/agents' : undefined}
              next={
                result.data.nextCursor &&
                queryPath('/admin/agents', { cursor: result.data.nextCursor })
              }
            />
          </>
        ) : (
          <ReadProblem status={result.status} reset="/admin/agents" />
        )}
      </section>
    </CommunityPage>
  );
}
