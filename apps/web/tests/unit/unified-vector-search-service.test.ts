import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../../../packages/ai/rag/src/embedding-provider";
import {
  type UnifiedVectorSearchResult,
  UnifiedVectorSearchService,
} from "../../../../packages/ai/rag/src/unified-vector-search-service";
import type {
  DocumentChunk,
  IVectorStore,
  VectorSearchResult,
  VectorStoreSearchOptions,
} from "../../../../packages/ai/rag/src/vector-service";

class TestVectorStore implements IVectorStore {
  chunks: DocumentChunk[] = [];
  results: VectorSearchResult[] = [];
  lastSearchOptions?: VectorStoreSearchOptions;
  deletedBefore?: number;

  async addChunk(chunk: DocumentChunk): Promise<void> {
    this.chunks.push(chunk);
  }

  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    this.chunks.push(...chunks);
  }

  async similaritySearch(): Promise<VectorSearchResult[]> {
    return this.results;
  }

  async similaritySearchWithOptions(
    _queryEmbedding: number[],
    options: VectorStoreSearchOptions,
  ): Promise<VectorSearchResult[]> {
    this.lastSearchOptions = options;
    return this.results;
  }

  async deleteDocument(): Promise<void> {}

  async getDocumentCount(): Promise<number> {
    return new Set(this.chunks.map((chunk) => chunk.documentId)).size;
  }

  async getChunkCount(): Promise<number> {
    return this.chunks.length;
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }

  async deleteOlderThan(timestamp: number): Promise<number> {
    this.deletedBefore = timestamp;
    return 2;
  }

  async getStats(): Promise<{ count: number; dimensions: number }> {
    return {
      count: this.chunks.length,
      dimensions: this.chunks[0]?.embedding.length ?? 0,
    };
  }
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    embedDocuments: vi.fn(async (texts: string[]) =>
      texts.map((text) => [text.length, 1, 0]),
    ),
    embedQuery: vi.fn(async () => [1, 0, 0]),
    getModelName: () => "test/local-model",
    getDimensions: () => 3,
  };
}

describe("UnifiedVectorSearchService", () => {
  it("embeds only missing vectors and preserves common metadata", async () => {
    const store = new TestVectorStore();
    const embeddingProvider = createEmbeddingProvider();
    const service = new UnifiedVectorSearchService({ embeddingProvider });
    await service.initialize({ type: "custom", store });

    await service.upsertMessages([
      {
        id: "generated",
        content: "generate me",
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        timestamp: 100,
      },
      {
        id: "provided",
        content: "already embedded",
        embedding: [0, 1, 0],
        metadata: { userId: "user-2", embeddingModel: "imported-model" },
      },
    ]);

    expect(embeddingProvider.embedDocuments).toHaveBeenCalledWith([
      "generate me",
    ]);
    expect(store.chunks).toHaveLength(2);
    expect(store.chunks[0]).toMatchObject({
      id: "generated",
      embedding: [11, 1, 0],
      metadata: {
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        timestamp: 100,
        embeddingModel: "test/local-model",
        embeddingDimensions: 3,
      },
    });
    expect(store.chunks[1]).toMatchObject({
      id: "provided",
      embedding: [0, 1, 0],
      metadata: {
        userId: "user-2",
        embeddingModel: "imported-model",
        embeddingDimensions: 3,
      },
    });
  });

  it("applies the shared filter contract, threshold, retention, and stats", async () => {
    const store = new TestVectorStore();
    const service = new UnifiedVectorSearchService({
      embeddingProvider: createEmbeddingProvider(),
    });
    await service.initialize({ type: "custom", store });

    store.results = [
      result("match", 0.9, {
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        timestamp: 150,
      }),
      result("wrong-channel", 0.95, {
        userId: "user-1",
        platform: "feishu",
        channel: "general",
        timestamp: 150,
      }),
      result("below-threshold", 0.4, {
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        timestamp: 150,
      }),
    ];

    const results = await service.searchByText({
      query: "project",
      k: 5,
      threshold: 0.5,
      includeEmbeddings: true,
      filter: {
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        startTime: 100,
        endTime: 200,
      },
    });

    expect(results.map((item) => item.id)).toEqual(["match"]);
    expect(store.lastSearchOptions).toMatchObject({
      limit: 5,
      includeEmbeddings: true,
    });
    await expect(service.deleteOlderThan(123)).resolves.toBe(2);
    expect(store.deletedBefore).toBe(123);
    await expect(service.getStats()).resolves.toEqual({
      count: 0,
      dimensions: 0,
      backend: "custom",
      embeddingModel: "test/local-model",
    });
  });
});

function result(
  id: string,
  score: number,
  metadata: Record<string, unknown>,
): VectorSearchResult {
  return {
    id,
    content: id,
    score,
    documentId: id,
    metadata,
    embedding: [1, 0, 0],
  } satisfies UnifiedVectorSearchResult;
}
