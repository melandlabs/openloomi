import {
  type MemoryClusterLifecycleStatus,
  type MemoryGraphCorrectionAction,
  type MemoryGraphOperation,
  type MemoryGraphSnapshot,
  type OwnerScope,
  buildMemoryGraphCorrectionPlan,
  buildMemoryGraphRollbackFinalizePlan,
  buildMemoryGraphRollbackPreparePlan,
  ownerScopeKey,
  sameOwnerScope,
} from "../../ai/memory-consolidation/src";
import {
  isMemorySummaryPublicationPending,
  publishMemorySummary,
  stageMemorySummaryPublication,
} from "../../ai/src/memory/summary-publication";
import {
  type RawMessageGraphEvolutionStorage,
  createRawMessageMemoryGraphStore,
  ownerScopeFromMessage,
} from "./memory-graph-evolution";
import type {
  MemorySummaryQuery,
  MemorySummaryRecord,
  RawMessage,
  RawMessageQuery,
} from "./storage";
export type RawMessageMemoryGraphCorrectionAction =
  | {
      type: "correct-summary";
      clusterId: string;
      summaryId: string;
      correctedContent: string;
      correctedSummaryId?: string;
    }
  | {
      type: "set-lifecycle";
      clusterId: string;
      lifecycleStatus: MemoryClusterLifecycleStatus;
    }
  | {
      type: "remove-member";
      clusterId: string;
      nodeId: string;
      separatedClusterId?: string;
    }
  | {
      type: "set-representative";
      clusterId: string;
      representativeNodeId: string;
    };

export interface RawMessageMemoryGraphCommandBase {
  commandId: string;
  reason: string;
  expectedVersion?: string;
}

export interface RawMessageMemoryGraphCorrectionCommand extends RawMessageMemoryGraphCommandBase {
  action: RawMessageMemoryGraphCorrectionAction;
}

export interface RawMessageMemoryGraphRollbackCommand extends RawMessageMemoryGraphCommandBase {
  summaryId: string;
}

export interface RawMessageMemoryGraphTrustedContext {
  ownerScope: OwnerScope;
  requestedBy: string;
}

interface SemanticSearchInput {
  userId: string;
  queryEmbedding: number[];
  includeArchived?: boolean;
  includeDeprecated?: boolean;
  limit?: number;
  threshold?: number;
}

export interface RawMessageGraphGovernanceStorage extends RawMessageGraphEvolutionStorage {
  queryMessages(query: RawMessageQuery): Promise<RawMessage[]>;
  upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void>;
  querySummaries(query: MemorySummaryQuery): Promise<MemorySummaryRecord[]>;
  restoreDeprecatedMessages?: (
    messageIds: string[],
    input: { userId?: string; supersededBySummaryId?: string },
  ) => Promise<number>;
  searchMessagesSemantically?: (
    input: SemanticSearchInput,
  ) => Promise<unknown[]>;
}

export type MemoryGraphGovernanceRuntimeStatus =
  | "applied"
  | "no-op"
  | "replayed"
  | "conflict"
  | "partial-failure"
  | "failed";

export interface MemoryGraphGovernanceRuntimeResult {
  status: MemoryGraphGovernanceRuntimeStatus;
  ownerScope: OwnerScope;
  commandId: string;
  graphVersion?: string;
  appliedOperationIds: string[];
  restoredRecords: number;
  reasonCodes: string[];
  summaryId?: string;
  sourceRecordIds?: string[];
  auditTrail?: {
    sourceNodeIds: string[];
    edgeIds: string[];
    operationIds: string[];
  };
  error?: { name: string; message: string };
}

const CORRECTION_COMMAND_DIMENSION =
  "__openloomiMemoryGraphCorrectionCommandId";
const CORRECTION_COMMAND_FINGERPRINT_DIMENSION =
  "__openloomiMemoryGraphCorrectionCommandFingerprint";

function stagedCorrectedSummary(
  summary: MemorySummaryRecord,
  commandId: string,
  fingerprint: string,
): MemorySummaryRecord {
  const staged = stageMemorySummaryPublication(summary);
  return {
    ...staged,
    dimensions: {
      ...(staged.dimensions ?? {}),
      [CORRECTION_COMMAND_DIMENSION]: commandId,
      [CORRECTION_COMMAND_FINGERPRINT_DIMENSION]: fingerprint,
    },
  };
}

