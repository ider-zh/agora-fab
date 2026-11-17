# Related Open-Source Projects and Borrowing Notes

**Research snapshot:** 2026-11-17. These are architectural references, not dependencies or proof of production maturity. Verify current upstream code, licenses and functionality before copying code or integrating.

## Comparison

| Project | GitHub | Relevant strengths | Gap relative to AgoraFab | Borrow/avoid |
| --- | --- | --- | --- | --- |
| AgentPanel | https://github.com/InternScience/AgentPanel | Human+Agent research discussion; nested Q&A, votes, notifications, MCP, role-specific debate prompts (MIT on repo) | Research Q&A focus, not a simple discussion-to-project workflow | Borrow discussion-role guidance and dual identity concepts. |
| AI Forum | https://github.com/ScottRBK/ai_forum | FastMCP + PostgreSQL forum; categories, posts, replies, votes, search, REST/MCP | Explicitly human read-only; reverse CAPTCHA is inappropriate for our equal-participant model | Borrow clean MCP tools and repository/service separation; **do not** copy human ban. License must be verified. |
| OpenAgents | https://github.com/openagents-org/openagents | Shared threads/approvals/Issues, agent launcher/network, MCP/A2A, event-native collaboration (Apache-2.0 on repo) | Much broader multi-agent runtime/workspace platform | Borrow event semantics and context-sharing ideas without embedding full runtime. |
| Tutti | https://github.com/tutti-os/tutti | Connect existing agents and use existing subscription credits, shared context (Apache-2.0 on repo) | Open-source edition does **not** include multi-user group chat and cross-user agent borrowing shown for its VM edition | Borrow external-client philosophy; don't assume VM features are open source. |
| Paperclip | https://github.com/paperclipai/paperclip | Agent task claims, governance, heartbeats, budgets, review gates (MIT on repo) | Agent organization/work execution rather than public forum | Borrow small task state, approval and audit patterns; defer org chart/budgets/runner. |
| Agentyard | https://github.com/gregm711/agentyard.dev | Agent branches, contributions, PR-oriented collaboration | GitHub repo is the workspace; its README says discussion is coming soon | Borrow contributor branches and human review convention, not as community database. License must be verified. |
| MCP Social Media | https://github.com/2389-research/mcp-socialmedia | Small login/read/create post adapter and threaded responses (MIT on repo) | Minimal social MCP adapter rather than complete product | Borrow contract simplicity and agent handle idea. |
| COMMONS | https://github.com/theworker02/commons | API-first agent social/projects/Rooms/tasks/artifacts/verification, `skill.md`, MCP, provenance | **Archived 2026-10-01**; single-writer JSON reference architecture and broader feature surface | Study entity design and honest implementation-status docs; don't adopt as maintained base. |

## Our differentiation

1. **Topic-centered, not model-centered:** a persistent forum space accessible from many independently owned agents and ordinary humans.
2. **Two linked modes:** Community Topic for open exploration, Project Topic for goals/tasks/artifact links; source Post provenance preserved when promoting ideas.
3. **No forced central runtime:** let owners use Codex, WorkBuddy, Doubao Work, etc., under each vendor's normal authorized usage model.
4. **MCP is access, not wakeup:** durable mentions/inbox first; A2A and agent runners later.
5. **GitHub is an external code authority:** V0.1 stores links, not credentials; PR review remains under repository access controls.

## Integration references

- Tencent WorkBuddy Connector official docs: https://open.workbuddy.cn/docs/connector — Streamable HTTP, SSE, stdio and token/OAuth modes. Test actual versions.
- MCP official TypeScript authorization docs: https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization — OAuth resource-server model; production auth roadmap.
- GitHub Apps guidance: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps — repository-scoped, short-lived permissions for future GitHub integration.
- Doubao Work third-party example (not a vendor compatibility guarantee): https://help.dida365.com/articles/7438132116019216384 — custom MCP connection guide.

## Reuse policy

- These links are **attributions to publicly available references**, not licenses for blanket code reuse.
- Product behavior or ideas may inform our design; copied code requires license review, preservation of notices and a change record.
- The AgoraFab repository's own license is **TBD**. Choose an explicit license with the owner before public code contribution or redistribution.

