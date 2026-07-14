import {
  type MemoryApplicabilityContext,
  type MemoryGraphAuditTrail,
  type MemoryGraphEvolutionEvidence,
  type MemoryGraphEvolutionRunResult,
  type MemoryGraphOperation,
  type MemoryGraphSnapshot,
  type MemoryGraphStore,
  type MemoryGraphUpdatePlan,
  type MemoryGraphUpdateResult,
  type OwnerScope,
  ownerScopeKey,
  runMemoryGraphEvolution,
  sameOwnerScope,
} from "../../ai/memory-consolidation/src";
export type { MemoryGraphEvolutionRunResult } from "../../ai/memory-consolidation/src";
import type { RawMessage, RawMessageQuery } from "./storage";

const LEDGER_METADATA_KEY = "memoryGraphLedger";
const LEDGER_MESSAGE_PREFIX = "__openloomi_memory_graph__";
const LEDGER_PLATFORM = "openloomi-internal";
const LEDGER_BOT_ID = "memory-graph";

export interface RawMessageGraphEvolutionStorage {
  storeMessage(message: RawMessage): Promise<number>;
  storeMessages(messages: RawMessage[]): Promise<number[]>;
  getMessageById(messageId: string): Promise<RawMessage | null>;
  queryMessages(query: RawMessageQuery): Promise<RawMessage[]>;
}

export interface RawMessageGraphEvolutionOptions {
  enabled?: boolean;
  dryRun?: boolean;
  workspaceId?: string;
  tenantId?: string;
  candidateLimit?: number;
}

export interface StoreRawMessagesWithGraphEvolutionInput {
  storage: RawMessageGraphEvolutionStorage;
  messages: RawMessage[];
  graphEvolution?: RawMessageGraphEvolutionOptions;
  now?: number;
}

export interface StoreRawMessagesWithGraphEvolutionResult {
  ids: number[];
  graphEvolution: MemoryGraphEvolutionRunResult;
}

interface MemoryGraphLedgerPayload {
  schemaVersion: 1;
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  appliedOperations: MemoryGraphOperation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isOwnerScopeValue(value: unknown): value is OwnerScope {
  return (
    isRecord(value) &&
    typeof value.userId === "string" &&
    (value.workspaceId === undefined ||
      typeof value.workspaceId === "string") &&
    (value.tenantId === undefined || typeof value.tenantId === "string")
  );
}

export function parseRawMessageGraphEvolutionOptions(
  value: unknown,
): RawMessageGraphEvolutionOptions {
  if (!isRecord(value)) return {};
  const candidateLimit =
    typeof value.candidateLimit === "number" &&
    Number.isFinite(value.candidateLimit)
      ? Math.max(1, Math.min(500, Math.floor(value.candidateLimit)))
      : undefined;
  return {
    enabled: value.enabled === true,
    dryRun: value.dryRun === true,
    workspaceId: optionalString(value.workspaceId),
    tenantId: optionalString(value.tenantId),
    candidateLimit,
  };
}

export function memoryGraphLedgerMessageId(ownerScope: OwnerScope): string {
  return `${LEDGER_MESSAGE_PREFIX}:${ownerScopeKey(ownerScope)}`;
}

function assertNoReservedGraphPayload(messages: RawMessage[]): void {
  const reserved = messages.some(
    (message) =>
      message.messageId.startsWith(`${LEDGER_MESSAGE_PREFIX}:`) ||
      message.metadata?.[LEDGER_METADATA_KEY] !== undefined,
  );
  if (reserved) {
    throw new Error(
      "Raw messages cannot use the internal memory graph namespace",
    );
  }
}

function emptySnapshot(
  ownerScope: OwnerScope,
  now: number,
): MemoryGraphSnapshot {
  return {
    ownerScope: { ...ownerScope },
    nodes: [],
    edges: [],
    clusters: [],
    version: "0",
    capturedAt: now,
  };
}

function cloneSnapshot(snapshot: MemoryGraphSnapshot): MemoryGraphSnapshot {
  return {
    ...snapshot,
    ownerScope: { ...snapshot.ownerScope },
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      ownerScope: { ...node.ownerScope },
      applicability: node.applicability ? { ...node.applicability } : undefined,
      metadata: node.metadata ? { ...node.metadata } : undefined,
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      ownerScope: { ...edge.ownerScope },
      evidenceNodeIds: [...edge.evidenceNodeIds],
      reasonCodes: [...edge.reasonCodes],
      applicability: edge.applicability ? { ...edge.applicability } : undefined,
      metadata: edge.metadata ? { ...edge.metadata } : undefined,
    })),
    clusters: snapshot.clusters.map((cluster) => ({
      ...cluster,
      ownerScope: { ...cluster.ownerScope },
      nodeIds: [...cluster.nodeIds],
      reasonCodes: [...cluster.reasonCodes],
      applicability: cluster.applicability
        ? { ...cluster.applicability }
        : undefined,
      metadata: cluster.metadata ? { ...cluster.metadata } : undefined,
    })),
  };
}

