UPDATE "Insight"
SET
  "is_archived" = true,
  "archived_at" = COALESCE("archived_at", "pending_deletion_at", now()),
  "pending_deletion_at" = NULL,
  "updated_at" = now()
WHERE "pending_deletion_at" IS NOT NULL;
