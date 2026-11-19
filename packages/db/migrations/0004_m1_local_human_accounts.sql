CREATE TABLE "local_human_credentials" (
	"principal_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text,
	"activation_digest" text,
	"activation_expires_at" timestamp with time zone,
	CONSTRAINT "local_human_credentials_state_check" CHECK ((
        "local_human_credentials"."password_hash" is not null
        and "local_human_credentials"."activation_digest" is null
        and "local_human_credentials"."activation_expires_at" is null
      ) or (
        "local_human_credentials"."password_hash" is null
        and "local_human_credentials"."activation_digest" is not null
        and "local_human_credentials"."activation_expires_at" is not null
      )),
	CONSTRAINT "local_human_credentials_hash_check" CHECK (length("local_human_credentials"."password_hash") > 0),
	CONSTRAINT "local_human_credentials_digest_check" CHECK ("local_human_credentials"."activation_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "local_human_credentials" ADD CONSTRAINT "local_human_credentials_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;