function parseLedger(
  message: RawMessage | null,
  ownerScope: OwnerScope,
  now: number,
): MemoryGraphLedgerPayload {
  const value = message?.metadata?.[LEDGER_METADATA_KEY];
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return {
      schemaVersion: 1,
      ownerScope: { ...ownerScope },
      snapshot: emptySnapshot(ownerScope, now),
      appliedOperations: [],
    };
  }
  const storedScope = value.ownerScope;
  const snapshot = value.snapshot;
  const appliedOperations = value.appliedOperations;
  if (
    !isOwnerScopeValue(storedScope) ||
    !sameOwnerScope(storedScope, ownerScope) ||
    !isRecord(snapshot) ||
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.edges) ||
    !Array.isArray(snapshot.clusters) ||
    !Array.isArray(appliedOperations)
  ) {
    throw new Error("Invalid owner-scoped memory graph ledger payload");
  }
  const graphObjects = [
    ...snapshot.nodes,
    ...snapshot.edges,
    ...snapshot.clusters,
    ...appliedOperations,
  ];
  if (
    !isOwnerScopeValue(snapshot.ownerScope) ||
    !sameOwnerScope(snapshot.ownerScope, ownerScope) ||
    graphObjects.some(
      (item) =>
        !isRecord(item) ||
        !isOwnerScopeValue(item.ownerScope) ||
        !sameOwnerScope(item.ownerScope, ownerScope),
    )
  ) {
    throw new Error("Invalid owner-scoped memory graph ledger payload");
  }
  const storedSnapshot = snapshot as unknown as MemoryGraphSnapshot;
  const storedOperations = appliedOperations as MemoryGraphOperation[];
  return {
    schemaVersion: 1,
    ownerScope: { ...ownerScope },
    snapshot: cloneSnapshot(storedSnapshot),
    appliedOperations: storedOperations,
  };
}

function nextVersion(version: string | undefined): string {
  const parsed = Number.parseInt(version ?? "0", 10);
  return String(Number.isFinite(parsed) ? parsed + 1 : 1);
}

function scopeErrors(plan: MemoryGraphUpdatePlan): string[] {
  const scopes = [
    ...plan.candidateNodes.map((node) => node.ownerScope),
    ...plan.candidateEdges.map((edge) => edge.ownerScope),
    ...(plan.candidateClusters ?? []).map((cluster) => cluster.ownerScope),
    ...plan.operations.map((operation) => operation.ownerScope),
  ];
  return scopes.some((scope) => !sameOwnerScope(scope, plan.ownerScope))
    ? ["memory_graph_scope_mismatch"]
    : [];
}

function noMutationResult(
  plan: MemoryGraphUpdatePlan,
  diagnostics: string[],
  options: { conflict?: boolean; replayed?: boolean; version?: string } = {},
): MemoryGraphUpdateResult {
  return {
    ownerScope: { ...plan.ownerScope },
    appliedOperations: [],
    skippedOperations: plan.operations.map((operation) => ({
      operation,
      reasonCodes: diagnostics,
    })),
    mutatesGraph: false,
    diagnostics,
    conflict: options.conflict,
    replayed: options.replayed,
    version: options.version,
  };
}

