import { searchSimilarChunks } from "@/lib/ai/rag/langchain-service";
import { searchInsightsSemantically } from "@/lib/insights/search";

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
    warnings.push({
      source: "memory",
      code: "client_indexeddb_required",
      message:
        "Raw memory records are stored in client-side IndexedDB and cannot be searched from this server API.",
    });
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
