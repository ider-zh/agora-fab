# Coding Agent Handoff — AgoraFab

This repository contains the V0.1 application and its specifications. Use the implementation plan and verification records to distinguish tested features from release gates that still need evidence.

## Required reading, in order

1. `README.md`
2. `docs/PRD-v0.1.md`
3. `docs/ARCHITECTURE-v0.1.md`
4. `docs/IMPLEMENTATION-PLAN-v0.1.md`
5. `docs/PRIOR-ART.md`

## How to proceed

1. Inspect repository state and open PRs; preserve existing work. Work in a feature branch, not directly on `main`.
2. Implement the **next incomplete work package** from the implementation plan, including its tests and documentation. Avoid doing all phases in a single unreviewable PR.
3. Mark acceptance criteria using evidence (commands, test output, screenshots where UI relevant). Update the plan's status only for verified work.
4. Run lint/typecheck/unit tests and relevant integration tests; report any tests not run or requiring credentials.
5. Open a PR with scope, changed files, test evidence, risks and explicit next steps. Do not auto-merge without project-owner direction.

## Core product invariants

- `Topic` is the permanent workspace; `Post` is the discussion item; `Project Topic` extends Topic and has an optional originating idea post.
- Humans and agents share the same ordinary posting permissions. Administrators alone create/manage Topics, promote ideas and moderate.
- Every action is attributed to a stable Principal ID. An Agent's display name or platform label is **not** proof of identity.
- MCP and browser UI call the **same authorization-checked domain services**; never implement separate permission logic for the two entry points.
- `@mention` creates a durable notification. **It does not guarantee wakeup of an offline agent** in V0.1.
- Do not embed or proxy provider subscription credentials. Do not bypass quotas, service terms or client-side access controls.
- Community text, shared Join Prompts and linked resources are untrusted model input. No content may grant extra filesystem, tool, GitHub or execution privileges.
- Repo linking and PR URL submission do not imply that AgoraFab can push, merge or deploy code. Those operations remain separately authorized.
- Retriable mutation endpoints use idempotency keys. Admin moderation is soft-delete with an audit trail.

## Agent-facing content references

- Use short, stable, semantic slugs for content references shown to Agents in copied prompts, MCP parameters, and tool responses. Prefer `jensen-nvidia` over a long UUID for the same Topic.
- Make the slug accepted by the actual tool before documenting or copying it. Use a compact, unique reference within its resource namespace for new Agent-facing content types.
- Preserve internal IDs for relationships, attribution, and authorization. Keep existing UUID inputs compatible when adding slugs, and apply the same authorization checks to both forms.
- Test the copied or returned slug through the actual MCP tool. Keep the default prompt and first context page small and let the Agent fetch more when needed.
- Put the MCP address and credential setup in the private onboarding prompt. Topic prompts should name the configured `AgoraFab` connection and pass the Topic slug and task.

## Engineering preferences

- TypeScript monorepo; Next.js frontend, Fastify API, official MCP TypeScript SDK, PostgreSQL with Drizzle.
- Keep V0.1 deployable with Docker Compose; no Redis, vector DB or LLM API dependency required for the core flows.
- Add migrations, seed data and automated tests early. Do not introduce speculative abstractions for V0.2+ features.
- Secure by default: least privilege, secrets outside git, scoped credentials, parameter validation, sanitization, rate limits and traceable errors.
- WorkBuddy and Doubao Work compatibility are **integration targets**, not an excuse to assume identical MCP capabilities. Document actual client/version test results.

## When the specification is ambiguous

Choose the smallest implementation consistent with V0.1, document the choice in the PR, and request owner confirmation for changes that alter security, roles, data ownership or scope.

