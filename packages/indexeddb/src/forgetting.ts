import type { MemoryConsolidationRuntimeRelationKeys } from "../../ai/memory-consolidation/src/runtime";
import type {
  MemoryConsolidationShadowDiagnosticsRunResult,
  RunMemoryConsolidationShadowDiagnosticsInput,
} from "../../ai/memory-consolidation/src/shadow";
import {
  type MemoryForgettingPolicyOverrides,
  type MemoryLockHandle,
  type MemoryPageResult,
  type MemoryQueryGraphRetrievalOptions,
  type MemoryRecord,
  type MemorySearchQuery,
  type MemorySearchWithFallbackResult,
  type MemorySemanticRecallHit,
  type MemorySemanticRecallQuery,
  type MemoryStorageAdapter,
  type MemorySummary,
  type MemorySummarySearchQuery,
  type MemoryTier,
  createMemoryForgettingEngine,
  createMemoryQueryApi,
} from "../../ai/src/memory";
import { cosineSimilarity } from "./embedding";
import type {
  IndexedDBManager,
  MemoryStage,
  MemorySummaryRecord,
  RawMessage,
} from "./manager";

/**
 * Bridge layer between IndexedDB manager and the shared memory engine APIs.
 *
 * Why this file exists:
 * - `packages/ai/src/memory` defines generic contracts/engine logic.
 * - `packages/indexeddb` owns concrete browser persistence details.
 * - This adapter maps the generic contract onto our IndexedDB stores.
 */
const LOCAL_LOCKS = new Map<
  string,
  {
    token: string;
    expiresAt: number;
  }
>();

/**
 * Normalize mixed timestamp inputs into milliseconds.
 *
 * Raw records in this codebase are historically second-based in many call-sites,
 * while memory engine contracts expect millisecond timestamps. We keep the adapter
 * tolerant to both, so existing integrations do not need to migrate all at once.
 */
function normalizeTimestampToMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if ((value as number) < 1e11) {
    return Math.floor((value as number) * 1000);
  }
  return Math.floor(value as number);
}

function normalizeTimestampFromMs(value: number): number {
  // Keep legacy raw timestamp convention (mostly seconds in raw store).
  return Math.floor(value / 1000);
}

/**
 * Convert persisted raw message records into engine-native `MemoryRecord`s.
 *
 * Important compatibility behavior:
 * - When message details were archived, `text` is omitted to model "compressed" memory.
 * - Original raw record is preserved in metadata for lossless fallback-query responses.
 */
function toMemoryRecord(message: RawMessage): MemoryRecord {
  return {
    id: message.messageId,
    userId: message.userId,
    timestamp: normalizeTimestampToMs(message.timestamp),
    text: message.archivedAt ? undefined : message.content,
    mediaRefs: message.attachments?.map((item) => item.url).filter(Boolean),
    embedding: message.embedding,
    embeddingModel: message.embeddingModel,
    embeddingContentHash: message.embeddingContentHash,
    embeddingDimensions: message.embeddingDimensions,
    embeddingUpdatedAt: message.embeddingUpdatedAt,
    tier: (message.memoryStage ?? "short") as MemoryStage,
    accessCount: message.accessCount ?? 0,
    lastAccessAt: message.lastAccessAt,
    importanceScore: message.importanceScore ?? 0,
    isPinned: message.isPinned ?? false,
    archivedAt: message.archivedAt,
    dimensions: {
      platform: message.platform,
      channel: message.channel,
      person: message.person,
      botId: message.botId,
    },
    metadata: {
      // Preserve the original raw record so fallback query can return full raw shape.
      ...(message.metadata ?? {}),
      __rawMessage: message,
    },
  };
}