function filterSnapshot(
  snapshot: MemoryGraphSnapshot,
  query: Parameters<MemoryGraphStore["readSnapshot"]>[0],
): MemoryGraphSnapshot {
  const nodeIds = query.nodeIds ? new Set(query.nodeIds) : undefined;
  const clusterIds = query.clusterIds ? new Set(query.clusterIds) : undefined;
  return {
    ...cloneSnapshot(snapshot),
    nodes: snapshot.nodes.filter(
      (node) =>
        sameOwnerScope(node.ownerScope, query.ownerScope) &&
        (!nodeIds || nodeIds.has(node.id)) &&
        (query.includeAuditOnly || node.visibility !== "audit-only"),
    ),
    edges: snapshot.edges.filter(
      (edge) =>
        sameOwnerScope(edge.ownerScope, query.ownerScope) &&
        (!nodeIds ||
          nodeIds.has(edge.fromNodeId) ||
          nodeIds.has(edge.toNodeId)),
    ),
    clusters: snapshot.clusters.filter(
      (cluster) =>
        sameOwnerScope(cluster.ownerScope, query.ownerScope) &&
        (!clusterIds || clusterIds.has(cluster.clusterId)),
    ),
  };
}

const ownerGraphLocks = new Map<string, Promise<void>>();

async function withOwnerGraphLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = ownerGraphLocks.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  ownerGraphLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (ownerGraphLocks.get(key) === queued) ownerGraphLocks.delete(key);
  }
}

export function createRawMessageMemoryGraphStore(input: {
  storage: RawMessageGraphEvolutionStorage;
  ownerScope: OwnerScope;
  now?: () => number;
}): MemoryGraphStore {
  const clock = input.now ?? Date.now;
  const readLedger = async () =>
    parseLedger(
      await input.storage.getMessageById(
        memoryGraphLedgerMessageId(input.ownerScope),
      ),
      input.ownerScope,
      clock(),
    );

  return {
    async readSnapshot(query) {
      if (!sameOwnerScope(query.ownerScope, input.ownerScope)) {
        return emptySnapshot(query.ownerScope, clock());
      }
      return filterSnapshot((await readLedger()).snapshot, query);
    },

    async persistPlan(plan) {
      return withOwnerGraphLock(ownerScopeKey(input.ownerScope), async () => {
        if (!sameOwnerScope(plan.ownerScope, input.ownerScope)) {
          return noMutationResult(plan, ["memory_graph_scope_mismatch"]);
        }
        const invalidScopes = scopeErrors(plan);
        if (invalidScopes.length > 0) {
          return noMutationResult(plan, invalidScopes);
        }
        if (!plan.persistence.enabled || plan.persistence.mode !== "write") {
          return noMutationResult(plan, ["memory_graph_persistence_disabled"]);
        }

        const ledger = await readLedger();
        const currentVersion = ledger.snapshot.version ?? "0";
        const appliedIds = new Set(
          ledger.appliedOperations.map((operation) => operation.operationId),
        );
        const pendingOperations = plan.operations.filter(
          (operation) => !appliedIds.has(operation.operationId),
        );
        if (pendingOperations.length === 0) {
          return noMutationResult(plan, ["memory_graph_operation_replayed"], {
            replayed: true,
            version: currentVersion,
          });
        }
        if (
          plan.expectedVersion !== undefined &&
          plan.expectedVersion !== currentVersion
        ) {
          return noMutationResult(plan, ["memory_graph_version_conflict"], {
            conflict: true,
            version: currentVersion,
          });
        }

        const snapshot = cloneSnapshot(ledger.snapshot);
        const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
        const edges = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
        const clusters = new Map(
          snapshot.clusters.map((cluster) => [cluster.clusterId, cluster]),
        );
        for (const node of plan.candidateNodes) nodes.set(node.id, node);
        for (const edge of plan.candidateEdges) edges.set(edge.id, edge);
        for (const candidate of plan.candidateClusters ?? []) {
          const candidateNodes = new Set(candidate.nodeIds);
          for (const [clusterId, cluster] of clusters) {
            if (clusterId === candidate.clusterId) continue;
            const remainingNodeIds = cluster.nodeIds.filter(
              (nodeId) => !candidateNodes.has(nodeId),
            );
            if (remainingNodeIds.length === 0) clusters.delete(clusterId);
            else if (remainingNodeIds.length !== cluster.nodeIds.length) {
              clusters.set(clusterId, {
                ...cluster,
                nodeIds: remainingNodeIds,
              });
            }
          }
          clusters.set(candidate.clusterId, candidate);
        }

        const now = clock();
        const version = nextVersion(currentVersion);
        const updatedSnapshot: MemoryGraphSnapshot = {
          ownerScope: { ...input.ownerScope },
          nodes: [...nodes.values()],
          edges: [...edges.values()],
          clusters: [...clusters.values()],
          version,
          capturedAt: now,
        };
        const payload: MemoryGraphLedgerPayload = {
          schemaVersion: 1,
          ownerScope: { ...input.ownerScope },
          snapshot: updatedSnapshot,
          appliedOperations: [
            ...ledger.appliedOperations,
            ...pendingOperations,
          ],
        };
        await input.storage.storeMessage({
          messageId: memoryGraphLedgerMessageId(input.ownerScope),
          platform: LEDGER_PLATFORM,
          botId: LEDGER_BOT_ID,
          userId: input.ownerScope.userId,
          channel: input.ownerScope.workspaceId,
          timestamp: Math.floor(now / 1000),
          content: "OpenLoomi internal memory graph ledger",
          attachments: [],
          metadata: { [LEDGER_METADATA_KEY]: payload },
          createdAt: Math.floor(now / 1000),
          memoryStage: "long",
          archivedAt: Math.floor(now / 1000),
          isPinned: true,
        });

        return {
          ownerScope: { ...input.ownerScope },
          appliedOperations: pendingOperations,
          skippedOperations: plan.operations
            .filter((operation) => appliedIds.has(operation.operationId))
            .map((operation) => ({
              operation,
              reasonCodes: ["memory_graph_operation_replayed"],
            })),
          mutatesGraph: true,
          diagnostics: ["memory_graph_plan_persisted"],
          version,
        };
      });
    },

    async readAuditTrail(query): Promise<MemoryGraphAuditTrail> {
      const ledger = await readLedger();
      if (!sameOwnerScope(query.ownerScope, input.ownerScope)) {
        return {
          ownerScope: { ...query.ownerScope },
          nodeId: query.nodeId,
          sourceNodeIds: [],
          edgeIds: [],
          operationIds: [],
          reasonCodes: ["memory_graph_scope_mismatch"],
        };
      }
      const node = ledger.snapshot.nodes.find(
        (item) => item.id === query.nodeId,
      );
      const edges = ledger.snapshot.edges.filter(
        (edge) =>
          edge.fromNodeId === query.nodeId || edge.toNodeId === query.nodeId,
      );
      const operations = ledger.appliedOperations.filter((operation) =>
        operation.nodeIds.includes(query.nodeId),
      );
      return {
        ownerScope: { ...input.ownerScope },
        nodeId: query.nodeId,
        sourceNodeIds: [
          ...(node?.sourceId ? [node.sourceId] : []),
          ...edges.flatMap((edge) => edge.evidenceNodeIds),
        ].filter((value, index, values) => values.indexOf(value) === index),
        edgeIds: edges.map((edge) => edge.id),
        operationIds: operations.map((operation) => operation.operationId),
        reasonCodes: node
          ? ["memory_graph_audit_trail_available"]
          : ["memory_graph_node_not_found"],
      };
    },
  };
}

