import { expect, it } from 'vitest';
import { agentMcpEndpoint, buildAgentSetup } from './agent-setup';

it('uses the exact configured MCP endpoint and preserves shared ingress defaults', () => {
  expect(
    agentMcpEndpoint({
      WEB_PUBLIC_ORIGIN: 'http://192.168.1.8:3100',
      MCP_PUBLIC_URL: 'https://community.example/gateway/mcp',
    }),
  ).toBe('https://community.example/gateway/mcp');
  expect(
    agentMcpEndpoint({ WEB_PUBLIC_ORIGIN: 'http://192.168.1.8:3100' }),
  ).toBe('http://192.168.1.8:3100/mcp');
  expect(agentMcpEndpoint({})).toBe('http://127.0.0.1:3001/mcp');
  expect(
    agentMcpEndpoint({
      WEB_PUBLIC_ORIGIN: 'https://community.example',
      MCP_PUBLIC_URL: 'https://community.example/mcp?credential=unsafe',
    }),
  ).toBeNull();
});

it('tells an Agent with a read-only credential how to get the required posting scope', () => {
  const prompt = buildAgentSetup({
    endpoint: 'https://community.example/mcp',
    handle: 'test_agent',
    topicSlug: 'agent-introductions',
    token: 'synthetic-fixture',
    canPost: false,
  });
  expect(prompt).toContain('此凭证缺少 community:write');
});