function publishCorrectedSummary(
  summary: MemorySummaryRecord,
): MemorySummaryRecord {
  const published = publishMemorySummary(summary);
  const dimensions = { ...(published.dimensions ?? {}) };
  delete dimensions[CORRECTION_COMMAND_DIMENSION];
  delete dimensions[CORRECTION_COMMAND_FINGERPRINT_DIMENSION];
  return {
    ...published,
    dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
  };
}

function errorInfo(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function commandFingerprint(
  kind: "correction" | "rollback",
  command:
    | RawMessageMemoryGraphCorrectionCommand
    | RawMessageMemoryGraphRollbackCommand,
  trustedContext: RawMessageMemoryGraphTrustedContext,
): string {
  const payload = { ...command } as Record<string, unknown>;
  payload.expectedVersion = undefined;
  return JSON.stringify(
    canonicalValue({
      kind,
      ...payload,
      requestedBy: trustedContext.requestedBy,
    }),
  );
}

function hasCommandFingerprintConflict(
  operations: MemoryGraphOperation[],
  commandId: string,
  fingerprint: string,
): boolean {
  return operations.some(
    (operation) =>
      operation.metadata?.commandId === commandId &&
      typeof operation.metadata.commandFingerprint === "string" &&
      operation.metadata.commandFingerprint !== fingerprint,
  );
}

function ownerScope(
  userId: string,
  input: { workspaceId?: string; tenantId?: string },
): OwnerScope {
  return {
    userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
  };
}

function correctedSummaryId(scope: OwnerScope, commandId: string): string {
  return `memory-graph-correction:${ownerScopeKey(scope)}:${encodeURIComponent(commandId)}`;
}

function runtimeResult(input: {
  status: MemoryGraphGovernanceRuntimeStatus;
  ownerScope: OwnerScope;
  commandId: string;
  graphVersion?: string;
  operations?: MemoryGraphOperation[];
  restoredRecords?: number;
  reasonCodes: string[];
  summaryId?: string;
  sourceRecordIds?: string[];
  error?: { name: string; message: string };
}): MemoryGraphGovernanceRuntimeResult {
  return {
    status: input.status,
    ownerScope: { ...input.ownerScope },
    commandId: input.commandId,
    graphVersion: input.graphVersion,
    appliedOperationIds: (input.operations ?? []).map(
      (operation) => operation.operationId,
    ),
    restoredRecords: input.restoredRecords ?? 0,
    reasonCodes: unique(input.reasonCodes),
    summaryId: input.summaryId,
    sourceRecordIds: input.sourceRecordIds
      ? [...input.sourceRecordIds]
      : undefined,
    error: input.error,
  };
}

function validateCommand(command: RawMessageMemoryGraphCommandBase): string[] {
  return [
    ...(command.commandId.trim().length === 0
      ? ["memory_graph_command_id_required"]
      : []),
    ...(command.reason.trim().length === 0
      ? ["memory_graph_command_reason_required"]
      : []),
  ];
}

function persistenceStatus(input: {
  mutatesGraph: boolean;
  replayed?: boolean;
  conflict?: boolean;
}): MemoryGraphGovernanceRuntimeStatus {
  if (input.conflict) return "conflict";
  if (input.replayed) return "replayed";
  return input.mutatesGraph ? "applied" : "no-op";
}

function metadataStringArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function restoreCorrectionMessages(input: {
  storage: RawMessageGraphGovernanceStorage;
  userId: string;
  messages: RawMessage[];
}): Promise<
  | { success: true; restoredRecords: number }
  | { success: false; restoredRecords: number; error: unknown }
> {
  if (typeof input.storage.restoreDeprecatedMessages !== "function") {
    return { success: true, restoredRecords: 0 };
  }
  const groups = new Map<string | undefined, string[]>();
  for (const message of input.messages) {
    if (message.deprecatedAt === undefined) continue;
    const summaryId = message.supersededBySummaryId;
    const ids = groups.get(summaryId) ?? [];
    ids.push(message.messageId);
    groups.set(summaryId, ids);
  }
  let restored = 0;
  for (const [summaryId, messageIds] of groups) {
    try {
      restored += await input.storage.restoreDeprecatedMessages(messageIds, {
        userId: input.userId,
        supersededBySummaryId: summaryId,
      });
    } catch (error) {
      return { success: false, restoredRecords: restored, error };
    }
  }
  return { success: true, restoredRecords: restored };
}

export async function runMemoryGraphCorrection(input: {
  storage: RawMessageGraphGovernanceStorage;
  trustedContext: RawMessageMemoryGraphTrustedContext;
  command: RawMessageMemoryGraphCorrectionCommand;
  now?: number;
}): Promise<MemoryGraphGovernanceRuntimeResult> {
  const now = input.now ?? Date.now();
  const scope = { ...input.trustedContext.ownerScope };
  const invalid = validateCommand(input.command);
  if (invalid.length > 0) {
    return runtimeResult({
      status: "failed",
      ownerScope: scope,
      commandId: input.command.commandId,
      reasonCodes: invalid,
    });
  }
  const store = createRawMessageMemoryGraphStore({
    storage: input.storage,
    ownerScope: scope,
    now: () => now,
  });
  let summaryId: string | undefined;
  try {
    const snapshot = await store.readSnapshot({
      ownerScope: scope,
      includeAuditOnly: true,
    });
    const priorCommandOperations = await store.readAppliedOperations({
      ownerScope: scope,
    });
    const fingerprint = commandFingerprint(
      "correction",
      input.command,
      input.trustedContext,
    );
    if (
      hasCommandFingerprintConflict(
        priorCommandOperations,
        input.command.commandId,
        fingerprint,
      )
    ) {
      return runtimeResult({
        status: "conflict",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: ["memory_graph_command_id_payload_conflict"],
      });
    }
    const commandWasApplied = priorCommandOperations.some(
      (operation) => operation.metadata?.commandId === input.command.commandId,
    );
    if (
      input.command.expectedVersion !== undefined &&
      input.command.expectedVersion !== (snapshot.version ?? "0") &&
      !commandWasApplied
    ) {
      return runtimeResult({
        status: "conflict",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: ["memory_graph_version_conflict"],
      });
    }

    let action: MemoryGraphCorrectionAction;
    let correctedSummary: MemorySummaryRecord | undefined;
    let previousSummary: MemorySummaryRecord | undefined;
    let memberMessage: RawMessage | null = null;
    if (input.command.action.type === "correct-summary") {
      const correction = input.command.action;
      const targetCorrectedSummaryId =
        correction.correctedSummaryId ??
        correctedSummaryId(scope, input.command.commandId);
      const summaryIds = unique([
        correction.summaryId,
        targetCorrectedSummaryId,
      ]);
      const oldSummaries = await input.storage.querySummaries({
        userId: scope.userId,
        summaryIds,
        pageSize: summaryIds.length,
      });
      const oldSummary = oldSummaries.find(
        (summary) => summary.summaryId === correction.summaryId,
      );
      if (!oldSummary || correction.correctedContent.trim().length === 0) {
        return runtimeResult({
          status: "failed",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: snapshot.version,
          reasonCodes: [
            oldSummary
              ? "memory_graph_corrected_content_required"
              : "memory_graph_summary_not_found",
          ],
        });
      }
      const graphSummary = snapshot.nodes.find(
        (node) =>
          node.id === correction.summaryId &&
          node.type === "summary" &&
          sameOwnerScope(node.ownerScope, scope),
      );
      const targetCluster = snapshot.clusters.find(
        (cluster) =>
          cluster.clusterId === correction.clusterId &&
          sameOwnerScope(cluster.ownerScope, scope),
      );
      if (!graphSummary || !targetCluster?.nodeIds.includes(graphSummary.id)) {
        return runtimeResult({
          status: "no-op",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: snapshot.version,
          reasonCodes: ["memory_graph_summary_not_found_or_scope_mismatch"],
        });
      }
      previousSummary = oldSummary;
      summaryId = targetCorrectedSummaryId;
      const storedSummaryWithCorrectedId = oldSummaries.find(
        (summary) => summary.summaryId === summaryId,
      );
      const graphAlreadyOwnsCorrectedSummary = snapshot.nodes.some(
        (node) =>
          node.id === summaryId &&
          node.type === "summary" &&
          sameOwnerScope(node.ownerScope, scope) &&
          node.metadata?.correctedFromSummaryId === correction.summaryId &&
          node.metadata?.commandId === input.command.commandId,
      );
      const pendingSummaryBelongsToCommand =
        storedSummaryWithCorrectedId !== undefined &&
        isMemorySummaryPublicationPending(storedSummaryWithCorrectedId) &&
        storedSummaryWithCorrectedId.dimensions?.[
          CORRECTION_COMMAND_DIMENSION
        ] === input.command.commandId &&
        storedSummaryWithCorrectedId.dimensions?.[
          CORRECTION_COMMAND_FINGERPRINT_DIMENSION
        ] === fingerprint;
      const pendingSummaryReusesCommandId =
        storedSummaryWithCorrectedId !== undefined &&
        isMemorySummaryPublicationPending(storedSummaryWithCorrectedId) &&
        storedSummaryWithCorrectedId.dimensions?.[
          CORRECTION_COMMAND_DIMENSION
        ] === input.command.commandId &&
        storedSummaryWithCorrectedId.dimensions?.[
          CORRECTION_COMMAND_FINGERPRINT_DIMENSION
        ] !== fingerprint;
      if (pendingSummaryReusesCommandId) {
        return runtimeResult({
          status: "conflict",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: snapshot.version,
          reasonCodes: ["memory_graph_command_id_payload_conflict"],
          summaryId,
        });
      }
      if (
        storedSummaryWithCorrectedId !== undefined &&
        !graphAlreadyOwnsCorrectedSummary &&
        !pendingSummaryBelongsToCommand
      ) {
        return runtimeResult({
          status: "no-op",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: snapshot.version,
          reasonCodes: [
            "memory_graph_correction_corrected_summary_id_conflict",
          ],
        });
      }
      correctedSummary = stagedCorrectedSummary(
        {
          ...oldSummary,
          summaryId,
          summaryText: correction.correctedContent,
          updatedAt: now,
          createdAt: now,
        },
        input.command.commandId,
        fingerprint,
      );
      action = {
        type: "correct-summary",
        clusterId: correction.clusterId,
        summaryId: correction.summaryId,
        correctedSummaryId: summaryId,
      };
    } else {
      action = input.command.action;
      if (action.type === "remove-member") {
        memberMessage = await input.storage.getMessageById(action.nodeId);
        if (
          memberMessage &&
          !sameOwnerScope(ownerScopeFromMessage(memberMessage), scope)
        ) {
          return runtimeResult({
            status: "no-op",
            ownerScope: scope,
            commandId: input.command.commandId,
            graphVersion: snapshot.version,
            reasonCodes: ["memory_graph_scope_mismatch"],
          });
        }
      }
    }

    const plan = buildMemoryGraphCorrectionPlan({
      ownerScope: scope,
      snapshot,
      commandId: input.command.commandId,
      action,
      reason: input.command.reason,
      requestedBy: input.trustedContext.requestedBy,
      now,
      persistence: { mode: "write", enabled: true },
    });
    const removeMemberOperation =
      action.type === "remove-member"
        ? (plan.operations.find(
            (operation) => operation.kind === "remove-cluster-member",
          ) ??
          priorCommandOperations.find(
            (operation) =>
              operation.kind === "remove-cluster-member" &&
              operation.metadata?.commandId === input.command.commandId,
          ))
        : undefined;
    const correctionRestoreSourceIds =
      action.type === "remove-member"
        ? unique([
            action.nodeId,
            ...metadataStringArray(
              removeMemberOperation?.metadata,
              "restoreSourceNodeIds",
            ),
          ])
        : [];
    const correctionRestoreMessages = (
      await Promise.all(
        correctionRestoreSourceIds.map((messageId) =>
          input.storage.getMessageById(messageId),
        ),
      )
    ).filter(
      (message): message is RawMessage =>
        message !== null &&
        sameOwnerScope(ownerScopeFromMessage(message), scope),
    );
    if (
      correctionRestoreMessages.some(
        (message) => message.deprecatedAt !== undefined,
      ) &&
      typeof input.storage.restoreDeprecatedMessages !== "function"
    ) {
      return runtimeResult({
        status: commandWasApplied ? "partial-failure" : "no-op",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: [
          "adapter_missing_restore_deprecated_messages",
          "memory_graph_correction_not_applied",
        ],
        sourceRecordIds: correctionRestoreSourceIds,
      });
    }
    if (plan.operations.length === 0) {
      if (
        action.type === "remove-member" &&
        removeMemberOperation &&
        correctionRestoreMessages.some(
          (message) => message.deprecatedAt !== undefined,
        ) &&
        typeof input.storage.restoreDeprecatedMessages === "function"
      ) {
        const restoration = await restoreCorrectionMessages({
          storage: input.storage,
          userId: scope.userId,
          messages: correctionRestoreMessages,
        });
        if (!restoration.success) {
          return runtimeResult({
            status: "partial-failure",
            ownerScope: scope,
            commandId: input.command.commandId,
            graphVersion: snapshot.version,
            restoredRecords: restoration.restoredRecords,
            reasonCodes: ["memory_graph_correction_restore_failed"],
            sourceRecordIds: correctionRestoreSourceIds,
            error: errorInfo(restoration.error),
          });
        }
        return runtimeResult({
          status: restoration.restoredRecords > 0 ? "applied" : "replayed",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: snapshot.version,
          restoredRecords: restoration.restoredRecords,
          reasonCodes: [
            ...plan.reasonCodes,
            "memory_graph_correction_restore_retried",
          ],
          sourceRecordIds: correctionRestoreSourceIds,
        });
      }
      if (correctedSummary && commandWasApplied) {
        try {
          await input.storage.upsertSummaries([
            publishCorrectedSummary(correctedSummary),
          ]);
          return runtimeResult({
            status: "replayed",
            ownerScope: scope,
            commandId: input.command.commandId,
            graphVersion: snapshot.version,
            reasonCodes: [
              ...plan.reasonCodes,
              "memory_graph_corrected_summary_publication_retried",
            ],
            summaryId,
          });
        } catch (error) {
          return runtimeResult({
            status: "partial-failure",
            ownerScope: scope,
            commandId: input.command.commandId,
            graphVersion: snapshot.version,
            reasonCodes: ["memory_graph_corrected_summary_publication_failed"],
            summaryId,
            error: errorInfo(error),
          });
        }
      }
      return runtimeResult({
        status: "no-op",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: plan.reasonCodes,
        summaryId,
      });
    }
    if (correctedSummary) {
      await input.storage.upsertSummaries([correctedSummary]);
      for (const operation of plan.operations) {
        operation.metadata = {
          ...(operation.metadata ?? {}),
          previousSummaryId:
            action.type === "correct-summary" ? action.summaryId : undefined,
          previousSummaryText:
            action.type === "correct-summary"
              ? previousSummary?.summaryText
              : undefined,
        };
      }
    }
    for (const operation of plan.operations) {
      operation.metadata = {
        ...(operation.metadata ?? {}),
        commandFingerprint: fingerprint,
      };
    }
    const persisted = await store.persistPlan(plan);
    if (correctedSummary && !persisted.conflict) {
      try {
        await input.storage.upsertSummaries([
          publishCorrectedSummary(correctedSummary),
        ]);
      } catch (error) {
        return runtimeResult({
          status: "partial-failure",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: persisted.version,
          operations: persisted.appliedOperations,
          reasonCodes: [
            ...plan.reasonCodes,
            "memory_graph_corrected_summary_publication_failed",
          ],
          summaryId,
          error: errorInfo(error),
        });
      }
    }
    let restoredRecords = 0;
    if (
      !persisted.conflict &&
      action.type === "remove-member" &&
      correctionRestoreMessages.some(
        (message) => message.deprecatedAt !== undefined,
      ) &&
      typeof input.storage.restoreDeprecatedMessages === "function"
    ) {
      const restoration = await restoreCorrectionMessages({
        storage: input.storage,
        userId: scope.userId,
        messages: correctionRestoreMessages,
      });
      restoredRecords = restoration.restoredRecords;
      if (!restoration.success) {
        return runtimeResult({
          status: "partial-failure",
          ownerScope: scope,
          commandId: input.command.commandId,
          graphVersion: persisted.version,
          operations: persisted.appliedOperations,
          restoredRecords,
          reasonCodes: [
            ...plan.reasonCodes,
            "memory_graph_correction_restore_failed",
          ],
          sourceRecordIds: correctionRestoreSourceIds,
          error: errorInfo(restoration.error),
        });
      }
    }
    const auditNodeId =
      summaryId ??
      (action.type === "remove-member"
        ? action.nodeId
        : action.type === "set-representative"
          ? action.representativeNodeId
          : undefined);
    const audit = auditNodeId
      ? await store.readAuditTrail({
          ownerScope: scope,
          nodeId: auditNodeId,
          includeDeprecated: true,
        })
      : undefined;
    return {
      ...runtimeResult({
        status:
          correctedSummary && persisted.conflict
            ? "partial-failure"
            : persistenceStatus(persisted),
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: persisted.version,
        operations: persisted.appliedOperations,
        restoredRecords,
        reasonCodes: [
          ...plan.reasonCodes,
          ...persisted.diagnostics,
          ...(correctedSummary && persisted.conflict
            ? ["memory_graph_corrected_summary_pending_after_conflict"]
            : []),
        ],
        summaryId,
        sourceRecordIds:
          action.type === "remove-member"
            ? correctionRestoreSourceIds
            : undefined,
      }),
      auditTrail: audit
        ? {
            sourceNodeIds: [...audit.sourceNodeIds],
            edgeIds: [...audit.edgeIds],
            operationIds: [...audit.operationIds],
          }
        : undefined,
    };
  } catch (error) {
    return runtimeResult({
      status: "failed",
      ownerScope: scope,
      commandId: input.command.commandId,
      reasonCodes: ["memory_graph_correction_failed"],
      summaryId,
      error: errorInfo(error),
    });
  }
}

function sourceIdsForSummary(
  snapshot: MemoryGraphSnapshot,
  summaryId: string,
): string[] {
  const summary = snapshot.nodes.find((node) => node.id === summaryId);
  const metadataSources = Array.isArray(summary?.metadata?.sourceNodeIds)
    ? summary.metadata.sourceNodeIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const edgeSources = snapshot.edges
    .filter((edge) => edge.kind === "supersede" && edge.toNodeId === summaryId)
    .map((edge) => edge.fromNodeId);
  return unique([...metadataSources, ...edgeSources]).filter(
    (nodeId) =>
      snapshot.nodes.find((node) => node.id === nodeId)?.type === "raw",
  );
}

function predecessorSummaryIdsForSummary(
  snapshot: MemoryGraphSnapshot,
  summaryId: string,
): string[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const summary = nodesById.get(summaryId);
  const correctedFromSummaryId =
    typeof summary?.metadata?.correctedFromSummaryId === "string"
      ? summary.metadata.correctedFromSummaryId
      : undefined;
  return unique([
    ...(correctedFromSummaryId ? [correctedFromSummaryId] : []),
    ...snapshot.edges
      .filter(
        (edge) =>
          edge.kind === "supersede" &&
          edge.toNodeId === summaryId &&
          edge.metadata?.inactive !== true,
      )
      .map((edge) => edge.fromNodeId)
      .filter((nodeId) => {
        const node = nodesById.get(nodeId);
        return node?.type === "summary" || node?.type === "artifact";
      }),
  ]);
}

export async function runMemoryGraphRollback(input: {
  storage: RawMessageGraphGovernanceStorage;
  trustedContext: RawMessageMemoryGraphTrustedContext;
  command: RawMessageMemoryGraphRollbackCommand;
  now?: number;
}): Promise<MemoryGraphGovernanceRuntimeResult> {
  const now = input.now ?? Date.now();
  const scope = { ...input.trustedContext.ownerScope };
  const invalid = validateCommand(input.command);
  if (invalid.length > 0) {
    return runtimeResult({
      status: "failed",
      ownerScope: scope,
      commandId: input.command.commandId,
      reasonCodes: invalid,
      summaryId: input.command.summaryId,
    });
  }
  const store = createRawMessageMemoryGraphStore({
    storage: input.storage,
    ownerScope: scope,
    now: () => now,
  });
  try {
    let snapshot = await store.readSnapshot({
      ownerScope: scope,
      includeAuditOnly: true,
    });
    const priorCommandOperations = await store.readAppliedOperations({
      ownerScope: scope,
    });
    const fingerprint = commandFingerprint(
      "rollback",
      input.command,
      input.trustedContext,
    );
    if (
      hasCommandFingerprintConflict(
        priorCommandOperations,
        input.command.commandId,
        fingerprint,
      )
    ) {
      return runtimeResult({
        status: "conflict",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: ["memory_graph_command_id_payload_conflict"],
        summaryId: input.command.summaryId,
      });
    }
    const commandWasApplied = priorCommandOperations.some(
      (operation) => operation.metadata?.commandId === input.command.commandId,
    );
    if (
      input.command.expectedVersion !== undefined &&
      input.command.expectedVersion !== (snapshot.version ?? "0") &&
      !commandWasApplied
    ) {
      return runtimeResult({
        status: "conflict",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: ["memory_graph_version_conflict"],
        summaryId: input.command.summaryId,
      });
    }
    const existingAudit = await store.readAuditTrail({
      ownerScope: scope,
      nodeId: input.command.summaryId,
      includeDeprecated: true,
    });
    const predecessorSummaryNodeIds = predecessorSummaryIdsForSummary(
      snapshot,
      input.command.summaryId,
    );
    const directSourceRecordIds = sourceIdsForSummary(
      snapshot,
      input.command.summaryId,
    );
    const sourceRecordIds =
      predecessorSummaryNodeIds.length > 0 && directSourceRecordIds.length > 0
        ? directSourceRecordIds
        : unique([...directSourceRecordIds, ...existingAudit.sourceNodeIds]);
    if (sourceRecordIds.length === 0) {
      return runtimeResult({
        status: "no-op",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: snapshot.version,
        reasonCodes: ["memory_graph_rollback_source_records_not_found"],
        summaryId: input.command.summaryId,
      });
    }
    const prepare = buildMemoryGraphRollbackPreparePlan({
      ownerScope: scope,
      snapshot,
      commandId: input.command.commandId,
      summaryId: input.command.summaryId,
      sourceNodeIds: sourceRecordIds,
      predecessorSummaryNodeIds,
      reason: input.command.reason,
      requestedBy: input.trustedContext.requestedBy,
      now,
      persistence: { mode: "write", enabled: true },
    });
    for (const operation of prepare.operations) {
      operation.metadata = {
        ...(operation.metadata ?? {}),
        commandFingerprint: fingerprint,
      };
    }
    const prepared = await store.persistPlan(prepare);
    if (prepared.conflict) {
      return runtimeResult({
        status: "conflict",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: prepared.version,
        reasonCodes: [...prepare.reasonCodes, ...prepared.diagnostics],
        summaryId: input.command.summaryId,
        sourceRecordIds,
      });
    }
    if (typeof input.storage.restoreDeprecatedMessages !== "function") {
      return runtimeResult({
        status: "partial-failure",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: prepared.version,
        operations: prepared.appliedOperations,
        reasonCodes: [
          ...prepare.reasonCodes,
          "adapter_missing_restore_deprecated_messages",
        ],
        summaryId: input.command.summaryId,
        sourceRecordIds,
      });
    }
    let restoredRecords = 0;
    try {
      const summaryNode = snapshot.nodes.find(
        (node) => node.id === input.command.summaryId,
      );
      const correctedFromSummaryId =
        typeof summaryNode?.metadata?.correctedFromSummaryId === "string"
          ? summaryNode.metadata.correctedFromSummaryId
          : undefined;
      const deprecationSummaryIds = unique([
        input.command.summaryId,
        ...(correctedFromSummaryId ? [correctedFromSummaryId] : []),
      ]);
      for (const supersededBySummaryId of deprecationSummaryIds) {
        restoredRecords += await input.storage.restoreDeprecatedMessages(
          sourceRecordIds,
          {
            userId: scope.userId,
            supersededBySummaryId,
          },
        );
      }
    } catch (error) {
      return runtimeResult({
        status: "partial-failure",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: prepared.version,
        operations: prepared.appliedOperations,
        restoredRecords,
        reasonCodes: ["memory_graph_restore_deprecated_messages_failed"],
        summaryId: input.command.summaryId,
        sourceRecordIds,
        error: errorInfo(error),
      });
    }
    const restoredSources = await Promise.all(
      sourceRecordIds.map((messageId) =>
        input.storage.getMessageById(messageId),
      ),
    );
    const incompleteSourceRestore = restoredSources.some(
      (message) =>
        message === null ||
        !sameOwnerScope(ownerScopeFromMessage(message), scope) ||
        message.deprecatedAt !== undefined,
    );
    if (incompleteSourceRestore) {
      return runtimeResult({
        status: "partial-failure",
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: prepared.version,
        operations: prepared.appliedOperations,
        restoredRecords,
        reasonCodes: ["memory_graph_rollback_source_restore_incomplete"],
        summaryId: input.command.summaryId,
        sourceRecordIds,
      });
    }

    snapshot = await store.readSnapshot({
      ownerScope: scope,
      includeAuditOnly: true,
    });
    const appliedOperations = await store.readAppliedOperations({
      ownerScope: scope,
    });
    const previousLifecycleByClusterId: Record<
      string,
      MemoryClusterLifecycleStatus | undefined
    > = {};
    for (const operation of appliedOperations) {
      if (
        operation.kind === "set-cluster-lifecycle" &&
        operation.clusterId &&
        operation.supersededByNodeId === input.command.summaryId
      ) {
        previousLifecycleByClusterId[operation.clusterId] =
          operation.fromStatus;
      }
    }
    const finalize = buildMemoryGraphRollbackFinalizePlan({
      ownerScope: scope,
      snapshot,
      commandId: input.command.commandId,
      summaryId: input.command.summaryId,
      sourceNodeIds: sourceRecordIds,
      predecessorSummaryNodeIds,
      previousLifecycleByClusterId,
      reason: input.command.reason,
      requestedBy: input.trustedContext.requestedBy,
      now,
      persistence: { mode: "write", enabled: true },
    });
    for (const operation of finalize.operations) {
      operation.metadata = {
        ...(operation.metadata ?? {}),
        commandFingerprint: fingerprint,
      };
    }
    const finalized = await store.persistPlan(finalize);
    const audit = await store.readAuditTrail({
      ownerScope: scope,
      nodeId: input.command.summaryId,
      includeDeprecated: true,
    });
    return {
      ...runtimeResult({
        status: finalized.conflict
          ? "partial-failure"
          : persistenceStatus(finalized),
        ownerScope: scope,
        commandId: input.command.commandId,
        graphVersion: finalized.version,
        operations: [
          ...prepared.appliedOperations,
          ...finalized.appliedOperations,
        ],
        restoredRecords,
        reasonCodes: [
          ...prepare.reasonCodes,
          ...finalize.reasonCodes,
          ...prepared.diagnostics,
          ...finalized.diagnostics,
          ...(finalized.conflict
            ? ["memory_graph_rollback_finalize_version_conflict"]
            : []),
        ],
        summaryId: input.command.summaryId,
        sourceRecordIds,
      }),
      auditTrail: {
        sourceNodeIds: [...audit.sourceNodeIds],
        edgeIds: [...audit.edgeIds],
        operationIds: [...audit.operationIds],
      },
    };
  } catch (error) {
    return runtimeResult({
      status: "failed",
      ownerScope: scope,
      commandId: input.command.commandId,
      reasonCodes: ["memory_graph_rollback_failed"],
      summaryId: input.command.summaryId,
      error: errorInfo(error),
    });
  }
}