export function ownerScopeFromMessage(message: RawMessage): OwnerScope {
  const stored = message.metadata?.memoryOwnerScope;
  if (isRecord(stored) && typeof stored.userId === "string") {
    return {
      userId: stored.userId,
      workspaceId: optionalString(stored.workspaceId),
      tenantId: optionalString(stored.tenantId),
    };
  }
  return { userId: message.userId };
}

export function applicabilityFromMessage(
  message: RawMessage,
): MemoryApplicabilityContext {
  const stored = message.metadata?.memoryApplicability;
  if (isRecord(stored) && typeof stored.scope === "string") {
    const scope = stored.scope;
    if (
      [
        "global",
        "task",
        "conversation",
        "channel",
        "project",
        "custom",
      ].includes(scope)
    ) {
      return {
        scope: scope as MemoryApplicabilityContext["scope"],
        key: optionalString(stored.key),
        validFrom:
          typeof stored.validFrom === "number" ? stored.validFrom : undefined,
        validUntil:
          typeof stored.validUntil === "number" ? stored.validUntil : undefined,
      };
    }
  }
  return message.channel
    ? { scope: "channel", key: `${message.platform}:${message.channel}` }
    : { scope: "global" };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function messageToEvidence(message: RawMessage): MemoryGraphEvolutionEvidence {
  const relation = message.metadata?.memoryRelation;
  return {
    id: message.messageId,
    ownerScope: ownerScopeFromMessage(message),
    timestamp:
      message.timestamp < 1e11 ? message.timestamp * 1000 : message.timestamp,
    text: message.content,
    relationGroup:
      optionalString(message.metadata?.relationGroup) ??
      (isRecord(relation) ? optionalString(relation.group) : undefined),
    relationValue:
      optionalString(message.metadata?.relationValue) ??
      (isRecord(relation) ? optionalString(relation.value) : undefined),
    topicKeys: stringArray(
      message.metadata?.memoryTopicKeys ?? message.metadata?.topicKeys,
    ),
    applicability: applicabilityFromMessage(message),
    sourceIdentity:
      optionalString(message.metadata?.sourceIdentity) ?? message.messageId,
    accessCount: message.accessCount,
    importanceScore: message.importanceScore,
    metadata: message.metadata,
  };
}

function withGraphMetadata(
  message: RawMessage,
  ownerScope: OwnerScope,
): RawMessage {
  const applicability = applicabilityFromMessage(message);
  return {
    ...message,
    metadata: {
      ...message.metadata,
      memoryOwnerScope: ownerScope,
      memoryApplicability: applicability,
    },
  };
}

function disabledResult(ownerScope: OwnerScope): MemoryGraphEvolutionRunResult {
  return {
    status: "disabled",
    ownerScope,
    consideredCandidateIds: [],
    reasonCodes: ["memory_graph_evolution_disabled"],
  };
}

export async function storeRawMessagesWithGraphEvolution(
  input: StoreRawMessagesWithGraphEvolutionInput,
): Promise<StoreRawMessagesWithGraphEvolutionResult> {
  if (input.messages.length === 0) {
    const ownerScope = { userId: "" };
    return { ids: [], graphEvolution: disabledResult(ownerScope) };
  }
  assertNoReservedGraphPayload(input.messages);
  const options = input.graphEvolution ?? {};
  const ownerScope: OwnerScope = {
    userId: input.messages[0].userId,
    workspaceId: options.workspaceId,
    tenantId: options.tenantId,
  };
  const mixedOwnerBatch = input.messages.some(
    (message) => message.userId !== ownerScope.userId,
  );
  const scopedMessages = input.messages.map((message) =>
    withGraphMetadata(message, {
      userId: message.userId,
      workspaceId: options.workspaceId,
      tenantId: options.tenantId,
    }),
  );
  const ids = await input.storage.storeMessages(scopedMessages);
  if (options.enabled !== true) {
    return { ids, graphEvolution: disabledResult(ownerScope) };
  }

  if (
    mixedOwnerBatch ||
    scopedMessages.some(
      (message) => !sameOwnerScope(ownerScopeFromMessage(message), ownerScope),
    )
  ) {
    return {
      ids,
      graphEvolution: {
        status: "failed",
        ownerScope,
        consideredCandidateIds: [],
        reasonCodes: ["memory_graph_scope_mismatch"],
      },
    };
  }

  const candidateLimit = options.candidateLimit ?? 200;
  const newIds = new Set(scopedMessages.map((message) => message.messageId));
  const candidates = (
    await input.storage.queryMessages({
      userId: ownerScope.userId,
      includeArchived: false,
      includeDeprecated: true,
      reverse: true,
      limit: candidateLimit + scopedMessages.length,
    })
  ).filter(
    (message) =>
      !newIds.has(message.messageId) &&
      !message.metadata?.[LEDGER_METADATA_KEY] &&
      sameOwnerScope(ownerScopeFromMessage(message), ownerScope),
  );
  const store = createRawMessageMemoryGraphStore({
    storage: input.storage,
    ownerScope,
    now: () => input.now ?? Date.now(),
  });
  const graphEvolution = await runMemoryGraphEvolution({
    ownerScope,
    newEvidence: scopedMessages.map(messageToEvidence),
    candidateEvidence: candidates.map(messageToEvidence),
    store,
    enabled: true,
    dryRun: options.dryRun,
    now: input.now,
  });
  return { ids, graphEvolution };
}
