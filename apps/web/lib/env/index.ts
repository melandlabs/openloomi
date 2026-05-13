/**
 * Unified environment configuration entry
 * Automatically switches configuration based on deployment mode
 */

export * from "./constants";

// Server-only path constants (node:os / node:path)
// Only import these in server-side files, never in client components
export {
  TAURI_DATA_DIR,
  TAURI_DB_PATH,
  TAURI_STORAGE_PATH,
  TAURI_LOGS_PATH,
  getTauriDataDir,
  getTauriDbPath,
  getTauriStoragePath,
  getTauriLogsPath,
} from "@/lib/utils/path";

import { DEV_PORT, PROD_PORT } from "@openloomi/shared";
import {
  DEPLOYMENT_MODE,
  TAURI_SERVER_PORT,
  TAURI_SERVER_HOST,
  isTauriMode,
} from "./constants";
import {
  TAURI_DATA_DIR,
  TAURI_DB_PATH,
  TAURI_STORAGE_PATH,
  TAURI_LOGS_PATH,
} from "@/lib/utils/path";

/**
 * Initialize Tauri data directory
 */
export function initTauriDirs(): void {
  if (!isTauriMode()) return;

  // Lazy import fs only when needed (server-side only)
  if (typeof window !== "undefined") return;

  const { mkdirSync } = require("node:fs");
  const { existsSync } = require("node:fs");

  const dirs = [TAURI_DATA_DIR, TAURI_STORAGE_PATH, TAURI_LOGS_PATH];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Get database connection string
 */
export function getDatabaseUrl(): string {
  if (isTauriMode()) {
    // SQLite uses local file path
    return TAURI_DB_PATH;
  }

  // Server mode uses PostgreSQL connection string from environment variables
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
}

/**
 * Get application base URL (server-safe, checks multiple env vars)
 */
export function getApplicationBaseUrl(): string {
  // Prefer URL configured in environment variables
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.APPLICATION_URL ||
    process.env.NEXTAUTH_URL;

  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  // Tauri mode uses localhost
  if (isTauriMode()) {
    return `http://${TAURI_SERVER_HOST}:${TAURI_SERVER_PORT}`;
  }

  // Vercel deployment
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }

  const isDevelopment = process.env.NODE_ENV === "development";
  const port = isDevelopment ? DEV_PORT : PROD_PORT;

  // Default to localhost with environment-based port
  return `http://localhost:${port}`;
}

/**
 * @deprecated Use getApplicationBaseUrl() instead
 */
export function getAppUrl(): string {
  return getApplicationBaseUrl();
}

/**
 * Print environment configuration info (for debugging)
 */
export function printEnvironmentInfo(): void {
  console.log("=".repeat(60));
  console.log("🚀 Application Environment");
  console.log("=".repeat(60));
  console.log(`Deployment Mode: ${DEPLOYMENT_MODE}`);
  console.log(`IS_TAURI: ${process.env.IS_TAURI}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

  if (isTauriMode()) {
    console.log("\n📦 Tauri Configuration:");
    console.log(`  Data Dir: ${TAURI_DATA_DIR}`);
    console.log(`  Database: ${TAURI_DB_PATH}`);
    console.log(`  Storage: ${TAURI_STORAGE_PATH}`);
    console.log(`  Logs: ${TAURI_LOGS_PATH}`);
    console.log(`  Server Port: ${TAURI_SERVER_PORT}`);
  } else {
    console.log("\n☁️ Server Configuration:");
    console.log(`  Database URL: ${maskUrl(getDatabaseUrl())}`);
  }

  console.log("=".repeat(60));
}

function maskUrl(url: string): string {
  if (!url) return "not set";
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      return url.replace(/:[^:@]+@/, ":****@");
    }
    return url;
  } catch {
    return url;
  }
}
