UPDATE "Insight"
SET
  "is_archived" = 1,
  "archived_at" = COALESCE("archived_at", "pending_deletion_at", (unixepoch() * 1000)),
  "pending_deletion_at" = NULL,
  "updated_at" = (unixepoch() * 1000)
WHERE "pending_deletion_at" IS NOT NULL;
