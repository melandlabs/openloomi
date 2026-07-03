-- Migration: Add deprecation columns to raw_messages
--
-- Deprecation soft-hides source records that have been superseded by a
-- higher-tier memory summary. Records stay in storage (audit / chain
-- traversal) but the default retrieval path filters them out via the
-- `includeDeprecated` flag.
--
-- Mirrors the SQLite migration in packages/sqlite/migrations/ so behaviour
-- is consistent across both backends.

ALTER TABLE "raw_messages" ADD COLUMN IF NOT EXISTS "deprecated_at" bigint;
ALTER TABLE "raw_messages" ADD COLUMN IF NOT EXISTS "deprecation_reason" text;
ALTER TABLE "raw_messages" ADD COLUMN IF NOT EXISTS "superseded_by_summary_id" text;

-- Partial index lets the default retrieval query (WHERE deprecated_at IS NULL)
-- use an index-only scan on the active subset. The non-deprecated rows are
-- the hot path; deprecated rows live outside the index.
CREATE INDEX IF NOT EXISTS "raw_messages_active_user_idx"
  ON "raw_messages" ("user_id", "memory_stage", "deprecated_at")
  WHERE "deprecated_at" IS NULL;
