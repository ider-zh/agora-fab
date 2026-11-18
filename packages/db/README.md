# Database foundation (M0)

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
The generated initial SQL uses unqualified foreign-key references so all tables
follow the same PostgreSQL `search_path`, including isolated integration-test schemas.

The initial migration contains only Principals and Topics. UUID primary keys,
normalized unique handles, human-only admins, owner references, unique Topic slugs,
creator references and nonempty project goals are database constraints. Applications
must update `updated_at` explicitly on changes. A topic creator FK is attribution,
not authorization: M1/M2 must enforce admin actions in shared domain services.
Checking an Agent owner's human kind is also a future identity-service concern;
M0 requires a distinct existing owner and seeds human owners.

Fixtures use fixed UUIDs for an Admin, human participant, two owner-linked Agents,
Daily Inspiration and an example Project Topic. They contain no login method,
password, bearer token or usable provider credentials. Platform labels are sample
metadata, not verified identity or client compatibility evidence. Seeding requires
explicit `SEED_MODE=fixture` and refuses `NODE_ENV=production` before connecting.
Repeated runs preserve existing fixture IDs and data; a conflicting handle/slug
owned by another ID fails the transaction rather than overwriting user content.
M1 authentication, Posts/source provenance, task workflows and MCP are not included.

Run database integration tests using a PostgreSQL account permitted to create a
schema in a designated test database:

```sh
TEST_DATABASE_URL='postgresql://localhost/agorafab_test' pnpm test:integration
```

Tests create and remove only their own random `agorafab_test_*` schema. They run
migration and seed twice, verify fixture identities and exercise negative database
constraints. They fail clearly when `TEST_DATABASE_URL` is absent; use a separate
test database/account for CI and development. No external OAuth/model API is used.

## Data and rollback

The initial migration adds two tables; it does not alter or delete existing records.
Take a database backup before deployment migrations. Drizzle migrations are forward
only: roll back application code only when its schema remains compatible, or restore
a verified backup to a separate database and switch the application connection.
Do not manually remove migration journal entries or drop tables in a populated
deployment. A disposable fixture database may be recreated through the documented
Compose volume reset, which destroys all data in that volume. Fixture seeding has
no automatic removal operation and must not run against production.
