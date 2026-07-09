import type {
  MemorySearchHit,
  MemorySearchWithFallbackResult,
  MemorySemanticRecallQuery,
  MemorySemanticRecallResult,
  MemoryStorageAdapter,
} from "./contracts";
import {
  type MemoryQueryGraphRetrievalOptions,
  type MemoryQueryGraphRetrievalQuery,
  applyGraphAwareRetrieval,
} from "./graph-aware-query";
export type {
  MemoryQueryGraphRetrievalQuery,
  MemoryQueryGraphRetrievalOptions,
  MemoryQueryGraphRetrievalSnapshotInput,
} from "./graph-aware-query";

export type QueryWithFallbackInput = MemoryQueryGraphRetrievalQuery;

export interface CreateMemoryQueryApiInput {
  storage: MemoryStorageAdapter;
  defaultPageSize?: number;
  markRawAccessOnRead?: boolean;
  graphRetrieval?: MemoryQueryGraphRetrievalOptions;
}

export interface MemoryQueryApi {
  queryWithFallback(
    input: QueryWithFallbackInput,
  ): Promise<MemorySearchWithFallbackResult>;
  semanticRecall(
    input: MemorySemanticRecallQuery,
  ): Promise<MemorySemanticRecallResult>;
}

function resolvePageSize(
  input: QueryWithFallbackInput,
  defaultPageSize: number,
) {
  return input.pageSize ?? input.limit ?? defaultPageSize;
}

export function createMemoryQueryApi(
  input: CreateMemoryQueryApiInput,
): MemoryQueryApi {
  const defaultPageSize = input.defaultPageSize ?? 50;
  const markRawAccessOnRead = input.markRawAccessOnRead ?? true;

  return {
    async semanticRecall(recallInput: MemorySemanticRecallQuery) {
      if (
        recallInput.queryEmbedding.length === 0 ||
        !input.storage.semanticRecallRaw
      ) {
        return {
          items: [],
          rawCount: 0,
        };
      }

      const limit = Math.max(
        1,
        Math.floor(recallInput.limit ?? defaultPageSize),
      );
      const hits = await input.storage.semanticRecallRaw({
        ...recallInput,
        limit,
      });
      const items = hits.slice(0, limit).map((hit) => ({
        ...hit,
        sourceType: "raw" as const,
        timestamp: hit.record.timestamp,
      }));

      if (markRawAccessOnRead && input.storage.markRecordsAccessed) {
        const rawIds = items.map((hit) => hit.record.id);
        if (rawIds.length > 0) {
          await input.storage.markRecordsAccessed({
            userId: recallInput.userId,
            ids: rawIds,
            at: Date.now(),
          });
        }
      }

      return {
        items,
        rawCount: items.length,
      };
    },

    async queryWithFallback(queryInput: QueryWithFallbackInput) {
      const pageSize = resolvePageSize(queryInput, defaultPageSize);
      const minRawResults = queryInput.minRawResultsWithoutFallback ?? pageSize;

      const rawResult = await input.storage.queryRaw({
        ...queryInput,
        pageSize,
      });

      const rawHits: MemorySearchHit[] = rawResult.items.map((record) => ({
        sourceType: "raw",
        timestamp: record.timestamp,
        record,
      }));

      let summaryHits: MemorySearchHit[] = [];
      let summaryHasMore = false;

      if (rawHits.length < minRawResults) {
        const remaining = Math.max(1, pageSize - rawHits.length);
        const summaryResult = await input.storage.querySummaries({
          userId: queryInput.userId,
          keywords: queryInput.keywords,
          startTime: queryInput.startTime,
          endTime: queryInput.endTime,
          reverse: queryInput.reverse,
          pageSize: remaining,
          offset: queryInput.offset,
          dimensions: queryInput.dimensions,
        });

        summaryHits = summaryResult.items.map((summary) => ({
          sourceType: "summary",
          timestamp: summary.endTimestamp,
          summary,
        }));
        summaryHasMore = summaryResult.hasMore;
      }

      const merged = [...rawHits, ...summaryHits].sort(
        (a, b) => b.timestamp - a.timestamp,
      );
      const graphApplication = await applyGraphAwareRetrieval({
        options: input.graphRetrieval,
        query: queryInput,
        baselineHits: merged,
        pageSize,
      });
      const items = graphApplication?.items ?? merged.slice(0, pageSize);

      if (markRawAccessOnRead && input.storage.markRecordsAccessed) {
        const rawIds = items
          .filter((hit) => hit.sourceType === "raw")
          .map((hit) => hit.record.id);
        if (rawIds.length > 0) {
          await input.storage.markRecordsAccessed({
            userId: queryInput.userId,
            ids: rawIds,
            at: Date.now(),
          });
        }
      }

      return {
        items,
        rawCount: rawHits.length,
        summaryCount: summaryHits.length,
        hasMore:
          rawResult.hasMore || summaryHasMore || merged.length > pageSize,
        ...(graphApplication
          ? { graphRetrieval: graphApplication.diagnostic }
          : {}),
      };
    },
  };
}
