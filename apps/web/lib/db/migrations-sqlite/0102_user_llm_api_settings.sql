-- User-configurable LLM API settings (SQLite)
-- Stores per-user OpenAI-compatible and Anthropic-compatible provider overrides.

CREATE TABLE IF NOT EXISTS `user_llm_api_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider_type` text NOT NULL,
  `api_key_encrypted` text,
  `encryption_key_id` text,
  `base_url` text,
  `model` text,
  `enabled` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  CONSTRAINT `user_llm_api_settings_provider_type_check`
    CHECK (`provider_type` IN ('openai_compatible', 'anthropic_compatible')),
  FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_llm_api_settings_user_provider_idx`
  ON `user_llm_api_settings` (`user_id`, `provider_type`);

CREATE INDEX IF NOT EXISTS `user_llm_api_settings_user_idx`
  ON `user_llm_api_settings` (`user_id`);
