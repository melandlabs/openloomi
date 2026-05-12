CREATE TABLE IF NOT EXISTS "insight_embeddings" (
  "insight_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "bot_id" uuid NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "embedding" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insight_embeddings" ADD CONSTRAINT "insight_embeddings_insight_id_Insight_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."Insight"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insight_embeddings" ADD CONSTRAINT "insight_embeddings_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insight_embeddings" ADD CONSTRAINT "insight_embeddings_bot_id_Bot_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."Bot"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_embeddings_user_idx"
ON "insight_embeddings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_embeddings_bot_idx"
ON "insight_embeddings" USING btree ("bot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_embeddings_model_idx"
ON "insight_embeddings" USING btree ("embedding_model");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insight_embeddings_updated_at_idx"
ON "insight_embeddings" USING btree ("updated_at");
