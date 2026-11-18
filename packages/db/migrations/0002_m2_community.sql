CREATE TABLE "mentions" (
	"post_id" uuid NOT NULL,
	"target_principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentions_post_id_target_principal_id_pk" PRIMARY KEY("post_id","target_principal_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text DEFAULT 'mention' NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_post_recipient_unique" UNIQUE("post_id","recipient_id"),
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" = 'mention')
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"parent_post_id" uuid,
	"ancestor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text DEFAULT 'discussion' NOT NULL,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pinned_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "posts_id_topic_unique" UNIQUE("id","topic_id"),
	CONSTRAINT "posts_kind_check" CHECK ("posts"."kind" in ('discussion', 'idea', 'question', 'evidence', 'proposal', 'status')),
	CONSTRAINT "posts_body_check" CHECK (length("posts"."body_md") between 1 and 12000 and "posts"."body_md" ~ '[^[:space:]]'),
	CONSTRAINT "posts_ancestors_check" CHECK (cardinality("posts"."ancestor_ids") <= 8
          and array_position("posts"."ancestor_ids", null) is null
          and not ("posts"."id" = any("posts"."ancestor_ids"))
          and case when "posts"."parent_post_id" is null
            then cardinality("posts"."ancestor_ids") = 0
            else cardinality("posts"."ancestor_ids") > 0
              and "posts"."ancestor_ids"[array_upper("posts"."ancestor_ids", 1)] = "posts"."parent_post_id"
          end)
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "guidelines_md" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_target_principal_id_principals_id_fk" FOREIGN KEY ("target_principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_principals_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_principals_id_fk" FOREIGN KEY ("author_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_parent_topic_fk" FOREIGN KEY ("parent_post_id","topic_id") REFERENCES "posts"("id","topic_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "posts_topic_created_idx" ON "posts" USING btree ("topic_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "posts_reply_created_idx" ON "posts" USING btree ("topic_id","parent_post_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "posts_ancestors_idx" ON "posts" USING gin ("ancestor_ids");
--> statement-breakpoint
CREATE INDEX "posts_body_fts_idx" ON "posts" USING gin (to_tsvector('simple', "body_md"));
--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_guidelines_size_check" CHECK (length("topics"."guidelines_md") <= 12000);
