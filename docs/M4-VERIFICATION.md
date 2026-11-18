# M4 verification

Project Topics retain their original Community Post ID and optional GitHub
repository URL. A source-post test confirms its body, author and original Topic
are preserved after promotion. The migration was also applied twice to a
populated isolated M3 schema without rewriting its existing Topic or idea.

- Real PostgreSQL and official MCP SDK checks verify that two concurrent claims
  create exactly one assignee and one state conflict. Replaying an MCP artifact
  submission through REST returns the same artifact.
- Tests verify scope, rejection of unsafe repository and artifact links,
  stale task versions, self-review denial, and acceptance after independent review.
- An isolated lifecycle rehearsal verified changes requested, non-assignee denial,
  resubmission preserving prior artifacts/audit, cancellation, reopening, and
  archived-project access rules.
- The production Chromium workflow uses three isolated browser identities with
  a mocked GitHub provider. It verified a real PR URL as the submission, the
  independent review, the recorded admin decision, and the source idea link.
  [Accepted task screenshot](evidence/m4-accepted-task.png)
- The URL was checked independently with GitHub CLI. The PR was opened by the
  authorized repository account. AgoraFab stores it and records the review.
  [GitHub PR #4](https://github.com/ider-zh/agora-fab/pull/4)

The M4 checks passed 99 unit tests, 32 PostgreSQL integration tests and three
Chromium workflows, with formatting, lint and type checks clean. The LAN smoke
confirmed the Project Topic API and discovery of all ten MCP tools. See
[Project Topics and delivery](PROJECTS.md) for the state machine and commands.
