import { searchSimilarChunks } from "@/lib/ai/rag/langchain-service";
import { searchInsightsSemantically } from "@/lib/insights/search";
import {
  getRawMessageManager,
  isRawMessageStorageAvailable,
} from "@/lib/memory/raw-message-store";
import {
  isRawMessageChromaEnabled,
  searchRawMessagesWithChroma,
} from "@/lib/memory/chroma-memory-index";
import { getEmbeddingProviderType } from "@openloomi/rag";

export type UnifiedMemorySearchSource = "memory" | "insights" | "knowledge";

export interface UnifiedMemorySearchResult {
  type: "memory" | "insight" | "knowledge";
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface UnifiedMemorySearchWarning {
  source: UnifiedMemorySearchSource;
  code: string;
  message: string;
}

export interface UnifiedMemorySearchInput {
  userId: string;
  query: string;
  sources?: UnifiedMemorySearchSource[];
  limit?: number;
  threshold?: number;
  authToken?: string;
  includeArchivedInsights?: boolean;
  botIds?: string[];
  documentIds?: string[];
}

export interface UnifiedMemorySearchOutput {
  query: string;
  sources: UnifiedMemorySearchSource[];
  results: UnifiedMemorySearchResult[];
  count: number;
  warnings: UnifiedMemorySearchWarning[];
}

const DEFAULT_LIMIT = 10;
const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_SOURCES: UnifiedMemorySearchSource[] = [
  "memory",
  "insights",
  "knowledge",
];
const SOURCE_SET = new Set<UnifiedMemorySearchSource>(DEFAULT_SOURCES);

export function normalizeUnifiedMemorySearchSources(
  sources: unknown,
): UnifiedMemorySearchSource[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [...DEFAULT_SOURCES];
  }

  const normalized = sources
    .filter((source): source is string => typeof source === "string")
    .map((source) => source.trim().toLowerCase())
    .filter((source): source is UnifiedMemorySearchSource =>
      SOURCE_SET.has(source as UnifiedMemorySearchSource),
    );

  return normalized.length > 0
    ? Array.from(new Set(normalized))
    : [...DEFAULT_SOURCES];
}

