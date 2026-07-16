/**
 * Client-safe deployment mode detection
 *
 * For client-side components only, use @/lib/env/constants for server-side
 */

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function hasTauriEnv(): boolean {
  return (
    typeof process !== "undefined" &&
    (typeof process.env.TAURI_MODE === "string" ||
      process.env.IS_TAURI === "true")
  );
}

export function isTauriMode(): boolean {
  return hasTauriRuntime() || hasTauriEnv();
}

export function isServerMode(): boolean {
  return !isTauriMode();
}
