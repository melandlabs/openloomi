/**
 * Database initialization script for Tauri
 * This script is called before starting Next.js to ensure the database is properly initialized
 */

const Database = require("better-sqlite3");
const { existsSync, readFileSync, mkdirSync, readdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const os = require("node:os");

// Get database path from environment variable or use default
// Use ~/.openloomi for macOS/Linux, and %APPDATA%/openloomi for Windows
function getAppDataDir() {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    return join(process.env.APPDATA || home, "openloomi");
  }
  // macOS and Linux use ~/.openloomi
  return join(home, ".openloomi");
}

const dbPath =
  process.env.TAURI_DB_PATH || join(getAppDataDir(), "data", "data.db");
const migrationsDir = process.env.TAURI_MIGRATIONS_DIR || join(process.cwd(), "lib/db/migrations-sqlite");

console.log("🗄️  Initializing SQLite database...");
console.log("   Database path:", dbPath);
console.log("   Migrations directory:", migrationsDir);

// Ensure database directory exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  console.log("   Creating database directory:", dbDir);
  mkdirSync(dbDir, { recursive: true });
}

// Create or open database
const db = new Database(dbPath);
console.log("   ✅ Database opened successfully");

// Enable WAL mode for better concurrency
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 30000");
// Use FULL to maximize durability under sudden power loss.
db.pragma("synchronous = FULL");

// Create migrations tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);

// Check for existing database (with tables)
const hasOldTables = db
  .prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('User', 'Bot', 'Chat')",
  )
  .get();

const appliedMigrationCount = db
  .prepare("SELECT COUNT(*) as count FROM __drizzle_migrations")
  .get();

// If there are old tables but no migration records, mark the first migration as applied
if (hasOldTables.count > 0 && appliedMigrationCount.count === 0) {
  console.log("📦 Detected existing database from previous version");
  console.log("🔄 Marking initial migration as applied...");

  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (migrationFiles.length > 0) {
    db.prepare("INSERT INTO __drizzle_migrations (name) VALUES (?)").run(
      migrationFiles[0],
    );
    console.log(
      `   ✅ Marked ${migrationFiles[0]} as applied (existing tables)`,
    );
    console.log(
      `   ℹ️  Will attempt to apply ${migrationFiles.length - 1} remaining migration(s)`,
    );
  }
}

// Get applied migrations
const appliedMigrations = new Set(
  db
    .prepare("SELECT name FROM __drizzle_migrations ORDER BY id")
    .all()
    .map((row) => row.name),
);

// Get all migration files
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// Apply pending migrations
let appliedCount = 0;
for (const file of migrationFiles) {
  if (!appliedMigrations.has(file)) {
    console.log(`🔄 Applying migration: ${file}`);

    try {
      const migrationSQL = readFileSync(join(migrationsDir, file), "utf-8");

      // Execute migration in a transaction
      db.exec(migrationSQL);

      // Record applied migration
      db.prepare("INSERT INTO __drizzle_migrations (name) VALUES (?)").run(
        file,
      );

      console.log(`   ✓ Applied migration: ${file}`);
      appliedCount++;
    } catch (error) {
      if (
        error.code === "SQLITE_ERROR" &&
        (error.message.includes("already exists") ||
          error.message.includes("duplicate column name"))
      ) {
        console.warn(
          `   ⚠️  Migration changes already applied, marking as done: ${file}`,
        );
        db.prepare(
          "INSERT OR IGNORE INTO __drizzle_migrations (name) VALUES (?)",
        ).run(file);
      } else {
        console.error(`   ❌ Failed to apply migration ${file}:`, error);
        throw error;
      }
    }
  }
}

if (appliedCount > 0) {
  console.log(`✅ Applied ${appliedCount} migration(s)`);
} else {
  console.log("✅ All migrations are up to date");
}

db.close();
console.log("✅ Database initialization complete");
