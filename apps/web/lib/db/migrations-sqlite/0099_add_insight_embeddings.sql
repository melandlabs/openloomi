CREATE TABLE IF NOT EXISTS "insight_embeddings" (
  "insight_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "bot_id" text NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "embedding" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
  "updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("insight_id") REFERENCES "Insight"("id") ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "insight_embeddings_user_idx"
ON "insight_embeddings" ("user_id");

CREATE INDEX IF NOT EXISTS "insight_embeddings_bot_idx"
ON "insight_embeddings" ("bot_id");

CREATE INDEX IF NOT EXISTS "insight_embeddings_model_idx"
ON "insight_embeddings" ("embedding_model");

CREATE INDEX IF NOT EXISTS "insight_embeddings_updated_at_idx"
ON "insight_embeddings" ("updated_at");
