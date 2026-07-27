import {
  type MemorySummaryRecord,
  type RawMessage,
  type RawMessageQuery,
  createRawMessageMemoryGraphStore,
  runMemoryForgettingCycle,
  runMemoryGraphRolloutEvaluation,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import type { OwnerScope } from "@openloomi/memory-consolidation";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const OWNER = { userId: "user-1" } satisfies OwnerScope;

class RolloutEvaluationRuntimeTestManager {
  readonly messages = new Map<string, RawMessage>();
  readonly summaries = new Map<string, MemorySummaryRecord>();
  nextId = 1;

  async storeMessage(message: RawMessage): Promise<number> {
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
  manager: RolloutEvaluationRuntimeTestManager,
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
  manager: RolloutEvaluationRuntimeTestManager,
  scope: OwnerScope = OWNER,
) {
  return createRawMessageMemoryGraphStore({
    storage: manager,
    ownerScope: scope,
    now: () => NOW,
  }).readSnapshot({ ownerScope: scope, includeAuditOnly: true });
}

async function seedConsolidated(
  manager: RolloutEvaluationRuntimeTestManager,
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

describe("memory graph rollout evaluation runtime", () => {
  it("keeps runtime rollout retrieval in its requested owner scope", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    const ownerScope = {
      userId: OWNER.userId,
      workspaceId: "workspace-a",
    } satisfies OwnerScope;
    await seedConsolidated(manager, ownerScope);

    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: ownerScope.userId,
      workspaceId: ownerScope.workspaceId,
      scenarioId: "workspace-scoped-runtime-retrieval",
    });

    expect(evaluation.ownerScope).toEqual(ownerScope);
    const defaultScenario = evaluation.report.graphRetrievalScenarios.find(
      (scenario) => scenario.scenarioId === "runtime-default-retrieval",
    );
    expect(defaultScenario?.reasonCodes).toContain(
      "memory_graph_runtime_retrieval_applied",
    );
    expect(defaultScenario?.reasonCodes).not.toContain(
      "memory_graph_runtime_retrieval_no-op",
    );
  });

  it("evaluates only global applicability when contextual nodes coexist", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    await seedConsolidated(manager);
    await storeEvidence(manager, [
      rawMessage("conversation-only", {
        applicability: { scope: "conversation", key: "chat-a" },
        timestamp: Math.floor(NOW / 1000) + 10,
      }),
    ]);

    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "global-only-with-contextual-memory",
      queryEmbedding: [1, 0],
    });

    expect(evaluation.runtimeEvidence.sourceRecordIds).not.toContain(
      "conversation-only",
    );
    expect(evaluation.runtimeEvidence.semanticDefaultRecordIds).not.toContain(
      "conversation-only",
    );
    expect(evaluation.runtimeEvidence.semanticAuditRecordIds).not.toContain(
      "conversation-only",
    );
    for (const scenario of evaluation.report.graphRetrievalScenarios) {
      expect(scenario.missingRankedNodeIds).not.toContain("conversation-only");
      expect(scenario.crossScopeLeakNodeIds).not.toContain("conversation-only");
    }
  });

  it("reports unlinked semantic results as cross-scope contamination", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    await seedConsolidated(manager);
    const crossScope = rawMessage("unlinked-cross-scope");
    crossScope.metadata = {
      ...(crossScope.metadata ?? {}),
      memoryOwnerScope: {
        userId: OWNER.userId,
        workspaceId: "other-workspace",
      },
    };
    await manager.storeMessage(crossScope);

    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "unlinked-semantic-cross-scope",
      queryEmbedding: [1, 0],
    });

    expect(evaluation.report.semanticRetrievalScenarios[0]?.metadata).toEqual(
      expect.objectContaining({
        crossScopeRecordIds: ["unlinked-cross-scope"],
      }),
    );
  });

  it("excludes an unlinked summary before rollout evaluation", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    const { summary } = await seedConsolidated(manager);
    await manager.upsertSummaries([
      {
        ...summary,
        summaryId: "unrelated-summary",
        sourceRecordIds: ["unrelated-source"],
        summaryText: "Unrelated workspace summary.",
      },
    ]);
    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "unrelated-summary-scope",
    });
    expect(evaluation.report.summary.decision).toBe("blocked");
    expect(
      evaluation.report.graphRetrievalScenarios.find(
        (scenario) => scenario.scenarioId === "runtime-default-retrieval",
      )?.crossScopeLeakNodeIds,
    ).not.toContain("unrelated-summary");
  });

  it("blocks the graph retrieval gate when a persisted graph node cannot be materialized", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    const { summary } = await seedConsolidated(manager);
    manager.summaries.delete(summary.summaryId);

    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "missing-materialized-summary",
    });

    expect(evaluation.runtimeEvidence.defaultRetrievedNodeIds).not.toContain(
      summary.summaryId,
    );
    expect(
      evaluation.report.graphRetrievalScenarios.find(
        (scenario) => scenario.scenarioId === "runtime-default-retrieval",
      )?.passed,
    ).toBe(false);
    expect(
      evaluation.report.gates.find(
        (gate) => gate.gateId === "retrieval.graph-scenarios",
      )?.passed,
    ).toBe(false);
    expect(evaluation.report.summary.decision).toBe("blocked");
  });

  it("blocks rollout when graph visibility and raw deprecation diverge", async () => {
    const manager = new RolloutEvaluationRuntimeTestManager();
    await seedConsolidated(manager);
    const message = manager.messages.get("zh-1");
    if (!message) {
      throw new Error("expected consolidated raw evidence");
    }
    manager.messages.set("zh-1", {
      ...message,
      deprecatedAt: undefined,
      deprecationReason: undefined,
      supersededBySummaryId: undefined,
    });
    const evaluation = await runMemoryGraphRolloutEvaluation({
      storage: manager,
      userId: OWNER.userId,
      scenarioId: "raw-visibility-mismatch",
    });
    expect(evaluation.report.gates).toContainEqual(
      expect.objectContaining({
        gateId: "runtime.publication-convergence",
        passed: false,
        actual: expect.arrayContaining(["zh-1"]),
      }),
    );
  });
});
