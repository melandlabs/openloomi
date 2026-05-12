/**
 * File-Backed Conversation Store Base
 *
 * Provides lazy-loading per-day file persistence for all conversation stores.
 * Data lives in `{memoryDir}/{prefix}/YYYY-MM-DD.json`.
 * Load on first access, save after every write.
 *
 * Backward compatibility: if the old flat `{prefix}-conversations.json` file
 * exists, it is migrated to the per-day structure on first access and then deleted.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface ConversationMessage {
  timestamp: number;
  role?: string;
  content?: string;
}

/**
 * Internal shape stored in each day file:
 * Record<userKey, Record<accountId, ConversationMessage[]>>
 */
type DayFileData = Record<string, Record<string, ConversationMessage[]>>;

function ensureMemoryDir(memoryDir: string): void {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
}

function getPrefixDir(memoryDir: string, prefix: string): string {
  return join(memoryDir, prefix);
}

function ensurePrefixDir(memoryDir: string, prefix: string): string {
  const dir = getPrefixDir(memoryDir, prefix);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDayFilePath(
  memoryDir: string,
  prefix: string,
  date: string,
): string {
  return join(ensurePrefixDir(memoryDir, prefix), `${date}.json`);
}

// ─── Legacy helpers (kept for reference and internal use) ─────────────────────

/**
 * @deprecated Internal only. Use the public API methods instead.
 * Reads the old flat `{prefix}-conversations.json` file.
 */
export function loadConversations<T>(memoryDir: string, prefix: string): T {
  const filePath = join(memoryDir, `${prefix}-conversations.json`);
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.warn(`[${prefix}] Failed to load conversations from disk:`, err);
  }
  return {} as T;
}

/**
 * @deprecated Internal only. Use the public API methods instead.
 * Writes directly to the old flat `{prefix}-conversations.json` file.
 */
