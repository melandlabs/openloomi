-- Migration: Add temporal validity and living connections
--
-- Adds valid_from/valid_to columns to Insight table for time-travel queries
-- Adds insight_connections table for Hebbian potentiation (Living Connections)
-- Adds entities and insight_entities tables for Entity Registry

-- =============================================================================
-- Temporal Validity Columns on Insight Table
-- =============================================================================

-- Add valid_from column (when this insight becomes relevant/valid)
ALTER TABLE "Insight" ADD COLUMN "valid_from" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "insight_valid_from_idx" ON "Insight" ("valid_from");

-- Add valid_to column (when this insight expires/becomes irrelevant)
ALTER TABLE "Insight" ADD COLUMN "valid_to" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "insight_valid_to_idx" ON "Insight" ("valid_to");

-- Composite index for as-of queries (time-travel)
CREATE INDEX IF NOT EXISTS "insight_valid_time_idx" ON "Insight" ("valid_from", "valid_to");

-- =============================================================================
-- Living Connections: Insight Connections Table (Hebbian Potentiation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "insight_connections" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "insight_id_a" UUID NOT NULL REFERENCES "Insight"("id") ON DELETE CASCADE,
    "insight_id_b" UUID NOT NULL REFERENCES "Insight"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "strength" NUMERIC(10, 6) NOT NULL DEFAULT 0.1,
    "co_access_count" INTEGER NOT NULL DEFAULT 0,
    "last_strengthened_at" TIMESTAMPTZ,
    "stability" NUMERIC(10, 4) NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one connection per insight pair per user
CREATE UNIQUE INDEX IF NOT EXISTS "insight_connection_unique_idx"
    ON "insight_connections" ("insight_id_a", "insight_id_b", "user_id");

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS "insight_connection_user_idx" ON "insight_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "insight_connection_insight_a_idx" ON "insight_connections" ("insight_id_a");
CREATE INDEX IF NOT EXISTS "insight_connection_insight_b_idx" ON "insight_connections" ("insight_id_b");
CREATE INDEX IF NOT EXISTS "insight_connection_strength_idx" ON "insight_connections" ("user_id", "strength");
CREATE INDEX IF NOT EXISTS "insight_connection_last_strengthened_idx" ON "insight_connections" ("user_id", "last_strengthened_at");

-- =============================================================================
-- Entity Registry: Entities Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS "entities" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "entity_type" VARCHAR(30) NOT NULL, -- "person" | "group" | "concept" | "project" | "company"
    "canonical_name" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT '{}',
    "disambiguation_context" TEXT, -- e.g., "CEO of Acme Corp", "works in the NYC office"
    "source_bot_ids" UUID[] NOT NULL DEFAULT '{}',
    "insight_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "is_pinned" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_ignored" BOOLEAN NOT NULL DEFAULT FALSE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one entity per user/type/canonical name
CREATE UNIQUE INDEX IF NOT EXISTS "entity_unique_idx"
    ON "entities" ("user_id", "entity_type", "canonical_name");
CREATE INDEX IF NOT EXISTS "entity_user_idx" ON "entities" ("user_id");
CREATE INDEX IF NOT EXISTS "entity_type_idx" ON "entities" ("entity_type");
CREATE INDEX IF NOT EXISTS "entity_name_search_idx" ON "entities" ("canonical_name");
CREATE INDEX IF NOT EXISTS "entity_last_seen_idx" ON "entities" ("user_id", "last_seen_at");

-- =============================================================================
-- Entity Registry: Insight-Entity Junction Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS "insight_entities" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "insight_id" UUID NOT NULL REFERENCES "Insight"("id") ON DELETE CASCADE,
    "entity_id" UUID NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
    "role" VARCHAR(20) NOT NULL, -- "subject" | "object" | "mentioned"
    "confidence" NUMERIC(5, 4) NOT NULL DEFAULT 0.5,
    "text_span" TEXT, -- The original text in the insight referring to this entity
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one role per entity per insight
CREATE UNIQUE INDEX IF NOT EXISTS "insight_entity_unique_idx"
    ON "insight_entities" ("insight_id", "entity_id");
CREATE INDEX IF NOT EXISTS "insight_entity_insight_idx" ON "insight_entities" ("insight_id");
CREATE INDEX IF NOT EXISTS "insight_entity_entity_idx" ON "insight_entities" ("entity_id");
CREATE INDEX IF NOT EXISTS "insight_entity_role_idx" ON "insight_entities" ("role");
