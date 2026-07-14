/**
 * Client-side IndexedDB integration for raw messages
 * This module handles browser-side IndexedDB operations for storing and querying raw messages
 */

import type {
  RunMemoryForgettingCycleResult,
  RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions,
} from "./forgetting";
import type {
  GroupByType,
  MemorySummaryRecord,
  RawMessage,
  RawMessageQuery,
} from "./manager";
import {
  type MemoryGraphEvolutionRunResult,
  type RawMessageGraphEvolutionOptions,
  storeRawMessagesWithGraphEvolution,
} from "./memory-graph-evolution";
import {
  ensureRawMessagesSQLiteMigration,
  migrateIndexedDBRawMessagesToSQLite,
  shouldUseRawMessageApiStorage,
  shouldUseSQLiteRawMessageStorage,
  sqliteClearOldRawMessages,
  sqliteGetRawMessagesStats,
  sqliteQueryRawMessages,
  sqliteQueryRawMessagesGrouped,
  sqliteRunMemoryForgettingCycleForUser,
  sqliteRunRawMessageEmbeddingDreamForUser,
  sqliteSearchRawMessagesSemanticallyForUser,
  sqliteStoreRawMessagesFromInsight,
} from "./sqlite-client";

// Re-export types for external use
export type { RawMessage, RawMessageQuery, GroupByType, MemorySummaryRecord };
export {
  ensureRawMessagesSQLiteMigration,
  migrateIndexedDBRawMessagesToSQLite,
  shouldUseRawMessageApiStorage,
  shouldUseSQLiteRawMessageStorage,
};

export type RawMessageSourceType = "raw" | "summary";

export type RawMessageQueryResultItem =
  | (RawMessage & { sourceType: "raw" })
  | (MemorySummaryRecord & { sourceType: "summary" });

export interface RunMemoryForgettingCycleForUserOptions {
  dryRun?: boolean;
  hardDeleteArchivedOlderThan?: number;
  shadowDiagnostics?: RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions;
}

export interface RunMemoryForgettingCycleForUserResult {
  success: boolean;
  status?: "success" | "skipped_locked";
  createdSummaries?: number;
  transitionedRecords?: number;
  archivedDetailRecords?: number;
  hardDeletedRecords?: number;
  shadowDiagnostics?: RunMemoryForgettingCycleResult["shadowDiagnostics"];
  error?: string;
}

let managerInstance: any = null;

/**
 * Initialize IndexedDB manager (client-side only)
 */
async function getManager() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }

  if (!managerInstance) {
    const { getIndexedDBManager } = await import("./manager");
    managerInstance = getIndexedDBManager();
    await managerInstance.init();
  }

  return managerInstance;
}

function normalizeTimestampToMs(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if ((value as number) < 1e11) {
    return Math.floor((value as number) * 1000);
  }
  return Math.floor(value as number);
}

function toRawSourceItem(
  message: RawMessage,
): RawMessage & { sourceType: "raw" } {
  return {
    ...message,
    sourceType: "raw",
  };
}

function toSummarySourceItem(
  summary: MemorySummaryRecord,
): MemorySummaryRecord & { sourceType: "summary" } {
  return {
    ...summary,
    sourceType: "summary",
  };
}

/**
 * Store raw messages from insight generation
 * Call this function when insights are generated to store the raw messages
 */
