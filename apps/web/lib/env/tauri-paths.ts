/**
 * Tauri path utilities module
 *
 * Consistent with Rust side get_data_dir():
 * - Unix: ~/.openloomi/data
 * - Windows: %USERPROFILE%\.openloomi\data or %APPDATA%\openloomi\data
 *
 * Note: This module is for server-side only
 */

/**
 * Get Tauri data directory (server-side)
 */
export function getTauriDataDir(): string {
  if (process.env.TAURI_DATA_DIR) {
    return process.env.TAURI_DATA_DIR;
  }
  // For development and production, use difference data dir.
  if (process.env.NODE_ENV === "development") {
    return process.platform === "win32"
      ? `${process.env.APPDATA}/openloomi`
      : process.platform === "darwin"
        ? `${process.env.HOME}/Library/Application Support/openloomi`
        : `${process.env.HOME}/.config/openloomi`;
  }

  const { homedir } = require("node:os");
  const { join } = require("node:path");
  const home = homedir();

  if (process.platform === "win32") {
    // Windows: Prefer USERPROFILE, then APPDATA
    const userprofile = process.env.USERPROFILE;
    if (userprofile) {
      return join(userprofile, ".openloomi", "data");
    }
    return join(process.env.APPDATA || home, "openloomi", "data");
  }

  // Unix (Linux/macOS): ~/.openloomi/data
  return join(home, ".openloomi", "data");
}

/**
 * Get database path
 */
export function getTauriDbPath(): string {
  return `${getTauriDataDir()}/data.db`;
}

/**
 * Get storage directory path
 */
export function getTauriStoragePath(): string {
  return `${getTauriDataDir()}/storage`;
}

/**
 * Get logs directory path
 */
export function getTauriLogsPath(): string {
  return `${getTauriDataDir()}/logs`;
}

// Re-export for server-side convenience (these are just getTauriDataDir() based)
export const TAURI_DATA_DIR = getTauriDataDir();
export const TAURI_DB_PATH =
  process.env.TAURI_DB_PATH || `${TAURI_DATA_DIR}/data.db`;
export const TAURI_STORAGE_PATH =
  process.env.TAURI_STORAGE_PATH || `${TAURI_DATA_DIR}/storage`;
export const TAURI_LOGS_PATH =
  process.env.TAURI_LOGS_PATH || `${TAURI_DATA_DIR}/logs`;
