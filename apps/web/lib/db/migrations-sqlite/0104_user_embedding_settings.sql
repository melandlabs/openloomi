-- User-configurable embedding settings (SQLite)

CREATE TABLE IF NOT EXISTS `user_embedding_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider_type` text NOT NULL,
  `api_key_encrypted` text,
  `encryption_key_id` text,
  `base_url` text,
  `model` text,
  `device` text,
  `local_files_only` integer DEFAULT 0 NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  CONSTRAINT `user_embedding_settings_provider_type_check`
    CHECK (`provider_type` IN ('cloud', 'local')),
  FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_embedding_settings_user_idx`
  ON `user_embedding_settings` (`user_id`);