export function saveConversations<T>(
  memoryDir: string,
  prefix: string,
  data: T,
): void {
  const filePath = join(memoryDir, `${prefix}-conversations.json`);
  try {
    ensureMemoryDir(memoryDir);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[${prefix}] Failed to save conversations to disk:`, err);
  }
}

// ─── Migration ─────────────────────────────────────────────────────────────────

type LegacyData = Record<string, Record<string, Record<string, unknown[]>>>;

/**
 * Migrates the legacy flat file to per-day files, then deletes the old file.
 */
function migrateLegacyFile(memoryDir: string, prefix: string): void {
  const legacyPath = join(memoryDir, `${prefix}-conversations.json`);
  if (!existsSync(legacyPath)) return;

  try {
    const raw = readFileSync(legacyPath, "utf-8");
    const legacy: LegacyData = JSON.parse(raw);

    const migratedDays = new Map<string, DayFileData>();

    for (const [userKey, accounts] of Object.entries(legacy)) {
      for (const [accountId, messages] of Object.entries(accounts)) {
        for (const msg of messages as unknown as ConversationMessage[]) {
          const ts = msg.timestamp as number;
          if (!ts) continue;

          const dateStr = new Date(ts).toISOString().slice(0, 10);

          if (!migratedDays.has(dateStr)) {
            migratedDays.set(dateStr, {});
          }
          // biome-ignore lint/style/noNonNullAssertion: dateStr is guaranteed to exist after the has() check above
          const dayData = migratedDays.get(dateStr)!;

          if (!dayData[userKey]) {
            dayData[userKey] = {};
          }
          if (!dayData[userKey][accountId]) {
            dayData[userKey][accountId] = [];
          }
          dayData[userKey][accountId].push(msg);
        }
      }
    }

    for (const [dateStr, dayData] of migratedDays) {
      const filePath = getDayFilePath(memoryDir, prefix, dateStr);
      const existing: DayFileData = existsSync(filePath)
        ? JSON.parse(readFileSync(filePath, "utf-8"))
        : {};

      // Merge: deep merge per userKey + accountId
      for (const [userKey, accounts] of Object.entries(dayData)) {
        if (!existing[userKey]) existing[userKey] = {};
        for (const [accountId, msgs] of Object.entries(accounts)) {
          if (!existing[userKey][accountId]) existing[userKey][accountId] = [];
          const seenTimestamps = new Set(
            existing[userKey][accountId].map((m) => m.timestamp),
          );
          for (const msg of msgs) {
            if (!seenTimestamps.has(msg.timestamp)) {
              existing[userKey][accountId].push(msg);
            }
          }
        }
      }

      writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
    }

    rmSync(legacyPath);
    console.info(
      `[${prefix}] Migrated legacy conversation file and deleted it.`,
    );
  } catch (err) {
    console.error(
      `[${prefix}] Failed to migrate legacy conversation file:`,
      err,
    );
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Reads a specific day's file, returning empty object if absent or on error.
 */
function readDayFile(
  memoryDir: string,
  prefix: string,
  date: string,
): DayFileData {
  const filePath = getDayFilePath(memoryDir, prefix, date);
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as DayFileData;
    }
  } catch (err) {
    console.warn(`[${prefix}] Failed to load day file ${date}:`, err);
  }
  return {};
}

/**
 * Writes a specific day's file, creating the prefix directory if needed.
 */
function writeDayFile(
  memoryDir: string,
  prefix: string,
  date: string,
  data: DayFileData,
): void {
  const filePath = getDayFilePath(memoryDir, prefix, date);
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[${prefix}] Failed to save day file ${date}:`, err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Lazy migration flag per prefix (in-memory, runs once per process)
const migratedPrefixes = new Set<string>();

/**
 * Ensures the legacy flat file (if any) is migrated before any public operation.
 */
function ensureMigrated(memoryDir: string, prefix: string): void {
  const key = `${memoryDir}|${prefix}`;
  if (migratedPrefixes.has(key)) return;
  migrateLegacyFile(memoryDir, prefix);
  migratedPrefixes.add(key);
}

/**
 * Saves a message to the appropriate day file based on the message's timestamp.
 * If the message does not have a timestamp, defaults to the current date.
 *
 * @param memoryDir - Base directory for memory storage
 * @param prefix    - Store prefix (e.g. "agent")
 * @param userKey   - Unique user identifier
 * @param accountId - Account identifier within the user
 * @param message   - The message to save; must contain a `timestamp` field
 */
export function saveMessage(
  memoryDir: string,
  prefix: string,
  userKey: string,
  accountId: string,
  message: ConversationMessage,
): void {
  ensureMigrated(memoryDir, prefix);

  const ts = message.timestamp ?? Date.now();
  const dateStr = new Date(ts).toISOString().slice(0, 10);

  const dayData = readDayFile(memoryDir, prefix, dateStr);

  if (!dayData[userKey]) dayData[userKey] = {};
  if (!dayData[userKey][accountId]) dayData[userKey][accountId] = [];

  // Append the message directly — dedup by timestamp+content is unreliable across same-millisecond saves
  const newMsg = { ...message, timestamp: ts };
  dayData[userKey][accountId].push(newMsg);
  dayData[userKey][accountId].sort((a, b) => a.timestamp - b.timestamp);

  writeDayFile(memoryDir, prefix, dateStr, dayData);
}

/**
 * Loads all messages for a specific day, optionally filtered by userKey and/or accountId.
 *
 * @param memoryDir - Base directory for memory storage
 * @param prefix    - Store prefix
 * @param date      - Date string in YYYY-MM-DD format
 * @param userKey   - Optional filter by user key
 * @param accountId - Optional filter by account id
 */
export function loadDay(
  memoryDir: string,
  prefix: string,
  date: string,
  userKey?: string,
  accountId?: string,
): ConversationMessage[] {
  ensureMigrated(memoryDir, prefix);

  const dayData = readDayFile(memoryDir, prefix, date);

  if (userKey && accountId) {
    return dayData[userKey]?.[accountId] ?? [];
  }

  if (userKey) {
    const accounts = dayData[userKey] ?? {};
    return Object.values(accounts).flat();
  }

  return Object.values(dayData).flatMap((accounts) =>
    Object.values(accounts).flat(),
  );
}

/**
 * Returns an array of date strings (YYYY-MM-DD) that have data for the given prefix.
 */
export function listAvailableDays(memoryDir: string, prefix: string): string[] {
  ensureMigrated(memoryDir, prefix);

  const prefixDir = getPrefixDir(memoryDir, prefix);
  if (!existsSync(prefixDir)) return [];

  try {
    return readdirSync(prefixDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch (err) {
    console.warn(`[${prefix}] Failed to list available days:`, err);
    return [];
  }
}

/**
 * Loads all messages for a user+account within a date range (inclusive).
 *
 * @param memoryDir - Base directory for memory storage
 * @param prefix    - Store prefix
 * @param userKey   - User identifier
 * @param accountId - Account identifier
 * @param startDate - Start date string (YYYY-MM-DD, inclusive)
 * @param endDate   - End date string (YYYY-MM-DD, inclusive)
 */
export function loadDateRange(
  memoryDir: string,
  prefix: string,
  userKey: string,
  accountId: string,
  startDate: string,
  endDate: string,
): ConversationMessage[] {
  ensureMigrated(memoryDir, prefix);

  const prefixDir = getPrefixDir(memoryDir, prefix);
  if (!existsSync(prefixDir)) return [];

  const results: ConversationMessage[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Iterate over each day in the range
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const dayData = readDayFile(memoryDir, prefix, dateStr);
    const msgs = dayData[userKey]?.[accountId];
    if (msgs) {
      for (const msg of msgs) {
        // Extra safety filter in case the message timestamp falls outside the range
        const tsDate = new Date(msg.timestamp).toISOString().split("T")[0];
        if (tsDate >= startDate && tsDate <= endDate) {
          results.push(msg);
        }
      }
    }
    current.setDate(current.getDate() + 1);
  }

  // Sort final result by timestamp ascending
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results;
}

/**
 * Rewrites a day file, removing all messages for the given userKey+accountId pair.
 */
export function rewriteDayWithout(
  memoryDir: string,
  prefix: string,
  date: string,
  userKey: string,
  accountId: string,
): void {
  ensureMigrated(memoryDir, prefix);
  const dayData = readDayFile(memoryDir, prefix, date);
  let changed = false;

  if (dayData[userKey]?.[accountId]) {
    delete dayData[userKey]?.[accountId];
    changed = true;
  }
  if (dayData[userKey] && Object.keys(dayData[userKey]).length === 0) {
    delete dayData[userKey];
    changed = true;
  }

  if (changed) {
    writeDayFile(memoryDir, prefix, date, dayData);
  }
}

/**
 * Removes all data for a specific userKey across all day files.
 */
export function clearAllForUser(
  memoryDir: string,
  prefix: string,
  userKey: string,
): void {
  ensureMigrated(memoryDir, prefix);
  const days = listAvailableDays(memoryDir, prefix);
  for (const date of days) {
    const dayData = readDayFile(memoryDir, prefix, date);
    let changed = false;
    if (dayData[userKey]) {
      delete dayData[userKey];
      changed = true;
    }
    if (changed) {
      writeDayFile(memoryDir, prefix, date, dayData);
    }
  }
}

/**
 * Removes all data for userKeys that start with a given prefix across all day files.
 * Useful when userKey encodes multiple levels (e.g. Telegram's "telegram:self-chat:userId:").
 */
export function clearAllForUserPrefix(
  memoryDir: string,
  prefix: string,
  userKeyPrefix: string,
): void {
  ensureMigrated(memoryDir, prefix);
  const days = listAvailableDays(memoryDir, prefix);
  for (const date of days) {
    const dayData = readDayFile(memoryDir, prefix, date);
    let changed = false;
    for (const key of Object.keys(dayData)) {
      if (key.startsWith(userKeyPrefix)) {
        delete dayData[key];
        changed = true;
      }
    }
    if (changed) {
      writeDayFile(memoryDir, prefix, date, dayData);
    }
  }
}

/**
 * Clears a specific (userKey, accountId) conversation from all day files.
 */
export function clearConversationFromAllDays(
  memoryDir: string,
  prefix: string,
  userKey: string,
  accountId: string,
): void {
  const days = listAvailableDays(memoryDir, prefix);
  for (const date of days) {
    rewriteDayWithout(memoryDir, prefix, date, userKey, accountId);
  }
}

// ─── Compaction Summary ────────────────────────────────────────────────────────

export interface CompactionSummaryMessage {
  timestamp: number;
  role: "compact_summary";
  content: string;
  compactedMessageCount: number;
  compactedRangeStart: string; // ISO date YYYY-MM-DD
  compactedRangeEnd: string; // ISO date YYYY-MM-DD
}

/**
 * Writes a compact_summary message to each day file in the compacted range.
 * For each day in [compactedRangeStart, compactedRangeEnd], removes all
 * messages from the targeted conversation and appends the summary.
 *
 * @param memoryDir             - Base directory for memory storage
 * @param prefix               - Store prefix (e.g. "agent")
 * @param userKey             - Unique user identifier
 * @param accountId           - Account identifier within the user
 * @param summary             - The summary text from compaction
 * @param compactedMessageCount - Number of messages that were compacted
 * @param compactedRangeStart - Start of date range (YYYY-MM-DD, inclusive)
 * @param compactedRangeEnd   - End of date range (YYYY-MM-DD, inclusive)
 */
export function saveCompactionSummary(
  memoryDir: string,
  prefix: string,
  userKey: string,
  accountId: string,
  summary: string,
  compactedMessageCount: number,
  compactedRangeStart: string,
  compactedRangeEnd: string,
): void {
  ensureMigrated(memoryDir, prefix);

  const summaryMsg: CompactionSummaryMessage = {
    timestamp: Date.now(),
    role: "compact_summary",
    content: summary,
    compactedMessageCount,
    compactedRangeStart,
    compactedRangeEnd,
  };

  const start = new Date(compactedRangeStart);
  const end = new Date(compactedRangeEnd);

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const dayData = readDayFile(memoryDir, prefix, dateStr);

    // Remove all messages for this conversation in this day
    if (dayData[userKey]?.[accountId]) {
      // Keep only messages outside the compacted range
      dayData[userKey][accountId] = dayData[userKey][accountId].filter(
        (msg) => {
          const msgDate = new Date(msg.timestamp).toISOString().split("T")[0];
          return msgDate < compactedRangeStart || msgDate > compactedRangeEnd;
        },
      );

      // Append the summary message
      dayData[userKey][accountId].push(summaryMsg as ConversationMessage);

      // Clean up empty entries
      if (dayData[userKey][accountId].length === 0) {
        delete dayData[userKey][accountId];
      }
      if (Object.keys(dayData[userKey]).length === 0) {
        delete dayData[userKey];
      }

      writeDayFile(memoryDir, prefix, dateStr, dayData);
    }

    current.setDate(current.getDate() + 1);
  }
}

// ─── Channel Store Helpers ───────────────────────────────────────────────────

/**
 * Builds the memory directory path for a specific channel.
 * Uses proper path.join to handle cross-platform path separators.
 */
export function getChannelMemoryDir(
  memoryDir: string,
  platform: string,
): string {
  return join(memoryDir, "channels", platform);
}

/**
 * Saves a message to a channel-specific day file.
 * The channel path is automatically nested under channels/{platform}.
 */
export function saveChannelMessage(
  memoryDir: string,
  platform: string,
  userKey: string,
  accountId: string,
  message: ConversationMessage,
): void {
  const channelDir = getChannelMemoryDir(memoryDir, platform);
  saveMessage(channelDir, platform, userKey, accountId, message);
}

/**
 * Loads messages for a specific channel and day.
 * The channel path is automatically nested under channels/{platform}.
 */
export function loadChannelDay(
  memoryDir: string,
  platform: string,
  date: string,
  userKey?: string,
  accountId?: string,
): ConversationMessage[] {
  const channelDir = getChannelMemoryDir(memoryDir, platform);
  return loadDay(channelDir, platform, date, userKey, accountId);
}

/**
 * Clears a specific conversation from all day files for a channel.
 */
export function clearChannelConversationFromAllDays(
  memoryDir: string,
  platform: string,
  userKey: string,
  accountId: string,
): void {
  const channelDir = getChannelMemoryDir(memoryDir, platform);
  clearConversationFromAllDays(channelDir, platform, userKey, accountId);
}

/**
 * Clears all conversations for a user within a channel.
 */
export function clearAllChannelForUser(
  memoryDir: string,
  platform: string,
  userKey: string,
): void {
  const channelDir = getChannelMemoryDir(memoryDir, platform);
  clearAllForUser(channelDir, platform, userKey);
}

/**
 * Clears all conversations for userKeys that start with a given prefix within a channel.
 */
export function clearChannelForUserPrefix(
  memoryDir: string,
  platform: string,
  userKeyPrefix: string,
): void {
  const channelDir = getChannelMemoryDir(memoryDir, platform);
  clearAllForUserPrefix(channelDir, platform, userKeyPrefix);
}
