-- Migration: Add Chronicle screen-aware memory feature columns to
--              user_insight_settings, and the user_vision_llm_settings
--              companion table for the optional custom vision LLM override.
-- Date: 2026

-- ============================================================================
-- 1. user_insight_settings: Chronicle + voice input shortcut columns
-- ============================================================================

ALTER TABLE "user_insight_settings"
ADD COLUMN IF NOT EXISTS "chronicle_enabled" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "user_insight_settings"."chronicle_enabled" IS
'Chronicle screen-aware memory feature enabled';

ALTER TABLE "user_insight_settings"
ADD COLUMN IF NOT EXISTS "chronicle_capture_shortcut" varchar(32) NOT NULL DEFAULT 'Enter';

COMMENT ON COLUMN "user_insight_settings"."chronicle_capture_shortcut" IS
'device_query Keycode id (e.g. Enter, F9) for Chronicle global screen capture trigger';

ALTER TABLE "user_insight_settings"
ADD COLUMN IF NOT EXISTS "chronicle_capture_interval_ms" integer NOT NULL DEFAULT 5000;

COMMENT ON COLUMN "user_insight_settings"."chronicle_capture_interval_ms" IS
'Minimum milliseconds between consecutive screen captures (default 5000, min 3000)';

ALTER TABLE "user_insight_settings"
ADD COLUMN IF NOT EXISTS "chronicle_boot_check" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "user_insight_settings"."chronicle_boot_check" IS
'One-shot flag: retry enabling Chronicle on next app start after a failed enable (e.g. missing macOS permissions).';

ALTER TABLE "user_insight_settings"
ADD COLUMN IF NOT EXISTS "voice_input_shortcut" varchar(32) NOT NULL DEFAULT 'Shift+V';

COMMENT ON COLUMN "user_insight_settings"."voice_input_shortcut" IS
'Modifier+key combo for global voice input (e.g. Shift+V)';

CREATE INDEX IF NOT EXISTS idx_user_insight_settings_chronicle
  ON "user_insight_settings" (chronicle_enabled);

-- ============================================================================
-- 2. user_vision_llm_settings: custom OpenAI-compatible vision LLM override
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_vision_llm_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  -- OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`.
  -- We append `/chat/completions` at request time.
  api_url     TEXT NOT NULL DEFAULT '',
  -- Raw API key, returned verbatim by GET /api/preferences/insight per the
  -- agreed UX (the settings page renders the current value).
  api_key     TEXT NOT NULL DEFAULT '',
  -- Vision-capable model id, e.g. `gpt-4o-mini`, `qwen-vl-max`.
  model       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_vision_llm_settings_user_enabled
  ON user_vision_llm_settings(user_id, enabled);

COMMENT ON TABLE user_vision_llm_settings IS
  'Per-user custom OpenAI-compatible vision LLM override for the Chronicle screen-aware memory analyzer. Gated by user_insight_settings.chronicle_enabled at the UI/API layer.';
COMMENT ON COLUMN user_vision_llm_settings.api_url IS
  'OpenAI-compatible base URL (e.g. https://api.openai.com/v1). /chat/completions is appended at request time.';
COMMENT ON COLUMN user_vision_llm_settings.api_key IS
  'Raw API key; returned in GET responses per agreed UX so the settings page can render the current value.';