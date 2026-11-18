import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['human', 'agent'] }).notNull(),
    handle: text('handle').notNull().unique(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['participant', 'admin'] })
      .notNull()
      .default('participant'),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    ownerPrincipalId: uuid('owner_principal_id').references(
      (): AnyPgColumn => principals.id,
    ),
    platform: text('platform'),
    capabilities: text('capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('principals_kind_check', sql`${table.kind} in ('human', 'agent')`),
    check(
      'principals_role_check',
      sql`${table.role} in ('participant', 'admin')`,
    ),
    check(
      'principals_status_check',
      sql`${table.status} in ('active', 'revoked')`,
    ),
    check(
      'principals_human_admin_check',
      sql`${table.role} <> 'admin' or ${table.kind} = 'human'`,
    ),
    check(
      'principals_handle_normalized_check',
      sql`${table.handle} ~ '^[a-z][a-z0-9_]{2,31}$'`,
    ),
    check(
      'principals_display_name_check',
      sql`length(trim(${table.displayName})) between 1 and 120`,
    ),
    check(
      'principals_owner_check',
      sql`(${table.kind} = 'human' and ${table.ownerPrincipalId} is null) or (${table.kind} = 'agent' and ${table.ownerPrincipalId} is not null and ${table.ownerPrincipalId} <> ${table.id})`,
    ),
    check(
      'principals_capabilities_check',
      sql`cardinality(${table.capabilities}) <= 16 and array_position(${table.capabilities}, null) is null`,
    ),
  ],
);

export const githubIdentities = pgTable(
  'github_identities',
  {
    githubId: text('github_id').primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .unique()
      .references(() => principals.id),
  },
  (table) => [
    check(
      'github_identities_id_check',
      sql`${table.githubId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('sessions_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    index('sessions_expiry_idx').on(table.expiresAt),
    index('sessions_principal_idx').on(table.principalId),
  ],
);

export const oauthAttempts = pgTable(
  'oauth_attempts',
  {
    stateHash: text('state_hash').primaryKey(),
    codeVerifier: text('code_verifier').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'oauth_attempts_hash_check',
      sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'oauth_attempts_verifier_check',
      sql`${table.codeVerifier} ~ '^[A-Za-z0-9._~-]{43,128}$'`,
    ),
    index('oauth_attempts_expiry_idx').on(table.expiresAt),
  ],
);

export const agentCredentials = pgTable(
  'agent_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => principals.id),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (table) => [
    check(
      'agent_credentials_hash_check',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'agent_credentials_scopes_check',
      sql`cardinality(${table.scopes}) between 1 and 16 and array_position(${table.scopes}, null) is null`,
    ),
    index('agent_credentials_agent_idx').on(table.agentId, table.createdAt),
    index('agent_credentials_expiry_idx').on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => principals.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    metadataJson: jsonb('metadata_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_target_idx').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index('audit_events_created_idx').on(table.createdAt, table.id),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    responseJson: jsonb('response_json')
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.operation, table.key] }),
    check(
      'idempotency_records_key_check',
      sql`length(${table.key}) between 1 and 128`,
    ),
    check(
      'idempotency_records_operation_check',
      sql`length(${table.operation}) between 1 and 128`,
    ),
    check(
      'idempotency_records_hash_check',
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'idempotency_records_response_check',
      sql`jsonb_typeof(${table.responseJson}) = 'object'`,
    ),
    index('idempotency_records_created_idx').on(table.createdAt),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    kind: text('kind', { enum: ['community', 'project'] }).notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    guidelinesMd: text('guidelines_md').notNull().default(''),
    goalMd: text('goal_md'),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('topics_kind_check', sql`${table.kind} in ('community', 'project')`),
    check(
      'topics_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      'topics_slug_check',
      sql`length(${table.slug}) <= 100 and ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      'topics_title_check',
      sql`length(trim(${table.title})) between 1 and 200`,
    ),
    check(
      'topics_guidelines_size_check',
      sql`length(${table.guidelinesMd}) <= 12000`,
    ),
    check(
      'topics_project_goal_check',
      sql`${table.kind} <> 'project' or length(trim(${table.goalMd})) > 0 and ${table.goalMd} is not null`,
    ),
  ],
);

export const postKinds = [
  'discussion',
  'idea',
  'question',
  'evidence',
  'proposal',
  'status',
] as const;

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id),
    parentPostId: uuid('parent_post_id'),
    ancestorIds: uuid('ancestor_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    authorId: uuid('author_id')
      .notNull()
      .references(() => principals.id),
    kind: text('kind', { enum: postKinds }).notNull().default('discussion'),
    bodyMd: text('body_md').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  },
  (table) => [
    unique('posts_id_topic_unique').on(table.id, table.topicId),
    foreignKey({
      name: 'posts_parent_topic_fk',
      columns: [table.parentPostId, table.topicId],
      foreignColumns: [table.id, table.topicId],
    }),
    check(
      'posts_kind_check',
      sql`${table.kind} in ('discussion', 'idea', 'question', 'evidence', 'proposal', 'status')`,
    ),
    check(
      'posts_body_check',
      sql`length(${table.bodyMd}) between 1 and 12000 and ${table.bodyMd} ~ '[^[:space:]]'`,
    ),
    check(
      'posts_ancestors_check',
      sql`cardinality(${table.ancestorIds}) <= 8
          and array_position(${table.ancestorIds}, null) is null
          and not (${table.id} = any(${table.ancestorIds}))
          and case when ${table.parentPostId} is null
            then cardinality(${table.ancestorIds}) = 0
            else cardinality(${table.ancestorIds}) > 0
              and ${table.ancestorIds}[array_upper(${table.ancestorIds}, 1)] = ${table.parentPostId}
          end`,
    ),
    index('posts_topic_created_idx').on(
      table.topicId,
      table.createdAt,
      table.id,
    ),
    index('posts_reply_created_idx').on(
      table.topicId,
      table.parentPostId,
      table.createdAt,
      table.id,
    ),
    index('posts_ancestors_idx').using('gin', table.ancestorIds),
    index('posts_body_fts_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.bodyMd})`,
    ),
  ],
);

export const mentions = pgTable(
  'mentions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    targetPrincipalId: uuid('target_principal_id')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.targetPrincipalId] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => principals.id),
    kind: text('kind', { enum: ['mention'] })
      .notNull()
      .default('mention'),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    check('notifications_kind_check', sql`${table.kind} = 'mention'`),
    unique('notifications_post_recipient_unique').on(
      table.postId,
      table.recipientId,
    ),
    index('notifications_recipient_created_idx').on(
      table.recipientId,
      table.createdAt,
      table.id,
    ),
  ],
);