function toSummaryRecord(summary: MemorySummary): MemorySummaryRecord {
  // Materialize `keywordsText` for simple contains-based search in IndexedDB.
  return {
    summaryId: summary.summaryId,
    userId: summary.userId,
    summaryTier: summary.summaryTier,
    sourceTier: summary.sourceTier,
    startTimestamp: summary.startTimestamp,
    endTimestamp: summary.endTimestamp,
    messageCount: summary.messageCount,
    sourceRecordIds: summary.sourceRecordIds,
    keyPoints: summary.keyPoints,
    keywords: summary.keywords,
    keywordsText: summary.keywords.join(" "),
    summaryText: summary.summaryText,
    dimensions: summary.dimensions,
    qualityScore: summary.qualityScore,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function toMemorySummary(summary: MemorySummaryRecord): MemorySummary {
  // Reverse mapping for query API consumption.
  return {
    summaryId: summary.summaryId,
    userId: summary.userId,
    summaryTier: summary.summaryTier,
    sourceTier: summary.sourceTier,
    startTimestamp: summary.startTimestamp,
    endTimestamp: summary.endTimestamp,
    messageCount: summary.messageCount,
    sourceRecordIds: summary.sourceRecordIds,
    keyPoints: summary.keyPoints,
    keywords: summary.keywords,
    summaryText: summary.summaryText,
    dimensions: summary.dimensions,
    qualityScore: summary.qualityScore,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function getPageSize(input: { pageSize?: number; limit?: number }): number {
  // Preserve old `limit` behavior while preferring explicit `pageSize`.
  return input.pageSize ?? input.limit ?? 50;
}

function clampSemanticLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.max(1, Math.floor(value as number));
}

function clampSemanticThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.min(1, Math.max(-1, value as number));
}

function dimensionMatches(
  record: MemoryRecord,
  dimensions: MemorySemanticRecallQuery["dimensions"],
): boolean {
  if (!dimensions) {
    return true;
  }

  const recordDimensions = record.dimensions ?? {};
  return Object.entries(dimensions).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }
    return recordDimensions[key] === value;
  });
}

function timeMatches(
  record: MemoryRecord,
  query: Pick<MemorySemanticRecallQuery, "startTime" | "endTime">,
): boolean {
  if (query.startTime !== undefined && record.timestamp < query.startTime) {
    return false;
  }
  if (query.endTime !== undefined && record.timestamp >= query.endTime) {
    return false;
  }
  return true;
}

type NativeRawSemanticSearchResult = {
  message: RawMessage;
  similarity: number;
};

type NativeSemanticSearchManager = IndexedDBManager & {
  searchMessagesSemantically?: (input: {
    userId: string;
    queryEmbedding: number[];
    limit?: number;
    scanLimit?: number;
    threshold?: number;
    includeArchived?: boolean;
    includeDeprecated?: boolean;
    platform?: string;
    botId?: string;
    channel?: string;
    person?: string;
    startTime?: number;
    endTime?: number;
  }) => Promise<NativeRawSemanticSearchResult[]>;
};

function hasMoreByLength<T>(items: T[], pageSize: number): MemoryPageResult<T> {
  // We intentionally fetch `pageSize + 1` upstream so we can compute hasMore cheaply.
  const hasMore = items.length > pageSize;
  return {
    items: hasMore ? items.slice(0, pageSize) : items,
    hasMore,
    nextOffset: hasMore ? pageSize : undefined,
  };
}

