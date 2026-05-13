import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema-sqlite.ts",
  out: "./lib/db/migrations-sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.TAURI_DB_PATH ||
      `${process.env.HOME || process.env.USERPROFILE || process.env.APPDATA || ""}/.openloomi/data/data.db`,
  },
});
