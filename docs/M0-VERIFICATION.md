# M0 verification — 2026-11-18

Scope: the next incomplete work package, **M0 Foundation**, implemented on
`feat/m0-foundation`. Two implementation subagents owned API and DB; the parent
owned Web, Compose, CI and live integration. A third, independent subagent reviewed
the combined code. The repository had only specifications and no open PRs before
this work.

## Implemented

- pnpm 10.34.9/TypeScript monorepo; Next.js 16.4.6 + React 19.3.1 + Tailwind;
  Fastify 5.12.8; PostgreSQL 17.7 + Drizzle 0.45.4.
- SSR shell with clear planned-feature labels and actual dependency status.
- API liveness/readiness, validated startup config, structured errors/request IDs,
  safe logs and graceful shutdown.
- Versioned initial Principals/Topics migration and repeatable credential-free
  fixture profiles/Topics. Seed requires explicit fixture mode and refuses production.
- Docker Compose persistent volume, migration gate, health checks, nonroot app
  processes, local environment initialization and CI quality/Compose jobs.

Headless Firefox 158.0.1 captured the live deployment at desktop (1440×1100) and
mobile (390×1200) widths. The status and planned-feature labels render correctly:
[desktop screenshot](evidence/m0-desktop.png),
[mobile screenshot](evidence/m0-mobile.png). These are layout smoke checks, not
coverage of future discussion interactions or complete accessibility testing.

## Commands and results

All commands below ran on Linux with Node 22.22.1 and pnpm 10.34.9.

| Check                                                    | Result                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                         | Installed all four workspace projects; Docker also installs from the frozen lockfile without host node_modules                        |
| `pnpm format:check`                                      | Passed                                                                                                                                |
| `pnpm lint`                                              | Passed, zero warnings                                                                                                                 |
| `pnpm typecheck`                                         | Passed across API/Web/DB and tests; Web generates Next types first                                                                    |
| `pnpm test`                                              | 49 passed across 4 files                                                                                                              |
| `pnpm db:migrate`                                        | Applied initial migration successfully                                                                                                |
| `pnpm db:seed`                                           | Four profiles and two Topics; no auth credentials                                                                                     |
| `node --env-file=.env.test scripts/test-integration.mjs` | 3 PostgreSQL integration tests passed in a separate test DB; migrations/seed replayed twice in an isolated schema                     |
| `pnpm db:generate`                                       | No schema changes; generated metadata agrees with schema                                                                              |
| `pnpm build`                                             | Web production build, DB JS/declarations and API bundle passed                                                                        |
| `pnpm dev`                                               | Web on 3000 and API on 3001; both readiness endpoints returned 200; processes stopped afterward                                       |
| Compose build/start and fixture seed                     | Built API/Web/migration images, migration exited 0, persistent DB/API/Web healthy; explicit seed command succeeded                    |
| LAN `pnpm test:smoke`                                    | SSR status, security header, Web/API/DB health and structured missing-route response passed                                           |
| PostgreSQL outage/recovery                               | Liveness stayed 200; API/Web readiness became 503; shell stayed 200 with unavailable status; full smoke passed again after DB restart |
| Container-to-LAN HTTP                                    | Web container reached published LAN Web/API health addresses with 200                                                                 |

`docker run --rm --network none agorafab-migrate pnpm --version` also returned
10.34.9 as the unprivileged image user. The shared Corepack cache avoids a runtime
package-manager download.

Database integration tests verify unique normalized handles, human-only Admins,
owner/creator foreign keys, Topic slugs and nonempty project goals. They create and
drop only a random test schema. No deployment database is cleared. The initial
migration has no destructive schema change; rollback/data-reset limits are in
[development notes](DEVELOPMENT.md).

The independent review passed lint/typecheck and 49 unit tests. It found a local
Web/API `PORT` collision, fixed by explicit Web port 3000. Live startup also exposed
Next dev forwarding Node's env-file flag into unsupported worker `NODE_OPTIONS`;
the Web launcher now loads the root environment before spawning Next. Both
documented development processes were then verified together.

## LAN deployment

- Web: http://192.168.1.220:3100
- Web/API/DB health: http://192.168.1.220:3100/health
- API readiness: http://192.168.1.220:3101/health/ready
- PostgreSQL remains bound to loopback 127.0.0.1:54329.
- Only the independent `agorafab` Compose stack was created; existing services and
  shared daemon settings were preserved. No production deployment or merge.

Docker Hub and GCR access timed out on this host. AWS Public ECR's official Docker
Library mirror worked for the pinned Node/Postgres tags. A local file outside git
overrode build networking, predefined HTTP(S) proxy arguments and `NODE_IMAGE`;
the committed Compose file retains normal Docker Hub defaults. See network notes
in [DEVELOPMENT.md](DEVELOPMENT.md). No proxy credentials or local database secrets
are included in the repository.

Verification covers host and container network paths to the LAN IP. A separate
physical LAN device has not been tested. Public HTTPS deployment is not configured.

## Remaining scope

M1–M6 are not implemented. No login, posting, mention inbox, MCP endpoint, task
workflow, provider account, GitHub OAuth, client compatibility or multi-client demo
is claimed. UI currently displays infrastructure health only. Future packages must
implement and test the shared authorization-checked domain services before adding
write adapters. Production backup/restore rehearsal and lean runtime images are
also later work.

GitHub CI is configured and local equivalents passed; check the PR's actual checks
for hosted CI status. Remote client/version tests require the future M3 integration
and actual authorized clients, so none were run for M0.
