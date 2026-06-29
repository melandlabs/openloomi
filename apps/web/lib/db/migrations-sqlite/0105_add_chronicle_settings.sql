-- Migration: Add Chronicle screen-aware memory feature columns to
--              user_insight_settings, and the user_vision_llm_settings
--              companion table for the optional custom vision LLM override.
-- Date: 2026

PRAGMA journal_mode=WAL;

-- ============================================================================
-- 1. user_insight_settings: Chronicle + voice input shortcut columns
-- ============================================================================

ALTER TABLE user_insight_settings
ADD COLUMN chronicle_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE user_insight_settings
ADD COLUMN chronicle_capture_shortcut TEXT NOT NULL DEFAULT 'Enter';

ALTER TABLE user_insight_settings
ADD COLUMN chronicle_capture_interval_ms INTEGER NOT NULL DEFAULT 5000;

ALTER TABLE user_insight_settings
ADD COLUMN chronicle_boot_check INTEGER NOT NULL DEFAULT 0;

ALTER TABLE user_insight_settings
ADD COLUMN voice_input_shortcut TEXT NOT NULL DEFAULT 'Shift+V';

CREATE INDEX IF NOT EXISTS idx_user_insight_settings_chronicle
  ON user_insight_settings (chronicle_enabled);

-- ============================================================================
-- 2. user_vision_llm_settings: custom OpenAI-compatible vision LLM override
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_vision_llm_settings (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
  enabled     INTEGER NOT NULL DEFAULT 0,
  api_url     TEXT NOT NULL DEFAULT '',
  api_key     TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_vision_llm_settings_user_enabled
  ON user_vision_llm_settings(user_id, enabled);