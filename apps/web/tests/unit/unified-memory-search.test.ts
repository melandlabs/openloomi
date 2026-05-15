import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSQLiteRawMessageManagerMock,
  isSQLiteRawMessageStorageAvailableMock,
  queryMessagesMock,
  searchInsightsSemanticallyMock,
  searchMessagesSemanticallyMock,
  searchSimilarChunksMock,
  universalEmbedQueryMock,
} = vi.hoisted(() => ({
  getSQLiteRawMessageManagerMock: vi.fn(),
  isSQLiteRawMessageStorageAvailableMock: vi.fn(),
  queryMessagesMock: vi.fn(),
  searchInsightsSemanticallyMock: vi.fn(),
  searchMessagesSemanticallyMock: vi.fn(),
  searchSimilarChunksMock: vi.fn(),
  universalEmbedQueryMock: vi.fn(),
}));

vi.mock("@/lib/memory/sqlite-raw-message-store", () => ({
  getSQLiteRawMessageManager: getSQLiteRawMessageManagerMock,
  isSQLiteRawMessageStorageAvailable: isSQLiteRawMessageStorageAvailableMock,
}));

vi.mock("@openloomi/rag/universal-embeddings", () => ({
  UniversalEmbeddings: vi.fn().mockImplementation(function (this: {
    embedQuery: typeof universalEmbedQueryMock;
  }) {
    this.embedQuery = universalEmbedQueryMock;
  }),
}));

vi.mock("@/lib/insights/search", () => ({
  searchInsightsSemantically: searchInsightsSemanticallyMock,
}));

vi.mock("@/lib/ai/rag/langchain-service", () => ({
  searchSimilarChunks: searchSimilarChunksMock,
}));

import {
  clampUnifiedMemorySearchLimit,
  clampUnifiedMemorySearchThreshold,
  mergeUnifiedMemorySearchResults,
  normalizeUnifiedMemorySearchSources,
  searchUnifiedMemory,
  type UnifiedMemorySearchResult,
} from "@/lib/memory/unified-search";