export function clampUnifiedMemorySearchLimit(limit: unknown): number {
  const parsed =
    typeof limit === "number" ? limit : Number(limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

export function clampUnifiedMemorySearchThreshold(threshold: unknown): number {
  const parsed =
    typeof threshold === "number"
      ? threshold
      : Number(threshold ?? DEFAULT_THRESHOLD);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_THRESHOLD;
  }
  return Math.min(1, Math.max(-1, parsed));
}

export function mergeUnifiedMemorySearchResults(
  results: UnifiedMemorySearchResult[],
  limit: number,
): UnifiedMemorySearchResult[] {
  return [...results]
    .sort((a, b) => {
      const scoreDelta = b.similarity - a.similarity;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

function toKnowledgeResult(result: {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  chunkIndex: number;
}): UnifiedMemorySearchResult {
  return {
    type: "knowledge",
    id: result.chunkId,
    content: result.content,
    similarity: result.similarity,
    metadata: {
      documentId: result.documentId,
      documentName: result.documentName,
      chunkIndex: result.chunkIndex,
    },
  };
}

function hasEmbeddingProviderConfig(authToken?: string): boolean {
  if (getEmbeddingProviderType() === "local") {
    return true;
  }
  return Boolean(
    authToken ||
    process.env.OPENAI_EMBEDDINGS_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY,
  );
}

async function embedQuery(
  query: string,
  authToken?: string,
): Promise<number[]> {
  if (!hasEmbeddingProviderConfig(authToken)) {
    throw new Error("Embedding provider API key is not configured");
  }

  const { UniversalEmbeddings } =
    await import("@openloomi/rag/universal-embeddings");
  const embeddings = new UniversalEmbeddings(authToken);
  return embeddings.embedQuery(query);
}

function toMemoryResult(result: {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}): UnifiedMemorySearchResult {
  return {
    type: "memory",
    id: result.id,
    content: result.content,
    similarity: result.similarity,
    metadata: result.metadata,
  };
}

function isRawMemorySemanticResult(result: unknown): result is {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
} {
  if (!result || typeof result !== "object") {
    return false;
  }
  const item = result as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.content === "string" &&
    typeof item.similarity === "number" &&
    Boolean(item.metadata) &&
    typeof item.metadata === "object"
  );
}

async function searchRawMemorySemantically(input: {
  userId: string;
  query: string;
  authToken?: string;
  botIds?: string[];
  limit: number;
  threshold: number;
}): Promise<UnifiedMemorySearchResult[]> {
  const manager = await getRawMessageManager();
  const filters =
    input.botIds && input.botIds.length > 0
      ? input.botIds.map((botId) => ({ botId }))
      : [{}];

  let semanticResults: UnifiedMemorySearchResult[] = [];
  let semanticBackendHandled = false;
  if (hasEmbeddingProviderConfig(input.authToken)) {
    const queryEmbedding = await embedQuery(input.query, input.authToken);
    if (queryEmbedding.length > 0) {
      if (isRawMessageChromaEnabled()) {
        try {
          semanticResults = (
            await Promise.all(
              filters.map((filter) => {
                const botId = "botId" in filter ? filter.botId : undefined;
                return searchRawMessagesWithChroma({
                  userId: input.userId,
                  queryEmbedding,
                  limit: input.limit,
                  threshold: input.threshold,
                  botId,
                });
              }),
            )
          )
            .flat()
            .map(toMemoryResult);
          semanticBackendHandled = true;
          console.log("[UnifiedMemory] Raw message semantic search completed", {
            backend: "chroma",
            dimensions: queryEmbedding.length,
            count: semanticResults.length,
          });
        } catch (error) {
          console.warn(
            "[UnifiedMemory] Chroma raw message search failed; falling back to database search:",
            error,
          );
        }
      }

      if (
        !semanticBackendHandled &&
        typeof manager.searchMessagesSemantically === "function"
      ) {
        semanticResults = (
          await Promise.all(
            filters.map((filter) =>
              manager.searchMessagesSemantically?.({
                userId: input.userId,
                queryEmbedding,
                limit: input.limit,
                threshold: input.threshold,
                ...filter,
              }),
            ),
          )
        )
          .flat()
          .filter(isRawMemorySemanticResult)
          .map(toMemoryResult);
      }
    }
  }

  return mergeUnifiedMemorySearchResults(semanticResults, input.limit);
}

export async function searchUnifiedMemory(
  input: UnifiedMemorySearchInput,
): Promise<UnifiedMemorySearchOutput> {
  const query = input.query.trim();
  const sources = normalizeUnifiedMemorySearchSources(input.sources);
  const limit = clampUnifiedMemorySearchLimit(input.limit);
  const threshold = clampUnifiedMemorySearchThreshold(input.threshold);
  const warnings: UnifiedMemorySearchWarning[] = [];
  const results: UnifiedMemorySearchResult[] = [];

  if (!query) {
    return {
      query,
      sources,
      results: [],
      count: 0,
      warnings,
    };
  }

  if (sources.includes("memory")) {
    if (isRawMessageStorageAvailable()) {
      const memoryResults = await searchRawMemorySemantically({
        userId: input.userId,
        query,
        authToken: input.authToken,
        botIds: input.botIds,
        limit,
        threshold,
      });
      results.push(...memoryResults);
    } else {
      warnings.push({
        source: "memory",
        code: "raw_message_storage_unavailable",
        message: "Raw memory storage is not available in this environment.",
      });
    }
  }

  if (sources.includes("insights")) {
    const insightResults = await searchInsightsSemantically({
      userId: input.userId,
      query,
      limit,
      threshold,
      botIds: input.botIds,
      includeArchived: input.includeArchivedInsights,
      authToken: input.authToken,
    });
    results.push(...insightResults);
  }

  if (sources.includes("knowledge")) {
    const knowledgeResults = await searchSimilarChunks(
      input.userId,
      query,
      {
        limit,
        threshold,
        documentIds: input.documentIds,
      },
      input.authToken,
    );
    results.push(...knowledgeResults.map(toKnowledgeResult));
  }

  const merged = mergeUnifiedMemorySearchResults(results, limit);
  return {
    query,
    sources,
    results: merged,
    count: merged.length,
    warnings,
  };
}
