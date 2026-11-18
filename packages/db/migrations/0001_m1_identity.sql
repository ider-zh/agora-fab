CREATE TABLE "agent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "agent_credentials_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agent_credentials_hash_check" CHECK ("agent_credentials"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_credentials_scopes_check" CHECK (cardinality("agent_credentials"."scopes") between 1 and 16 and array_position("agent_credentials"."scopes", null) is null)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_identities" (
	"github_id" text PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	CONSTRAINT "github_identities_principal_id_unique" UNIQUE("principal_id"),
	CONSTRAINT "github_identities_id_check" CHECK ("github_identities"."github_id" ~ '^[1-9][0-9]{0,19}$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"principal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_principal_id_operation_key_pk" PRIMARY KEY("principal_id","operation","key"),
	CONSTRAINT "idempotency_records_key_check" CHECK (length("idempotency_records"."key") between 1 and 128),
	CONSTRAINT "idempotency_records_operation_check" CHECK (length("idempotency_records"."operation") between 1 and 128),
	CONSTRAINT "idempotency_records_hash_check" CHECK ("idempotency_records"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "idempotency_records_response_check" CHECK (jsonb_typeof("idempotency_records"."response_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "oauth_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_attempts_hash_check" CHECK ("oauth_attempts"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "oauth_attempts_verifier_check" CHECK ("oauth_attempts"."code_verifier" ~ '^[A-Za-z0-9._~-]{43,128}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_hash_check" CHECK ("sessions"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "principals" ADD COLUMN "capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_principals_id_fk" FOREIGN KEY ("agent_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_principals_id_fk" FOREIGN KEY ("actor_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_identities" ADD CONSTRAINT "github_identities_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_credentials_agent_idx" ON "agent_credentials" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_credentials_expiry_idx" ON "agent_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "idempotency_records_created_idx" ON "idempotency_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "oauth_attempts_expiry_idx" ON "oauth_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_principal_idx" ON "sessions" USING btree ("principal_id");--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_capabilities_check" CHECK (cardinality("principals"."capabilities") <= 16 and array_position("principals"."capabilities", null) is null);