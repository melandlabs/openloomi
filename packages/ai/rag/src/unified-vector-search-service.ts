import {
  getConfiguredEmbeddingProvider,
  type EmbeddingProvider,
} from "./embedding-provider";
import {
  ChromaVectorStore,
  type ChromaVectorStoreOptions,
} from "./chroma-store";
import { getSQLiteVecStore, type SchemaModule } from "./sqlite-vec-store";
import type {
  DocumentChunk,
  IVectorStore,
  VectorSearchFilter,
  VectorSearchResult,
} from "./vector-service";

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SEARCH_THRESHOLD = 0;
const FALLBACK_OVERFETCH_MULTIPLIER = 5;

export type VectorStoreConfig =
  | ({
      type: "chroma";
    } & ChromaVectorStoreOptions)
  | {
      type: "sqlite-vec";
      dbPath: string;
      schemaModule?: SchemaModule;
      collectionName?: string;
    }
  | {
      type: "custom";
      store: IVectorStore;
    };

export interface RawMessageWithEmbedding {
  id: string;
  content: string;
  embedding?: number[];
  documentId?: string;
  userId?: string;
  platform?: string;
  channel?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchOptions {
  query: string;
  k?: number;
  threshold?: number;
  filter?: VectorSearchFilter;
  includeEmbeddings?: boolean;
}

export type VectorSearchByVectorOptions = Omit<VectorSearchOptions, "query">;

export interface UnifiedVectorSearchResult {
  id: string;
  content: string;
  score: number;
  documentId: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface UnifiedVectorSearchStats {
  count: number;
  dimensions: number;
  backend: VectorStoreConfig["type"];
  embeddingModel: string;
}

export interface UnifiedVectorSearchServiceOptions {
  embeddingProvider?: EmbeddingProvider;
}

/**
 * Coordinates embedding generation and vector storage behind one backend-
 * independent API. Call initialize() once before using the service.
 */
export class UnifiedVectorSearchService {
  private store?: IVectorStore;
  private backend?: VectorStoreConfig["type"];
  private embeddingProvider: EmbeddingProvider;

  constructor(options: UnifiedVectorSearchServiceOptions = {}) {
    this.embeddingProvider =
      options.embeddingProvider ?? getConfiguredEmbeddingProvider();
  }

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.store = await createVectorStore(config);
    this.backend = config.type;
  }

