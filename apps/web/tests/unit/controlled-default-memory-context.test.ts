import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  storageAvailable: vi.fn(),
  getManager: vi.fn(),
  queryMemoryWithFallback: vi.fn(),
  createGraphStore: vi.fn(),
  readSnapshot: vi.fn(),
  readAuditTrail: vi.fn(),
  compareGraph: vi.fn(),
  materializeNodeIds: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/memory/memory-graph-write-policy", () => ({
  resolveMemoryGraphWritePolicy: mocks.policy,
}));

vi.mock("@/lib/memory/raw-message-store", () => ({
  isRawMessageStorageAvailable: mocks.storageAvailable,
  getRawMessageManager: mocks.getManager,
}));

vi.mock("@openloomi/indexeddb", () => ({
  queryMemoryWithFallback: mocks.queryMemoryWithFallback,
  createRawMessageMemoryGraphStore: mocks.createGraphStore,
  materializeMemoryGraphNodeIds: mocks.materializeNodeIds,
}));

vi.mock("@openloomi/memory-consolidation", () => ({
  createGraphAwareRetrievalDryRunRetriever: () => ({
    compare: mocks.compareGraph,
  }),
}));

import { getControlledDefaultMemoryContext } from "@/lib/memory/controlled-default-context";

const USER_ID = "user-1";
const manager = {
  getMessageById: vi.fn(),
  querySummaries: vi.fn(),
};

function rawHit(id: string, text: string) {
  return {
    sourceType: "raw" as const,
    timestamp: 2000,
    record: {
      id,
      userId: USER_ID,
      timestamp: 2000,
      text,
      tier: "short" as const,
    },
  };
}

function summaryHit(id: string, text: string) {
  return {
    sourceType: "summary" as const,
    timestamp: 3000,
    summary: {
      summaryId: id,
      userId: USER_ID,
      summaryTier: "L1" as const,
      sourceTier: "short" as const,
      startTimestamp: 1000,
      endTimestamp: 3000,
      messageCount: 2,
      sourceRecordIds: ["raw-superseded"],
      keyPoints: [text],
      keywords: ["concise"],
      summaryText: text,
      createdAt: 3000,
      updatedAt: 3000,
    },
  };
}

