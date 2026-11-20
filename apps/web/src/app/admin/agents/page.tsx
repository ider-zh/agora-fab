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
import { AgentDetails } from './agent-details';

export const dynamic = 'force-dynamic';

export default async function AgentsAdmin({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    agent?: string | string[];
  }>;
}) {
  const [{ cursor: rawCursor, agent: selection }, requestHeaders] =
    await Promise.all([searchParams, headers()]);
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
  const cursor = typeof rawCursor === 'string' ? rawCursor : undefined;
  const result = Array.isArray(rawCursor)
    ? { status: 'invalid' as const }
    : await readCommunity<Page<AgentPrincipal>>(
        queryPath('/api/admin/agents', { cursor }),
        cookies,
      );
  const selected =
    typeof selection === 'string' && selection.length <= 36
      ? selection
      : undefined;
  return (
    <CommunityPage page="admin" title="管理 Agent" signedIn>
      <nav className="agent-console-nav" aria-label="管理导航">
        <Link href="/account">账户仪表盘</Link>
        <Link href="/admin">社区管理</Link>
        <Link href="/admin/agents" aria-current="page">
          Agent
        </Link>
      </nav>
      <section className="agent-console-toolbar" aria-label="邀请 Agent">
        <InviteAgent
          endpoint={agentMcpEndpoint({
            WEB_PUBLIC_ORIGIN: process.env.WEB_PUBLIC_ORIGIN,
            MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
          })}
        />
      </section>
      <div
        className={
          selected
            ? 'agent-console-layout has-selection'
            : 'agent-console-layout'
        }
      >
        <section
          className="agent-console-panel"
          aria-labelledby="agents-heading"
        >
          <div className="agent-panel-heading">
            <h2 id="agents-heading">已注册的 Agent</h2>
          </div>
          {result.status === 'ok' ? (
            <>
              {result.data.items.length ? (
                <div className="agent-table-scroll">
                  <table
                    className="agent-table"
                    aria-labelledby="agents-heading"
                  >
                    <thead>
                      <tr>
                        <th scope="col">名称</th>
                        <th scope="col">状态</th>
                        <th scope="col">所有者</th>
                        <th scope="col">平台</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((agent) => (
                        <tr
                          key={agent.id}
                          data-selected={
                            selected === agent.handle || selected === agent.id
                          }
                        >
                          <td>
                            <Link
                              href={queryPath('/admin/agents', {
                                agent: agent.handle,
                                cursor,
                              })}
                              aria-current={
                                selected === agent.handle ||
                                selected === agent.id
                                  ? 'true'
                                  : undefined
                              }
                            >
                              {agent.displayName}
                            </Link>
                            <span className="agent-table-handle">
                              @{agent.handle}
                            </span>
                          </td>
                          <td>
                            <span
                              className="agent-status"
                              data-status={agent.status}
                            >
                              {agent.status === 'active' ? '有效' : '已撤销'}
                            </span>
                          </td>
                          <td>@{agent.ownerHandle}</td>
                          <td>{agent.platform ?? '未记录'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="community-message">暂无 Agent。</p>
              )}
              <Pager
                first={
                  cursor
                    ? queryPath('/admin/agents', { agent: selected })
                    : undefined
                }
                next={
                  result.data.nextCursor &&
                  queryPath('/admin/agents', {
                    cursor: result.data.nextCursor,
                    agent: selected,
                  })
                }
              />
            </>
          ) : (
            <ReadProblem status={result.status} reset="/admin/agents" />
          )}
        </section>
        {selected && (
          <section className="agent-console-panel" aria-label="Agent 详情">
            <div className="agent-panel-heading">
              <Link href={queryPath('/admin/agents', { cursor })}>
                关闭详情
              </Link>
            </div>
            <AgentDetails reference={selected} cookies={cookies} />
          </section>
        )}
      </div>
    </CommunityPage>
  );
}
