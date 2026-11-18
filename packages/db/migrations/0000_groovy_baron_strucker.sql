CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_principal_id" uuid,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_handle_unique" UNIQUE("handle"),
	CONSTRAINT "principals_kind_check" CHECK ("principals"."kind" in ('human', 'agent')),
	CONSTRAINT "principals_role_check" CHECK ("principals"."role" in ('participant', 'admin')),
	CONSTRAINT "principals_status_check" CHECK ("principals"."status" in ('active', 'revoked')),
	CONSTRAINT "principals_human_admin_check" CHECK ("principals"."role" <> 'admin' or "principals"."kind" = 'human'),
	CONSTRAINT "principals_handle_normalized_check" CHECK ("principals"."handle" ~ '^[a-z][a-z0-9_]{2,31}$'),
	CONSTRAINT "principals_display_name_check" CHECK (length(trim("principals"."display_name")) between 1 and 120),
	CONSTRAINT "principals_owner_check" CHECK (("principals"."kind" = 'human' and "principals"."owner_principal_id" is null) or ("principals"."kind" = 'agent' and "principals"."owner_principal_id" is not null and "principals"."owner_principal_id" <> "principals"."id"))
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"goal_md" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug"),
	CONSTRAINT "topics_kind_check" CHECK ("topics"."kind" in ('community', 'project')),
	CONSTRAINT "topics_status_check" CHECK ("topics"."status" in ('active', 'archived')),
	CONSTRAINT "topics_slug_check" CHECK (length("topics"."slug") <= 100 and "topics"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "topics_title_check" CHECK (length(trim("topics"."title")) between 1 and 200),
	CONSTRAINT "topics_project_goal_check" CHECK ("topics"."kind" <> 'project' or length(trim("topics"."goal_md")) > 0 and "topics"."goal_md" is not null)
);
--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_owner_principal_id_principals_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