function queryResult(input: {
  items: Array<ReturnType<typeof rawHit> | ReturnType<typeof summaryHit>>;
  status: "applied" | "no-op" | "failed";
  reasonCode: string;
  result?: Record<string, unknown>;
}) {
  return {
    items: input.items,
    rawCount: 2,
    summaryCount: 1,
    hasMore: false,
    graphRetrieval: {
      status: input.status,
      reasonCodes: [input.reasonCode],
      ...(input.result ? { result: input.result } : {}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy.mockReturnValue({
    enabled: true,
    reasonCodes: ["memory_graph_write_cohort_enabled"],
  });
  mocks.storageAvailable.mockReturnValue(true);
  mocks.getManager.mockResolvedValue(manager);
  mocks.createGraphStore.mockReturnValue({
    readSnapshot: mocks.readSnapshot,
    readAuditTrail: mocks.readAuditTrail,
  });
  mocks.compareGraph.mockResolvedValue({
    ownerScope: { userId: USER_ID },
    rankedNodeIds: ["summary-1"],
    hiddenDeprecatedNodeIds: [],
    expandedClusterIds: [],
    auditTrail: [
      {
        ownerScope: { userId: USER_ID },
        nodeId: "summary-1",
        sourceNodeIds: ["raw-superseded"],
        edgeIds: ["dry-run-edge"],
        operationIds: [],
        reasonCodes: ["graph_retrieval_audit_trail"],
      },
    ],
    reasonCodes: ["graph_retrieval_dry_run"],
  });
  mocks.readAuditTrail.mockImplementation(
    async ({ nodeId }: { nodeId: string }) => ({
      ownerScope: { userId: USER_ID },
      nodeId,
      sourceNodeIds: ["raw-superseded"],
      edgeIds: ["persisted-edge"],
      operationIds: ["persisted-operation"],
      reasonCodes: ["memory_graph_audit_trail_available"],
    }),
  );
  mocks.readSnapshot.mockResolvedValue({
    ownerScope: { userId: USER_ID },
    version: "1",
    nodes: [
      {
        id: "summary-1",
        ownerScope: { userId: USER_ID },
      },
    ],
    edges: [],
    clusters: [],
  });
  mocks.materializeNodeIds.mockResolvedValue([]);
});

describe("controlled default memory context", () => {
  it("uses graph-selected materialized hits and excludes superseded raw noise", async () => {
    mocks.queryMemoryWithFallback.mockResolvedValue(
      queryResult({
        items: [summaryHit("summary-1", "Use concise answers")],
        status: "applied",
        reasonCode: "default_hides_deprecated_raw",
      }),
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "How should the answer be concise?",
      applicabilityContexts: [{ scope: "conversation", key: "trusted-chat" }],
    });

    expect(result.content).toContain("Use concise answers");
    expect(result.content).not.toContain("superseded raw noise");
    expect(result.diagnostic).toEqual({
      status: "applied",
      reasonCodes: [
        "memory_graph_write_cohort_enabled",
        "default_hides_deprecated_raw",
      ],
      sourceCount: 1,
      requestedMode: "default",
      appliedMode: "default",
      graphRetrievalStatus: "applied",
      materializedNodeIds: ["summary-1"],
    });

    const [calledManager, query, options] =
      mocks.queryMemoryWithFallback.mock.calls[0];
    expect(calledManager).toBe(manager);
    expect(query).toMatchObject({
      userId: USER_ID,
      pageSize: 6,
      minRawResultsWithoutFallback: 6,
      reverse: true,
      includeDeprecated: false,
      conflictSensitive: false,
    });
    expect(query.keywords).toEqual(
      expect.arrayContaining(["answer", "concise"]),
    );
    expect(options.graphRetrieval).toMatchObject({
      enabled: true,
      ownerScope: { userId: USER_ID },
      applicabilityContexts: [{ scope: "conversation", key: "trusted-chat" }],
    });
    expect(options.graphRetrieval.queryText()).toBe(
      "How should the answer be concise?",
    );
    await expect(
      options.graphRetrieval.snapshotProvider({
        ownerScope: { userId: USER_ID },
      }),
    ).resolves.toMatchObject({ version: "1" });
    expect(mocks.readSnapshot).toHaveBeenCalledWith({
      ownerScope: { userId: USER_ID },
      includeAuditOnly: true,
    });
    const snapshot = await options.graphRetrieval.snapshotProvider({
      ownerScope: { userId: USER_ID },
    });
    mocks.materializeNodeIds.mockResolvedValueOnce([
      summaryHit("summary-1", "Use concise answers"),
    ]);
    await expect(
      options.graphRetrieval.materializeNodeIds({
        ownerScope: { userId: USER_ID },
        snapshot,
        nodeIds: ["summary-1"],
        applicabilityContexts: [{ scope: "conversation", key: "trusted-chat" }],
      }),
    ).resolves.toEqual([summaryHit("summary-1", "Use concise answers")]);
    expect(mocks.materializeNodeIds).toHaveBeenCalledWith({
      manager,
      ownerScope: { userId: USER_ID },
      snapshot,
      nodeIds: ["summary-1"],
      applicabilityContexts: [{ scope: "conversation", key: "trusted-chat" }],
    });
    const graphResult = await options.graphRetrieval.retriever.compare({
      ownerScope: { userId: USER_ID },
      query: "concise",
      baselineNodeIds: ["raw-superseded"],
      snapshot,
      visibilityMode: "default",
    });
    expect(mocks.compareGraph).toHaveBeenCalledWith({
      ownerScope: { userId: USER_ID },
      query: "concise",
      baselineNodeIds: ["raw-superseded"],
      snapshot,
      visibilityMode: "default",
    });
    expect(mocks.readAuditTrail).toHaveBeenCalledWith({
      ownerScope: { userId: USER_ID },
      nodeId: "summary-1",
      includeDeprecated: undefined,
    });
    expect(graphResult.auditTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "summary-1",
          sourceNodeIds: ["raw-superseded"],
          edgeIds: ["dry-run-edge", "persisted-edge"],
          operationIds: ["persisted-operation"],
          reasonCodes: [
            "graph_retrieval_audit_trail",
            "memory_graph_audit_trail_available",
          ],
        }),
      ]),
    );
  });

  it("materializes deprecated source evidence and provenance in audit mode", async () => {
    mocks.queryMemoryWithFallback.mockResolvedValue(
      queryResult({
        items: [
          summaryHit("summary-1", "Use concise answers"),
          rawHit("raw-superseded", "Earlier verbose preference"),
        ],
        status: "applied",
        reasonCode: "include_deprecated_requested",
        result: {
          auditTrail: [
            {
              nodeId: "summary-1",
              sourceNodeIds: ["raw-superseded"],
              edgeIds: ["supersede-edge"],
              operationIds: ["publish-summary"],
              reasonCodes: ["graph_retrieval_audit_trail"],
            },
            {
              nodeId: "raw-superseded",
              sourceNodeIds: ["raw-superseded"],
              edgeIds: ["supersede-edge"],
              operationIds: ["deprecate-source"],
              reasonCodes: ["deprecated_raw_included"],
            },
          ],
        },
      }),
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "Why is concise preferred?",
      mode: "audit",
    });

    expect(result.content).toContain("Use concise answers");
    expect(result.content).toContain("Earlier verbose preference");
    expect(result.diagnostic).toMatchObject({
      status: "applied",
      requestedMode: "audit",
      appliedMode: "audit",
      sourceCount: 2,
      materializedNodeIds: ["summary-1", "raw-superseded"],
      provenance: [
        expect.objectContaining({
          nodeId: "summary-1",
          sourceNodeIds: ["raw-superseded"],
          operationIds: ["publish-summary"],
        }),
        expect.objectContaining({
          nodeId: "raw-superseded",
          operationIds: ["deprecate-source"],
        }),
      ],
    });
    expect(mocks.queryMemoryWithFallback.mock.calls[0]?.[1]).toMatchObject({
      includeDeprecated: true,
      conflictSensitive: false,
    });
  });

  it("materializes explained alternatives in conflict mode", async () => {
    mocks.queryMemoryWithFallback.mockResolvedValue(
      queryResult({
        items: [
          summaryHit("summary-1", "Use concise answers"),
          summaryHit("summary-alternative", "Use detailed answers"),
        ],
        status: "applied",
        reasonCode: "competing_alternatives_exposed",
        result: {
          auditTrail: [
            {
              nodeId: "summary-1",
              sourceNodeIds: ["raw-superseded"],
              edgeIds: ["compete-edge"],
              operationIds: ["competition-operation"],
              reasonCodes: ["competing_alternative_source"],
            },
            {
              nodeId: "summary-alternative",
              sourceNodeIds: ["raw-alternative"],
              edgeIds: ["compete-edge"],
              operationIds: ["competition-operation"],
              reasonCodes: ["competing_alternative_exposed"],
            },
          ],
        },
      }),
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "How detailed should this answer be?",
      mode: "conflict",
    });

    expect(result.content).toContain("Use concise answers");
    expect(result.content).toContain("Use detailed answers");
    expect(result.diagnostic).toMatchObject({
      status: "applied",
      requestedMode: "conflict",
      appliedMode: "conflict",
      sourceCount: 2,
      materializedNodeIds: ["summary-1", "summary-alternative"],
      provenance: [
        expect.objectContaining({ nodeId: "summary-1" }),
        expect.objectContaining({ nodeId: "summary-alternative" }),
      ],
    });
    expect(mocks.queryMemoryWithFallback.mock.calls[0]?.[1]).toMatchObject({
      includeDeprecated: false,
      conflictSensitive: true,
    });
  });

  it("leaves the original agent prompt untouched when policy is disabled", async () => {
    mocks.policy.mockReturnValue({
      enabled: false,
      reasonCodes: ["memory_graph_write_kill_switch"],
    });

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "Keep the baseline prompt",
    });

    expect(result.content).toBeUndefined();
    expect(result.diagnostic).toEqual({
      status: "no-op",
      reasonCodes: [
        "native_agent_memory_context_policy_disabled",
        "memory_graph_write_kill_switch",
      ],
      sourceCount: 0,
      requestedMode: "default",
      appliedMode: "baseline",
    });
    expect(mocks.queryMemoryWithFallback).not.toHaveBeenCalled();
  });

  it("preserves baseline hits when graph snapshot capability is missing", async () => {
    const baselineOnlyManager = {};
    mocks.getManager.mockResolvedValue(baselineOnlyManager);
    mocks.queryMemoryWithFallback.mockImplementation(
      async (_manager, _query, options) => {
        expect(options.graphRetrieval.snapshotProvider).toBeUndefined();
        return queryResult({
          items: [rawHit("raw-baseline", "Keep baseline memory")],
          status: "no-op",
          reasonCode: "graph_retrieval_missing_snapshot_provider",
        });
      },
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "baseline memory",
    });

    expect(result.content).toContain("Keep baseline memory");
    expect(result.diagnostic).toMatchObject({
      status: "baseline",
      sourceCount: 1,
      requestedMode: "default",
      appliedMode: "baseline",
      graphRetrievalStatus: "no-op",
      reasonCodes: expect.arrayContaining([
        "graph_retrieval_missing_snapshot_provider",
      ]),
    });
  });

  it("treats an empty persisted graph as an unavailable snapshot and keeps baseline hits", async () => {
    mocks.readSnapshot.mockResolvedValue({
      ownerScope: { userId: USER_ID },
      version: "0",
      nodes: [],
      edges: [],
      clusters: [],
    });
    mocks.queryMemoryWithFallback.mockImplementation(
      async (_manager, _query, options) => {
        await expect(
          options.graphRetrieval.snapshotProvider({
            ownerScope: { userId: USER_ID },
          }),
        ).resolves.toBeUndefined();
        return queryResult({
          items: [rawHit("raw-baseline", "Snapshot fallback memory")],
          status: "no-op",
          reasonCode: "graph_retrieval_snapshot_unavailable",
        });
      },
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "snapshot fallback",
    });

    expect(result.content).toContain("Snapshot fallback memory");
    expect(result.diagnostic).toMatchObject({
      status: "baseline",
      requestedMode: "default",
      appliedMode: "baseline",
      reasonCodes: expect.arrayContaining([
        "graph_retrieval_snapshot_unavailable",
      ]),
    });
  });

  it.each([
    "graph_retrieval_owner_scope_mismatch",
    "graph_retrieval_unmaterialized_graph_nodes",
  ])("keeps baseline context for %s", async (reasonCode) => {
    mocks.queryMemoryWithFallback.mockResolvedValue(
      queryResult({
        items: [rawHit("raw-baseline", "Trusted baseline memory")],
        status: "no-op",
        reasonCode,
      }),
    );

    const result = await getControlledDefaultMemoryContext({
      userId: USER_ID,
      query: "trusted baseline",
    });

    expect(result.content).toContain("Trusted baseline memory");
    expect(result.diagnostic).toMatchObject({
      status: "baseline",
      sourceCount: 1,
      requestedMode: "default",
      appliedMode: "baseline",
      graphRetrievalStatus: "no-op",
      reasonCodes: expect.arrayContaining([reasonCode]),
    });
  });
});
