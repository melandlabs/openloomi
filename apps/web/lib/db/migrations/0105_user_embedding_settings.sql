-- User-configurable embedding settings (PostgreSQL)

CREATE TABLE IF NOT EXISTS "user_embedding_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider_type" varchar(16) NOT NULL,
  "api_key_encrypted" text,
  "encryption_key_id" text,
  "base_url" text,
  "model" text,
  "device" varchar(64),
  "local_files_only" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_embedding_settings_provider_type_check"
    CHECK ("provider_type" IN ('cloud', 'local'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_embedding_settings_user_idx"
  ON "user_embedding_settings" ("user_id");

DO $$ BEGIN
  ALTER TABLE "user_embedding_settings"
    ADD CONSTRAINT "user_embedding_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