  async upsertMessages(messages: RawMessageWithEmbedding[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const store = this.getInitializedStore();
    // Embed only records that do not already carry a vector. This lets callers
    // migrate or replay pre-embedded data without paying the embedding cost again.
    const missingEmbeddingIndexes = messages
      .map((message, index) =>
        message.embedding && message.embedding.length > 0 ? -1 : index,
      )
      .filter((index) => index >= 0);

    const generatedEmbeddings =
      missingEmbeddingIndexes.length > 0
        ? await this.embeddingProvider.embedDocuments(
            missingEmbeddingIndexes.map((index) => messages[index].content),
          )
        : [];
    // Index generated vectors by their original message position because the
    // input may mix pre-computed and missing embeddings.
    const generatedByIndex = new Map<number, number[]>(
      missingEmbeddingIndexes.map((messageIndex, embeddingIndex) => [
        messageIndex,
        generatedEmbeddings[embeddingIndex],
      ]),
    );

    const chunks: DocumentChunk[] = messages.map((message, index) => {
      const embedding = message.embedding ?? generatedByIndex.get(index);
      if (!embedding || embedding.length === 0) {
        throw new Error(
          `No embedding generated for vector record ${message.id}`,
        );
      }
      const embeddingWasGenerated = generatedByIndex.has(index);

      return {
        id: message.id,
        documentId: message.documentId ?? message.id,
        content: message.content,
        embedding,
        metadata: {
          ...message.metadata,
          userId: message.userId ?? message.metadata?.userId,
          platform: message.platform ?? message.metadata?.platform,
          channel: message.channel ?? message.metadata?.channel,
          timestamp: message.timestamp ?? message.metadata?.timestamp,
          embeddingModel:
            message.metadata?.embeddingModel ??
            (embeddingWasGenerated
              ? this.embeddingProvider.getModelName()
              : undefined),
          embeddingDimensions: embedding.length,
        },
      };
    });

    await store.addChunks(chunks);
  }

  async searchByText(
    options: VectorSearchOptions,
  ): Promise<UnifiedVectorSearchResult[]> {
    const query = options.query.trim();
    if (!query) {
      return [];
    }

    const queryEmbedding = await this.embeddingProvider.embedQuery(query);
    return this.searchByVector(queryEmbedding, options);
  }

  async searchByVector(
    embedding: number[],
    options: VectorSearchByVectorOptions = {},
  ): Promise<UnifiedVectorSearchResult[]> {
    if (embedding.length === 0) {
      return [];
    }

    const store = this.getInitializedStore();
    const limit = normalizeLimit(options.k);
    const threshold = normalizeThreshold(options.threshold);
    const storeOptions = {
      limit,
      filter: options.filter,
      includeEmbeddings: options.includeEmbeddings,
    };

    // Newer stores can push metadata filters down to their native query API.
    // Older IVectorStore implementations still work through over-fetching and
    // the backend-independent filter pass below.
    const results = store.similaritySearchWithOptions
      ? await store.similaritySearchWithOptions(embedding, storeOptions)
      : await store.similaritySearch(
          embedding,
          Math.max(limit * FALLBACK_OVERFETCH_MULTIPLIER, limit),
          options.filter?.userId,
        );

    // Always apply the common filter contract, even when the backend performed
    // native filtering, so custom stores cannot accidentally leak other users'
    // or channels' records through an incomplete implementation.
    return results
      .filter((result) => result.score >= threshold)
      .filter((result) => matchesFilter(result, options.filter))
      .slice(0, limit)
      .map(toUnifiedResult);
  }

  async deleteOlderThan(
    timestamp: number,
    timestampField = "timestamp",
  ): Promise<number> {
    if (!Number.isFinite(timestamp)) {
      throw new Error("deleteOlderThan requires a finite timestamp");
    }

    const store = this.getInitializedStore();
    if (!store.deleteOlderThan) {
      throw new Error(
        `Vector backend ${this.backend ?? "unknown"} does not support deleteOlderThan`,
      );
    }

    return store.deleteOlderThan(timestamp, timestampField);
  }

  async getStats(): Promise<UnifiedVectorSearchStats> {
    const store = this.getInitializedStore();
    // Backends that cannot inspect their stored vectors fall back to the
    // provider's last known dimensions and the existing chunk-count API.
    const stats = store.getStats
      ? await store.getStats()
      : {
          count: await store.getChunkCount(),
          dimensions: this.embeddingProvider.getDimensions() ?? 0,
        };

    return {
      ...stats,
      backend: this.backend ?? "custom",
      embeddingModel: this.embeddingProvider.getModelName(),
    };
  }

  private getInitializedStore(): IVectorStore {
    if (!this.store) {
      throw new Error(
        "UnifiedVectorSearchService is not initialized. Call initialize() first.",
      );
    }
    return this.store;
  }
}

/**
 * Build a vector store from a serializable backend choice, or accept a custom
 * implementation for tests and future backends such as Qdrant or Weaviate.
 */
export async function createVectorStore(
  config: VectorStoreConfig,
): Promise<IVectorStore> {
  switch (config.type) {
    case "chroma": {
      const { type: _type, ...options } = config;
      return new ChromaVectorStore(options);
    }
    case "sqlite-vec":
      return getSQLiteVecStore(config.dbPath, config.schemaModule, {
        collectionName: config.collectionName,
      });
    case "custom":
      return config.store;
  }
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.max(1, Math.floor(value as number));
}

function normalizeThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SEARCH_THRESHOLD;
  }
  return Math.min(1, Math.max(-1, value as number));
}

function matchesFilter(
  result: VectorSearchResult,
  filter?: VectorSearchFilter,
): boolean {
  if (!filter) {
    return true;
  }

  const metadata = result.metadata ?? {};
  if (filter.userId && metadata.userId !== filter.userId) {
    return false;
  }
  if (filter.platform && metadata.platform !== filter.platform) {
    return false;
  }
  if (filter.channel && metadata.channel !== filter.channel) {
    return false;
  }

  const timestamp = normalizeMetadataTimestamp(metadata.timestamp);
  if (filter.startTime !== undefined || filter.endTime !== undefined) {
    // A record without a usable timestamp cannot safely satisfy a time range.
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    if (filter.startTime !== undefined && timestamp < filter.startTime) {
      return false;
    }
    if (filter.endTime !== undefined && timestamp > filter.endTime) {
      return false;
    }
  }

  return true;
}

function normalizeMetadataTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function toUnifiedResult(
  result: VectorSearchResult,
): UnifiedVectorSearchResult {
  return {
    id: result.id,
    content: result.content,
    score: result.score,
    documentId: result.documentId,
    metadata: result.metadata ?? {},
    embedding: result.embedding,
  };
}
