import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  getRawMessageManagerMock,
  isRawMessageStorageAvailableMock,
  runMemoryGraphCorrectionMock,
  runMemoryGraphRollbackMock,
  runMemoryGraphRolloutEvaluationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getRawMessageManagerMock: vi.fn(),
  isRawMessageStorageAvailableMock: vi.fn(),
  runMemoryGraphCorrectionMock: vi.fn(),
  runMemoryGraphRollbackMock: vi.fn(),
  runMemoryGraphRolloutEvaluationMock: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({ auth: authMock }));
vi.mock("@/lib/memory/raw-message-store", () => ({
  getRawMessageManager: getRawMessageManagerMock,
  getRawMessageStorageBackend: vi.fn(),
  isRawMessageStorageAvailable: isRawMessageStorageAvailableMock,
}));
vi.mock("@openloomi/indexeddb", () => ({
  parseRawMessageGraphEvolutionOptions: vi.fn(),
  parseRawMessageGraphLifecycleOptions: vi.fn(),
  runMemoryGraphCorrection: runMemoryGraphCorrectionMock,
  runMemoryGraphRollback: runMemoryGraphRollbackMock,
  runMemoryGraphRolloutEvaluation: runMemoryGraphRolloutEvaluationMock,
  storeRawMessagesWithGraphEvolution: vi.fn(),
}));
vi.mock("@openloomi/indexeddb/forgetting", () => ({
  queryMemoryWithFallback: vi.fn(),
  runMemoryForgettingCycle: vi.fn(),
}));

