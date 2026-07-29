import {
  type MemorySummaryRecord,
  type RawMessage,
  type RawMessageGraphGovernanceStorage,
  type RawMessageMemoryGraphCorrectionCommand,
  type RawMessageMemoryGraphRollbackCommand,
  type RawMessageQuery,
  createRawMessageMemoryGraphStore,
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
  runMemoryGraphRolloutEvaluation,
  runMemoryGraphCorrection as runTrustedMemoryGraphCorrection,
  runMemoryGraphRollback as runTrustedMemoryGraphRollback,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import {
  type MemoryGraphSnapshot,
  type OwnerScope,
  buildGraphAwareRetrievalDryRun,
  buildMemoryGraphCorrectionPlan,
} from "@openloomi/memory-consolidation";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const OWNER = { userId: "user-1" } satisfies OwnerScope;

type LegacyCommandScope = {
  requestedBy?: string;
  workspaceId?: string;
  tenantId?: string;
};

function trustedCommandInput<
  T extends
    | RawMessageMemoryGraphCorrectionCommand
    | RawMessageMemoryGraphRollbackCommand,
>(userId: string, command: T & LegacyCommandScope) {
  const { requestedBy, workspaceId, tenantId, ...trustedCommand } = command;
  return {
    trustedContext: {
      ownerScope: { userId, workspaceId, tenantId },
      requestedBy: requestedBy ?? userId,
    },
    command: trustedCommand as T,
  };
}

function runMemoryGraphCorrection(input: {
  storage: RawMessageGraphGovernanceStorage;
  userId: string;
  command: RawMessageMemoryGraphCorrectionCommand & LegacyCommandScope;
  now?: number;
}) {
  return runTrustedMemoryGraphCorrection({
    storage: input.storage,
    now: input.now,
    ...trustedCommandInput(input.userId, input.command),
  });
}

function runMemoryGraphRollback(input: {
  storage: RawMessageGraphGovernanceStorage;
  userId: string;
  command: RawMessageMemoryGraphRollbackCommand & LegacyCommandScope;
  now?: number;
}) {
  return runTrustedMemoryGraphRollback({
    storage: input.storage,
    now: input.now,
    ...trustedCommandInput(input.userId, input.command),
  });
}

class GovernanceRuntimeTestManager {
  readonly messages = new Map<string, RawMessage>();
  readonly summaries = new Map<string, MemorySummaryRecord>();
  nextId = 1;
  failRestoreWrites = 0;
  restoreWriteCount = 0;
  readonly failRestoreWriteNumbers = new Set<number>();
  noopRestoreWrites = 0;
  failLedgerWrites = 0;
  summaryWriteCount = 0;
  readonly failSummaryWriteNumbers = new Set<number>();
  restoreDeprecatedMessages?: (
    messageIds: string[],
    input: { userId?: string; supersededBySummaryId?: string },
  ) => Promise<number>;

  constructor(input: { supportsRestore?: boolean } = {}) {
    if (input.supportsRestore !== false) {
      this.restoreDeprecatedMessages = async (messageIds, options) => {
        this.restoreWriteCount += 1;
        if (this.failRestoreWriteNumbers.has(this.restoreWriteCount)) {
          throw new Error("restore write failed");
        }
        if (this.failRestoreWrites > 0) {
          this.failRestoreWrites -= 1;
          throw new Error("restore write failed");
        }
        if (this.noopRestoreWrites > 0) {
          this.noopRestoreWrites -= 1;
          return 0;
        }
        let changed = 0;
        for (const messageId of messageIds) {
          const message = this.messages.get(messageId);
          if (
            !message ||
            message.deprecatedAt === undefined ||
            (options.userId && message.userId !== options.userId) ||
            (options.supersededBySummaryId &&
              message.supersededBySummaryId !== options.supersededBySummaryId)
          ) {
            continue;
          }
          const restored = { ...message };
          restored.deprecatedAt = undefined;
          restored.deprecationReason = undefined;
          restored.supersededBySummaryId = undefined;
          this.messages.set(messageId, restored);
          changed += 1;
        }
        return changed;
      };
    }
  }

  async storeMessage(message: RawMessage): Promise<number> {
    if (
      message.content === "OpenLoomi internal memory graph ledger" &&
      this.failLedgerWrites > 0
    ) {
      this.failLedgerWrites -= 1;
      throw new Error("ledger write failed");
    }
    const existing = this.messages.get(message.messageId);
    const id = existing?.id ?? this.nextId++;
    this.messages.set(message.messageId, { ...message, id });
    return id;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    return Promise.all(messages.map((message) => this.storeMessage(message)));
  }

  async compareAndSwapGraphLedger(
    message: RawMessage,
    input: { expectedVersion: string; metadataKey: string },
  ): Promise<boolean> {
    const current = this.messages.get(message.messageId);
    const ledger = current?.metadata?.[input.metadataKey] as
      | { snapshot?: { version?: unknown } }
      | undefined;
    const currentVersion =
      typeof ledger?.snapshot?.version === "string"
        ? ledger.snapshot.version
        : "0";
    if (currentVersion !== input.expectedVersion) return false;
    await this.storeMessage(message);
    return true;
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
    messages.sort((left, right) => right.timestamp - left.timestamp);
    return messages.slice(
      query.offset ?? 0,
      (query.offset ?? 0) + (query.limit ?? query.pageSize ?? messages.length),
    );
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    this.summaryWriteCount += 1;
    if (this.failSummaryWriteNumbers.has(this.summaryWriteCount)) {
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
    summaryIds?: string[];
    pageSize?: number;
  }): Promise<MemorySummaryRecord[]> {
    return [...this.summaries.values()]
      .filter(
        (summary) =>
          (!input.userId || summary.userId === input.userId) &&
          (!input.summaryIds || input.summaryIds.includes(summary.summaryId)),
      )
      .slice(0, input.pageSize);
  }

  async deprecateMessages(
    messageIds: string[],
    input: {
      userId?: string;
      deprecatedAt?: number;
      reason?: string;
      supersededBySummaryId?: string;
    } = {},
  ): Promise<number> {
    let changed = 0;
    for (const messageId of messageIds) {
      const message = this.messages.get(messageId);
      if (
        !message ||
        message.deprecatedAt !== undefined ||
        (input.userId && message.userId !== input.userId)
      ) {
        continue;
      }
      this.messages.set(messageId, {
        ...message,
        deprecatedAt: input.deprecatedAt ?? Date.now(),
        deprecationReason: input.reason,
        supersededBySummaryId: input.supersededBySummaryId,
      });
      changed += 1;
    }
    return changed;
  }

  async searchMessagesSemantically(input: {
    userId: string;
    includeArchived?: boolean;
    includeDeprecated?: boolean;
  }): Promise<unknown[]> {
    return [...this.messages.values()]
      .filter(
        (message) =>
          message.userId === input.userId &&
          !message.messageId.startsWith("__") &&
          (input.includeArchived || message.archivedAt === undefined) &&
          (input.includeDeprecated || message.deprecatedAt === undefined),
      )
      .map((message) => ({ message, similarity: 1 }));
  }

  async hardDeleteArchived(): Promise<number> {
    return 0;
  }

  async markMessagesAccessed(): Promise<number> {
    return 0;
  }
}

function rawMessage(
  messageId: string,
  input: {
    relationValue?: string;
    sourceIdentity?: string;
    applicability?: Record<string, unknown>;
    timestamp?: number;
    userId?: string;
  } = {},
): RawMessage {
  return {
    messageId,
    platform: "slack",
    botId: "bot-1",
    userId: input.userId ?? OWNER.userId,
    timestamp: input.timestamp ?? Math.floor(NOW / 1000),
    content: `User language preference: ${input.relationValue ?? "zh"}`,
    attachments: [],
    metadata: {
      relationGroup: "language",
      relationValue: input.relationValue ?? "zh",
      sourceIdentity: input.sourceIdentity ?? `source:${messageId}`,
      memoryApplicability: input.applicability ?? { scope: "global" },
    },
    embedding: [1, 0],
    embeddingModel: "test",
    createdAt: input.timestamp ?? Math.floor(NOW / 1000),
    memoryStage: "short",
  };
}

async function storeEvidence(
  manager: GovernanceRuntimeTestManager,
  messages: RawMessage[],
  now = NOW,
  ownerScope: OwnerScope = OWNER,
) {
  return storeRawMessagesWithGraphEvolution({
    storage: manager,
    messages,
    graphEvolution: {
      enabled: true,
      workspaceId: ownerScope.workspaceId,
      tenantId: ownerScope.tenantId,
    },
    now,
  });
}

async function graph(
  manager: GovernanceRuntimeTestManager,
  scope: OwnerScope = OWNER,
) {
  return createRawMessageMemoryGraphStore({
    storage: manager,
    ownerScope: scope,
    now: () => NOW,
  }).readSnapshot({ ownerScope: scope, includeAuditOnly: true });
}

async function seedConsolidated(
  manager: GovernanceRuntimeTestManager,
  ownerScope: OwnerScope = OWNER,
) {
  await storeEvidence(manager, [rawMessage("zh-1")], NOW, ownerScope);
  await storeEvidence(
    manager,
    [rawMessage("zh-2", { timestamp: Math.floor(NOW / 1000) + 1 })],
    NOW + 1000,
    ownerScope,
  );
  await storeEvidence(
    manager,
    [rawMessage("zh-3", { timestamp: Math.floor(NOW / 1000) + 2 })],
    NOW + 2000,
    ownerScope,
  );
  const lifecycle = await runMemoryForgettingCycle(
    manager as never,
    ownerScope.userId,
    {
      now: NOW + 3000,
      graphLifecycle: {
        enabled: true,
        workspaceId: ownerScope.workspaceId,
        tenantId: ownerScope.tenantId,
      },
    },
  );
  const summary = [...manager.summaries.values()][0];
  const snapshot = await graph(manager, ownerScope);
  if (!summary || !snapshot.clusters[0]) {
    throw new Error("expected consolidated graph fixture");
  }
  expect(lifecycle.graphLifecycle?.status).toBe("applied");
  return { summary, cluster: snapshot.clusters[0], snapshot };
}

describe("memory graph correction, rollback, and rollout runtime", () => {
  it("corrects an incorrect merge without deleting graph history", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster } = await seedConsolidated(manager);
    for (const [id, supersededBySummaryId] of [
      ["zh-1", "summary-group-a"],
      ["zh-2", "summary-group-a"],
      ["zh-3", "summary-group-b"],
    ] as const) {
      const message = manager.messages.get(id);
      if (!message) throw new Error("expected deprecated source evidence");
      manager.messages.set(id, { ...message, supersededBySummaryId });
    }
    manager.failRestoreWriteNumbers.add(manager.restoreWriteCount + 2);
    const partial = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "remove-incorrect-member",
        reason: "The third observation belongs to a separate context",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    expect(partial.status).toBe("partial-failure");
    expect(partial.restoredRecords).toBe(1);
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeDefined();
    expect(manager.messages.get("zh-2")?.deprecatedAt).toBeDefined();
    expect(manager.messages.get("zh-3")?.deprecatedAt).toBeUndefined();
    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command: {
        commandId: "remove-incorrect-member",
        reason: "The third observation belongs to a separate context",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    expect(result.status).toBe("applied");
    expect(result.restoredRecords).toBe(2);
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeUndefined();
    }
    const snapshot = await graph(manager);
    expect(
      snapshot.clusters.find((item) => item.clusterId === cluster.clusterId)
        ?.nodeIds,
    ).not.toContain("zh-3");
    expect(
      snapshot.clusters.find((item) => item.nodeIds.includes("zh-3")),
    ).toEqual(
      expect.objectContaining({
        lifecycleStatus: "forming",
        metadata: expect.objectContaining({
          correctedFromClusterId: cluster.clusterId,
        }),
      }),
    );
    expect(
      snapshot.edges.some(
        (edge) =>
          (edge.fromNodeId === "zh-3" || edge.toNodeId === "zh-3") &&
          edge.metadata?.inactive === true,
      ),
    ).toBe(true);
    expect(
      snapshot.nodes.find((node) => node.id === cluster.representativeNodeId)
        ?.visibility,
    ).toBe("audit-only");
    expect(
      snapshot.clusters.find((item) => item.clusterId === cluster.clusterId)
        ?.representativeNodeId,
    ).toBeUndefined();
    const operations = await createRawMessageMemoryGraphStore({
      storage: manager,
      ownerScope: OWNER,
    }).readAppliedOperations({ ownerScope: OWNER, nodeId: "zh-3" });
    expect(operations.map((operation) => operation.kind)).toContain(
      "remove-cluster-member",
    );
  });

  it("persists a corrected summary as representative and keeps the old summary audit-only", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "correct-summary-content",
        reason: "The generated summary overstated the preference",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "The user generally prefers Chinese responses.",
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "applied",
        summaryId: expect.any(String),
      }),
    );
    expect(manager.summaries.get(result.summaryId ?? "")?.summaryText).toBe(
      "The user generally prefers Chinese responses.",
    );
    const snapshot = await graph(manager);
    expect(snapshot.clusters[0].representativeNodeId).toBe(result.summaryId);
    expect(
      snapshot.nodes.find((node) => node.id === summary.summaryId)?.visibility,
    ).toBe("audit-only");
    expect(
      snapshot.nodes.find((node) => node.id === result.summaryId)?.visibility,
    ).toBe("default");
    const retrieval = buildGraphAwareRetrievalDryRun({
      ownerScope: OWNER,
      query: "language preference",
      baselineNodeIds: snapshot.nodes.map((node) => node.id),
      snapshot,
      visibilityMode: "default",
    });
    expect(retrieval.rankedNodeIds).toContain(result.summaryId);
    expect(retrieval.rankedNodeIds).not.toContain(summary.summaryId);
    expect(result.auditTrail?.sourceNodeIds).toEqual(
      expect.arrayContaining(["zh-1", "zh-2", "zh-3"]),
    );
    const correctionOperations = await createRawMessageMemoryGraphStore({
      storage: manager,
      ownerScope: OWNER,
    }).readAppliedOperations({ ownerScope: OWNER, nodeId: result.summaryId });
    expect(correctionOperations[0]?.metadata).toEqual(
      expect.objectContaining({ previousSummaryText: summary.summaryText }),
    );
  });

  it("rolls back a corrected summary through its original source linkage", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const corrected = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "correct-summary-before-rollback",
        reason: "Use reviewed wording before testing recovery",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "The user generally prefers Chinese responses.",
        },
      },
    });
    if (!corrected.summaryId) {
      throw new Error("expected a persisted corrected summary");
    }

    const rollback = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command: {
        commandId: "rollback-corrected-summary",
        reason: "Restore the original evidence and representative",
        summaryId: corrected.summaryId,
      },
    });

    expect(rollback).toEqual(
      expect.objectContaining({ status: "applied", restoredRecords: 3 }),
    );
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeUndefined();
    }
    const snapshot = await graph(manager);
    expect(
      snapshot.nodes.find((node) => node.id === summary.summaryId)?.visibility,
    ).toBe("default");
    expect(
      snapshot.nodes.find((node) => node.id === corrected.summaryId)
        ?.visibility,
    ).toBe("audit-only");
    expect(
      snapshot.clusters.find((item) => item.clusterId === cluster.clusterId)
        ?.representativeNodeId,
    ).toBe(summary.summaryId);
  });

  it("reports partial corrected-summary restoration and converges on retry", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const corrected = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "correct-summary-before-partial-rollback",
        reason: "Use reviewed wording before testing partial recovery",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "The user generally prefers Chinese responses.",
        },
      },
    });
    if (!corrected.summaryId) {
      throw new Error("expected a persisted corrected summary");
    }
    const command = {
      commandId: "rollback-corrected-summary-after-partial-restore",
      reason: "Retry after the second restoration group fails",
      summaryId: corrected.summaryId,
    };
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      const message = manager.messages.get(id);
      if (!message) throw new Error("expected deprecated source evidence");
      manager.messages.set(id, {
        ...message,
        supersededBySummaryId: corrected.summaryId,
      });
    }
    manager.failRestoreWriteNumbers.add(manager.restoreWriteCount + 2);

    const partial = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command,
    });

    expect(partial).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        restoredRecords: 3,
        reasonCodes: ["memory_graph_restore_deprecated_messages_failed"],
      }),
    );
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeUndefined();
    }
    expect(
      (await graph(manager)).nodes.find(
        (node) => node.id === corrected.summaryId,
      )?.visibility,
    ).toBe("default");

    const retried = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 6000,
      command,
    });

    expect(retried.status).toBe("applied");
    expect(retried.restoredRecords).toBe(0);
    const snapshot = await graph(manager);
    expect(
      snapshot.nodes.find((node) => node.id === summary.summaryId)?.visibility,
    ).toBe("default");
    expect(
      snapshot.nodes.find((node) => node.id === corrected.summaryId)
        ?.visibility,
    ).toBe("audit-only");
  });

  it("keeps a corrected summary pending until its graph commit succeeds", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const command = {
      commandId: "retry-corrected-summary-publication",
      reason: "Keep the correction hidden until graph persistence succeeds",
      action: {
        type: "correct-summary" as const,
        clusterId: cluster.clusterId,
        summaryId: summary.summaryId,
        correctedSummaryId: "pending-corrected-summary",
        correctedContent: "The user prefers Chinese responses after review.",
      },
    };

    manager.failLedgerWrites = 1;
    const failed = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command,
    });
    expect(failed.status).toBe("failed");
    const pendingRecall = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 10,
    });
    expect(
      pendingRecall.items.some(
        (item) =>
          item.sourceType === "summary" &&
          item.summary.summaryId === "pending-corrected-summary",
      ),
    ).toBe(false);
    const pendingBeforeConflict = manager.summaries.get(
      "pending-corrected-summary",
    );
    const conflictingRetry = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4500,
      command: {
        ...command,
        action: {
          ...command.action,
          correctedContent: "A different correction must not reuse this ID.",
        },
      },
    });
    expect(conflictingRetry).toEqual(
      expect.objectContaining({
        status: "conflict",
        reasonCodes: ["memory_graph_command_id_payload_conflict"],
      }),
    );
    expect(manager.summaries.get("pending-corrected-summary")).toEqual(
      pendingBeforeConflict,
    );
    expect(
      (await graph(manager)).nodes.some(
        (node) => node.id === "pending-corrected-summary",
      ),
    ).toBe(false);

    const retried = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command,
    });
    expect(retried.status).toBe("applied");
    const publishedRecall = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 10,
    });
    expect(
      publishedRecall.items.some(
        (item) =>
          item.sourceType === "summary" &&
          item.summary.summaryId === "pending-corrected-summary",
      ),
    ).toBe(true);
  });

  it("retries corrected summary publication after its graph commit", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const command = {
      commandId: "retry-corrected-summary-after-graph-commit",
      reason: "Keep the correction pending until the summary publish retry",
      action: {
        type: "correct-summary" as const,
        clusterId: cluster.clusterId,
        summaryId: summary.summaryId,
        correctedSummaryId: "publish-after-graph-retry",
        correctedContent: "The reviewed preference is Chinese responses.",
      },
    };

    manager.failSummaryWriteNumbers.add(manager.summaryWriteCount + 2);
    const failed = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command,
    });
    expect(failed).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        reasonCodes: expect.arrayContaining([
          "memory_graph_corrected_summary_publication_failed",
        ]),
      }),
    );
    expect((await graph(manager)).clusters[0].representativeNodeId).toBe(
      "publish-after-graph-retry",
    );
    const pendingRecall = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 10,
    });
    expect(
      pendingRecall.items.some(
        (item) =>
          item.sourceType === "summary" &&
          item.summary.summaryId === "publish-after-graph-retry",
      ),
    ).toBe(false);

    const retried = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command,
    });
    expect(retried.status).toBe("replayed");
    const publishedRecall = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 10,
    });
    expect(
      publishedRecall.items.some(
        (item) =>
          item.sourceType === "summary" &&
          item.summary.summaryId === "publish-after-graph-retry",
      ),
    ).toBe(true);
  });

  it("applies explicit lifecycle and preferred-representative corrections", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const corrected = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "representative-candidate",
        reason: "Create a reviewed representative",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "Reviewed language preference.",
        },
      },
    });
    const lifecycle = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command: {
        commandId: "mark-cluster-active",
        reason: "Keep this cluster active during review",
        action: {
          type: "set-lifecycle",
          clusterId: cluster.clusterId,
          lifecycleStatus: "active",
        },
      },
    });
    expect(lifecycle.status).toBe("applied");
    expect((await graph(manager)).clusters[0].lifecycleStatus).toBe("active");

    const preferred = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 6000,
      command: {
        commandId: "restore-reviewed-preference",
        reason: "The original summary is the preferred reviewed wording",
        action: {
          type: "set-representative",
          clusterId: cluster.clusterId,
          representativeNodeId: summary.summaryId,
        },
      },
    });
    expect(preferred.status).toBe("applied");
    const snapshot = await graph(manager);
    expect(snapshot.clusters[0].representativeNodeId).toBe(summary.summaryId);
    expect(
      snapshot.nodes.find((node) => node.id === summary.summaryId)?.visibility,
    ).toBe("default");
    expect(
      snapshot.nodes.find((node) => node.id === corrected.summaryId)
        ?.visibility,
    ).toBe("audit-only");
  });

  it("rolls back persisted consolidation, restores raw retrieval, and is idempotent", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { summary, snapshot: initialSnapshot } =
      await seedConsolidated(manager);
    const first = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "rollback-consolidation",
        reason: "The consolidation must be reversed for review",
        expectedVersion: initialSnapshot.version,
        summaryId: summary.summaryId,
      },
    });

    expect(first).toEqual(
      expect.objectContaining({ status: "applied", restoredRecords: 3 }),
    );
    expect(first.sourceRecordIds).toEqual(
      expect.arrayContaining(["zh-1", "zh-2", "zh-3"]),
    );
    expect(first.auditTrail?.sourceNodeIds).toEqual(
      expect.arrayContaining(["zh-1", "zh-2", "zh-3"]),
    );
    expect(first.auditTrail?.operationIds.length).toBeGreaterThan(0);
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeUndefined();
    }
    const snapshot = await graph(manager);
    expect(
      snapshot.nodes.find((node) => node.id === summary.summaryId)?.visibility,
    ).toBe("audit-only");
    expect(
      snapshot.nodes
        .filter((node) => node.type === "raw")
        .every((node) => node.visibility === "default"),
    ).toBe(true);
    const defaultMemory = await queryMemoryWithFallback(manager as never, {
      userId: OWNER.userId,
      limit: 10,
      minRawResultsWithoutFallback: 1,
    });
    expect(defaultMemory.items.every((item) => item.sourceType === "raw")).toBe(
      true,
    );
    const replay = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command: {
        commandId: "rollback-consolidation",
        reason: "The consolidation must be reversed for review",
        expectedVersion: initialSnapshot.version,
        summaryId: summary.summaryId,
      },
    });
    expect(["no-op", "replayed"]).toContain(replay.status);
    expect(replay.restoredRecords).toBe(0);
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeUndefined();
  });

  it("rejects stale, colliding, and cross-scope rollback commands before recovery", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { summary, snapshot } = await seedConsolidated(manager);
    const before = await graph(manager);

    const stale = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stale-rollback",
        reason: "Reject stale operator state",
        expectedVersion: String(Number(snapshot.version ?? "0") - 1),
        summaryId: summary.summaryId,
      },
    });
    expect(stale).toEqual(
      expect.objectContaining({
        status: "conflict",
        reasonCodes: ["memory_graph_version_conflict"],
      }),
    );
    expect(await graph(manager)).toEqual(before);
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeDefined();

    const wrongScope = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "cross-scope-rollback",
        reason: "Reject another workspace",
        workspaceId: "workspace-b",
        summaryId: summary.summaryId,
      },
    });
    expect(wrongScope).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: ["memory_graph_rollback_source_records_not_found"],
      }),
    );
    expect(await graph(manager)).toEqual(before);
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeDefined();

    const applied = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stable-rollback-command",
        reason: "Apply reviewed rollback",
        summaryId: summary.summaryId,
      },
    });
    expect(applied.status).toBe("applied");
    const afterApplied = await graph(manager);

    const collision = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stable-rollback-command",
        reason: "Different reason under the same command id",
        summaryId: summary.summaryId,
      },
    });
    expect(collision).toEqual(
      expect.objectContaining({
        status: "conflict",
        reasonCodes: ["memory_graph_command_id_payload_conflict"],
      }),
    );
    expect(await graph(manager)).toEqual(afterApplied);
  });

  it("hides a superseded summary by default and restores it on rollback", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { summary: oldSummary } = await seedConsolidated(manager);
    await storeEvidence(
      manager,
      [rawMessage("en-1", { relationValue: "en" })],
      NOW + 4000,
    );
    await storeEvidence(
      manager,
      [rawMessage("en-2", { relationValue: "en" })],
      NOW + 5000,
    );
    await storeEvidence(
      manager,
      [rawMessage("en-3", { relationValue: "en" })],
      NOW + 6000,
    );
    const lifecycle = await runMemoryForgettingCycle(
      manager as never,
      OWNER.userId,
      { now: NOW + 7000, graphLifecycle: { enabled: true } },
    );
    expect(lifecycle.graphLifecycle?.createdSummaries).toBe(1);
    const superseded = await graph(manager);
    const newSummary = superseded.nodes.find(
      (node) =>
        node.type === "summary" &&
        node.id !== oldSummary.summaryId &&
        node.visibility === "default",
    );
    expect(newSummary).toBeDefined();
    const supersededCluster = superseded.clusters.find(
      (cluster) => cluster.representativeNodeId === oldSummary.summaryId,
    );
    expect(supersededCluster).toEqual(
      expect.objectContaining({
        lifecycleStatus: "superseded",
        metadata: expect.objectContaining({
          supersededBySummaryId: newSummary?.id,
        }),
      }),
    );
    expect(
      superseded.nodes.find((node) => node.id === oldSummary.summaryId)
        ?.visibility,
    ).toBe("audit-only");
    expect(
      superseded.edges.some(
        (edge) =>
          edge.kind === "supersede" &&
          edge.fromNodeId === oldSummary.summaryId &&
          edge.toNodeId === newSummary?.id,
      ),
    ).toBe(true);
    const defaultRetrieval = buildGraphAwareRetrievalDryRun({
      ownerScope: OWNER,
      query: "language preference",
      baselineNodeIds: superseded.nodes.map((node) => node.id),
      snapshot: superseded,
      visibilityMode: "default",
    });
    expect(defaultRetrieval.rankedNodeIds).toContain(newSummary?.id);
    expect(defaultRetrieval.rankedNodeIds).not.toContain(oldSummary.summaryId);

    const rollback = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 8000,
      command: {
        commandId: "rollback-preference-supersession",
        reason: "Restore the previous reviewed preference",
        summaryId: newSummary?.id ?? "",
      },
    });
    expect(rollback.status).toBe("applied");
    const restored = await graph(manager);
    expect(
      restored.nodes.find((node) => node.id === oldSummary.summaryId)
        ?.visibility,
    ).toBe("default");
    expect(
      restored.nodes.find((node) => node.id === newSummary?.id)?.visibility,
    ).toBe("audit-only");
    const restoredCluster = restored.clusters.find(
      (cluster) => cluster.clusterId === supersededCluster?.clusterId,
    );
    expect(restoredCluster?.lifecycleStatus).toBe("stable");
    expect(restoredCluster?.metadata?.supersededBySummaryId).toBeUndefined();
    expect(restoredCluster?.metadata?.supersededByClusterId).toBeUndefined();
    for (const id of ["zh-1", "zh-2", "zh-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeDefined();
    }
    for (const id of ["en-1", "en-2", "en-3"]) {
      expect(manager.messages.get(id)?.deprecatedAt).toBeUndefined();
    }
  });

  it("keeps the summary active when restore capability is missing or fails", async () => {
    const missing = new GovernanceRuntimeTestManager({
      supportsRestore: false,
    });
    const missingSeed = await seedConsolidated(missing);
    const missingResult = await runMemoryGraphRollback({
      storage: missing,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "rollback-without-adapter",
        reason: "Review rollback",
        summaryId: missingSeed.summary.summaryId,
      },
    });
    expect(missingResult).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        reasonCodes: expect.arrayContaining([
          "adapter_missing_restore_deprecated_messages",
        ]),
      }),
    );
    expect(
      (await graph(missing)).nodes.find(
        (node) => node.id === missingSeed.summary.summaryId,
      )?.visibility,
    ).toBe("default");

    const failing = new GovernanceRuntimeTestManager();
    const failingSeed = await seedConsolidated(failing);
    failing.failRestoreWrites = 1;
    const failed = await runMemoryGraphRollback({
      storage: failing,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "rollback-failing-adapter",
        reason: "Review rollback",
        summaryId: failingSeed.summary.summaryId,
      },
    });
    expect(failed.status).toBe("partial-failure");
    expect(
      (await graph(failing)).nodes.find(
        (node) => node.id === failingSeed.summary.summaryId,
      )?.visibility,
    ).toBe("default");
  });

  it("does not retire the representative when raw restoration makes no progress", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { summary } = await seedConsolidated(manager);
    const command = {
      commandId: "rollback-silent-noop-adapter",
      reason: "Do not retire the representative until raw records are visible",
      summaryId: summary.summaryId,
    };
    manager.noopRestoreWrites = 1;

    const blocked = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command,
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        reasonCodes: ["memory_graph_rollback_source_restore_incomplete"],
      }),
    );
    expect(
      (await graph(manager)).nodes.find((node) => node.id === summary.summaryId)
        ?.visibility,
    ).toBe("default");
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeDefined();

    const retried = await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command,
    });
    expect(retried.status).toBe("applied");
    expect(
      (await graph(manager)).nodes.find((node) => node.id === summary.summaryId)
        ?.visibility,
    ).toBe("audit-only");
    expect(manager.messages.get("zh-1")?.deprecatedAt).toBeUndefined();
  });

  it("replays an applied correction with its original expected version", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, snapshot } = await seedConsolidated(manager);
    const command = {
      commandId: "expected-version-replay",
      reason: "Keep the reviewed lifecycle decision idempotent",
      expectedVersion: snapshot.version,
      action: {
        type: "set-lifecycle" as const,
        clusterId: cluster.clusterId,
        lifecycleStatus: "active" as const,
      },
    };
    const applied = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command,
    });
    expect(applied.status).toBe("applied");

    const replayed = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command,
    });
    expect(replayed.status).toBe("replayed");
    expect((await graph(manager)).clusters[0].lifecycleStatus).toBe("active");
  });

  it("rejects reuse of a correction command id with different content", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary, snapshot } = await seedConsolidated(manager);
    const first = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stable-correction-command",
        reason: "Apply reviewed wording",
        expectedVersion: snapshot.version,
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "First reviewed wording.",
        },
      },
    });
    expect(first.status).toBe("applied");
    const correctedSummaryId = first.summaryId ?? "";

    const collision = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stable-correction-command",
        reason: "Apply reviewed wording",
        expectedVersion: snapshot.version,
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedContent: "Different wording under the same command id.",
        },
      },
    });
    expect(collision).toEqual(
      expect.objectContaining({
        status: "conflict",
        reasonCodes: ["memory_graph_command_id_payload_conflict"],
      }),
    );
    expect(manager.summaries.get(correctedSummaryId)?.summaryText).toBe(
      "First reviewed wording.",
    );
  });

  it("rejects correction identifiers that collide with unrelated graph state", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const before = await graph(manager);

    const clusterCollision = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "separated-cluster-id-collision",
        reason: "Do not overwrite the source cluster",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
          separatedClusterId: cluster.clusterId,
        },
      },
    });
    expect(clusterCollision).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_correction_separated_cluster_id_conflict",
        ]),
      }),
    );

    const nodeCollision = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "corrected-summary-id-collision",
        reason: "Do not overwrite retained raw evidence",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedSummaryId: "zh-1",
          correctedContent: "Reviewed preference.",
        },
      },
    });
    expect(nodeCollision).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_correction_corrected_summary_id_conflict",
        ]),
      }),
    );
    manager.summaries.set("unlinked-summary-store-id", {
      ...summary,
      summaryId: "unlinked-summary-store-id",
      summaryText: "An unrelated retained summary.",
    });
    const summaryStoreCollision = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "corrected-summary-store-id-collision",
        reason: "Do not overwrite an unlinked stored summary",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedSummaryId: "unlinked-summary-store-id",
          correctedContent: "Reviewed preference.",
        },
      },
    });
    expect(summaryStoreCollision).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_correction_corrected_summary_id_conflict",
        ]),
      }),
    );
    expect(
      manager.summaries.get("unlinked-summary-store-id")?.summaryText,
    ).toBe("An unrelated retained summary.");

    expect(await graph(manager)).toEqual(before);
  });

  it("rejects a summary correction sourced from outside the target cluster", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const foreignSummaryId = "foreign-summary";
    manager.summaries.set(foreignSummaryId, {
      ...summary,
      summaryId: foreignSummaryId,
      summaryText: "Unrelated summary content.",
    });

    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "foreign-summary-correction",
        reason: "Reject cross-cluster provenance",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: foreignSummaryId,
          correctedContent: "This must not become the cluster representative.",
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_summary_not_found_or_scope_mismatch",
        ]),
      }),
    );
    expect(manager.summaries.size).toBe(2);
    expect((await graph(manager)).clusters[0].representativeNodeId).toBe(
      summary.summaryId,
    );
  });

  it("rejects stale or cross-scope corrections before dependent mutation", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, snapshot } = await seedConsolidated(manager);
    const before = await graph(manager);
    const stale = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "stale-correction",
        reason: "stale review",
        expectedVersion: String(Number(snapshot.version ?? "0") - 1),
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    expect(stale.status).toBe("conflict");
    expect(await graph(manager)).toEqual(before);

    const wrongCluster = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "wrong-cluster-correction",
        reason: "wrong cluster",
        action: {
          type: "remove-member",
          clusterId: "missing-cluster",
          nodeId: "zh-3",
        },
      },
    });
    expect(wrongCluster.status).toBe("no-op");
    expect(manager.messages.get("zh-3")?.deprecatedAt).toBeDefined();

    const wrongScope = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "wrong-workspace-correction",
        reason: "wrong workspace",
        workspaceId: "workspace-b",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    expect(wrongScope).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining(["memory_graph_scope_mismatch"]),
      }),
    );
    expect(await graph(manager)).toEqual(before);
  });

  it("exposes competing alternatives and builds rollout decisions from persisted evidence", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    await runMemoryGraphRollback({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "evaluation-rollback",
        reason: "Restore raw evidence",
        summaryId: summary.summaryId,
      },
    });
    await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command: {
        commandId: "evaluation-correction",
        reason: "Separate a polluted source",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    const blocked = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "missing-semantic-artifact",
    });
    expect(blocked.report.summary.decision).toBe("blocked");
    expect(blocked.reasonCodes).toContain(
      "memory_graph_required_semantic_eval_artifact_missing",
    );

    const ready = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "persisted-runtime-artifacts",
      queryEmbedding: [1, 0],
      pollutedArtifactIds: ["zh-3"],
    });
    expect(ready.runtimeEvidence.correctionOperationIds.length).toBeGreaterThan(
      0,
    );
    expect(ready.runtimeEvidence.rollbackOperationIds.length).toBeGreaterThan(
      0,
    );
    expect(ready.report.summary.decision).toBe("ready-for-limited-rollout");
    expect(
      ready.report.graphRetrievalScenarios.find(
        (scenario) => scenario.scenarioId === "runtime-audit-retrieval",
      )?.auditTrailNodeIds,
    ).toContain(summary.summaryId);

    const crossScopeSemantic = rawMessage("cross-scope-semantic");
    crossScopeSemantic.metadata = {
      ...(crossScopeSemantic.metadata ?? {}),
      memoryOwnerScope: {
        userId: OWNER.userId,
        workspaceId: "other-workspace",
      },
    };
    await manager.storeMessage(crossScopeSemantic);
    const contaminated = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "semantic-cross-scope-contamination",
      queryEmbedding: [1, 0],
      pollutedArtifactIds: ["zh-3"],
    });
    expect(contaminated.report.summary.decision).toBe("blocked");
    expect(contaminated.report.semanticRetrievalScenarios[0]?.metadata).toEqual(
      expect.objectContaining({
        crossScopeRecordIds: ["cross-scope-semantic"],
      }),
    );

    const competitionManager = new GovernanceRuntimeTestManager();
    await storeEvidence(competitionManager, [rawMessage("global-zh")]);
    await storeEvidence(
      competitionManager,
      [rawMessage("global-en", { relationValue: "en" })],
      NOW + 1000,
    );
    await storeEvidence(
      competitionManager,
      [rawMessage("global-ja", { relationValue: "ja" })],
      NOW + 2000,
    );
    const competition = await graph(competitionManager);
    const conflict = buildGraphAwareRetrievalDryRun({
      ownerScope: OWNER,
      query: "language preference",
      baselineNodeIds: ["global-zh"],
      snapshot: competition,
      visibilityMode: "conflict",
    });
    expect(conflict.reasonCodes).toContain("competing_alternatives_exposed");
    expect(conflict.rankedNodeIds).toEqual(
      expect.arrayContaining(["global-zh", "global-en", "global-ja"]),
    );
  });

  it("does not attach an unlinked summary to a target graph cluster", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const unrelatedSummary = {
      ...summary,
      summaryId: "unlinked-summary",
      sourceRecordIds: ["unlinked-source"],
      summaryText: "Unrelated workspace summary.",
    };
    await manager.upsertSummaries([unrelatedSummary]);
    const before = await graph(manager);
    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "reject-unlinked-summary",
        reason: "The target summary belongs to another graph scope",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: unrelatedSummary.summaryId,
          correctedContent: "This correction must not cross graph scope.",
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_summary_not_found_or_scope_mismatch",
        ]),
      }),
    );
    expect(manager.summaries.get(unrelatedSummary.summaryId)?.summaryText).toBe(
      unrelatedSummary.summaryText,
    );
    expect(await graph(manager)).toEqual(before);
  });
});

