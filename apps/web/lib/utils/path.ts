/**
 * Cross-platform path utility module
 *
 * Provides cross-platform compatible path processing functionality, supports Windows, Linux, macOS
 * Note: This module is only available in Node.js environment, not applicable to browser environment
 */

import "server-only";

/**
 * Get user home directory (cross-platform)
 * Use Node.js built-in os.homedir() to ensure cross-platform compatibility
 * Note: This function is only available in Node.js environment
 */
export function getHomeDir(): string {
  const { homedir } = require("node:os");
  return homedir();
}

/**
 * Path joining (using platform separator)
 * @param paths Path segments
 */
export function joinPath(...paths: string[]): string {
  const { join } = require("node:path");
  return join(...paths);
}

/**
 * Get application data directory (cross-platform)
 * Consistent with Rust side get_data_dir():
 * - Unix: ~/.openloomi
 * - Windows: %USERPROFILE%\.openloomi or %APPDATA%\openloomi
 *
 * Note: This function is only available in Node.js environment
 */
export function getAppDataDir(): string {
  const { homedir } = require("node:os");
  const { join } = require("node:path");
  const home = homedir();

  if (process.platform === "win32") {
    // Windows: prioritize USERPROFILE, then APPDATA
    const userprofile = process.env.USERPROFILE;
    if (userprofile) {
      return join(userprofile, ".openloomi");
    }
    return join(process.env.APPDATA || home, "openloomi");
  }

  // Unix (Linux/macOS): ~/.openloomi
  return join(home, ".openloomi");
}

/**
 * Get subdirectories under application data directory (cross-platform)
 * @param subDirs Subdirectory paths
 */
export function getAppDataSubPath(...subDirs: string[]): string {
  return joinPath(getAppDataDir(), ...subDirs);
}

/**
 * Get database file path
 * Default path: <appDataDir>/data.db
 */
export function getDatabasePath(): string {
  return getAppDataSubPath("data.db");
}

/**
 * Get the memory directory path for conversation stores.
 * Path: <appDataDir>/data/memory/
 */
export function getAppMemoryDir(): string {
  return getAppDataSubPath("data", "memory");
}

/**
 * Get memory file system path
 * Default path: <appDataDir>/data/memory
 */
export function getMemoryPath(): string {
  return getAppDataSubPath("data", "memory");
}

/**
 * Get storage directory path
 * Default path: <appDataDir>/storage
 */
export function getStoragePath(): string {
  return getAppDataSubPath("storage");
}

/**
 * Get logs directory path
 * Default path: <appDataDir>/logs
 */
export function getLogsPath(): string {
  return getAppDataSubPath("logs");
}

// ============================================================================
// Tauri-specific path utilities
// Consistent with Rust side get_data_dir():
// - Unix: ~/.openloomi/data
// - Windows: %USERPROFILE%\.openloomi\data or %APPDATA%\openloomi\data
// ============================================================================

/**
 * Get Tauri data directory
 * Uses TAURI_DATA_DIR env var if set, otherwise falls back to <appDataDir>/data
 */
export function getTauriDataDir(): string {
  if (process.env.TAURI_DATA_DIR) {
    return process.env.TAURI_DATA_DIR;
  }
  return joinPath(getAppDataDir(), "data");
}

/**
 * Get database path under Tauri data directory
 */
export function getTauriDbPath(): string {
  return process.env.TAURI_DB_PATH || joinPath(getTauriDataDir(), "data.db");
}

/**
 * Get storage directory path under Tauri data directory
 */
export function getTauriStoragePath(): string {
  return (
    process.env.TAURI_STORAGE_PATH || joinPath(getTauriDataDir(), "storage")
  );
}

/**
 * Get logs directory path under Tauri data directory
 */
export function getTauriLogsPath(): string {
  return process.env.TAURI_LOGS_PATH || joinPath(getTauriDataDir(), "logs");
}

// Tauri path constants
export const TAURI_DATA_DIR = getTauriDataDir();
export const TAURI_DB_PATH = getTauriDbPath();
export const TAURI_STORAGE_PATH = getTauriStoragePath();
export const TAURI_LOGS_PATH = getTauriLogsPath();
