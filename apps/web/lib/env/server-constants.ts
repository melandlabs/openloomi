/**
 * Server-only environment constants
 * This file imports node: modules and must not be imported by client components.
 */

import { join } from "node:path";
import { DEV_PORT, PROD_PORT } from "@openloomi/shared";

// Re-export deployment mode and database type from constants
export { DEPLOYMENT_MODE, DATABASE_TYPE } from "@/lib/env/constants";
export { isTauriMode, isServerMode } from "@/lib/env/client-constants";

// SQLite database path for development mode (USE_SQLITE=true)
export const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH || join(process.cwd(), "data", "sqlite.db");

// Server port configuration
const isDevelopment = process.env.NODE_ENV === "development";
const defaultPort = isDevelopment ? DEV_PORT : PROD_PORT;

export const TAURI_SERVER_PORT = Number.parseInt(
  process.env.TAURI_SERVER_PORT || defaultPort,
  10,
);
export const TAURI_SERVER_HOST = process.env.TAURI_SERVER_HOST || "localhost";

// Server-side AI proxy URL
export const AI_PROXY_BASE_URL = `http://${TAURI_SERVER_HOST}:${TAURI_SERVER_PORT}/api/ai`;
