CREATE TABLE IF NOT EXISTS "raw_messages" (
  "id" bigserial PRIMARY KEY,
  "message_id" text NOT NULL,
  "platform" text NOT NULL,
  "bot_id" uuid NOT NULL REFERENCES "public"."Bot"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "public"."User"("id") ON DELETE cascade,
  "channel" text,
  "person" text,
  "timestamp" bigint NOT NULL,
  "content" text NOT NULL,
  "attachments" jsonb DEFAULT NULL,
  "embedding" text,
  "embedding_model" text,
  "embedding_content_hash" text,
  "embedding_dimensions" integer,
  "embedding_updated_at" bigint,
  "metadata" jsonb,
  "created_at" bigint NOT NULL,
  "memory_stage" varchar(16) DEFAULT 'short',
  "access_count" integer DEFAULT 0,
  "last_access_at" bigint,
  "importance_score" real DEFAULT 0,
  "archived_at" bigint,
  "is_pinned" boolean DEFAULT false,
  "summary_ref_id" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "raw_messages_message_id_idx"
  ON "raw_messages" ("message_id");
CREATE INDEX IF NOT EXISTS "raw_messages_user_timestamp_idx"
  ON "raw_messages" ("user_id", "timestamp");
CREATE INDEX IF NOT EXISTS "raw_messages_user_memory_stage_idx"
  ON "raw_messages" ("user_id", "memory_stage");
CREATE INDEX IF NOT EXISTS "raw_messages_platform_idx"
  ON "raw_messages" ("platform");
CREATE INDEX IF NOT EXISTS "raw_messages_bot_id_idx"
  ON "raw_messages" ("bot_id");
CREATE INDEX IF NOT EXISTS "raw_messages_archived_at_idx"
  ON "raw_messages" ("archived_at");
CREATE INDEX IF NOT EXISTS "raw_messages_created_at_idx"
  ON "raw_messages" ("created_at");
CREATE INDEX IF NOT EXISTS "raw_messages_fts_idx"
  ON "raw_messages"
  USING gin (
    to_tsvector(
      'simple',
      coalesce("content", '') || ' ' || coalesce("channel", '') || ' ' || coalesce("person", '')
    )
  );

CREATE TABLE IF NOT EXISTS "memory_summaries" (
  "summary_id" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "public"."User"("id") ON DELETE cascade,
  "summary_tier" varchar(8) NOT NULL,
  "source_tier" varchar(16) NOT NULL,
  "start_timestamp" bigint NOT NULL,
  "end_timestamp" bigint NOT NULL,
  "message_count" integer NOT NULL,
  "source_record_ids" jsonb DEFAULT NULL,
  "key_points" jsonb DEFAULT NULL,
  "keywords" jsonb DEFAULT NULL,
  "keywords_text" text,
  "summary_text" text NOT NULL,
  "dimensions" jsonb DEFAULT NULL,
  "quality_score" real,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "memory_summaries_user_time_idx"
  ON "memory_summaries" ("user_id", "end_timestamp");
CREATE INDEX IF NOT EXISTS "memory_summaries_user_tier_idx"
  ON "memory_summaries" ("user_id", "summary_tier");
