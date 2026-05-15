import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SQLiteRawMessageManager } from "@openloomi/sqlite";
import { isTauriMode } from "@/lib/env/constants";
import { getTauriDbPath } from "@/lib/env/tauri-paths";

let manager: SQLiteRawMessageManager | null = null;

export function isSQLiteRawMessageStorageAvailable(): boolean {
  return isTauriMode();
}

export async function getSQLiteRawMessageManager(): Promise<SQLiteRawMessageManager> {
  if (!isSQLiteRawMessageStorageAvailable()) {
    throw new Error(
      "SQLite raw message storage is only available in Tauri mode.",
    );
  }

  if (!manager) {
    const dbPath = getTauriDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    manager = new SQLiteRawMessageManager(dbPath);
    await manager.init();
  }

  return manager;
}

export async function closeSQLiteRawMessageManager(): Promise<void> {
  if (!manager) {
    return;
  }
  await manager.close();
  manager = null;
}