export async function storeRawMessagesFromInsight(
  userId: string,
  messages: Array<{
    messageId: string;
    platform: string;
    botId: string;
    channel?: string;
    person?: string;
    timestamp: number;
    content: string;
    attachments?: Array<{
      name: string;
      url: string;
      contentType?: string;
      sizeBytes?: number;
    }>;
    embedding?: number[];
    embeddingModel?: string;
    embeddingContentHash?: string;
    embeddingDimensions?: number;
    embeddingUpdatedAt?: number;
    metadata?: Record<string, any>;
  }>,
  graphEvolution?: RawMessageGraphEvolutionOptions,
): Promise<{
  success: boolean;
  stored: number;
  errors: number;
  graphEvolution?: MemoryGraphEvolutionRunResult;
}> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteStoreRawMessagesFromInsight(
        userId,
        messages,
        graphEvolution,
      );
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to store messages, falling back to IndexedDB:",
        error,
      );
    }
  }

  try {
    const manager = await getManager();

    // Add userId to all messages before storing
    const messagesWithUserId = messages.map((msg) => ({
      ...msg,
      userId,
      createdAt: Date.now() / 1000,
    }));

    const stored = await storeRawMessagesWithGraphEvolution({
      storage: manager,
      messages: messagesWithUserId,
      graphEvolution,
    });
    return {
      success: true,
      stored: stored.ids.length,
      errors: 0,
      graphEvolution: stored.graphEvolution,
    };
  } catch (error) {
    console.error("[Client IndexedDB] Failed to store messages:", error);
    return {
      success: false,
      stored: 0,
      errors: 1,
    };
  }
}

/**
 * Query raw messages from IndexedDB
 */
export async function queryRawMessages(
  query: RawMessageQuery,
): Promise<RawMessageQueryResultItem[]> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return (await sqliteQueryRawMessages(
        query,
      )) as RawMessageQueryResultItem[];
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to query messages, falling back to IndexedDB:",
        error,
      );
    }
  }

  // Opt-in switch to keep old behavior stable unless caller requests fallback.
  if (query.includeSummaryFallback) {
    return queryRawMessagesWithFallback(query);
  }

  // Normal IndexedDB query
  try {
    const manager = await getManager();
    const rawMessages = await manager.queryMessages(query);
    return rawMessages.map(toRawSourceItem);
  } catch (error) {
    console.error("[Client IndexedDB] Failed to query messages:", error);
    return [];
  }
}

/**
 * Query raw messages with summary fallback.
 * It first queries raw records; if results are insufficient it appends summary hits.
 */
export async function queryRawMessagesWithFallback(
  query: RawMessageQuery,
): Promise<RawMessageQueryResultItem[]> {
  const pageSize = query.pageSize ?? query.limit ?? 50;
  const minRaw =
    query.minRawResultsWithoutFallback ?? query.pageSize ?? query.limit ?? 50;

  try {
    const manager = await getManager();

    if (!query.userId) {
      const rawOnly = await manager.queryMessages({
        ...query,
        includeSummaryFallback: false,
        pageSize,
      });
      return rawOnly.map(toRawSourceItem);
    }

    const { queryMemoryWithFallback } = await import("./forgetting");
    // Bridge raw-message query shape into the memory query API.
    const result = await queryMemoryWithFallback(manager, {
      userId: query.userId,
      keywords: query.keywords,
      startTime: normalizeTimestampToMs(query.startTime),
      endTime: normalizeTimestampToMs(query.endTime),
      limit: pageSize,
      pageSize,
      offset: query.offset,
      reverse: query.reverse ?? true,
      tiers: query.memoryStages,
      dimensions: {
        platform: query.platform,
        channel: query.channel,
        person: query.person,
        botId: query.botId,
      },
      minRawResultsWithoutFallback: minRaw,
      includeDeprecated: query.includeDeprecated,
    });

    const items: RawMessageQueryResultItem[] = result.items.map((item) => {
      if (item.sourceType === "summary") {
        return toSummarySourceItem({
          summaryId: item.summary.summaryId,
          userId: item.summary.userId,
          summaryTier: item.summary.summaryTier,
          sourceTier: item.summary.sourceTier,
          startTimestamp: item.summary.startTimestamp,
          endTimestamp: item.summary.endTimestamp,
          messageCount: item.summary.messageCount,
          sourceRecordIds: item.summary.sourceRecordIds,
          keyPoints: item.summary.keyPoints,
          keywords: item.summary.keywords,
          keywordsText: item.summary.keywords.join(" "),
          summaryText: item.summary.summaryText,
          dimensions: item.summary.dimensions,
          qualityScore: item.summary.qualityScore,
          createdAt: item.summary.createdAt,
          updatedAt: item.summary.updatedAt,
        });
      }

      const rawMaybe = (
        item.record.metadata as Record<string, unknown> | undefined
      )?.__rawMessage;
      if (rawMaybe && typeof rawMaybe === "object") {
        // Preferred path: return exact stored raw object for downstream compatibility.
        return toRawSourceItem(rawMaybe as RawMessage);
      }

      // Fallback reconstruction should be rare, but keeps API resilient if metadata is minimal.
      return toRawSourceItem({
        messageId: item.record.id,
        platform:
          typeof item.record.dimensions?.platform === "string"
            ? String(item.record.dimensions.platform)
            : "unknown",
        botId:
          typeof item.record.dimensions?.botId === "string"
            ? String(item.record.dimensions.botId)
            : "unknown",
        userId: item.record.userId,
        channel:
          typeof item.record.dimensions?.channel === "string"
            ? String(item.record.dimensions.channel)
            : undefined,
        person:
          typeof item.record.dimensions?.person === "string"
            ? String(item.record.dimensions.person)
            : undefined,
        timestamp: Math.floor(item.record.timestamp / 1000),
        content: item.record.text ?? "",
        attachments: [],
        embedding: item.record.embedding,
        embeddingModel: item.record.embeddingModel,
        embeddingContentHash: item.record.embeddingContentHash,
        embeddingDimensions: item.record.embeddingDimensions,
        embeddingUpdatedAt: item.record.embeddingUpdatedAt,
        metadata:
          (item.record.metadata as Record<string, any> | undefined) ??
          undefined,
        createdAt: item.record.timestamp,
        memoryStage: item.record.tier,
        accessCount: item.record.accessCount,
        lastAccessAt: item.record.lastAccessAt,
        importanceScore: item.record.importanceScore,
        archivedAt: item.record.archivedAt,
        isPinned: item.record.isPinned,
      });
    });

    return items.slice(0, pageSize);
  } catch (error) {
    console.error(
      "[Client IndexedDB] Failed to query messages with fallback:",
      error,
    );
    return [];
  }
}

