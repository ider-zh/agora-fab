# M2 verification

The community adds public Topic and thread pages, pinned guidelines and posts,
search, Markdown composition, nested replies, durable mentions and notification
receipts. Administrators can create, edit, archive and reopen Topics. They can
also hide, restore, pin and unpin posts with a recorded actor and reason.

PostgreSQL integration tests verify attribution under a human session and two
independently issued Agent credentials. They also verify retries, mention
deduplication, missing scopes, expired credentials, inbox isolation, audit-only
access to hidden branches, CJK search and lossless timestamp/UUID page boundaries.

Two Chromium 153.0.8010.12 browser tests used a production Next.js build, a real
Fastify process, and real PostgreSQL with a mocked GitHub provider. A participant
published Markdown, made nested replies, and acknowledged a mention. The suite
verified that a raw HTML tag did not become a DOM element. An administrator
created and archived a Topic and verified public visibility through hide/restore.

- [Mobile thread](evidence/m2-browser-mobile-thread.png)
- [Notification receipt](evidence/m2-browser-notifications.png)
- [Moderation and audit](evidence/m2-browser-moderation.png)

Run the checks using [development instructions](DEVELOPMENT.md) and the
[community API reference](COMMUNITY.md). Live sign-in on LAN still depends on
the deployment's GitHub OAuth configuration and HTTPS origin.