export function createIndexedDBMemoryStorageAdapter(
  manager: IndexedDBManager,
): MemoryStorageAdapter {
  return {
    async acquireLock(input) {
      // Process-local lock for re-entrancy control.
      // For multi-tab/global locks we can move this to durable storage later.
      const existing = LOCAL_LOCKS.get(input.key);
      if (existing && existing.expiresAt > input.now) {
        return null;
      }
      const token = `${input.key}:${input.now}:${Math.random().toString(36).slice(2)}`;
      const expiresAt = input.now + input.ttlMs;
      LOCAL_LOCKS.set(input.key, { token, expiresAt });
      const handle: MemoryLockHandle = {
        key: input.key,
        token,
        acquiredAt: input.now,
        expiresAt,
      };
      return handle;
    },
    async releaseLock(handle) {
      // Guard against stale releases from previous lock owners.
      const existing = LOCAL_LOCKS.get(handle.key);
      if (!existing) {
        return;
      }
      if (existing.token !== handle.token) {
        return;
      }
      LOCAL_LOCKS.delete(handle.key);
    },

    async listCandidates(input) {
      const batchSize = Math.max(input.limit, 50);
      const candidates: MemoryRecord[] = [];
      let offset = 0;

      // Query in pages and filter by cutoff in-memory; this keeps manager API small.
      // We keep scanning until:
      // 1) collected enough candidates, or
      // 2) source data is exhausted.
      while (candidates.length < input.limit) {
        const messages = await manager.queryMessages({
          userId: input.userId,
          memoryStages: [input.tier],
          includeArchived: false,
          reverse: false,
          offset,
          pageSize: batchSize,
          // Force use of userId+timestamp index for stable chronological scans.
          startTime: Number.MIN_SAFE_INTEGER,
        });

        if (messages.length === 0) {
          break;
        }

        for (const message of messages) {
          const record = toMemoryRecord(message);
          if (record.timestamp <= input.olderThan) {
            candidates.push(record);
            if (candidates.length >= input.limit) {
              break;
            }
          }
        }

        if (messages.length < batchSize) {
          break;
        }

        offset += messages.length;
      }

      return candidates.slice(0, input.limit);
    },

    async saveSummaries(summaries) {
      // Upsert keeps cycles idempotent when a run retries after partial progress.
      await manager.upsertSummaries(summaries.map(toSummaryRecord));
    },

    async transitionRecords(input) {
      // Persist stage transition and reference the generated summary for traceability.
      await manager.promoteMessagesToStage(input.ids, input.toTier, {
        userId: input.userId,
        summaryRefId: input.summaryId,
        promotedAt: input.transitionedAt,
      });
    },

    async archiveRecordDetails(input) {
      // Archive marks detail payload as cold; hard-delete may run later by policy.
      await manager.archiveMessages(input.ids, input.archivedAt, input.userId);
    },

    async queryRaw(query: MemorySearchQuery) {
      const pageSize = getPageSize(query);
      // Memory API uses ms timestamps; raw manager query uses seconds.
      // `pageSize + 1` lets us infer hasMore without total-count queries.
      const raw = await manager.queryMessages({
        userId: query.userId,
        keywords: query.keywords,
        startTime:
          query.startTime === undefined
            ? undefined
            : normalizeTimestampFromMs(query.startTime),
        endTime:
          query.endTime === undefined
            ? undefined
            : normalizeTimestampFromMs(query.endTime),
        offset: query.offset,
        pageSize: pageSize + 1,
        reverse: query.reverse ?? true,
        includeArchived: false,
        includeDeprecated: query.includeDeprecated,
        memoryStages: query.tiers as MemoryStage[] | undefined,
        platform:
          typeof query.dimensions?.platform === "string"
            ? String(query.dimensions.platform)
            : undefined,
        channel:
          typeof query.dimensions?.channel === "string"
            ? String(query.dimensions.channel)
            : undefined,
        person:
          typeof query.dimensions?.person === "string"
            ? String(query.dimensions.person)
            : undefined,
        botId:
          typeof query.dimensions?.botId === "string"
            ? String(query.dimensions.botId)
            : undefined,
      });
      return hasMoreByLength(raw.map(toMemoryRecord), pageSize);
    },

    async semanticRecallRaw(query: MemorySemanticRecallQuery) {
      if (query.queryEmbedding.length === 0) {
        return [];
      }

      const limit = clampSemanticLimit(query.limit);
      const threshold = clampSemanticThreshold(query.threshold);
      const platform =
        typeof query.dimensions?.platform === "string"
          ? String(query.dimensions.platform)
          : undefined;
      const channel =
        typeof query.dimensions?.channel === "string"
          ? String(query.dimensions.channel)
          : undefined;
      const person =
        typeof query.dimensions?.person === "string"
          ? String(query.dimensions.person)
          : undefined;
      const botId =
        typeof query.dimensions?.botId === "string"
          ? String(query.dimensions.botId)
          : undefined;

      const nativeManager = manager as NativeSemanticSearchManager;
      if (typeof nativeManager.searchMessagesSemantically === "function") {
        const nativeResults = await nativeManager.searchMessagesSemantically({
          userId: query.userId,
          queryEmbedding: query.queryEmbedding,
          // Over-fetch because the shared memory contract supports tier and
          // arbitrary dimension filters that some raw backends do not push down.
          limit: Math.max(limit * 5, limit),
          threshold,
          includeArchived: false,
          includeDeprecated: query.includeDeprecated,
          platform,
          botId,
          channel,
          person,
          startTime:
            query.startTime === undefined
              ? undefined
              : normalizeTimestampFromMs(query.startTime),
          endTime:
            query.endTime === undefined
              ? undefined
              : normalizeTimestampFromMs(query.endTime),
        });

        return nativeResults
          .map(
            (result): MemorySemanticRecallHit => ({
              record: toMemoryRecord(result.message),
              similarity: result.similarity,
            }),
          )
          .filter((hit) => {
            if (
              !query.includeDeprecated &&
              hit.record.deprecatedAt !== undefined
            ) {
              return false;
            }
            if (query.tiers && !query.tiers.includes(hit.record.tier)) {
              return false;
            }
            return (
              timeMatches(hit.record, query) &&
              dimensionMatches(hit.record, query.dimensions)
            );
          })
          .slice(0, limit);
      }

      const scanLimit = Math.max(limit * 10, limit);
      const raw = await manager.queryMessages({
        userId: query.userId,
        includeArchived: false,
        includeDeprecated: query.includeDeprecated,
        pageSize: scanLimit,
        reverse: true,
        memoryStages: query.tiers as MemoryStage[] | undefined,
        platform,
        botId,
        channel,
        person,
        startTime:
          query.startTime === undefined
            ? undefined
            : normalizeTimestampFromMs(query.startTime),
        endTime:
          query.endTime === undefined
            ? undefined
            : normalizeTimestampFromMs(query.endTime),
      });

      return raw
        .map((message): MemorySemanticRecallHit | null => {
          if (!message.embedding || message.embedding.length === 0) {
            return null;
          }
          const similarity = cosineSimilarity(
            query.queryEmbedding,
            message.embedding,
          );
          if (!Number.isFinite(similarity) || similarity < threshold) {
            return null;
          }
          return {
            record: toMemoryRecord(message),
            similarity,
          };
        })
        .filter((hit): hit is MemorySemanticRecallHit => hit !== null)
        .filter((hit) => dimensionMatches(hit.record, query.dimensions))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },

    async querySummaries(query: MemorySummarySearchQuery) {
      const pageSize = getPageSize(query);
      // Same `+1` strategy as raw query for consistent pagination semantics.
      const summaries = await manager.querySummaries({
        userId: query.userId,
        keywords: query.keywords,
        startTime: query.startTime,
        endTime: query.endTime,
        offset: query.offset,
        pageSize: pageSize + 1,
        reverse: query.reverse ?? true,
        summaryTiers: query.summaryTiers,
        dimensions: query.dimensions,
      });
      return hasMoreByLength(summaries.map(toMemorySummary), pageSize);
    },

    async markRecordsAccessed(input) {
      // Access tracking feeds scorer recency/value decisions in future cycles.
      await manager.markMessagesAccessed(input.ids, input.at, input.userId);
    },
  };
}

