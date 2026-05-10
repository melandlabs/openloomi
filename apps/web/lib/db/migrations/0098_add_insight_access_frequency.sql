ALTER TABLE "insight_weights"
ADD COLUMN IF NOT EXISTS "access_count_total" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN IF NOT EXISTS "access_count_7d" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN IF NOT EXISTS "access_count_30d" integer NOT NULL DEFAULT 0;

ALTER TABLE "insight_weights"
ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "weights_access_count_30d_idx"
ON "insight_weights" ("user_id", "access_count_30d");

CREATE INDEX IF NOT EXISTS "weights_last_accessed_idx"
ON "insight_weights" ("user_id", "last_accessed_at");

UPDATE "insight_weights" AS weights
SET
  "access_count_total" = stats.total_count,
  "access_count_7d" = stats.count_7d,
  "access_count_30d" = stats.count_30d,
  "last_accessed_at" = stats.last_accessed_at
FROM (
  SELECT
    "insight_id",
    "user_id",
    COUNT(*)::integer AS total_count,
    COUNT(*) FILTER (
      WHERE "viewed_at" >= now() - interval '7 days'
    )::integer AS count_7d,
    COUNT(*) FILTER (
      WHERE "viewed_at" >= now() - interval '30 days'
    )::integer AS count_30d,
    MAX("viewed_at") AS last_accessed_at
  FROM "insight_view_history"
  GROUP BY "insight_id", "user_id"
) AS stats
WHERE
  weights."insight_id" = stats."insight_id"
  AND weights."user_id" = stats."user_id";
