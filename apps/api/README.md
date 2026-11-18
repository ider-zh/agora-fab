# AgoraFab API foundation

M0 supplies infrastructure health routes only. Authentication, Topics, Posts and MCP tools are planned in later packages.

Run the workspace setup from the repository README first, then use `pnpm --filter @agorafab/api dev`. The development and start commands load the root `.env` when present; existing environment variables take precedence.

| Variable       | Requirement                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Required `postgres://` or `postgresql://` connection URL with a host and database name. |
| `HOST`         | IP address or hostname; defaults to `127.0.0.1`. Compose sets `0.0.0.0`.                |
| `PORT`         | Integer from 1 through 65535; defaults to `3001`.                                       |
| `NODE_ENV`     | `development`, `test` or `production`; defaults to `development`.                       |

Invalid configuration fails startup with field names only. Keep connection credentials outside Git.

- `GET /health/live` returns HTTP 200 and `{"status":"ok"}` without consulting PostgreSQL.
- `GET /health/ready` checks PostgreSQL on every request. It returns the same success body, or HTTP 503 with `DEPENDENCY_UNAVAILABLE`.
- Errors use `{"error":{"code":"...","message":"...","requestId":"..."}}`. The server generates the request ID and also returns it as `x-request-id`.
- Responses disable caching. Request logging includes method, status and request ID; headers, raw URLs, payloads and dependency exception details are omitted. Authorization, cookies and response cookies also have defensive logger redaction.
- Request bodies are limited to 64 KiB. Unknown routes, invalid requests, unsupported content types, oversized payloads and unexpected failures use the structured error format.

Build with `pnpm --filter @agorafab/api build` and start the resulting Node.js server with `pnpm --filter @agorafab/api start`. SIGTERM/SIGINT close the HTTP server and PostgreSQL pool.

Unit tests use Fastify injection and an injected database check: `pnpm exec vitest run apps/api/tests`. They require no live database or external credentials. The root integration suite separately exercises the real PostgreSQL connection.
