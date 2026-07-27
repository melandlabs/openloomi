import {
  type MemoryApplicabilityContext,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryGraphSnapshot,
  type OwnerScope,
  buildGraphAwareRetrievalDryRun,
  createGraphAwareRetrievalDryRunRetriever,
} from "@openloomi/memory-consolidation";
import { describe, expect, it, vi } from "vitest";
import {
  type MemoryRecord,
  type MemoryStorageAdapter,
  type MemorySummary,
  createMemoryQueryApi,
} from "../../../../packages/ai/src/memory";
function createRecord(
  input: Partial<MemoryRecord> & { id: string },
): MemoryRecord {
  return {
    id: input.id,
    userId: input.userId ?? "u1",
    timestamp: input.timestamp ?? Date.now(),
    text: input.text,
    mediaRefs: input.mediaRefs,
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingContentHash: input.embeddingContentHash,
    embeddingDimensions: input.embeddingDimensions,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
    tier: input.tier ?? "short",
    accessCount: input.accessCount,
    lastAccessAt: input.lastAccessAt,
    importanceScore: input.importanceScore,
    isPinned: input.isPinned,
    archivedAt: input.archivedAt,
    dimensions: input.dimensions,
    metadata: input.metadata,
    deprecatedAt: input.deprecatedAt,
    deprecationReason: input.deprecationReason,
    supersededBySummaryId: input.supersededBySummaryId,
  };
}

function createSummary(
  input: Partial<MemorySummary> & { summaryId: string },
): MemorySummary {
  return {
    summaryId: input.summaryId,
    userId: input.userId ?? "u1",
    summaryTier: input.summaryTier ?? "L1",
    sourceTier: input.sourceTier ?? "short",
    startTimestamp: input.startTimestamp ?? 100,
    endTimestamp: input.endTimestamp ?? 1000,
    messageCount: input.messageCount ?? 2,
    sourceRecordIds: input.sourceRecordIds ?? ["r-old"],
    keyPoints: input.keyPoints ?? ["preference"],
    keywords: input.keywords ?? ["language"],
    summaryText: input.summaryText ?? "User prefers concise language.",
    dimensions: input.dimensions,
    qualityScore: input.qualityScore,
    createdAt: input.createdAt ?? 1000,
    updatedAt: input.updatedAt ?? 1000,
  };
}
const GRAPH_NOW = 1_700_000_000_000;
const graphOwnerScope = { userId: "u1" } satisfies OwnerScope;

function graphNode(
  id: string,
  type: MemoryGraphNode["type"],
  visibility: MemoryGraphNode["visibility"] = "default",
  applicability?: MemoryApplicabilityContext,
): MemoryGraphNode {
  return {
    id,
    ownerScope: graphOwnerScope,
    type,
    visibility,
    applicability,
    createdAt: GRAPH_NOW,
  };
}