describe("memory graph control-plane regressions", () => {
  it("finds a correction target beyond the first summary page", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    manager.summaries.clear();
    for (let index = 0; index < 1000; index += 1) {
      manager.summaries.set(`decoy-summary-${index}`, {
        ...summary,
        summaryId: `decoy-summary-${index}`,
      });
    }
    manager.summaries.set(summary.summaryId, summary);

    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "correct-summary-after-first-page",
        reason: "Resolve the target by id instead of scanning one page",
        action: {
          type: "correct-summary",
          clusterId: cluster.clusterId,
          summaryId: summary.summaryId,
          correctedSummaryId: "corrected-summary-after-first-page",
          correctedContent: "The reviewed preference is Chinese responses.",
        },
      },
    });

    expect(result.status).toBe("applied");
    expect(
      manager.summaries.get("corrected-summary-after-first-page")?.summaryText,
    ).toBe("The reviewed preference is Chinese responses.");
  });

  it("does not treat delimiter-colliding owner scopes as equal", () => {
    const requestedScope = {
      tenantId: "tenant",
      workspaceId: "workspace|segment",
      userId: "user",
    } satisfies OwnerScope;
    const foreignScope = {
      tenantId: "tenant|workspace",
      workspaceId: "segment",
      userId: "user",
    } satisfies OwnerScope;
    const snapshot = {
      ownerScope: requestedScope,
      nodes: [],
      edges: [],
      clusters: [
        {
          clusterId: "foreign-cluster",
          ownerScope: foreignScope,
          nodeIds: [],
          lifecycleStatus: "forming",
          supportScore: 0,
          updatedAt: NOW,
          reasonCodes: [],
        },
      ],
      version: "1",
      capturedAt: NOW,
    } satisfies MemoryGraphSnapshot;

    const plan = buildMemoryGraphCorrectionPlan({
      ownerScope: requestedScope,
      snapshot,
      commandId: "scope-delimiter-collision",
      reason: "Keep tenant and workspace boundaries exact",
      now: NOW,
      persistence: { mode: "write", enabled: true },
      action: {
        type: "set-lifecycle",
        clusterId: "foreign-cluster",
        lifecycleStatus: "active",
      },
    });

    expect(plan.operations).toEqual([]);
    expect(plan.reasonCodes).toContain(
      "memory_graph_correction_cluster_not_found",
    );
  });

  it("keeps retired supersession edges available to audit traversal", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster } = await seedConsolidated(manager);
    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command: {
        commandId: "audit-retired-supersession",
        reason: "Preserve the retired representative chain for audit",
        action: {
          type: "remove-member",
          clusterId: cluster.clusterId,
          nodeId: "zh-3",
        },
      },
    });
    expect(result.status).toBe("applied");
    if (!cluster.representativeNodeId) {
      throw new Error(
        "expected the consolidated fixture to have a representative",
      );
    }
    const snapshot = await graph(manager);
    const retiredSupersedeEdge = snapshot.edges.find(
      (edge) =>
        edge.kind === "supersede" &&
        edge.toNodeId === cluster.representativeNodeId &&
        edge.metadata?.inactive === true,
    );
    if (!retiredSupersedeEdge) {
      throw new Error("expected an inactive supersession edge");
    }
    const audit = buildGraphAwareRetrievalDryRun({
      ownerScope: OWNER,
      query: "language preference",
      baselineNodeIds: [cluster.representativeNodeId],
      snapshot,
      visibilityMode: "audit",
      includeDeprecated: true,
    });
    expect(audit.auditTrail?.flatMap((trail) => trail.edgeIds)).toContain(
      retiredSupersedeEdge.id,
    );
  });

  it("does not move a competing node across clusters when setting a representative", async () => {
    const manager = new GovernanceRuntimeTestManager();
    await storeEvidence(manager, [rawMessage("global-zh")]);
    await storeEvidence(
      manager,
      [rawMessage("global-en", { relationValue: "en" })],
      NOW + 1000,
    );
    await storeEvidence(
      manager,
      [rawMessage("global-ja", { relationValue: "ja" })],
      NOW + 2000,
    );
    const before = await graph(manager);
    const sourceCluster = before.clusters.find((cluster) =>
      cluster.nodeIds.includes("global-zh"),
    );
    const competingCluster = before.clusters.find(
      (cluster) =>
        cluster.clusterId !== sourceCluster?.clusterId &&
        cluster.nodeIds.includes("global-en"),
    );
    if (!sourceCluster || !competingCluster) {
      throw new Error("expected independent competing clusters");
    }
    const result = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      command: {
        commandId: "reject-cross-cluster-representative",
        reason: "A representative cannot silently move between clusters",
        action: {
          type: "set-representative",
          clusterId: sourceCluster.clusterId,
          representativeNodeId: "global-en",
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: "no-op",
        reasonCodes: expect.arrayContaining([
          "memory_graph_correction_representative_not_in_cluster",
        ]),
      }),
    );
    expect(await graph(manager)).toEqual(before);
  });

  it("blocks pending summary publication and passes the convergence gate after retry", async () => {
    const manager = new GovernanceRuntimeTestManager();
    const { cluster, summary } = await seedConsolidated(manager);
    const command = {
      commandId: "rollout-pending-summary",
      reason: "Keep rollout blocked until publication finishes",
      action: {
        type: "correct-summary" as const,
        clusterId: cluster.clusterId,
        summaryId: summary.summaryId,
        correctedSummaryId: "rollout-pending-summary",
        correctedContent: "The reviewed preference is Chinese responses.",
      },
    };
    manager.failSummaryWriteNumbers.add(manager.summaryWriteCount + 2);
    const failed = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 4000,
      command,
    });
    expect(failed.status).toBe("partial-failure");
    const pending = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "pending-summary-rollout",
    });
    expect(pending.report.gates).toContainEqual(
      expect.objectContaining({
        gateId: "runtime.publication-convergence",
        passed: false,
        actual: expect.arrayContaining(["rollout-pending-summary"]),
      }),
    );
    const retried = await runMemoryGraphCorrection({
      storage: manager,
      userId: OWNER.userId,
      now: NOW + 5000,
      command,
    });
    expect(retried.status).toBe("replayed");
    const converged = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "pending-summary-rollout",
    });
    expect(
      converged.report.gates.find(
        (gate) => gate.gateId === "runtime.publication-convergence",
      )?.passed,
    ).toBe(true);
  });
});