describe("unified memory search", () => {
  beforeEach(() => {
    getSQLiteRawMessageManagerMock.mockReset();
    isSQLiteRawMessageStorageAvailableMock.mockReset();
    queryMessagesMock.mockReset();
    searchInsightsSemanticallyMock.mockReset();
    searchMessagesSemanticallyMock.mockReset();
    searchSimilarChunksMock.mockReset();
    universalEmbedQueryMock.mockReset();

    isSQLiteRawMessageStorageAvailableMock.mockReturnValue(false);
    getSQLiteRawMessageManagerMock.mockResolvedValue({
      queryMessages: queryMessagesMock,
      searchMessagesSemantically: searchMessagesSemanticallyMock,
    });
    queryMessagesMock.mockResolvedValue([]);
    searchInsightsSemanticallyMock.mockResolvedValue([]);
    searchMessagesSemanticallyMock.mockResolvedValue([]);
    searchSimilarChunksMock.mockResolvedValue([]);
    universalEmbedQueryMock.mockResolvedValue([0.1, 0.2]);
  });

  it("normalizes sources and clamps numeric options", () => {
    expect(normalizeUnifiedMemorySearchSources(undefined)).toEqual([
      "memory",
      "insights",
      "knowledge",
    ]);
    expect(
      normalizeUnifiedMemorySearchSources([
        "insights",
        "unknown",
        "knowledge",
        "insights",
      ]),
    ).toEqual(["insights", "knowledge"]);
    expect(clampUnifiedMemorySearchLimit(1000)).toBe(50);
    expect(clampUnifiedMemorySearchLimit("0")).toBe(1);
    expect(clampUnifiedMemorySearchThreshold(2)).toBe(1);
    expect(clampUnifiedMemorySearchThreshold("-2")).toBe(-1);
  });

  it("merges results by similarity with stable tie breaking", () => {
    const results: UnifiedMemorySearchResult[] = [
      {
        type: "knowledge",
        id: "k1",
        content: "knowledge",
        similarity: 0.8,
        metadata: {},
      },
      {
        type: "insight",
        id: "i1",
        content: "insight",
        similarity: 0.9,
        metadata: {},
      },
      {
        type: "memory",
        id: "m1",
        content: "memory",
        similarity: 0.8,
        metadata: {},
      },
    ];

    expect(
      mergeUnifiedMemorySearchResults(results, 2).map(
        (result) => `${result.type}:${result.id}`,
      ),
    ).toEqual(["insight:i1", "knowledge:k1"]);
  });

  it("searches insights and knowledge, then returns unified results", async () => {
    searchInsightsSemanticallyMock.mockResolvedValue([
      {
        type: "insight",
        id: "insight-1",
        content: "User liked project feedback",
        similarity: 0.91,
        metadata: {
          botId: "bot-1",
        },
      },
    ]);
    searchSimilarChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Project.md",
        content: "Feedback notes",
        similarity: 0.86,
        chunkIndex: 2,
      },
    ]);

    const output = await searchUnifiedMemory({
      userId: "user-1",
      query: "project feedback",
      sources: ["memory", "insights", "knowledge"],
      limit: 10,
      threshold: 0.7,
      authToken: "token",
      botIds: ["bot-1"],
      documentIds: ["doc-1"],
    });

    expect(searchInsightsSemanticallyMock).toHaveBeenCalledWith({
      userId: "user-1",
      query: "project feedback",
      limit: 10,
      threshold: 0.7,
      botIds: ["bot-1"],
      includeArchived: undefined,
      authToken: "token",
    });
    expect(searchSimilarChunksMock).toHaveBeenCalledWith(
      "user-1",
      "project feedback",
      {
        limit: 10,
        threshold: 0.7,
        documentIds: ["doc-1"],
      },
      "token",
    );
    expect(output.results.map((result) => result.type)).toEqual([
      "insight",
      "knowledge",
    ]);
    expect(output.warnings).toEqual([
      {
        source: "memory",
        code: "client_indexeddb_required",
        message:
          "Raw memory records are stored in client-side IndexedDB and cannot be searched from this server API.",
      },
    ]);
  });

  it("hybrid searches SQLite raw memory with FTS keywords and semantic vectors", async () => {
    isSQLiteRawMessageStorageAvailableMock.mockReturnValue(true);
    queryMessagesMock.mockResolvedValue([
      {
        messageId: "message-1",
        userId: "user-1",
        platform: "slack",
        botId: "bot-1",
        channel: "product",
        person: "alice",
        timestamp: 1774500000,
        content: "Raw project feedback",
        createdAt: 1774500000,
        memoryStage: "short",
      },
      {
        messageId: "message-2",
        userId: "user-1",
        platform: "slack",
        botId: "bot-1",
        channel: "product",
        person: "bob",
        timestamp: 1774500010,
        content: "Project keyword-only note",
        createdAt: 1774500010,
        memoryStage: "short",
      },
    ]);
    searchMessagesSemanticallyMock.mockResolvedValue([
      {
        type: "memory",
        id: "message-1",
        content: "Raw project feedback",
        similarity: 0.93,
        metadata: {
          userId: "user-1",
          botId: "bot-1",
          platform: "slack",
        },
      },
    ]);

    const output = await searchUnifiedMemory({
      userId: "user-1",
      query: "project feedback",
      sources: ["memory"],
      limit: 5,
      threshold: 0.6,
      authToken: "token",
      botIds: ["bot-1"],
    });

    expect(universalEmbedQueryMock).toHaveBeenCalledWith("project feedback");
    expect(queryMessagesMock).toHaveBeenCalledWith({
      userId: "user-1",
      keywords: ["project feedback", "project", "feedback"],
      reverse: true,
      includeArchived: false,
      pageSize: 15,
      botId: "bot-1",
    });
    expect(searchMessagesSemanticallyMock).toHaveBeenCalledWith({
      userId: "user-1",
      queryEmbedding: [0.1, 0.2],
      limit: 5,
      threshold: 0.6,
      botId: "bot-1",
    });
    expect(output.warnings).toEqual([]);
    expect(output.results.map((result) => result.id)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(output.results[0]).toMatchObject({
      type: "memory",
      id: "message-1",
      content: "Raw project feedback",
      metadata: {
        userId: "user-1",
        botId: "bot-1",
        platform: "slack",
        matchType: "hybrid",
      },
    });
    expect(output.results[0]?.similarity).toBe(1);
    expect(output.results[1]).toMatchObject({
      type: "memory",
      id: "message-2",
      content: "Project keyword-only note",
      metadata: {
        userId: "user-1",
        botId: "bot-1",
        platform: "slack",
        matchType: "keyword",
      },
    });
  });
});
