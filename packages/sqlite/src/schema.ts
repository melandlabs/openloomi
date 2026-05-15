import type Database from "better-sqlite3";

export const RAW_MESSAGES_SCHEMA_VERSION = 1;

export function initializeRawMessageSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 30000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE NOT NULL,
      platform TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT,
      person TEXT,
      timestamp INTEGER NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT,
      embedding BLOB,
      embedding_model TEXT,
      embedding_content_hash TEXT,
      embedding_dimensions INTEGER,
      embedding_updated_at INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      memory_stage TEXT DEFAULT 'short',
      access_count INTEGER DEFAULT 0,
      last_access_at INTEGER,
      importance_score REAL DEFAULT 0,
      archived_at INTEGER,
      is_pinned INTEGER DEFAULT 0,
      summary_ref_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_raw_messages_user_timestamp
      ON raw_messages(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_user_memory_stage
      ON raw_messages(user_id, memory_stage);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_platform
      ON raw_messages(platform);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_bot_id
      ON raw_messages(bot_id);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_archived_at
      ON raw_messages(archived_at);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_created_at
      ON raw_messages(created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS raw_messages_fts USING fts5(
      content,
      channel,
      person,
      content='raw_messages',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS raw_messages_ai AFTER INSERT ON raw_messages BEGIN
      INSERT INTO raw_messages_fts(rowid, content, channel, person)
      VALUES (new.id, new.content, new.channel, new.person);
    END;

    CREATE TRIGGER IF NOT EXISTS raw_messages_ad AFTER DELETE ON raw_messages BEGIN
      INSERT INTO raw_messages_fts(raw_messages_fts, rowid, content, channel, person)
      VALUES('delete', old.id, old.content, old.channel, old.person);
    END;

    CREATE TRIGGER IF NOT EXISTS raw_messages_au AFTER UPDATE ON raw_messages BEGIN
      INSERT INTO raw_messages_fts(raw_messages_fts, rowid, content, channel, person)
      VALUES('delete', old.id, old.content, old.channel, old.person);
      INSERT INTO raw_messages_fts(rowid, content, channel, person)
      VALUES (new.id, new.content, new.channel, new.person);
    END;

    CREATE TABLE IF NOT EXISTS memory_summaries (
      summary_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      summary_tier TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      start_timestamp INTEGER NOT NULL,
      end_timestamp INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      source_record_ids TEXT,
      key_points TEXT,
      keywords TEXT,
      keywords_text TEXT,
      summary_text TEXT NOT NULL,
      dimensions TEXT,
      quality_score REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_time
      ON memory_summaries(user_id, end_timestamp);
    CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_tier
      ON memory_summaries(user_id, summary_tier);
  `);
}
