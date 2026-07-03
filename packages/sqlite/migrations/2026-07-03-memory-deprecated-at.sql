-- Migration: add deprecation columns to raw_messages
--
-- Deprecation marks a source record as superseded by a higher-tier summary
-- without physically deleting it. The default retrieval path (no
-- `includeDeprecated`) should not return deprecated rows, so we add a partial
-- index that excludes them — keeps the hot path cheap.

ALTER TABLE raw_messages ADD COLUMN deprecated_at INTEGER;
ALTER TABLE raw_messages ADD COLUMN deprecation_reason TEXT;
ALTER TABLE raw_messages ADD COLUMN superseded_by_summary_id TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_messages_active_user
  ON raw_messages(user_id, memory_stage, deprecated_at)
  WHERE deprecated_at IS NULL;
