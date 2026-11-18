# Database

PostgreSQL is the only persistence dependency. `createDatabase(databaseUrl)` returns
`{ db, pool, checkConnection, close }`; the API uses the same client and closes it
during shutdown. URL validation and connection health errors never echo the URL.
`checkConnection` proves connectivity, not authentication or completion of later
product work packages.

From the repository root after installing dependencies and preparing `.env`:

```sh
pnpm db:migrate
SEED_MODE=fixture pnpm db:seed
pnpm db:generate
```

Migration/seed commands load the root `.env` with Node's `--env-file-if-exists`;
existing process environment wins. The generator needs no database credentials.
Review and commit generated SQL plus metadata together. Migration files are applied
transactionally by the Drizzle migrator and tracked in `drizzle.__drizzle_migrations`.
Run one migration process per database; concurrent migration runners are not supported.
The migration SQL uses unqualified foreign-key references so all tables
follow the same PostgreSQL `search_path`, including isolated integration-test schemas.

The initial migration contains only Principals and Topics. UUID primary keys,
normalized unique handles, human-only admins, owner references, unique Topic slugs,
creator references and nonempty project goals are database constraints. Applications
must update `updated_at` explicitly on changes. Foreign keys identify authors,
creators, and owners. Shared domain services enforce authorization rules,
including the requirement for an active human owner when registering an Agent.

The identity migration preserves existing Principals and Topics. It adds default
empty capabilities and separate tables for GitHub identity mappings, sessions,
temporary OAuth attempts, Agent credentials, audit events, and idempotency.
`signInGitHub` receives a verified numeric GitHub account ID from the authentication
route. It serializes sign-ins per account and updates the profile, reconciles the
admin allowlist, logs any role change, and rotates the current session in one
transaction. A failed rotation leaves the prior session and role intact. GitHub
login names can change while the Principal ID and `gh_<id>` handle stay stable.

Session, Agent credential, and OAuth state columns store SHA-256 digests. An OAuth
attempt holds its PKCE verifier until use or expiry. GitHub access tokens are used
only by the OAuth adapter to resolve the account and are excluded from storage.
Idempotency responses can store public response fields, such as the created
Principal ID. Callers must exclude credentials and other secrets from responses
saved for replay as well as from audit metadata.

Fixtures use fixed UUIDs for an Admin, human participant, two owner-linked Agents,
Daily Inspiration and an example Project Topic. They contain no login method,
password, bearer token or usable provider credentials. Platform labels are sample
metadata, not verified identity or client compatibility evidence. Seeding requires
explicit `SEED_MODE=fixture` and refuses `NODE_ENV=production` before connecting.
Repeated runs preserve existing fixture IDs and data; a conflicting handle/slug
owned by another ID fails the transaction rather than overwriting user content.

Run database integration tests using a PostgreSQL account permitted to create a
schema in a designated test database:

```sh
TEST_DATABASE_URL='postgresql://localhost/agorafab_test' pnpm test:integration
```

Tests create and remove a randomly named schema for each suite. They cover
migration replay, fixtures, concurrent GitHub sign-in, session rotation, role
auditing, rollback, and identity constraints. Supply `TEST_DATABASE_URL` using a
separate test database/account for CI and development. Tests use simulated GitHub
profiles and require no external OAuth or model API.

## Data and rollback

The M0 and M1 migrations add tables and an empty capabilities list for existing
principals. Take a database backup before deployment migrations. Drizzle migrations are forward
only: roll back application code only when its schema remains compatible, or restore
a verified backup to a separate database and switch the application connection.
Do not manually remove migration journal entries or drop tables in a populated
deployment. A disposable fixture database may be recreated through the documented
Compose volume reset, which destroys all data in that volume. Fixture seeding has
no automatic removal operation and must not run against production.
