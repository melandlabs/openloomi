/**
 * Client-safe environment constants
 * This file must NOT import any node: module, as it may be imported by client components.
 */

// Deployment mode detection (client-safe, no node: dependencies)
// Aligned with constants.ts: TAURI_MODE is set to '1' by the Rust runtime (src-tauri/src/node.rs)
const DEPLOYMENT_MODE =
  typeof process !== "undefined" &&
  (typeof process.env.TAURI_MODE === "string" ||
    process.env.IS_TAURI === "true")
    ? "tauri"
    : "server";

export function isTauriMode(): boolean {
  return DEPLOYMENT_MODE === "tauri";
}

export function isServerMode(): boolean {
  return DEPLOYMENT_MODE === "server";
}

// Session and auth constants
export const guestRegex = /^guest-\d+$/;

// Environment flags (these are plain values, safe for client)
export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
  process.env.PLAYWRIGHT ||
  process.env.CI_PLAYWRIGHT,
);

// AI Model and proxy configuration (client-safe, no node: dependencies)
export const DEFAULT_AI_MODEL =
  process.env.NEXT_PUBLIC_ANTHROPIC_MODEL || "claude-sonnet-5";
// Use a relative path so it works across both local web and tauri runtimes.
export const AI_PROXY_BASE_URL =
  process.env.NEXT_PUBLIC_AI_PROXY_URL || "/api/ai";
/** Application data directory name (used in home directory) */
export const APP_DIR_NAME = ".openloomi";

// Feature flags (default false = hidden, set NEXT_PUBLIC_FF_SCREEN_MEMORY=1 to enable)
export const FF_SCREEN_MEMORY =
  process.env.NEXT_PUBLIC_FF_SCREEN_MEMORY === "1";
