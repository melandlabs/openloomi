import {
  type MemorySummaryRecord,
  type RawMessage,
  type RawMessageQuery,
  createRawMessageMemoryGraphStore,
  memoryGraphLedgerMessageId,
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import type { OwnerScope } from "@openloomi/memory-consolidation";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const OWNER = { userId: "user-1" } satisfies OwnerScope;

class GraphLifecycleTestManager {
  readonly messages = new Map<string, RawMessage>();
  readonly summaries = new Map<string, MemorySummaryRecord>();
  nextId = 1;
  failSummaryWrites = 0;
  failDeprecationWrites = 0;
  ledgerWriteCount = 0;
  readonly failLedgerWriteNumbers = new Set<number>();
  hardDeleted = 0;
  deprecateMessages?: (
    messageIds: string[],
    input?: {
      userId?: string;
      deprecatedAt?: number;
      reason?: string;
      supersededBySummaryId?: string;
    },
  ) => Promise<number>;

  constructor(input: { supportsDeprecation?: boolean } = {}) {
    if (input.supportsDeprecation !== false) {
      this.deprecateMessages = async (messageIds, options = {}) => {
        if (this.failDeprecationWrites > 0) {
          this.failDeprecationWrites -= 1;
          throw new Error("deprecation write failed");
        }
        let changed = 0;
        for (const messageId of messageIds) {
          const message = this.messages.get(messageId);
          if (
            !message ||
            message.deprecatedAt !== undefined ||
            (options.userId && message.userId !== options.userId)
          ) {
            continue;
          }
          this.messages.set(messageId, {
            ...message,
            deprecatedAt: options.deprecatedAt ?? Date.now(),
            deprecationReason: options.reason,
            supersededBySummaryId: options.supersededBySummaryId,
          });
          changed += 1;
        }
        return changed;
      };
    }
  }

  async storeMessage(message: RawMessage): Promise<number> {
    if (message.messageId.startsWith("__openloomi_memory_graph__")) {
      this.ledgerWriteCount += 1;
      if (this.failLedgerWriteNumbers.has(this.ledgerWriteCount)) {
        throw new Error("ledger write failed");
      }
    }
    const existing = this.messages.get(message.messageId);
    const id = existing?.id ?? this.nextId++;
    this.messages.set(message.messageId, { ...message, id });
    return id;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    return Promise.all(messages.map((message) => this.storeMessage(message)));
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    return this.messages.get(messageId) ?? null;
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let messages = [...this.messages.values()];
    if (query.userId) {
      messages = messages.filter((message) => message.userId === query.userId);
    }
    if (!query.includeArchived) {
      messages = messages.filter((message) => message.archivedAt === undefined);
    }
    if (!query.includeDeprecated) {
      messages = messages.filter(
        (message) => message.deprecatedAt === undefined,
      );
    }
    if (query.memoryStages) {
      messages = messages.filter(
        (message) =>
          message.memoryStage !== undefined &&
          query.memoryStages?.includes(message.memoryStage),
      );
    }
    messages.sort((left, right) =>
      query.reverse === false
        ? left.timestamp - right.timestamp
        : right.timestamp - left.timestamp,
    );
    const offset = query.offset ?? 0;
    const limit = query.limit ?? query.pageSize ?? messages.length;
    return messages.slice(offset, offset + limit);
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    if (this.failSummaryWrites > 0) {
      this.failSummaryWrites -= 1;
      throw new Error("summary write failed");
    }
    for (const summary of summaries) {
      const existing = this.summaries.get(summary.summaryId);
      this.summaries.set(summary.summaryId, {
        ...summary,
        createdAt: existing?.createdAt ?? summary.createdAt,
      });
    }
  }

  async querySummaries(input: {
    userId?: string;
    pageSize?: number;
  }): Promise<MemorySummaryRecord[]> {
    return [...this.summaries.values()]
      .filter((summary) => !input.userId || summary.userId === input.userId)
      .slice(0, input.pageSize);
  }

  async hardDeleteArchived(): Promise<number> {
    return this.hardDeleted;
  }
}

function rawMessage(
  messageId: string,
  input: {
    relationValue?: string;
    sourceIdentity?: string;
    applicability?: Record<string, unknown>;
    timestamp?: number;
  } = {},
): RawMessage {
  return {
    messageId,
    platform: "slack",
    botId: "bot-1",
    userId: OWNER.userId,
    timestamp: input.timestamp ?? Math.floor(NOW / 1000),
    content: `User language preference: ${input.relationValue ?? "zh"}`,
    attachments: [],
    metadata: {
      relationGroup: "language",
      relationValue: input.relationValue ?? "zh",
      sourceIdentity: input.sourceIdentity ?? `source:${messageId}`,
      memoryApplicability: input.applicability ?? { scope: "global" },
    },
    createdAt: input.timestamp ?? Math.floor(NOW / 1000),
    memoryStage: "short",
  };
}

async function storeEvidence(
  manager: GraphLifecycleTestManager,
  messages: RawMessage[],
  input: { workspaceId?: string; now?: number } = {},
) {
  return storeRawMessagesWithGraphEvolution({
    storage: manager,
    messages,
    graphEvolution: { enabled: true, workspaceId: input.workspaceId },
    now: input.now ?? NOW,
  });
}

async function snapshot(
  manager: GraphLifecycleTestManager,
  ownerScope: OwnerScope = OWNER,
) {
  return createRawMessageMemoryGraphStore({
    storage: manager,
    ownerScope,
    now: () => NOW,
  }).readSnapshot({ ownerScope, includeAuditOnly: true });
}

describe("memory graph lifecycle forgetting runtime", () => {
  it("persists a representative before soft-deprecating stable cluster sources", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("zh-1")], { now: NOW });
    await storeEvidence(
      manager,
      [rawMessage("zh-2", { timestamp: Math.floor(NOW / 1000) + 1 })],
      { now: NOW + 1000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("zh-3", { timestamp: Math.floor(NOW / 1000) + 2 })],
      { now: NOW + 2000 },
    );

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      {
        now: NOW + 3000,
        graphLifecycle: { enabled: true },
      },
    );

    expect(result.graphLifecycle).toEqual(
      expect.objectContaining({
        status: "applied",
        stableClusters: 1,
        createdSummaries: 1,
        deprecatedRecords: 3,
      }),
    );
    const storedSummary = [...manager.summaries.values()][0];
    expect(storedSummary).toEqual(
      expect.objectContaining({
        sourceRecordIds: ["zh-1", "zh-2", "zh-3"],
        messageCount: 3,
      }),
    );
    expect(
      await manager.querySummaries({ userId: OWNER.userId, pageSize: 10 }),
    ).toEqual([storedSummary]);
    const defaultRetrieval = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 1,
    });
    expect(defaultRetrieval.items).toEqual([
      expect.objectContaining({
        sourceType: "summary",
        summary: expect.objectContaining({
          summaryId: storedSummary?.summaryId,
        }),
      }),
    ]);
    const defaultRaw = await manager.queryMessages({
      userId: OWNER.userId,
      includeArchived: false,
      includeDeprecated: false,
    });
    expect(defaultRaw.map((message) => message.messageId)).toEqual([]);
    const auditRaw = await manager.queryMessages({
      userId: OWNER.userId,
      includeArchived: false,
      includeDeprecated: true,
    });
    expect(
      auditRaw.filter((message) => !message.messageId.startsWith("__")),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: "zh-1",
          deprecatedAt: NOW + 3000,
          supersededBySummaryId: storedSummary?.summaryId,
        }),
      ]),
    );
    const graph = await snapshot(manager);
    expect(
      graph.nodes.find((node) => node.id === storedSummary?.summaryId),
    ).toEqual(
      expect.objectContaining({ type: "summary", visibility: "default" }),
    );
    expect(
      graph.nodes
        .filter((node) => ["zh-1", "zh-2", "zh-3"].includes(node.id))
        .every((node) => node.visibility === "audit-only"),
    ).toBe(true);
    expect(graph.clusters[0]).toEqual(
      expect.objectContaining({
        lifecycleStatus: "stable",
        representativeNodeId: storedSummary?.summaryId,
      }),
    );
    const audit = await createRawMessageMemoryGraphStore({
      storage: manager,
      ownerScope: OWNER,
      now: () => NOW,
    }).readAuditTrail({
      ownerScope: OWNER,
      nodeId: storedSummary?.summaryId ?? "",
    });
    expect(audit.sourceNodeIds).toEqual(
      expect.arrayContaining(["zh-1", "zh-2", "zh-3"]),
    );
  });

  it("keeps sources visible when summary persistence fails", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("fail-1")]);
    await storeEvidence(manager, [rawMessage("fail-2")], { now: NOW + 1000 });
    await storeEvidence(manager, [rawMessage("fail-3")], { now: NOW + 2000 });
    manager.failSummaryWrites = 1;

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 3000, graphLifecycle: { enabled: true } },
    );

    expect(result.graphLifecycle?.status).toBe("partial-failure");
    expect(manager.summaries.size).toBe(0);
    expect(
      (
        await manager.queryMessages({
          userId: OWNER.userId,
          includeArchived: false,
          includeDeprecated: false,
        })
      ).filter((message) => !message.messageId.startsWith("__")),
    ).toHaveLength(3);
    expect(
      (await snapshot(manager)).clusters[0].representativeNodeId,
    ).toBeUndefined();
  });

  it("does not deprecate sources when representative graph persistence fails", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("representative-fail-1")]);
    await storeEvidence(manager, [rawMessage("representative-fail-2")], {
      now: NOW + 1000,
    });
    await storeEvidence(manager, [rawMessage("representative-fail-3")], {
      now: NOW + 2000,
    });
    manager.failLedgerWriteNumbers.add(manager.ledgerWriteCount + 2);

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 3000, graphLifecycle: { enabled: true } },
    );

    expect(result.graphLifecycle?.status).toBe("partial-failure");
    expect(manager.summaries.size).toBe(1);
    expect(
      manager.messages.get("representative-fail-1")?.deprecatedAt,
    ).toBeUndefined();
    expect(
      (await snapshot(manager)).clusters[0].representativeNodeId,
    ).toBeUndefined();
  });

  it("retries a partial deprecation failure without duplicating the summary", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("retry-1")]);
    await storeEvidence(manager, [rawMessage("retry-2")], { now: NOW + 1000 });
    await storeEvidence(manager, [rawMessage("retry-3")], { now: NOW + 2000 });
    manager.failDeprecationWrites = 1;

    const failed = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 3000, graphLifecycle: { enabled: true } },
    );
    expect(failed.graphLifecycle?.status).toBe("partial-failure");
    expect(manager.summaries.size).toBe(1);
    expect(manager.messages.get("retry-1")?.deprecatedAt).toBeUndefined();

    const retried = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 4000, graphLifecycle: { enabled: true } },
    );
    expect(retried.graphLifecycle?.status).toBe("applied");
    expect(manager.summaries.size).toBe(1);
    expect(manager.messages.get("retry-1")?.deprecatedAt).toBe(NOW + 4000);

    const replay = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 5000, graphLifecycle: { enabled: true } },
    );
    expect(replay.graphLifecycle?.status).toBe("no-op");
    expect(manager.messages.get("retry-1")?.deprecatedAt).toBe(NOW + 4000);
  });

  it("keeps summaries and raw visibility when the adapter cannot deprecate", async () => {
    const manager = new GraphLifecycleTestManager({
      supportsDeprecation: false,
    });
    await storeEvidence(manager, [rawMessage("no-adapter-1")]);
    await storeEvidence(manager, [rawMessage("no-adapter-2")], {
      now: NOW + 1000,
    });
    await storeEvidence(manager, [rawMessage("no-adapter-3")], {
      now: NOW + 2000,
    });

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 3000, graphLifecycle: { enabled: true } },
    );

    expect(result.graphLifecycle).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        createdSummaries: 1,
        deprecatedRecords: 0,
        reasonCodes: expect.arrayContaining([
          "adapter_missing_deprecate_records",
        ]),
      }),
    );
    expect(manager.messages.get("no-adapter-1")?.deprecatedAt).toBeUndefined();
    const graph = await snapshot(manager);
    expect(
      graph.nodes.find((node) => node.id === "no-adapter-1")?.visibility,
    ).toBe("default");
  });

  it("supersedes sustained same-context competition but preserves contextual exceptions", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [
      rawMessage("global-zh", { relationValue: "zh" }),
    ]);
    await storeEvidence(
      manager,
      [
        rawMessage("task-en", {
          relationValue: "en",
          applicability: { scope: "task", key: "task-42" },
        }),
      ],
      { now: NOW + 1000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("global-en-1", { relationValue: "en" })],
      { now: NOW + 2000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("global-en-2", { relationValue: "en" })],
      { now: NOW + 3000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("global-en-3", { relationValue: "en" })],
      { now: NOW + 4000 },
    );

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 5000, graphLifecycle: { enabled: true } },
    );

    expect(result.graphLifecycle?.createdSummaries).toBe(1);
    const graph = await snapshot(manager);
    const taskCluster = graph.clusters.find((cluster) =>
      cluster.nodeIds.includes("task-en"),
    );
    const oldGlobalCluster = graph.clusters.find((cluster) =>
      cluster.nodeIds.includes("global-zh"),
    );
    const newGlobalCluster = graph.clusters.find((cluster) =>
      cluster.nodeIds.includes("global-en-1"),
    );
    expect(taskCluster?.lifecycleStatus).toBe("forming");
    expect(oldGlobalCluster?.lifecycleStatus).toBe("superseded");
    expect(newGlobalCluster).toEqual(
      expect.objectContaining({
        lifecycleStatus: "stable",
        representativeNodeId: expect.any(String),
      }),
    );
    expect(manager.messages.get("global-zh")?.deprecationReason).toMatch(
      /^superseded_by_summary:/,
    );
    expect(manager.messages.get("global-en-1")?.deprecationReason).toMatch(
      /^summarized_into:/,
    );
  });

  it("resolves all alternatives in a connected multi-way competition", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [
      rawMessage("multi-zh", { relationValue: "zh" }),
    ]);
    await storeEvidence(
      manager,
      [rawMessage("multi-en", { relationValue: "en" })],
      { now: NOW + 1000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("multi-ja-1", { relationValue: "ja" })],
      { now: NOW + 2000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("multi-ja-2", { relationValue: "ja" })],
      { now: NOW + 3000 },
    );
    await storeEvidence(
      manager,
      [rawMessage("multi-ja-3", { relationValue: "ja" })],
      { now: NOW + 4000 },
    );

    const result = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 5000, graphLifecycle: { enabled: true } },
    );
    expect(result.graphLifecycle?.createdSummaries).toBe(1);
    const graph = await snapshot(manager);
    expect(
      graph.clusters.find((cluster) => cluster.nodeIds.includes("multi-zh"))
        ?.lifecycleStatus,
    ).toBe("superseded");
    expect(
      graph.clusters.find((cluster) => cluster.nodeIds.includes("multi-en"))
        ?.lifecycleStatus,
    ).toBe("superseded");
    expect(
      graph.clusters.find((cluster) => cluster.nodeIds.includes("multi-ja-1")),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: "stable",
        representativeNodeId: expect.any(String),
      }),
    );
  });

  it("supports dry-run, owner-scope isolation, and stale singleton decay", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("workspace-a")], {
      workspaceId: "workspace-a",
      now: NOW,
    });

    const wrongScope = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      {
        now: NOW + 1000,
        graphLifecycle: { enabled: true, workspaceId: "workspace-b" },
      },
    );
    expect(wrongScope.graphLifecycle).toEqual(
      expect.objectContaining({ status: "no-op", scannedClusters: 0 }),
    );

    const dryRun = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      {
        dryRun: true,
        now: NOW + 2000,
        graphLifecycle: {
          enabled: true,
          workspaceId: "workspace-a",
          decayAfterMs: 0,
        },
      },
    );
    expect(dryRun.graphLifecycle).toEqual(
      expect.objectContaining({
        status: "planned",
        decayingClusters: 1,
        createdSummaries: 0,
      }),
    );
    expect(manager.summaries.size).toBe(0);
    expect(
      (
        await snapshot(manager, {
          userId: OWNER.userId,
          workspaceId: "workspace-a",
        })
      ).clusters[0].lifecycleStatus,
    ).toBe("forming");
    expect(
      manager.messages.has(
        memoryGraphLedgerMessageId({
          userId: OWNER.userId,
          workspaceId: "workspace-a",
        }),
      ),
    ).toBe(true);
  });

  it("applies the same lifecycle transition again after an explicit reset", async () => {
    const manager = new GraphLifecycleTestManager();
    await storeEvidence(manager, [rawMessage("repeat-decay")], { now: NOW });

    const firstDecay = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      {
        now: NOW + 1000,
        graphLifecycle: { enabled: true, decayAfterMs: 0 },
      },
    );
    expect(firstDecay.graphLifecycle?.status).toBe("applied");

    const graphStore = createRawMessageMemoryGraphStore({
      storage: manager,
      ownerScope: OWNER,
      now: () => NOW + 2000,
    });
    const decayed = await graphStore.readSnapshot({
      ownerScope: OWNER,
      includeAuditOnly: true,
    });
    const cluster = decayed.clusters[0];
    expect(cluster.lifecycleStatus).toBe("decaying");
    await graphStore.persistPlan({
      planId: "test-reset-lifecycle",
      ownerScope: OWNER,
      candidateNodes: [],
      candidateEdges: [],
      candidateClusters: [{ ...cluster, lifecycleStatus: "forming" }],
      operations: [
        {
          operationId: "test-reset-lifecycle-operation",
          ownerScope: OWNER,
          kind: "set-cluster-lifecycle",
          nodeIds: [...cluster.nodeIds],
          clusterId: cluster.clusterId,
          fromStatus: "decaying",
          toStatus: "forming",
          reasonCodes: ["test_explicit_reset"],
        },
      ],
      expectedVersion: decayed.version,
      persistence: { mode: "write", enabled: true },
      reasonCodes: ["test_explicit_reset"],
    });

    const repeatedDecay = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      {
        now: NOW + 3000,
        graphLifecycle: { enabled: true, decayAfterMs: 0 },
      },
    );
    expect(repeatedDecay.graphLifecycle?.status).toBe("applied");
    expect((await snapshot(manager)).clusters[0].lifecycleStatus).toBe(
      "decaying",
    );
  });
});