describe("memory graph applicability", () => {
  it("filters baseline and graph-selected nodes by trusted applicability", async () => {
    const global = createRecord({
      id: "global",
      userId: "u1",
      timestamp: 3000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const conversationA = createRecord({
      id: "conversation-a",
      userId: "u1",
      timestamp: 2000,
      metadata: {
        memoryApplicability: { scope: "conversation", key: "chat-a" },
      },
    });
    const conversationB = createRecord({
      id: "conversation-b",
      userId: "u1",
      timestamp: 1000,
      metadata: {
        memoryApplicability: { scope: "conversation", key: "chat-b" },
      },
    });
    const contextualSummary = createSummary({
      summaryId: "summary-b",
      endTimestamp: 4000,
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({
        items: [global, conversationA, conversationB],
        hasMore: false,
      }),
      querySummaries: async () => ({
        items: [contextualSummary],
        hasMore: false,
      }),
    };
    const snapshot: MemoryGraphSnapshot = {
      ownerScope: graphOwnerScope,
      nodes: [
        graphNode("global", "raw"),
        graphNode("conversation-a", "raw", "default", {
          scope: "conversation",
          key: "chat-a",
        }),
        graphNode("conversation-b", "raw", "default", {
          scope: "conversation",
          key: "chat-b",
        }),
        graphNode("summary-b", "summary", "default", {
          scope: "conversation",
          key: "chat-b",
        }),
      ],
      edges: [],
      clusters: [],
      capturedAt: GRAPH_NOW,
    };
    const createApi = (applicabilityContexts: MemoryApplicabilityContext[]) =>
      createMemoryQueryApi({
        storage,
        graphRetrieval: {
          enabled: true,
          applicabilityContexts,
          retriever: createGraphAwareRetrievalDryRunRetriever(),
          snapshotProvider: async () => snapshot,
        },
      });

    const scoped = await createApi([
      { scope: "conversation", key: "chat-a" },
    ]).queryWithFallback({
      userId: "u1",
      pageSize: 4,
      minRawResultsWithoutFallback: 4,
    });
    expect(
      scoped.items.map((item) =>
        item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
      ),
    ).toEqual(expect.arrayContaining(["global", "conversation-a"]));
    expect(
      scoped.items.map((item) =>
        item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
      ),
    ).not.toEqual(expect.arrayContaining(["conversation-b", "summary-b"]));

    const globalOnly = await createApi([]).queryWithFallback({
      userId: "u1",
      pageSize: 4,
      minRawResultsWithoutFallback: 4,
    });
    const globalOnlyIds = globalOnly.items.map((item) =>
      item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
    );
    expect(globalOnlyIds.length).toBeGreaterThan(0);
    expect(globalOnlyIds.every((nodeId) => nodeId === "global")).toBe(true);

    const staleSnapshotResult = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        applicabilityContexts: [],
        retriever: createGraphAwareRetrievalDryRunRetriever(),
        snapshotProvider: async () => ({
          ...snapshot,
          nodes: snapshot.nodes.map((node) =>
            node.id === "conversation-b"
              ? { ...node, applicability: { scope: "global" } }
              : node,
          ),
        }),
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 4,
      minRawResultsWithoutFallback: 4,
    });
    const staleSnapshotIds = staleSnapshotResult.items.map((item) =>
      item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
    );
    expect(staleSnapshotIds).not.toContain("conversation-b");
    expect(staleSnapshotResult.graphRetrieval?.reasonCodes).toContain(
      "graph_retrieval_baseline_snapshot_mismatch",
    );
  });

  it("keeps applicable baseline hits when materialized indexes would overlap", async () => {
    const global = createRecord({
      id: "global",
      timestamp: 3000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const filtered = createRecord({
      id: "conversation-b",
      timestamp: 2000,
      metadata: {
        memoryApplicability: { scope: "conversation", key: "chat-b" },
      },
    });
    const applicable = createRecord({
      id: "conversation-a",
      timestamp: 1000,
      metadata: {
        memoryApplicability: { scope: "conversation", key: "chat-a" },
      },
    });
    const materializedSummary = createSummary({
      summaryId: "summary-a",
      endTimestamp: 4000,
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({
        items: [global, filtered, applicable],
        hasMore: false,
      }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };
    const snapshot: MemoryGraphSnapshot = {
      ownerScope: graphOwnerScope,
      nodes: [
        graphNode("global", "raw"),
        graphNode("conversation-b", "raw", "default", {
          scope: "conversation",
          key: "chat-b",
        }),
        graphNode("conversation-a", "raw", "default", {
          scope: "conversation",
          key: "chat-a",
        }),
        graphNode("summary-a", "summary", "default", {
          scope: "conversation",
          key: "chat-a",
        }),
      ],
      edges: [],
      clusters: [],
      capturedAt: GRAPH_NOW,
    };
    const result = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        applicabilityContexts: [{ scope: "conversation", key: "chat-a" }],
        retriever: {
          async compare() {
            return {
              ownerScope: graphOwnerScope,
              rankedNodeIds: ["summary-a", "conversation-a", "global"],
              hiddenDeprecatedNodeIds: [],
              expandedClusterIds: [],
              reasonCodes: [],
            };
          },
        },
        snapshotProvider: async () => snapshot,
        materializeNodeIds: async () => [
          {
            sourceType: "summary",
            timestamp: materializedSummary.endTimestamp,
            summary: materializedSummary,
          },
        ],
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 4,
    });

    expect(
      result.items.map((item) =>
        item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
      ),
    ).toEqual(["summary-a", "conversation-a"]);
  });

  it("keeps failed graph retrieval fallback constrained by snapshot applicability", async () => {
    const global = createRecord({
      id: "global-safe",
      userId: "u1",
      timestamp: 3000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const forgedGlobal = createRecord({
      id: "cross-scope-forged-global",
      userId: "u1",
      timestamp: 2000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({
        items: [global, forgedGlobal],
        hasMore: false,
      }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };

    const result = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        applicabilityContexts: [],
        retriever: {
          compare: async () => {
            throw new Error("graph failed");
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [
            graphNode("global-safe", "raw"),
            graphNode("cross-scope-forged-global", "raw", "default", {
              scope: "conversation",
              key: "chat-b",
            }),
          ],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceType: "raw",
      record: { id: "global-safe" },
    });
    expect(result.graphRetrieval?.status).toBe("failed");
  });

  it("drops an unlinked cross-owner baseline before graph retrieval", async () => {
    const global = createRecord({
      id: "global-safe",
      userId: "u1",
      timestamp: 3000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const foreign = createRecord({
      id: "foreign-unlinked",
      userId: "u2",
      timestamp: 2000,
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [global, foreign], hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };

    const result = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        applicabilityContexts: [],
        retriever: {
          compare: async () => {
            throw new Error("graph retrieval must not run");
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [graphNode("global-safe", "raw")],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceType: "raw",
      record: { id: "global-safe" },
    });
    expect(result.graphRetrieval).toMatchObject({
      status: "no-op",
      reasonCodes: ["graph_retrieval_baseline_snapshot_mismatch"],
    });
  });

  it("drops cross-owner global hits when no graph snapshot is available", async () => {
    const global = createRecord({
      id: "global-safe",
      userId: "u1",
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const foreign = createRecord({
      id: "foreign-global",
      userId: "u2",
      metadata: { memoryApplicability: { scope: "global" } },
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [global, foreign], hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };

    const result = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: createGraphAwareRetrievalDryRunRetriever(),
        snapshotProvider: async () => undefined,
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(
      result.items.map((item) =>
        item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
      ),
    ).toEqual(["global-safe"]);
    expect(result.graphRetrieval?.reasonCodes).toContain(
      "graph_retrieval_snapshot_unavailable",
    );
  });

  it("rejects cross-applicability graph output before materialization", async () => {
    const baseline = createRecord({
      id: "conversation-a",
      userId: "u1",
      timestamp: 2000,
      metadata: {
        memoryApplicability: { scope: "conversation", key: "chat-a" },
      },
    });
    const materializeNodeIds = vi.fn(async () => [
      {
        sourceType: "summary" as const,
        timestamp: 3000,
        summary: createSummary({ summaryId: "summary-b" }),
      },
    ]);
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [baseline], hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };
    const result = await createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        applicabilityContexts: [{ scope: "conversation", key: "chat-a" }],
        retriever: {
          async compare() {
            return {
              ownerScope: graphOwnerScope,
              rankedNodeIds: ["summary-b", "conversation-a"],
              hiddenDeprecatedNodeIds: [],
              expandedClusterIds: ["cluster-b"],
              reasonCodes: ["malicious_cross_context_output"],
            };
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [
            graphNode("conversation-a", "raw", "default", {
              scope: "conversation",
              key: "chat-a",
            }),
            graphNode("summary-b", "summary", "default", {
              scope: "conversation",
              key: "chat-b",
            }),
          ],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
        materializeNodeIds,
      },
    }).queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(materializeNodeIds).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ sourceType: "raw", record: baseline }),
    ]);
    expect(result.graphRetrieval?.status).toBe("applied");
  });

  it("does not expand representatives or conflicts across applicability", () => {
    const contextA = {
      scope: "conversation" as const,
      key: "chat-a",
    };
    const contextB = {
      scope: "conversation" as const,
      key: "chat-b",
    };
    const competeEdge = (
      id: string,
      fromNodeId: string,
      toNodeId: string,
      applicability: MemoryApplicabilityContext,
    ): MemoryGraphEdge => ({
      id,
      ownerScope: graphOwnerScope,
      fromNodeId,
      toNodeId,
      kind: "compete",
      weight: 1,
      evidenceNodeIds: [fromNodeId, toNodeId],
      reasonCodes: ["conflicting_evidence"],
      applicability,
      createdAt: GRAPH_NOW,
    });
    const snapshot: MemoryGraphSnapshot = {
      ownerScope: graphOwnerScope,
      nodes: [
        graphNode("raw-a", "raw", "default", contextA),
        graphNode("summary-a", "summary", "default", contextA),
        graphNode("alt-a", "summary", "audit-only", contextA),
        graphNode("raw-b", "raw", "default", contextB),
        graphNode("summary-b", "summary", "audit-only", contextB),
      ],
      edges: [
        competeEdge("compete-a", "summary-a", "alt-a", contextA),
        competeEdge("compete-b", "summary-a", "summary-b", contextB),
      ],
      clusters: [
        {
          clusterId: "cluster-a",
          ownerScope: graphOwnerScope,
          nodeIds: ["raw-a", "summary-a"],
          lifecycleStatus: "active",
          representativeNodeId: "summary-a",
          supportScore: 1,
          updatedAt: GRAPH_NOW,
          reasonCodes: [],
          applicability: contextA,
        },
        {
          clusterId: "cluster-alt-a",
          ownerScope: graphOwnerScope,
          nodeIds: ["alt-a"],
          lifecycleStatus: "active",
          representativeNodeId: "alt-a",
          supportScore: 1,
          updatedAt: GRAPH_NOW,
          reasonCodes: [],
          applicability: contextA,
        },
        {
          clusterId: "cluster-b",
          ownerScope: graphOwnerScope,
          nodeIds: ["raw-b", "summary-b"],
          lifecycleStatus: "active",
          representativeNodeId: "summary-b",
          supportScore: 1,
          updatedAt: GRAPH_NOW,
          reasonCodes: [],
          applicability: contextB,
        },
      ],
      capturedAt: GRAPH_NOW,
    };

    const result = buildGraphAwareRetrievalDryRun({
      ownerScope: graphOwnerScope,
      query: "preference",
      baselineNodeIds: ["raw-a", "raw-b"],
      snapshot,
      applicabilityContexts: [contextA],
      visibilityMode: "conflict",
    });

    expect(result.rankedNodeIds).toEqual(
      expect.arrayContaining(["summary-a", "alt-a"]),
    );
    expect(result.rankedNodeIds).not.toContain("summary-b");
    expect(result.rankedNodeIds).not.toContain("raw-b");
    expect(
      result.auditTrail?.flatMap((trail) => trail.sourceNodeIds),
    ).not.toContain("raw-b");
  });

  it("fails closed when baseline raw visibility disagrees with the graph", async () => {
    const restoredRaw = createRecord({
      id: "raw-restored",
      userId: "u1",
      timestamp: 2000,
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [restoredRaw], hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };
    const api = createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: createGraphAwareRetrievalDryRunRetriever(),
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [graphNode("raw-restored", "raw", "audit-only")],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    });

    const result = await api.queryWithFallback({
      userId: "u1",
      pageSize: 1,
    });

    expect(result.items).toEqual([]);
    expect(result.graphRetrieval).toEqual({
      status: "no-op",
      reasonCodes: ["graph_retrieval_baseline_snapshot_mismatch"],
    });
  });
  it("hides audit-only summaries without dropping uncovered baseline hits", async () => {
    const uncoveredRaw = createRecord({
      id: "r-uncovered",
      userId: "u1",
      timestamp: 1000,
    });
    const retiredSummary = createSummary({
      summaryId: "summary-retired",
      endTimestamp: 3000,
    });
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [uncoveredRaw], hasMore: false }),
      querySummaries: async () => ({
        items: [retiredSummary],
        hasMore: false,
      }),
      markRecordsAccessed: async () => {},
    };
    const api = createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: createGraphAwareRetrievalDryRunRetriever(),
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [graphNode("summary-retired", "summary", "audit-only")],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    });

    const defaultResult = await api.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(defaultResult.graphRetrieval?.status).toBe("applied");
    expect(
      defaultResult.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["r-uncovered"]);

    const conflictResult = await api.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
      conflictSensitive: true,
    });
    expect(
      conflictResult.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["r-uncovered"]);

    const unsafeConflictApi = createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: {
          async compare() {
            return {
              ownerScope: graphOwnerScope,
              rankedNodeIds: ["summary-retired"],
              hiddenDeprecatedNodeIds: [],
              expandedClusterIds: [],
              reasonCodes: [],
            };
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [graphNode("summary-retired", "summary", "audit-only")],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    });
    const unsafeConflictResult = await unsafeConflictApi.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
      conflictSensitive: true,
    });
    expect(
      unsafeConflictResult.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["r-uncovered"]);

    const auditResult = await api.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
      includeDeprecated: true,
    });

    expect(
      auditResult.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["summary-retired", "r-uncovered"]);

    const throwingApi = createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: {
          async compare() {
            throw new Error("graph unavailable");
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [graphNode("summary-retired", "summary", "audit-only")],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    });
    for (const query of [
      { userId: "u1", pageSize: 2, minRawResultsWithoutFallback: 2 },
      {
        userId: "u1",
        pageSize: 2,
        minRawResultsWithoutFallback: 2,
        conflictSensitive: true,
      },
    ]) {
      const failed = await throwingApi.queryWithFallback(query);
      expect(failed.graphRetrieval?.status).toBe("failed");
      expect(
        failed.items.map((item) =>
          item.sourceType === "summary"
            ? item.summary.summaryId
            : item.record.id,
        ),
      ).toEqual(["r-uncovered"]);
    }
    const failedAudit = await throwingApi.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
      includeDeprecated: true,
    });
    expect(failedAudit.graphRetrieval?.status).toBe("failed");
    expect(
      failedAudit.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["summary-retired", "r-uncovered"]);
  });

  it("falls back when graph ranking requires nodes outside the baseline", async () => {
    const rawRecords = [
      createRecord({ id: "r1", userId: "u1", timestamp: 2000 }),
      createRecord({ id: "r2", userId: "u1", timestamp: 1000 }),
    ];
    const markRecordsAccessed = vi.fn();
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: rawRecords, hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
      markRecordsAccessed,
    };
    const api = createMemoryQueryApi({
      storage,
      graphRetrieval: {
        enabled: true,
        retriever: {
          async compare() {
            return {
              ownerScope: graphOwnerScope,
              rankedNodeIds: ["r3", "r2"],
              hiddenDeprecatedNodeIds: [],
              expandedClusterIds: ["conflict-cluster"],
              auditTrail: [
                {
                  ownerScope: graphOwnerScope,
                  nodeId: "r3",
                  sourceNodeIds: ["r1"],
                  edgeIds: ["compete:r1:r3"],
                  operationIds: ["operation:r3"],
                  reasonCodes: ["competing_alternative_provenance"],
                },
              ],
              reasonCodes: ["competing_alternatives_exposed"],
            };
          },
        },
        snapshotProvider: async () => ({
          ownerScope: graphOwnerScope,
          nodes: [
            graphNode("r1", "raw"),
            graphNode("r2", "raw"),
            graphNode("r3", "raw"),
          ],
          edges: [],
          clusters: [],
          capturedAt: GRAPH_NOW,
        }),
      },
    });

    const result = await api.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
      conflictSensitive: true,
    });

    expect(result.items.map((item) => item.timestamp)).toEqual([2000, 1000]);
    expect(result.graphRetrieval).toEqual({
      status: "no-op",
      reasonCodes: ["graph_retrieval_unmaterialized_graph_nodes"],
    });
    expect(markRecordsAccessed).not.toHaveBeenCalled();
  });
});
