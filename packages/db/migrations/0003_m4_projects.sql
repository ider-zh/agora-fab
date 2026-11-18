CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_version" integer NOT NULL,
	CONSTRAINT "artifacts_task_version_unique" UNIQUE("task_id","task_version"),
	CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('pr', 'document', 'research', 'commit', 'preview', 'other')),
	CONSTRAINT "artifacts_url_check" CHECK (length("artifacts"."url") <= 2048 and "artifacts"."url" ~ '^https://[^[:space:]]+$'),
	CONSTRAINT "artifacts_description_size_check" CHECK (length("artifacts"."description_md") <= 12000),
	CONSTRAINT "artifacts_task_version_check" CHECK ("artifacts"."task_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"source_post_id" uuid,
	"title" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"assignee_id" uuid,
	"reviewer_id" uuid,
	"review_note" text,
	"decision_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_check" CHECK (length("tasks"."title") between 1 and 200 and "tasks"."title" ~ '[^[:space:]]'),
	CONSTRAINT "tasks_text_sizes_check" CHECK (length("tasks"."description_md") <= 12000 and coalesce(length("tasks"."review_note"), 0) <= 12000 and coalesce(length("tasks"."decision_note"), 0) <= 12000),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('proposed', 'open', 'claimed', 'submitted', 'in_review', 'done', 'changes_requested', 'cancelled')),
	CONSTRAINT "tasks_version_check" CHECK ("tasks"."version" > 0),
	CONSTRAINT "tasks_unassigned_status_check" CHECK ("tasks"."status" not in ('proposed', 'open') or ("tasks"."assignee_id" is null and "tasks"."reviewer_id" is null)),
	CONSTRAINT "tasks_assignee_required_check" CHECK ("tasks"."status" not in ('claimed', 'submitted', 'in_review', 'done', 'changes_requested') or "tasks"."assignee_id" is not null),
	CONSTRAINT "tasks_reviewer_required_check" CHECK ("tasks"."status" not in ('in_review', 'done', 'changes_requested') or "tasks"."reviewer_id" is not null),
	CONSTRAINT "tasks_review_independence_check" CHECK ("tasks"."reviewer_id" is null or "tasks"."reviewer_id" is distinct from "tasks"."assignee_id")
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "origin_post_id" uuid;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "repo_url" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_submitted_by_principals_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_principals_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_id_principals_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_post_topic_fk" FOREIGN KEY ("source_post_id","topic_id") REFERENCES "posts"("id","topic_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_task_created_idx" ON "artifacts" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_topic_status_created_idx" ON "tasks" USING btree ("topic_id","status","created_at","id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_origin_post_id_posts_id_fk" FOREIGN KEY ("origin_post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topics_origin_post_idx" ON "topics" USING btree ("origin_post_id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_project_provenance_check" CHECK ("topics"."kind" = 'project' or ("topics"."origin_post_id" is null and "topics"."repo_url" is null));--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_repo_url_check" CHECK ("topics"."repo_url" is null or (length("topics"."repo_url") <= 2048 and "topics"."repo_url" ~ '^https://[^[:space:]]+$'));