export interface RunMemoryForgettingCycleShadowDiagnosticsOptions {
  enabled?: boolean;
  dryRun?: boolean;
  limit?: number;
  candidateTier?: MemoryTier;
  olderThan?: number;
  relationKeys?: MemoryConsolidationRuntimeRelationKeys;
  semanticDraftCandidates?: RunMemoryConsolidationShadowDiagnosticsInput<MemoryRecord>["semanticDraftCandidates"];
  summarizerProvider?: RunMemoryConsolidationShadowDiagnosticsInput<MemoryRecord>["summarizerProvider"];
  summarizerContext?: RunMemoryConsolidationShadowDiagnosticsInput<MemoryRecord>["summarizerContext"];
  minConfidence?: number;
  metadata?: Record<string, unknown>;
  logReport?: RunMemoryConsolidationShadowDiagnosticsInput<MemoryRecord>["logReport"];
}

export type RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions = Pick<
  RunMemoryForgettingCycleShadowDiagnosticsOptions,
  | "enabled"
  | "dryRun"
  | "limit"
  | "candidateTier"
  | "olderThan"
  | "relationKeys"
  | "minConfidence"
  | "metadata"
>;

export interface RunMemoryForgettingCycleOptions {
  now?: number;
  dryRun?: boolean;
  policy?: MemoryForgettingPolicyOverrides;
  hardDeleteArchivedOlderThan?: number;
  shadowDiagnostics?: RunMemoryForgettingCycleShadowDiagnosticsOptions;
}