import { POST } from "@/app/api/memory/raw-messages/route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/memory/raw-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("memory graph governance route", () => {
  const manager = { id: "raw-manager" };

  beforeEach(() => {
    authMock.mockReset();
    getRawMessageManagerMock.mockReset();
    isRawMessageStorageAvailableMock.mockReset();
    runMemoryGraphCorrectionMock.mockReset();
    runMemoryGraphRollbackMock.mockReset();
    runMemoryGraphRolloutEvaluationMock.mockReset();

    authMock.mockResolvedValue({ user: { id: "authenticated-user" } });
    getRawMessageManagerMock.mockResolvedValue(manager);
    isRawMessageStorageAvailableMock.mockReturnValue(true);
    runMemoryGraphCorrectionMock.mockResolvedValue({ status: "applied" });
    runMemoryGraphRollbackMock.mockResolvedValue({ status: "applied" });
    runMemoryGraphRolloutEvaluationMock.mockResolvedValue({
      report: { summary: { decision: "blocked" } },
    });
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED", "true");
    vi.stubEnv(
      "OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS",
      "authenticated-user",
    );
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds graph commands and evaluation to the authenticated owner scope", async () => {
    await post({
      action: "graphCorrection",
      command: {
        commandId: "correct-cluster",
        reason: "The source belongs to another context",
        expectedVersion: "graph-version-7",
        userId: "forged-user",
        workspaceId: "forged-workspace",
        tenantId: "forged-tenant",
        requestedBy: "forged-operator",
        action: {
          type: "correct-summary",
          clusterId: "cluster-1",
          summaryId: "summary-1",
          correctedSummaryId: "forged-summary-id",
          correctedContent:
            "Review the summary without caller-selected identity.",
        },
      },
    });
    const correction = runMemoryGraphCorrectionMock.mock.calls[0]?.[0] as {
      command: Record<string, unknown>;
      trustedContext: {
        ownerScope: Record<string, unknown>;
        requestedBy: string;
      };
    };
    expect(correction.trustedContext).toEqual({
      ownerScope: { userId: "authenticated-user" },
      requestedBy: "authenticated-user",
    });
    expect(correction.command).not.toHaveProperty("userId");
    expect(correction.command).not.toHaveProperty("workspaceId");
    expect(correction.command).not.toHaveProperty("tenantId");
    expect(correction.command).not.toHaveProperty("requestedBy");
    expect(correction.command.expectedVersion).toBe("graph-version-7");
    expect(correction.command.action).not.toHaveProperty("correctedSummaryId");

    await post({
      action: "graphRollback",
      command: {
        commandId: "rollback-summary",
        reason: "Restore raw evidence for review",
        expectedVersion: "graph-version-8",
        summaryId: "summary-1",
        userId: "forged-user",
        workspaceId: "forged-workspace",
        tenantId: "forged-tenant",
        requestedBy: "forged-operator",
      },
    });
    const rollback = runMemoryGraphRollbackMock.mock.calls[0]?.[0] as {
      command: Record<string, unknown>;
      trustedContext: {
        ownerScope: Record<string, unknown>;
        requestedBy: string;
      };
    };
    expect(rollback.trustedContext).toEqual({
      ownerScope: { userId: "authenticated-user" },
      requestedBy: "authenticated-user",
    });
    expect(rollback.command).not.toHaveProperty("userId");
    expect(rollback.command).not.toHaveProperty("workspaceId");
    expect(rollback.command).not.toHaveProperty("tenantId");
    expect(rollback.command).not.toHaveProperty("requestedBy");
    expect(rollback.command.expectedVersion).toBe("graph-version-8");
    expect(rollback.command.summaryId).toBe("summary-1");

    await post({
      action: "graphRolloutEvaluation",
      options: {
        scenarioId: "cohort-evidence",
        workspaceId: "forged-workspace",
        tenantId: "forged-tenant",
        queryEmbedding: [1, 0, "invalid"],
        pollutedArtifactIds: ["raw-3", 7],
      },
    });
    expect(runMemoryGraphRolloutEvaluationMock).toHaveBeenCalledWith({
      storage: manager,
      userId: "authenticated-user",
      scenarioId: "cohort-evidence",
      workspaceId: undefined,
      tenantId: undefined,
      queryEmbedding: [1, 0],
      pollutedArtifactIds: ["raw-3"],
    });
  });

  it.each([
    {
      name: "disabled",
      environment: {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "false",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS:
          "authenticated-user",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH: "false",
      },
      reasonCode: "memory_graph_correction_disabled",
    },
    {
      name: "operator cohort miss",
      environment: {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "true",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS: "another-user",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH: "false",
      },
      reasonCode: "memory_graph_correction_operator_miss",
    },
    {
      name: "kill switch",
      environment: {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "true",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS:
          "authenticated-user",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH: "true",
      },
      reasonCode: "memory_graph_correction_kill_switch",
    },
  ])(
    "fails closed when correction policy is $name",
    async ({ environment, name, reasonCode }) => {
      for (const [key, value] of Object.entries(environment)) {
        vi.stubEnv(key, value);
      }
      if (name === "disabled") {
        isRawMessageStorageAvailableMock.mockReturnValue(false);
      }

      const response = await post({
        action: "graphCorrection",
        command: {
          commandId: "blocked-correction",
          reason: "This request must not reach storage",
          action: {
            type: "set-lifecycle",
            clusterId: "cluster-1",
            lifecycleStatus: "stable",
          },
        },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        reason: "memory_graph_correction_forbidden",
        reasonCodes: [reasonCode],
      });
      expect(getRawMessageManagerMock).not.toHaveBeenCalled();
      expect(isRawMessageStorageAvailableMock).not.toHaveBeenCalled();
      expect(runMemoryGraphCorrectionMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed before storage access for an unauthorized rollback", async () => {
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED", "false");
    isRawMessageStorageAvailableMock.mockReturnValue(false);

    const response = await post({
      action: "graphRollback",
      command: {
        commandId: "blocked-rollback",
        reason: "This request must not reach storage",
        summaryId: "summary-1",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      reason: "memory_graph_rollback_forbidden",
      reasonCodes: ["memory_graph_correction_disabled"],
    });
    expect(isRawMessageStorageAvailableMock).not.toHaveBeenCalled();
    expect(getRawMessageManagerMock).not.toHaveBeenCalled();
    expect(runMemoryGraphRollbackMock).not.toHaveBeenCalled();
  });

  it("returns partial rollback diagnostics and retry audit outcomes", async () => {
    const command = {
      commandId: "retry-rollback",
      reason: "Restore retained evidence",
      summaryId: "summary-1",
      expectedVersion: "graph-version-9",
    };
    runMemoryGraphRollbackMock
      .mockResolvedValueOnce({
        status: "partial-failure",
        reasonCodes: ["memory_graph_rollback_source_restore_incomplete"],
        restoredRecords: 0,
        sourceRecordIds: ["raw-1"],
      })
      .mockResolvedValueOnce({
        status: "applied",
        reasonCodes: ["memory_graph_rollback_finalize"],
        restoredRecords: 1,
        sourceRecordIds: ["raw-1"],
        auditTrail: {
          sourceNodeIds: ["raw-1"],
          edgeIds: ["edge-1"],
          operationIds: ["operation-1"],
        },
      });

    const partial = await post({ action: "graphRollback", command });
    expect(await partial.json()).toEqual({
      success: true,
      result: expect.objectContaining({
        status: "partial-failure",
        reasonCodes: ["memory_graph_rollback_source_restore_incomplete"],
        sourceRecordIds: ["raw-1"],
      }),
    });

    const retried = await post({ action: "graphRollback", command });
    expect(await retried.json()).toEqual({
      success: true,
      result: expect.objectContaining({
        status: "applied",
        restoredRecords: 1,
        auditTrail: {
          sourceNodeIds: ["raw-1"],
          edgeIds: ["edge-1"],
          operationIds: ["operation-1"],
        },
      }),
    });
    expect(runMemoryGraphRollbackMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty rollback summary id before execution", async () => {
    const response = await post({
      action: "graphRollback",
      command: {
        commandId: "malformed-rollback",
        reason: "Reject an empty target",
        summaryId: "   ",
      },
    });

    expect(response.status).toBe(400);
    expect(runMemoryGraphRollbackMock).not.toHaveBeenCalled();
  });

  it("rejects malformed graph correction identifiers before execution", async () => {
    const response = await post({
      action: "graphCorrection",
      command: {
        commandId: "malformed-separated-cluster-id",
        reason: "Reject malformed correction input",
        action: {
          type: "remove-member",
          clusterId: "cluster-1",
          nodeId: "node-1",
          separatedClusterId: 42,
        },
      },
    });

    expect(response.status).toBe(400);
    expect(runMemoryGraphCorrectionMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a non-string expected version",
      body: {
        action: "graphRollback",
        command: {
          commandId: "malformed-version",
          reason: "Reject a non-string version",
          expectedVersion: 7,
          summaryId: "summary-1",
        },
      },
    },
    {
      name: "an oversized command id",
      body: {
        action: "graphRollback",
        command: {
          commandId: "x".repeat(513),
          reason: "Reject an oversized command id",
          summaryId: "summary-1",
        },
      },
    },
    {
      name: "an oversized reason",
      body: {
        action: "graphRollback",
        command: {
          commandId: "oversized-reason",
          reason: "x".repeat(4097),
          summaryId: "summary-1",
        },
      },
    },
    {
      name: "oversized corrected content",
      body: {
        action: "graphCorrection",
        command: {
          commandId: "oversized-content",
          reason: "Reject oversized corrected content",
          action: {
            type: "correct-summary",
            clusterId: "cluster-1",
            summaryId: "summary-1",
            correctedContent: "x".repeat(64 * 1024 + 1),
          },
        },
      },
    },
  ])("rejects $name before execution", async ({ body }) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(runMemoryGraphCorrectionMock).not.toHaveBeenCalled();
    expect(runMemoryGraphRollbackMock).not.toHaveBeenCalled();
  });
});
