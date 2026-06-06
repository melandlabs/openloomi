-- Add temporal validity columns and living insight tables for SQLite.
--
-- This mirrors the Postgres 0104 migration with SQLite-compatible types.

ALTER TABLE `Insight` ADD COLUMN `valid_from` integer;
ALTER TABLE `Insight` ADD COLUMN `valid_to` integer;

CREATE INDEX IF NOT EXISTS `insight_valid_from_idx`
  ON `Insight` (`valid_from`);

CREATE INDEX IF NOT EXISTS `insight_valid_to_idx`
  ON `Insight` (`valid_to`);

CREATE INDEX IF NOT EXISTS `insight_valid_time_idx`
  ON `Insight` (`valid_from`, `valid_to`);

CREATE TABLE IF NOT EXISTS `insight_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `insight_id_a` text NOT NULL,
  `insight_id_b` text NOT NULL,
  `user_id` text NOT NULL,
  `strength` integer DEFAULT 0 NOT NULL,
  `co_access_count` integer DEFAULT 0 NOT NULL,
  `last_strengthened_at` integer,
  `stability` integer DEFAULT 1 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`insight_id_a`) REFERENCES `Insight`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`insight_id_b`) REFERENCES `Insight`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `insight_connection_unique_idx`
  ON `insight_connections` (`insight_id_a`, `insight_id_b`, `user_id`);

CREATE INDEX IF NOT EXISTS `insight_connection_user_idx`
  ON `insight_connections` (`user_id`);

CREATE INDEX IF NOT EXISTS `insight_connection_insight_a_idx`
  ON `insight_connections` (`insight_id_a`);

CREATE INDEX IF NOT EXISTS `insight_connection_insight_b_idx`
  ON `insight_connections` (`insight_id_b`);

CREATE INDEX IF NOT EXISTS `insight_connection_strength_idx`
  ON `insight_connections` (`user_id`, `strength`);

CREATE INDEX IF NOT EXISTS `insight_connection_last_strengthened_idx`
  ON `insight_connections` (`user_id`, `last_strengthened_at`);

CREATE TABLE IF NOT EXISTS `entities` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `canonical_name` text NOT NULL,
  `aliases` text DEFAULT '[]' NOT NULL,
  `disambiguation_context` text,
  `source_bot_ids` text DEFAULT '[]' NOT NULL,
  `insight_count` integer DEFAULT 0 NOT NULL,
  `first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `is_pinned` integer DEFAULT 0 NOT NULL,
  `is_ignored` integer DEFAULT 0 NOT NULL,
  `notes` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `entity_unique_idx`
  ON `entities` (`user_id`, `entity_type`, `canonical_name`);

CREATE INDEX IF NOT EXISTS `entity_user_idx`
  ON `entities` (`user_id`);

CREATE INDEX IF NOT EXISTS `entity_type_idx`
  ON `entities` (`entity_type`);

CREATE INDEX IF NOT EXISTS `entity_name_search_idx`
  ON `entities` (`canonical_name`);

CREATE INDEX IF NOT EXISTS `entity_last_seen_idx`
  ON `entities` (`user_id`, `last_seen_at`);

CREATE TABLE IF NOT EXISTS `insight_entities` (
  `id` text PRIMARY KEY NOT NULL,
  `insight_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `role` text NOT NULL,
  `confidence` integer DEFAULT 0 NOT NULL,
  `text_span` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`insight_id`) REFERENCES `Insight`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `insight_entity_unique_idx`
  ON `insight_entities` (`insight_id`, `entity_id`);

CREATE INDEX IF NOT EXISTS `insight_entity_insight_idx`
  ON `insight_entities` (`insight_id`);

CREATE INDEX IF NOT EXISTS `insight_entity_entity_idx`
  ON `insight_entities` (`entity_id`);

CREATE INDEX IF NOT EXISTS `insight_entity_role_idx`
  ON `insight_entities` (`role`);
