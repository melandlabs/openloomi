import { isTauri as tauriIsTauri } from "@tauri-apps/api/core";

export type PlatformKind = "tauri" | "browser";

export function isClient(): boolean {
  return typeof window !== "undefined";
}

export function isTauri(): boolean {
  if (!isClient()) return false;
  try {
    return tauriIsTauri();
  } catch {
    return false;
  }
}

export function isBrowser(): boolean {
  return isClient() && !isTauri();
}

export function getPlatformKind(): PlatformKind {
  if (isTauri()) return "tauri";
  return "browser";
}
