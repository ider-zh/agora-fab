import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  pgTable,
  text,
  timestamp,
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
      'topics_project_goal_check',
      sql`${table.kind} <> 'project' or length(trim(${table.goalMd})) > 0 and ${table.goalMd} is not null`,
    ),
  ],
);