/**
 * Query raw messages grouped by time period (day, week, month)
 * Returns grouped messages with user-friendly date labels (Today, Yesterday, etc.)
 */
export async function queryRawMessagesGrouped(
  query: RawMessageQuery,
): Promise<Record<string, RawMessage[]>> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteQueryRawMessagesGrouped(query);
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to query grouped messages, falling back to IndexedDB:",
        error,
      );
    }
  }

  // Normal IndexedDB query
  try {
    const manager = await getManager();
    return await manager.queryMessagesGrouped(query);
  } catch (error) {
    console.error(
      "[Client IndexedDB] Failed to query grouped messages:",
      error,
    );
    return {};
  }
}

/**
 * Get statistics about stored messages
 */
export async function getRawMessagesStats(): Promise<{
  totalMessages: number;
  messagesByPlatform: Record<string, number>;
  messagesByBot: Record<string, number>;
  oldestMessage?: number;
  newestMessage?: number;
}> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteGetRawMessagesStats();
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to get stats, falling back to IndexedDB:",
        error,
      );
    }
  }

  // Normal IndexedDB query
  try {
    const manager = await getManager();
    return await manager.getStats();
  } catch (error) {
    console.error("[Client IndexedDB] Failed to get stats:", error);
    return {
      totalMessages: 0,
      messagesByPlatform: {},
      messagesByBot: {},
    };
  }
}

/**
 * Clear old messages
 */
export async function clearOldRawMessages(
  olderThan: number,
  userId?: string,
): Promise<{ success: boolean; deleted: number }> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteClearOldRawMessages(olderThan, userId);
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to clear old messages, falling back to IndexedDB:",
        error,
      );
    }
  }

  try {
    const manager = await getManager();
    const deleted = await manager.deleteOldMessages(olderThan, userId);
    return {
      success: true,
      deleted,
    };
  } catch (error) {
    console.error("[Client IndexedDB] Failed to clear messages:", error);
    return {
      success: false,
      deleted: 0,
    };
  }
}

