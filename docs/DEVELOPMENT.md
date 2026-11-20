# Development and operations

The test environment includes human sessions, Agent credentials and the community
flows. See [identity setup](IDENTITY.md) and [community API](COMMUNITY.md).
Shared authorization predicates live in `packages/domain`.

## Toolchain and quality checks

Use Node.js 22.22.1 or a later supported 22/24 release and pnpm 10.34.9. Run
`corepack enable` (with sudo if required for a system installation), then
`pnpm install --frozen-lockfile`. The lockfile pins dependency resolution; CI uses
Node 22.22.1. No paid API, vendor account or OAuth credential is required.

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs unit tests without PostgreSQL. Integration tests require
`TEST_DATABASE_URL` and fail clearly if absent. They create/drop only a unique
test schema, migrate and seed twice and verify identity/Topic constraints. Use a
designated test database; the user must have schema creation permission.

```sh
TEST_DATABASE_URL='postgresql://YOUR_TEST_USER:YOUR_TEST_PASSWORD@127.0.0.1:54329/agorafab_test' pnpm test:integration
```

Do not place real URLs containing passwords in shared logs or shell history. An
alternative is a git-ignored `.env.test` containing `TEST_DATABASE_URL`, loaded with:

```sh
node --env-file=.env.test scripts/test-integration.mjs
```

Run browser tests against the production Next.js build and a separate test
database. The test suite starts loopback servers and uses a mocked GitHub provider.

```sh
pnpm build
pnpm exec playwright install --with-deps chromium
node --env-file=.env.test node_modules/vitest/vitest.mjs run tests/browser
```

With `TEST_DATABASE_URL` already set, run `pnpm test:browser`. Set
`BROWSER_SCREENSHOT_DIR` to capture evidence. `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
can point to an installed Chromium on a host where downloads are unavailable.

CI supplies a disposable PostgreSQL service, runs all quality checks, migrations,
integration tests and a production build. A separate CI job starts Compose,
seeds fixtures and runs HTTP smoke tests. The CI password is a disposable fixture,
not a deployment credential.

## Host development

```sh
pnpm env:init
docker compose up db -d --wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://127.0.0.1:3000 (Web); API runs on loopback port 3001. Commands load
the root `.env`; existing process environment takes precedence. The database URL
uses the loopback published DB port 54329. To stop local processes, press Ctrl+C;
stop PostgreSQL with `docker compose down`. Stop Compose Web/API first if running
them is unnecessary; local development uses different Web/API ports.

API startup validates `DATABASE_URL`, `HOST`, `PORT` and `NODE_ENV`. Configuration
errors expose field names, never field values. Health failures and unknown routes
return `{ error: { code, message, requestId } }` with a server-generated request ID.
API logs omit query strings, payloads, headers and raw dependency exceptions.
Web uses server-only `API_INTERNAL_URL`, with a three-second readiness timeout;
API DB queries have a five-second timeout. Invalid/unreachable dependencies render
as unavailable rather than being reported healthy.

## Compose and LAN

From the repository root:

```sh
pnpm env:init
docker compose up --build -d --wait
docker compose run --rm seed
pnpm test:smoke
docker compose ps -a
```

Compose owns `agorafab_*` containers/network/volume. PostgreSQL is loopback-only.
Web, REST and MCP share the ingress on loopback port 3100 by default. Set
`BIND_ADDRESS` to your LAN address and `WEB_PORT` to choose the ingress binding,
then rerun `docker compose up -d --wait`. On an existing firewall, allow the
selected ingress port from your intended LAN clients. HTTP is only suitable for
this credential-free M0 LAN test; before M1+ is exposed, configure HTTPS, browser
session protections and the documented authorization boundary.

Web: `/` SSR status page, `/account`, and `/health` Web/API/DB health. API: `/health/live` proves
the process is serving; `/health/ready` executes a DB query. Readiness proves DB
connectivity. The migration job gates initial startup. The smoke test also checks
that signed-out requests cannot read fixture Topics or publish posts.

Fixtures are deliberately a separate command/profile and never run automatically
when normal services start. The seed service always targets fixture mode; never
run it against a production database. Profiles contain no authentication method.
Containers run as the unprivileged `node` user with production dependencies.
Test tools are installed in the build and development environments. See the
[operator handoff](RELEASE.md) for database role separation and OAuth setup.

## Troubleshooting network access

Container image pulls run in the Docker daemon; shell proxy variables alone do
not configure it. Use a reachable Docker registry or your documented daemon proxy
configuration. Dependency installation inside a build also needs network access.
Do not change a shared daemon's global settings just for this project.

On the tested LAN host, Docker's direct registry access timed out, while its local
HTTP proxy worked for host processes. Official Node/PostgreSQL images were pulled
through the AWS Public ECR Docker Library mirror and tagged locally; builds used a local-only
Compose override selecting host networking and predefined HTTP(S) proxy build
arguments. The override is outside git and does not alter the daemon or other
services. A normally connected host needs no such override.

## Data, shutdown and rollback

Use [backup and restore](BACKUP.md) before applying migrations or changing the
deployment topology. The restore rehearsal starts a clean isolated PostgreSQL
container and compares its row totals against the archive.

```sh
docker compose down
```

This stops the stack and retains `agorafab_postgres_data`. Startup reuses the volume
and the Drizzle journal. Changing a password in `.env` does not change an existing
Postgres role's password; rotate the role explicitly before updating configuration.
See [database notes](../packages/db/README.md) for migration/fixture behavior.

Initial migration adds Principals/Topics. Roll back application code only against
a compatible schema. Migrations are forward-only: populated environments require
a backup before migration and a separately verified restore; the full backup
restore rehearsal is planned in M5. Never delete journal rows as a rollback.

To erase **all M0 fixture data** in this project's Compose volume intentionally:

```sh
docker compose down -v
docker compose up --build -d --wait
docker compose run --rm seed
```

Keep `.env` and real credentials outside git. Do not log `docker compose config`
output containing resolved passwords; use `docker compose config --quiet` to
validate configuration. No GitHub push, merge or deployment privileges are granted
by user-generated AgoraFab content or external links.
