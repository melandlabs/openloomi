/**
 * Deployment environment constant definitions
 *
 * IMPORTANT: This file must not import any node: module.
 * For server-only path constants (TAURI_DATA_DIR, etc.), use @/lib/utils/path
 */
import { DEV_PORT, PROD_PORT } from "@openloomi/shared";

export type DeploymentMode = "tauri" | "server";
export type DatabaseType = "postgres" | "sqlite";
export type StorageType =
  | "vercel-blob"
  | "local-fs"
  | "google-drive"
  | "notion";

export const DEPLOYMENT_MODE: DeploymentMode =
  typeof process.env.TAURI_MODE === "string"
    ? "tauri"
    : process.env.IS_TAURI === "true"
      ? "tauri"
      : "server";

export const DATABASE_TYPE: DatabaseType =
  DEPLOYMENT_MODE === "tauri" ? "sqlite" : "postgres";

export const DEFAULT_STORAGE_TYPE: StorageType =
  DEPLOYMENT_MODE === "tauri" ? "local-fs" : "vercel-blob";

const isDevelopment = process.env.NODE_ENV === "development";
const defaultPort = isDevelopment ? DEV_PORT : PROD_PORT;

export const TAURI_SERVER_PORT = Number.parseInt(
  process.env.TAURI_SERVER_PORT || defaultPort,
  10,
);
export const TAURI_SERVER_HOST = process.env.TAURI_SERVER_HOST || "localhost";

// OAuth callback URL configuration
export const OAUTH_CALLBACK_URL =
  DEPLOYMENT_MODE === "tauri"
    ? `http://${TAURI_SERVER_HOST}:${TAURI_SERVER_PORT}/api/auth/callback`
    : process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
      : undefined;

export function isTauriMode(): boolean {
  return DEPLOYMENT_MODE === "tauri";
}

export function isServerMode(): boolean {
  return DEPLOYMENT_MODE === "server";
}

// AI Model and Proxy Configuration
export const DEFAULT_AI_MODEL =
  process.env.ANTHROPIC_MODEL || "anthropic/claude-sonnet-4.6";
export const AI_PROXY_BASE_URL = process.env.ANTHROPIC_BASE_URL;

// Session and Auth Constants
export const maxChunkSummaryCount = 10;
export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
  process.env.PLAYWRIGHT ||
  process.env.CI_PLAYWRIGHT,
);

export const guestRegex = /^guest-\d+$/;

// Bump this value to force all users to re-authenticate and receive a fresh session token.
export const authSessionVersion = "2025-01-17";

export const nextAuthSessionCookies = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "__Host-next-auth.session-token",
] as const;

// For backward compatibility, export as const
import { generateDummyPassword } from "@/lib/db/utils";
export const DUMMY_PASSWORD = generateDummyPassword();