export async function runMemoryForgettingCycleForUser(
  userId: string,
  options?: RunMemoryForgettingCycleForUserOptions,
): Promise<RunMemoryForgettingCycleForUserResult> {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteRunMemoryForgettingCycleForUser(userId, options);
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to run forgetting cycle, falling back to IndexedDB:",
        error,
      );
    }
  }

  try {
    const manager = await getManager();
    const { runMemoryForgettingCycle } = await import("./forgetting");
    const result = await runMemoryForgettingCycle(manager, userId, options);
    return {
      success: true,
      status: result.status,
      createdSummaries: result.createdSummaries,
      transitionedRecords: result.transitionedRecords,
      archivedDetailRecords: result.archivedDetailRecords,
      hardDeletedRecords: result.hardDeletedRecords,
      shadowDiagnostics: result.shadowDiagnostics,
    };
  } catch (error) {
    console.error(
      "[Client IndexedDB] Failed to run memory forgetting cycle:",
      error,
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runRawMessageEmbeddingDreamForUser(
  userId: string,
  options: {
    embeddingModel: string;
    embedDocuments: (documents: string[]) => Promise<number[][]>;
    limit?: number;
    scanLimit?: number;
    includeArchived?: boolean;
    dryRun?: boolean;
  },
) {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteRunRawMessageEmbeddingDreamForUser(userId, options);
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to run embedding dream, falling back to IndexedDB:",
        error,
      );
    }
  }

  const manager = await getManager();
  const { runRawMessageEmbeddingDream } = await import("./embedding");
  return await runRawMessageEmbeddingDream(manager, {
    userId,
    ...options,
  });
}

export async function searchRawMessagesSemanticallyForUser(
  userId: string,
  options: {
    query: string;
    embedQuery: (query: string) => Promise<number[]>;
    embeddingModel?: string;
    limit?: number;
    scanLimit?: number;
    threshold?: number;
    includeArchived?: boolean;
    platform?: string;
    botId?: string;
    channel?: string;
    person?: string;
    startTime?: number;
    endTime?: number;
  },
) {
  if (shouldUseRawMessageApiStorage()) {
    try {
      return await sqliteSearchRawMessagesSemanticallyForUser(userId, options);
    } catch (error) {
      console.warn(
        "[Client Raw Messages API] Failed to search semantically, falling back to IndexedDB:",
        error,
      );
    }
  }

  const manager = await getManager();
  const { searchRawMessagesSemantically } = await import("./embedding");
  return await searchRawMessagesSemantically(manager, {
    userId,
    ...options,
  });
}

/**
 * Format raw messages for AI consumption
 */
export function formatRawMessagesForAI(
  messages: Array<RawMessage | RawMessageQueryResultItem>,
): string {
  if (messages.length === 0) {
    return "No raw messages found.";
  }

  const formatted = messages.map((msg) => {
    if ((msg as RawMessageQueryResultItem).sourceType === "summary") {
      const summary = msg as MemorySummaryRecord & { sourceType: "summary" };
      const date = new Date(summary.endTimestamp);
      const keywordsText =
        summary.keywords && summary.keywords.length > 0
          ? `\nKeywords: ${summary.keywords.join(", ")}`
          : "";
      const keyPointsText =
        summary.keyPoints && summary.keyPoints.length > 0
          ? `\nKey Points: ${summary.keyPoints.join(" | ")}`
          : "";
      return `[${date.toLocaleString()}] Summary ${summary.summaryTier} (${summary.sourceTier}) : ${summary.summaryText}${keyPointsText}${keywordsText}`;
    }

    const rawMessage =
      (msg as RawMessageQueryResultItem).sourceType === "raw"
        ? (msg as RawMessage & { sourceType: "raw" })
        : (msg as RawMessage);

    const parts: string[] = [];

    // Timestamp
    if (rawMessage.timestamp) {
      const rawTimestamp =
        rawMessage.timestamp < 1e11
          ? rawMessage.timestamp * 1000
          : rawMessage.timestamp;
      const date = new Date(rawTimestamp);
      parts.push(`[${date.toLocaleString()}]`);
    }

    // Platform & Channel
    parts.push(
      `${rawMessage.platform}${rawMessage.channel ? ` - ${rawMessage.channel}` : ""}`,
    );

    // Person
    if (rawMessage.person) {
      parts.push(`from ${rawMessage.person}`);
    }

    // Content
    parts.push(`: ${rawMessage.content}`);

    // Attachments
    if (rawMessage.attachments && rawMessage.attachments.length > 0) {
      parts.push(
        `\nAttachments: ${rawMessage.attachments.map((a) => a.name).join(", ")}`,
      );
    }

    return parts.join(" ");
  });

  return formatted.join("\n\n");
}

