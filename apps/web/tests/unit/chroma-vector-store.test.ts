import { beforeEach, describe, expect, it, vi } from "vitest";

const chromaMocks = vi.hoisted(() => {
  const collection = {
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    get: vi.fn(),
  };
  return {
    collection,
    constructorOptions: [] as unknown[],
    getOrCreateCollection: vi.fn(async () => collection),
    deleteCollection: vi.fn(),
  };
});

vi.mock("chromadb", () => {
  class ChromaNotFoundError extends Error {}

  class ChromaClient {
    constructor(options: unknown) {
      chromaMocks.constructorOptions.push(options);
    }

    getOrCreateCollection = chromaMocks.getOrCreateCollection;
    deleteCollection = chromaMocks.deleteCollection;
  }

  return {
    ChromaClient,
    ChromaNotFoundError,
    IncludeEnum: {
      documents: "documents",
      metadatas: "metadatas",
      distances: "distances",
      embeddings: "embeddings",
    },
  };
});

import { ChromaVectorStore } from "../../../../packages/ai/rag/src/chroma-store";

describe("ChromaVectorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromaMocks.constructorOptions.length = 0;
    chromaMocks.collection.count.mockResolvedValue(0);
    chromaMocks.collection.get.mockResolvedValue({
      ids: [],
      embeddings: [],
    });
  });

  it("supplies vectors explicitly and serializes structured metadata", async () => {
    const store = new ChromaVectorStore({
      url: "https://vectors.example.test:8443",
      collectionName: "test_collection",
    });

    await store.addChunk({
      id: "chunk-1",
      documentId: "document-1",
      content: "hello",
      embedding: [1, 0, 0],
      metadata: {
        userId: "user-1",
        tags: ["a", "b"],
        ignored: undefined,
      },
    });

    expect(chromaMocks.constructorOptions).toEqual([
      { host: "vectors.example.test", port: 8443, ssl: true },
    ]);
    expect(chromaMocks.getOrCreateCollection).toHaveBeenCalledWith({
      name: "test_collection",
      embeddingFunction: null,
      metadata: {
        source: "@openloomi/rag",
        store: "chroma",
      },
    });
    expect(chromaMocks.collection.upsert).toHaveBeenCalledWith({
      ids: ["chunk-1"],
      embeddings: [[1, 0, 0]],
      documents: ["hello"],
      metadatas: [
        {
          userId: "user-1",
          tags: '["a","b"]',
          documentId: "document-1",
        },
      ],
    });
  });

  it("pushes common filters into Chroma and converts distance to score", async () => {
    chromaMocks.collection.query.mockResolvedValue({
      ids: [["chunk-1"]],
      documents: [["matched"]],
      metadatas: [[{ documentId: "document-1", userId: "user-1" }]],
      distances: [[0.25]],
      embeddings: [[[1, 0, 0]]],
    });
    const store = new ChromaVectorStore({
      collectionName: "test_collection",
    });

    const results = await store.similaritySearchWithOptions([1, 0, 0], {
      limit: 3,
      includeEmbeddings: true,
      filter: {
        userId: "user-1",
        platform: "feishu",
        channel: "project",
        startTime: 100,
        endTime: 200,
      },
    });

    expect(chromaMocks.collection.query).toHaveBeenCalledWith({
      queryEmbeddings: [[1, 0, 0]],
      nResults: 3,
      where: {
        $and: [
          { userId: "user-1" },
          { platform: "feishu" },
          { channel: "project" },
          { timestamp: { $gte: 100 } },
          { timestamp: { $lte: 200 } },
        ],
      },
      include: ["documents", "metadatas", "distances", "embeddings"],
    });
    expect(results).toEqual([
      {
        id: "chunk-1",
        content: "matched",
        score: 0.8,
        documentId: "document-1",
        metadata: { documentId: "document-1", userId: "user-1" },
        embedding: [1, 0, 0],
      },
    ]);
  });

  it("treats clearing a missing collection as a successful no-op", async () => {
    chromaMocks.deleteCollection.mockRejectedValueOnce(
      Object.assign(new Error("collection not found"), {
        name: "ChromaNotFoundError",
      }),
    );
    const store = new ChromaVectorStore({
      collectionName: "missing_collection",
    });

    await expect(store.clear()).resolves.toBeUndefined();
  });
});
