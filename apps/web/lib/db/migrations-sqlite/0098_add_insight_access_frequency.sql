ALTER TABLE "insight_weights"
ADD COLUMN "access_count_total" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN "access_count_7d" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN "access_count_30d" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN "last_accessed_at" integer;

CREATE INDEX IF NOT EXISTS "weights_access_count_30d_idx"
ON "insight_weights" ("user_id", "access_count_30d");

CREATE INDEX IF NOT EXISTS "weights_last_accessed_idx"
ON "insight_weights" ("user_id", "last_accessed_at");

UPDATE "insight_weights"
SET
  "access_count_total" = (
    SELECT COUNT(*)
    FROM "insight_view_history"
    WHERE
      "insight_view_history"."insight_id" = "insight_weights"."insight_id"
      AND "insight_view_history"."user_id" = "insight_weights"."user_id"
  ),
  "access_count_7d" = (
    SELECT COUNT(*)
    FROM "insight_view_history"
    WHERE
      "insight_view_history"."insight_id" = "insight_weights"."insight_id"
      AND "insight_view_history"."user_id" = "insight_weights"."user_id"
      AND "insight_view_history"."viewed_at" >= (unixepoch() * 1000) - (7 * 24 * 60 * 60 * 1000)
  ),
  "access_count_30d" = (
    SELECT COUNT(*)
    FROM "insight_view_history"
    WHERE
      "insight_view_history"."insight_id" = "insight_weights"."insight_id"
      AND "insight_view_history"."user_id" = "insight_weights"."user_id"
      AND "insight_view_history"."viewed_at" >= (unixepoch() * 1000) - (30 * 24 * 60 * 60 * 1000)
  ),
  "last_accessed_at" = (
    SELECT MAX("viewed_at")
    FROM "insight_view_history"
    WHERE
      "insight_view_history"."insight_id" = "insight_weights"."insight_id"
      AND "insight_view_history"."user_id" = "insight_weights"."user_id"
  );