/**
 * Send raw messages to server for storage
 * This is used when messages are generated server-side during insight generation
 */
export async function sendRawMessagesToServer(
  messages: RawMessage[],
): Promise<{ success: boolean; stored: number }> {
  try {
    const response = await fetch("/api/messages/raw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      success: data.success,
      stored: data.stored || messages.length,
    };
  } catch (error) {
    console.error(
      "[Client IndexedDB] Failed to send messages to server:",
      error,
    );
    return {
      success: false,
      stored: 0,
    };
  }
}

/**
 * Initialize raw message storage and load initial data.
 * Tauri builds use SQLite with a one-time IndexedDB migration; browser builds
 * keep the IndexedDB backend.
 */
export async function initializeRawMessagesStorage(userId?: string): Promise<{
  success: boolean;
  migration?: Awaited<ReturnType<typeof ensureRawMessagesSQLiteMigration>>;
  stats?: {
    totalMessages: number;
    messagesByPlatform: Record<string, number>;
    messagesByBot: Record<string, number>;
  };
}> {
  try {
    if (typeof window === "undefined") {
      return { success: false };
    }

    if (shouldUseRawMessageApiStorage()) {
      const migration =
        shouldUseSQLiteRawMessageStorage() && userId
          ? await ensureRawMessagesSQLiteMigration({ userId })
          : undefined;
      const stats = await sqliteGetRawMessagesStats();
      console.log("[Client Raw Messages API] Initialized with stats:", stats);
      return {
        success: true,
        migration,
        stats: {
          totalMessages: stats.totalMessages,
          messagesByPlatform: stats.messagesByPlatform,
          messagesByBot: stats.messagesByBot,
        },
      };
    }

    const manager = await getManager();
    const stats = await manager.getStats();

    console.log("[Client IndexedDB] Initialized with stats:", stats);

    return {
      success: true,
      stats: {
        totalMessages: stats.totalMessages,
        messagesByPlatform: stats.messagesByPlatform,
        messagesByBot: stats.messagesByBot,
      },
    };
  } catch (error) {
    console.error("[Client IndexedDB] Initialization failed:", error);
    return { success: false };
  }
}

// React is imported lazily to avoid breaking non-React environments
let React: typeof import("react") | null = null;

async function getReact() {
  if (!React) {
    try {
      React = await import("react");
    } catch {
      throw new Error(
        "React is required for useRawMessages hook. Please ensure 'react' is installed.",
      );
    }
  }
  return React;
}

/**
 * React hook for using raw messages storage
 */
export async function useRawMessages() {
  const react = await getReact();
  const [stats, setStats] = react.useState<{
    totalMessages: number;
    messagesByPlatform: Record<string, number>;
    messagesByBot: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = react.useState(false);

  const loadStats = react.useCallback(async () => {
    setLoading(true);
    try {
      const stats = await getRawMessagesStats();
      setStats({
        totalMessages: stats.totalMessages,
        messagesByPlatform: stats.messagesByPlatform,
        messagesByBot: stats.messagesByBot,
      });
    } catch (error) {
      console.error("[useRawMessages] Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const queryMessages = react.useCallback(async (query: RawMessageQuery) => {
    return await queryRawMessages(query);
  }, []);

  const storeMessages = react.useCallback(
    async (
      userId: string,
      messages: Parameters<typeof storeRawMessagesFromInsight>[1],
    ) => {
      const result = await storeRawMessagesFromInsight(userId, messages);
      if (result.success) {
        // Reload stats after storing
        await loadStats();
      }
      return result;
    },
    [loadStats],
  );

  react.useEffect(() => {
    loadStats();
  }, [loadStats]);

  return {
    stats,
    loading,
    queryMessages,
    storeMessages,
    refreshStats: loadStats,
  };
}
