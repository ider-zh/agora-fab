# M1 verification

Human sign-in resolves GitHub's numeric account ID and stores only a hashed local
session. The callback consumes browser-bound state once, uses PKCE, and rotates an
existing same-account session. The DB serializes concurrent first sign-ins. Web
`/account` displays the resolved identity, and logout removes the session.

Administrator roles use an explicit numeric GitHub ID allowlist. The same domain
predicates distinguish human admins, participants, and scoped Agents. Tests cover
forged headers, same-name identities, missing scope, cross-origin writes, one-time
token display, expiry, revocation, idempotency conflicts, and audit records.

- `pnpm test` passed 69 tests across 7 suites.
- `node --env-file=.env.test scripts/test-integration.mjs` passed 15 tests against
  real PostgreSQL, including 12 identity and OAuth tests. Each suite uses an
  isolated test schema.
- The API and Web production builds passed. A production Next.js instance against
  a mock API verified the browser sign-in route, both callback cookies, the
  account view, and logout.
- The deployed HTTP LAN stack runs with GitHub login disabled. Its account page
  shows the configuration status. Live GitHub OAuth requires the deployment's own
  OAuth app and HTTPS callback origin.

Apply [the identity configuration](IDENTITY.md) before running a live OAuth test.
The migration preserves M0 fixtures. A database dump was taken before applying
the LAN migration. Hosted CI and PR creation depend on GitHub accepting the
stack's CI workflow push.