export interface RunMemoryForgettingCycleResult {
  status: "success" | "skipped_locked";
  dryRun: boolean;
  userId: string;
  startedAt: number;
  finishedAt: number;
  scannedRecords: number;
  eligibleRecords: number;
  createdSummaries: number;
  transitionedRecords: number;
  archivedDetailRecords: number;
  hardDeletedRecords: number;
  shadowDiagnostics?: MemoryConsolidationShadowDiagnosticsRunResult;
}

export async function runMemoryForgettingCycle(
  manager: IndexedDBManager,
  userId: string,
  options?: RunMemoryForgettingCycleOptions,
): Promise<RunMemoryForgettingCycleResult> {
  // Build engine with IndexedDB-backed adapter; policy can be overridden by caller.
  const storage = createIndexedDBMemoryStorageAdapter(manager);
  const engine = createMemoryForgettingEngine({
    storage,
    policy: options?.policy,
  });
  const now =
    options?.shadowDiagnostics === undefined
      ? options?.now
      : (options.now ?? Date.now());
  let shadowDiagnostics:
    | MemoryConsolidationShadowDiagnosticsRunResult
    | undefined;

  if (options?.shadowDiagnostics) {
    const { buildMemoryConsolidationRuntimeRecordSelectors } =
      await import("../../ai/memory-consolidation/src/runtime");
    const { runMemoryConsolidationShadowDiagnostics } =
      await import("../../ai/memory-consolidation/src/shadow");
    const shadowOptions = options.shadowDiagnostics;
    shadowDiagnostics = await runMemoryConsolidationShadowDiagnostics({
      enabled: shadowOptions.enabled,
      dryRun: shadowOptions.dryRun ?? true,
      now,
      limit: shadowOptions.limit,
      defaultUserId: userId,
      defaultTier: shadowOptions.candidateTier ?? "short",
      selectors: buildMemoryConsolidationRuntimeRecordSelectors({
        relationKeys: shadowOptions.relationKeys,
      }),
      semanticDraftCandidates: shadowOptions.semanticDraftCandidates,
      summarizerProvider: shadowOptions.summarizerProvider,
      summarizerContext: shadowOptions.summarizerContext,
      minConfidence: shadowOptions.minConfidence,
      metadata: {
        ...(shadowOptions.metadata ?? {}),
        integration: "forgetting-cycle",
      },
      loadRecords: ({ now: shadowNow, limit }) =>
        storage.listCandidates({
          userId,
          tier: shadowOptions.candidateTier ?? "short",
          olderThan: shadowOptions.olderThan ?? shadowNow,
          limit: limit ?? 500,
        }),
      logReport: shadowOptions.logReport,
    });
  }

  const result = await engine.runCycle({
    userId,
    now,
    dryRun: options?.dryRun,
  });

  let hardDeletedRecords = 0;
  // Optional hard-delete phase after normal transition/archive processing.
  // This is intentionally separate so teams can run:
  // - transition/archive daily
  // - irreversible hard-delete on a slower cadence
  if (!options?.dryRun && options?.hardDeleteArchivedOlderThan !== undefined) {
    hardDeletedRecords = await manager.hardDeleteArchived(
      options.hardDeleteArchivedOlderThan,
      userId,
    );
  }

  return {
    ...result,
    hardDeletedRecords,
    shadowDiagnostics,
  };
}

export async function queryMemoryWithFallback(
  manager: IndexedDBManager,
  query: MemorySearchQuery & {
    minRawResultsWithoutFallback?: number;
  },
  options?: {
    graphRetrieval?: MemoryQueryGraphRetrievalOptions;
  },
): Promise<MemorySearchWithFallbackResult> {
  // Unified read path: prefer raw hits; when insufficient, append summary hits.
  const storage = createIndexedDBMemoryStorageAdapter(manager);
  const api = createMemoryQueryApi({
    storage,
    graphRetrieval: options?.graphRetrieval,
  });
  return api.queryWithFallback(query);
}
