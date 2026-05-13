/**
 * Database serialization utilities
 *
 * Provides functions for serializing/deserializing data between
 * the application and database layers, handling differences between
 * SQLite (JSON strings) and PostgreSQL (jsonb) modes.
 */

import type { Insight, UserContact } from "./schema";
import { isTauriMode } from "@/lib/env/constants";
import { encryptToken, decryptToken } from "@openloomi/security/token-encryption";

/**
 * Convert JSON data (object or array) to database-compatible format
 * SQLite: needs to be serialized to JSON string
 * PostgreSQL: can directly use jsonb object or array
 */
export function serializeJson(
  data:
    | Record<string, unknown>
    | unknown[]
    | string
    | number
    | boolean
    | null
    | undefined,
): unknown {
  // SQLite mode: always return JSON string or empty string
  if (isTauriMode()) {
    if (data === null || data === undefined) return null;
    if (typeof data === "string") return data;
    return JSON.stringify(data);
  }
  // PostgreSQL mode: return data directly
  if (data === null || data === undefined) return null;
  if (typeof data === "string") return data;
  return data;
}

/**
 * Deserialize JSON data (used after reading from database)
 * SQLite: needs to parse JSON string to object or array
 * PostgreSQL: already object or array, return directly
 */
export function deserializeJson(
  data: string | unknown[] | Record<string, unknown> | null | undefined,
): any {
  // SQLite mode: need to parse JSON string
  if (isTauriMode()) {
    if (!data || data === "null" || data === "[]") return [];
    if (typeof data === "string") return JSON.parse(data);
    return data;
  }
  // PostgreSQL mode: return data directly
  if (!data) return [];
  return data;
}

/**
 * Parse contactMeta for a single UserContact object (using the generic deserializeJson)
 * @param contact Contact object
 * @returns Parsed contact object (modified in place)
 */
export function normalizeContactMeta<T extends UserContact>(contact: T): T {
  if (contact.contactMeta) {
    contact.contactMeta = deserializeJson(contact.contactMeta as any);
  }
  return contact;
}

/**
 * Parse contactMeta for an array of UserContact objects (using the generic deserializeJson)
 * @param contacts Array of contact objects
 * @returns Parsed array of contacts (modified in place)
 */
export function normalizeContactMetaList<T extends UserContact>(
  contacts: T[],
): T[] {
  for (const contact of contacts) {
    if (contact.contactMeta) {
      contact.contactMeta = deserializeJson(contact.contactMeta as any);
    }
  }
  return contacts;
}

/**
 * Parse all JSON fields for an Insight object (SQLite mode)
 * @param insight Insight object
 * @returns Parsed Insight object
 */
export function normalizeInsight<T extends Insight>(insight: T): T {
  const data = insight as any;

  // Parse all JSON fields
  if (data.groups) data.groups = deserializeJson(data.groups);
  if (data.people) data.people = deserializeJson(data.people);
  if (data.details) data.details = deserializeJson(data.details);
  if (data.timeline) data.timeline = deserializeJson(data.timeline);
  if (data.insights) data.insights = deserializeJson(data.insights);
  if (data.topKeywords) data.topKeywords = deserializeJson(data.topKeywords);
  if (data.topEntities) data.topEntities = deserializeJson(data.topEntities);
  if (data.topVoices) data.topVoices = deserializeJson(data.topVoices);
  if (data.sources) data.sources = deserializeJson(data.sources);
  if (data.buyerSignals) data.buyerSignals = deserializeJson(data.buyerSignals);
  if (data.stakeholders) data.stakeholders = deserializeJson(data.stakeholders);
  if (data.nextActions) data.nextActions = deserializeJson(data.nextActions);
  if (data.followUps) data.followUps = deserializeJson(data.followUps);
  if (data.actionRequiredDetails)
    data.actionRequiredDetails = deserializeJson(data.actionRequiredDetails);
  if (data.myTasks) data.myTasks = deserializeJson(data.myTasks);
  if (data.waitingForMe) data.waitingForMe = deserializeJson(data.waitingForMe);
  if (data.waitingForOthers)
    data.waitingForOthers = deserializeJson(data.waitingForOthers);
  if (data.categories) data.categories = deserializeJson(data.categories);
  if (data.priority) data.priority = deserializeJson(data.priority);
  if (data.experimentIdeas)
    data.experimentIdeas = deserializeJson(data.experimentIdeas);
  if (data.riskFlags) data.riskFlags = deserializeJson(data.riskFlags);
  if (data.historySummary)
    data.historySummary = deserializeJson(data.historySummary);
  if (data.strategic) data.strategic = deserializeJson(data.strategic);
  if (data.roleAttribution)
    data.roleAttribution = deserializeJson(data.roleAttribution);
  if (data.alerts) data.alerts = deserializeJson(data.alerts);

  return insight;
}

/**
 * Parse all JSON fields for an array of Insight objects (SQLite mode)
 * @param insights Array of Insight objects
 * @returns Parsed array of Insight objects
 */
export function normalizeInsightList<T extends Insight>(insights: T[]): T[] {
  return insights.map((insight) => normalizeInsight(insight));
}

/**
 * Encrypt a payload for storage
 */
export function encryptPayload<T>(input: T): string {
  const serialized = JSON.stringify(input ?? {});
  try {
    return encryptToken(serialized);
  } catch (error) {
    console.error("[IntegrationAccounts] Failed to encrypt payload", error);
    throw new Error(
      `[IntegrationAccounts] Failed to encrypt payload: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Decrypt a payload from storage
 */
export function decryptPayload<T = unknown>(payload: string | null): T | null {
  if (!payload) {
    return null;
  }
  try {
    const decrypted = decryptToken(payload);
    return JSON.parse(decrypted) as T;
  } catch (error) {
    console.error("[IntegrationAccounts] Failed to decrypt payload", error);
    try {
      return JSON.parse(payload) as T;
    } catch {
      console.error(
        "[IntegrationAccounts] Cannot parse payload as plaintext either",
      );
      return null;
    }
  }
}

export const DEFAULT_INSIGHT_TTL_HOURS = 24;
