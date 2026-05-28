-- User-configurable LLM API settings
-- Stores per-user OpenAI-compatible and Anthropic-compatible provider overrides.

CREATE TABLE IF NOT EXISTS "user_llm_api_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider_type" varchar(32) NOT NULL,
  "api_key_encrypted" text,
  "encryption_key_id" text,
  "base_url" text,
  "model" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_llm_api_settings_provider_type_check"
    CHECK ("provider_type" IN ('openai_compatible', 'anthropic_compatible'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_llm_api_settings_user_provider_idx"
  ON "user_llm_api_settings" ("user_id", "provider_type");

CREATE INDEX IF NOT EXISTS "user_llm_api_settings_user_idx"
  ON "user_llm_api_settings" ("user_id");

DO $$ BEGIN
  ALTER TABLE "user_llm_api_settings"
    ADD CONSTRAINT "user_llm_api_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
