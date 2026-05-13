/**
 * Agent Avatar utility functions
 */

import { getAvatarConfigByState } from "./constants";
import type { AvatarConfiguration } from "./types";
import { DEFAULT_AVATAR_SHAPE_ID } from "./shape-presets";

/**
 * Merge partial or API avatar config with defaults (legacy records may omit shapeId).
 */
export function mergeAvatarConfig(
  raw: Partial<AvatarConfiguration> | null | undefined,
): AvatarConfiguration {
  const base = getAvatarConfigByState();
  if (!raw || typeof raw !== "object") {
    return { ...base };
  }
  return {
    ...base,
    ...raw,
    shapeId:
      typeof raw.shapeId === "string" && raw.shapeId.length > 0
        ? raw.shapeId
        : (base.shapeId ?? DEFAULT_AVATAR_SHAPE_ID),
    customTextureUrl:
      raw.customTextureUrl === undefined
        ? base.customTextureUrl
        : raw.customTextureUrl,
    showBorder: raw.showBorder === undefined ? base.showBorder : raw.showBorder,
  };
}

/**
 * Load user's avatar config from local storage
 * @param userId User ID
 * @returns Avatar config or null
 */
export function loadAvatarConfigFromStorage(
  userId: string,
): AvatarConfiguration | null {
  if (typeof window === "undefined") return null;

  try {
    const key = `openloomi_avatar_config_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as AvatarConfiguration;
    }
  } catch (error) {
    console.error("Failed to load avatar config from storage:", error);
  }

  return null;
}

/**
 * Save user's avatar config to local storage
 * @param userId User ID
 * @param config Avatar config
 */
export function saveAvatarConfigToStorage(
  userId: string,
  config: AvatarConfiguration,
): void {
  if (typeof window === "undefined") return;

  try {
    const key = `openloomi_avatar_config_${userId}`;
    localStorage.setItem(key, JSON.stringify(config));
  } catch (error) {
    console.error("Failed to save avatar config to storage:", error);
  }
}

/**
 * Clear user's avatar config
 * @param userId User ID
 */
export function clearAvatarConfigFromStorage(userId: string): void {
  if (typeof window === "undefined") return;

  try {
    const key = `openloomi_avatar_config_${userId}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Failed to clear avatar config from storage:", error);
  }
}

const ASSISTANT_NAME_PREFIX = "openloomi_assistant_name_";

/**
 * Load assistant name from local storage
 */
export function loadAssistantNameFromStorage(userId: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    const key = `${ASSISTANT_NAME_PREFIX}${userId}`;
    const stored = localStorage.getItem(key);
    return stored ?? null;
  } catch (error) {
    console.error("Failed to load assistant name from storage:", error);
    return null;
  }
}

/**
 * Save assistant name to local storage
 */
export function saveAssistantNameToStorage(userId: string, name: string): void {
  if (typeof window === "undefined") return;

  try {
    const key = `${ASSISTANT_NAME_PREFIX}${userId}`;
    const value = name.trim();
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error("Failed to save assistant name to storage:", error);
  }
}
