import { describe, expect, it, vi } from "vitest";

const { searchInsightsSemanticallyMock, searchSimilarChunksMock } = vi.hoisted(
  () => ({
    searchInsightsSemanticallyMock: vi.fn(),
    searchSimilarChunksMock: vi.fn(),
  }),
);

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
});
