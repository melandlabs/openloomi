/**
 * Loop preferences — read/write the user's local config.json. Defaults
 * are applied on missing fields so partially-written files self-heal.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirs, ensureParent, LOOP_PATHS } from "./paths";
import { DEFAULT_LOOP_PREFERENCES, type LoopPreferences } from "./types";

export function readPreferences(): LoopPreferences {
  ensureDirs();
  if (!existsSync(LOOP_PATHS.config)) {
    return { ...DEFAULT_LOOP_PREFERENCES };
  }
  try {
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.config, "utf8"),
    ) as Partial<LoopPreferences>;
    return { ...DEFAULT_LOOP_PREFERENCES, ...(raw ?? {}) };
  } catch {
    return { ...DEFAULT_LOOP_PREFERENCES };
  }
}

export function writePreferences(
  patch: Partial<LoopPreferences>,
): LoopPreferences {
  ensureDirs();
  const next: LoopPreferences = { ...readPreferences(), ...(patch ?? {}) };
  ensureParent(LOOP_PATHS.config);
  try {
    writeFileSync(LOOP_PATHS.config, JSON.stringify(next, null, 2));
  } catch (e) {
    console.warn("[loop.preferences] write failed:", e);
  }
  return next;
}
