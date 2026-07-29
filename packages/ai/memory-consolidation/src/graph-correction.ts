import type {
  MemoryClusterLifecycleStatus,
  MemoryGraphClusterSnapshot,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphOperation,
  MemoryGraphPersistenceMode,
  MemoryGraphSnapshot,
  MemoryGraphUpdatePlan,
  OwnerScope,
} from "./graph-contracts";
import { applicabilityEquivalent, sameOwnerScope } from "./graph-evolution";

export type MemoryGraphCorrectionAction =
  | {
      type: "correct-summary";
      clusterId: string;
      summaryId: string;
      correctedSummaryId: string;
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

interface CommandPlanInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  commandId: string;
  reason: string;
  requestedBy?: string;
  now: number;
  persistence: MemoryGraphPersistenceMode;
}

export interface BuildMemoryGraphCorrectionPlanInput extends CommandPlanInput {
  action: MemoryGraphCorrectionAction;
}

export interface BuildMemoryGraphRollbackPreparePlanInput extends CommandPlanInput {
  summaryId: string;
  sourceNodeIds: string[];
  predecessorSummaryNodeIds?: string[];
}

export interface BuildMemoryGraphRollbackFinalizePlanInput extends BuildMemoryGraphRollbackPreparePlanInput {
  previousLifecycleByClusterId?: Record<
    string,
    MemoryClusterLifecycleStatus | undefined
  >;
}

function sameScope(left: OwnerScope, right: OwnerScope): boolean {
  return sameOwnerScope(left, right);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function operationId(commandId: string, suffix: string): string {
  return `memory-graph-command:${encodeURIComponent(commandId)}:${suffix}`;
}

function metadata(input: CommandPlanInput): Record<string, unknown> {
  return {
    commandId: input.commandId,
    reason: input.reason,
    requestedBy: input.requestedBy,
  };
}

function copyNode(node: MemoryGraphNode): MemoryGraphNode {
  return {
    ...node,
    ownerScope: { ...node.ownerScope },
    applicability: node.applicability ? { ...node.applicability } : undefined,
    metadata: node.metadata ? { ...node.metadata } : undefined,
  };
}

function copyEdge(edge: MemoryGraphEdge): MemoryGraphEdge {
  return {
    ...edge,
    ownerScope: { ...edge.ownerScope },
    evidenceNodeIds: [...edge.evidenceNodeIds],
    reasonCodes: [...edge.reasonCodes],
    applicability: edge.applicability ? { ...edge.applicability } : undefined,
    metadata: edge.metadata ? { ...edge.metadata } : undefined,
  };
}

function copyCluster(
  cluster: MemoryGraphClusterSnapshot,
): MemoryGraphClusterSnapshot {
  return {
    ...cluster,
    ownerScope: { ...cluster.ownerScope },
    nodeIds: [...cluster.nodeIds],
    reasonCodes: [...cluster.reasonCodes],
    applicability: cluster.applicability
      ? { ...cluster.applicability }
      : undefined,
    metadata: cluster.metadata ? { ...cluster.metadata } : undefined,
  };
}

function emptyPlan(
  input: CommandPlanInput,
  reasonCodes: string[],
): MemoryGraphUpdatePlan {
  return {
    planId: `memory-graph-command:${encodeURIComponent(input.commandId)}`,
    ownerScope: { ...input.ownerScope },
    candidateNodes: [],
    candidateEdges: [],
    candidateClusters: [],
    operations: [],
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes,
    metadata: metadata(input),
  };
}

function sameApplicability(
  node: MemoryGraphNode,
  cluster: MemoryGraphClusterSnapshot,
): boolean {
  return applicabilityEquivalent(node.applicability, cluster.applicability);
}

interface MemoryGraphCorrectionChanges {
  candidateNodes: MemoryGraphNode[];
  candidateEdges: MemoryGraphEdge[];
  candidateClusters: MemoryGraphClusterSnapshot[];
  operations: MemoryGraphOperation[];
}

function plannedCorrection(
  input: BuildMemoryGraphCorrectionPlanInput,
  changes: MemoryGraphCorrectionChanges,
): MemoryGraphUpdatePlan {
  return {
    planId: `memory-graph-correction:${encodeURIComponent(input.commandId)}`,
    ownerScope: { ...input.ownerScope },
    ...changes,
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes: unique([
      "memory_graph_correction_planned",
      ...changes.operations.flatMap((operation) => operation.reasonCodes),
    ]),
    metadata: metadata(input),
  };
}
function buildRemoveMemberCorrectionPlan(input: {
  command: BuildMemoryGraphCorrectionPlanInput;
  action: Extract<MemoryGraphCorrectionAction, { type: "remove-member" }>;
  cluster: MemoryGraphClusterSnapshot;
  nodesById: Map<string, MemoryGraphNode>;
}): MemoryGraphUpdatePlan {
  const { command, action, cluster, nodesById } = input;
  const candidateNodes: MemoryGraphNode[] = [];
  const candidateEdges: MemoryGraphEdge[] = [];
  const candidateClusters: MemoryGraphClusterSnapshot[] = [];
  const operations: MemoryGraphOperation[] = [];
  const commandMetadata = metadata(command);

  const node = nodesById.get(action.nodeId);
  if (
    !node ||
    !cluster.nodeIds.includes(node.id) ||
    cluster.nodeIds.length <= 1
  ) {
    return emptyPlan(command, ["memory_graph_correction_member_not_found"]);
  }
  const separatedClusterId =
    action.separatedClusterId ??
    `${cluster.clusterId}:corrected:${encodeURIComponent(node.id)}`;
  if (
    separatedClusterId === cluster.clusterId ||
    command.snapshot.clusters.some(
      (candidate) => candidate.clusterId === separatedClusterId,
    )
  ) {
    return emptyPlan(command, [
      "memory_graph_correction_separated_cluster_id_conflict",
    ]);
  }
  const representative = cluster.representativeNodeId
    ? nodesById.get(cluster.representativeNodeId)
    : undefined;
  const representativeSourceNodeIds = representative
    ? unique([
        ...(Array.isArray(representative.metadata?.sourceNodeIds)
          ? representative.metadata.sourceNodeIds.filter(
              (value): value is string => typeof value === "string",
            )
          : []),
        ...command.snapshot.edges
          .filter(
            (edge) =>
              edge.kind === "supersede" &&
              edge.toNodeId === representative.id &&
              sameScope(edge.ownerScope, command.ownerScope),
          )
          .map((edge) => edge.fromNodeId)
          .filter((nodeId) => nodesById.get(nodeId)?.type === "raw"),
      ])
    : [];
  const predecessorSummaryNodeIds = representative
    ? unique(
        command.snapshot.edges
          .filter(
            (edge) =>
              edge.kind === "supersede" &&
              edge.toNodeId === representative.id &&
              sameScope(edge.ownerScope, command.ownerScope),
          )
          .map((edge) => edge.fromNodeId)
          .filter((nodeId) => {
            const source = nodesById.get(nodeId);
            return source?.type === "summary" || source?.type === "artifact";
          }),
      )
    : [];
  const restoreSourceNodeIds = unique([
    node.id,
    ...representativeSourceNodeIds,
  ]);
  for (const sourceNodeId of restoreSourceNodeIds) {
    const source = nodesById.get(sourceNodeId);
    if (!source || source.type !== "raw") continue;
    candidateNodes.push({
      ...copyNode(source),
      visibility: "default",
      updatedAt: command.now,
      metadata: {
        ...(source.metadata ?? {}),
        ...(source.id === node.id ? { membershipCorrected: true } : {}),
        restoredAfterRepresentativeCorrection: representative?.id,
        ...commandMetadata,
      },
    });
  }
  if (
    representative &&
    (representative.type === "summary" || representative.type === "artifact")
  ) {
    candidateNodes.push({
      ...copyNode(representative),
      visibility: "audit-only",
      updatedAt: command.now,
      metadata: {
        ...(representative.metadata ?? {}),
        invalidatedByMemberCorrection: node.id,
        ...commandMetadata,
      },
    });
  }
  for (const predecessorNodeId of predecessorSummaryNodeIds) {
    const predecessor = nodesById.get(predecessorNodeId);
    if (!predecessor) continue;
    candidateNodes.push({
      ...copyNode(predecessor),
      visibility: "default",
      updatedAt: command.now,
      metadata: {
        ...(predecessor.metadata ?? {}),
        supersededBySummaryId: undefined,
        restoredAfterRepresentativeCorrection: representative?.id,
        ...commandMetadata,
      },
    });
  }
  const updatedCluster = copyCluster(cluster);
  updatedCluster.nodeIds = updatedCluster.nodeIds.filter(
    (nodeId) => nodeId !== node.id,
  );
  updatedCluster.updatedAt = command.now;
  updatedCluster.reasonCodes = unique([
    ...updatedCluster.reasonCodes,
    "memory_graph_membership_corrected",
  ]);
  if (representative) {
    updatedCluster.representativeNodeId = undefined;
    const remainingRawCount = updatedCluster.nodeIds.filter(
      (nodeId) => nodesById.get(nodeId)?.type === "raw",
    ).length;
    updatedCluster.lifecycleStatus =
      remainingRawCount >= 2 ? "active" : "forming";
  }
  const restoredClusters = representative
    ? command.snapshot.clusters
        .filter(
          (candidate) =>
            candidate.clusterId !== cluster.clusterId &&
            candidate.metadata?.supersededBySummaryId === representative.id &&
            sameScope(candidate.ownerScope, command.ownerScope),
        )
        .map((candidate) => {
          const restored = copyCluster(candidate);
          const rawCount = restored.nodeIds.filter(
            (nodeId) => nodesById.get(nodeId)?.type === "raw",
          ).length;
          restored.lifecycleStatus = rawCount >= 2 ? "active" : "forming";
          restored.updatedAt = command.now;
          restored.reasonCodes = unique([
            ...restored.reasonCodes,
            "memory_graph_representative_correction_restored_cluster",
          ]);
          restored.metadata = {
            ...(restored.metadata ?? {}),
            restoredAfterRepresentativeCorrection: representative.id,
            ...commandMetadata,
          };
          return restored;
        })
    : [];
  candidateClusters.push(updatedCluster, ...restoredClusters, {
    clusterId: separatedClusterId,
    ownerScope: { ...command.ownerScope },
    nodeIds: [node.id],
    lifecycleStatus: "forming",
    supportScore: 0,
    updatedAt: command.now,
    reasonCodes: ["memory_graph_membership_corrected"],
    applicability: node.applicability ? { ...node.applicability } : undefined,
    metadata: {
      correctedFromClusterId: cluster.clusterId,
      ...commandMetadata,
    },
  });
  const retiredEdgeIds = new Set<string>();
  for (const edge of command.snapshot.edges) {
    const retiresRepresentativeEdge =
      representative !== undefined &&
      edge.kind === "supersede" &&
      edge.toNodeId === representative.id;
    const separatesMemberEdge =
      (edge.kind === "support" || edge.kind === "supersede") &&
      (edge.fromNodeId === node.id || edge.toNodeId === node.id);
    if (
      !sameScope(edge.ownerScope, command.ownerScope) ||
      (!retiresRepresentativeEdge && !separatesMemberEdge) ||
      retiredEdgeIds.has(edge.id)
    ) {
      continue;
    }
    retiredEdgeIds.add(edge.id);
    candidateEdges.push({
      ...copyEdge(edge),
      weight: 0,
      updatedAt: command.now,
      reasonCodes: unique([
        ...edge.reasonCodes,
        "memory_graph_membership_corrected",
      ]),
      metadata: {
        ...(edge.metadata ?? {}),
        inactive: true,
        ...commandMetadata,
      },
    });
  }
  operations.push({
    operationId: operationId(command.commandId, `remove-member:${node.id}`),
    ownerScope: { ...command.ownerScope },
    kind: "remove-cluster-member",
    nodeIds: unique([
      node.id,
      ...restoreSourceNodeIds,
      ...predecessorSummaryNodeIds,
      ...(representative ? [representative.id] : []),
    ]),
    clusterId: cluster.clusterId,
    reasonCodes: ["memory_graph_membership_corrected"],
    metadata: {
      ...commandMetadata,
      separatedClusterId,
      restoreSourceNodeIds,
      predecessorSummaryNodeIds,
      retiredSummaryId: representative?.id,
      restoredClusterIds: restoredClusters.map((item) => item.clusterId),
    },
  });
  return plannedCorrection(command, {
    candidateNodes,
    candidateEdges,
    candidateClusters,
    operations,
  });
}
function buildLifecycleCorrectionPlan(input: {
  command: BuildMemoryGraphCorrectionPlanInput;
  action: Extract<MemoryGraphCorrectionAction, { type: "set-lifecycle" }>;
  cluster: MemoryGraphClusterSnapshot;
}): MemoryGraphUpdatePlan {
  const { command, action, cluster } = input;
  const candidateNodes: MemoryGraphNode[] = [];
  const candidateEdges: MemoryGraphEdge[] = [];
  const candidateClusters: MemoryGraphClusterSnapshot[] = [];
  const operations: MemoryGraphOperation[] = [];
  const commandMetadata = metadata(command);

  const updatedCluster = copyCluster(cluster);
  const fromStatus = updatedCluster.lifecycleStatus;
  updatedCluster.lifecycleStatus = action.lifecycleStatus;
  updatedCluster.updatedAt = command.now;
  updatedCluster.reasonCodes = unique([
    ...updatedCluster.reasonCodes,
    "memory_graph_lifecycle_corrected",
  ]);
  candidateClusters.push(updatedCluster);
  operations.push({
    operationId: operationId(
      command.commandId,
      `lifecycle:${cluster.clusterId}`,
    ),
    ownerScope: { ...command.ownerScope },
    kind: "set-cluster-lifecycle",
    nodeIds: [...cluster.nodeIds],
    clusterId: cluster.clusterId,
    fromStatus,
    toStatus: action.lifecycleStatus,
    reasonCodes: ["memory_graph_lifecycle_corrected"],
    metadata: commandMetadata,
  });
  return plannedCorrection(command, {
    candidateNodes,
    candidateEdges,
    candidateClusters,
    operations,
  });
}
function buildRepresentativeCorrectionPlan(input: {
  command: BuildMemoryGraphCorrectionPlanInput;
  action: Extract<
    MemoryGraphCorrectionAction,
    { type: "correct-summary" | "set-representative" }
  >;
  cluster: MemoryGraphClusterSnapshot;
  nodesById: Map<string, MemoryGraphNode>;
}): MemoryGraphUpdatePlan {
  const { command, action, cluster, nodesById } = input;
  const candidateNodes: MemoryGraphNode[] = [];
  const candidateEdges: MemoryGraphEdge[] = [];
  const candidateClusters: MemoryGraphClusterSnapshot[] = [];
  const operations: MemoryGraphOperation[] = [];
  const commandMetadata = metadata(command);

  const representativeNodeId =
    action.type === "correct-summary"
      ? action.correctedSummaryId
      : action.representativeNodeId;
  const sourceSummary =
    action.type === "correct-summary"
      ? nodesById.get(action.summaryId)
      : undefined;
  const correctedSourceNodeIds =
    action.type === "correct-summary" &&
    Array.isArray(sourceSummary?.metadata?.sourceNodeIds)
      ? sourceSummary.metadata.sourceNodeIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  if (
    action.type === "correct-summary" &&
    (!sourceSummary ||
      sourceSummary.type !== "summary" ||
      !cluster.nodeIds.includes(sourceSummary.id) ||
      !sameApplicability(sourceSummary, cluster))
  ) {
    return emptyPlan(command, [
      "memory_graph_correction_summary_not_in_cluster",
    ]);
  }
  const existingCorrectedNode = nodesById.get(representativeNodeId);
  if (
    action.type === "correct-summary" &&
    existingCorrectedNode &&
    (existingCorrectedNode.type !== "summary" ||
      existingCorrectedNode.metadata?.correctedFromSummaryId !==
        action.summaryId ||
      !cluster.nodeIds.includes(existingCorrectedNode.id))
  ) {
    return emptyPlan(command, [
      "memory_graph_correction_corrected_summary_id_conflict",
    ]);
  }
  const representative: MemoryGraphNode | undefined =
    action.type === "correct-summary"
      ? (existingCorrectedNode ?? {
          id: representativeNodeId,
          ownerScope: { ...command.ownerScope },
          type: "summary",
          sourceId: action.summaryId,
          createdAt: command.now,
          updatedAt: command.now,
          visibility: "default",
          applicability: cluster.applicability
            ? { ...cluster.applicability }
            : undefined,
          metadata: {
            correctedFromSummaryId: action.summaryId,
            sourceNodeIds: correctedSourceNodeIds,
            clusterId: cluster.clusterId,
            ...commandMetadata,
          },
        })
      : nodesById.get(representativeNodeId);
  if (
    !representative ||
    !sameScope(representative.ownerScope, command.ownerScope) ||
    !sameApplicability(representative, cluster) ||
    (representative.type === "raw" && representative.visibility !== "default")
  ) {
    return emptyPlan(command, [
      "memory_graph_correction_representative_not_found_or_inapplicable",
    ]);
  }
  if (
    action.type === "set-representative" &&
    !cluster.nodeIds.includes(representative.id)
  ) {
    return emptyPlan(command, [
      "memory_graph_correction_representative_not_in_cluster",
    ]);
  }
  const oldRepresentative = cluster.representativeNodeId
    ? nodesById.get(cluster.representativeNodeId)
    : undefined;
  if (oldRepresentative && oldRepresentative.id !== representativeNodeId) {
    candidateNodes.push({
      ...copyNode(oldRepresentative),
      visibility: "audit-only",
      updatedAt: command.now,
      metadata: {
        ...(oldRepresentative.metadata ?? {}),
        correctedByRepresentativeId: representativeNodeId,
        ...commandMetadata,
      },
    });
  }
  candidateNodes.push({
    ...copyNode(representative),
    visibility: "default",
    updatedAt: command.now,
  });
  const updatedCluster = copyCluster(cluster);
  updatedCluster.nodeIds = unique([
    ...updatedCluster.nodeIds,
    representativeNodeId,
  ]);
  updatedCluster.representativeNodeId = representativeNodeId;
  updatedCluster.updatedAt = command.now;
  updatedCluster.reasonCodes = unique([
    ...updatedCluster.reasonCodes,
    "memory_graph_representative_corrected",
  ]);
  candidateClusters.push(updatedCluster);
  operations.push({
    operationId: operationId(
      command.commandId,
      `representative:${representativeNodeId}`,
    ),
    ownerScope: { ...command.ownerScope },
    kind:
      action.type === "correct-summary"
        ? "correct-node"
        : "set-cluster-representative",
    nodeIds: unique([
      representativeNodeId,
      ...(oldRepresentative ? [oldRepresentative.id] : []),
    ]),
    clusterId: cluster.clusterId,
    supersededByNodeId: representativeNodeId,
    reasonCodes: ["memory_graph_representative_corrected"],
    metadata: {
      ...commandMetadata,
      previousRepresentativeNodeId: oldRepresentative?.id,
    },
  });
  return plannedCorrection(command, {
    candidateNodes,
    candidateEdges,
    candidateClusters,
    operations,
  });
}
export function buildMemoryGraphCorrectionPlan(
  input: BuildMemoryGraphCorrectionPlanInput,
): MemoryGraphUpdatePlan {
  if (!input.commandId || !input.reason) {
    return emptyPlan(input, ["memory_graph_correction_invalid_command"]);
  }
  const cluster = input.snapshot.clusters.find(
    (candidate) =>
      candidate.clusterId === input.action.clusterId &&
      sameScope(candidate.ownerScope, input.ownerScope),
  );
  if (!cluster) {
    return emptyPlan(input, ["memory_graph_correction_cluster_not_found"]);
  }

  const nodesById = new Map(
    input.snapshot.nodes
      .filter((node) => sameScope(node.ownerScope, input.ownerScope))
      .map((node) => [node.id, node]),
  );

  if (input.action.type === "remove-member") {
    return buildRemoveMemberCorrectionPlan({
      command: input,
      action: input.action,
      cluster,
      nodesById,
    });
  }
  if (input.action.type === "set-lifecycle") {
    return buildLifecycleCorrectionPlan({
      command: input,
      action: input.action,
      cluster,
    });
  }
  return buildRepresentativeCorrectionPlan({
    command: input,
    action: input.action,
    cluster,
    nodesById,
  });
}

export function buildMemoryGraphRollbackPreparePlan(
  input: BuildMemoryGraphRollbackPreparePlanInput,
): MemoryGraphUpdatePlan {
  const sourceIds = new Set(input.sourceNodeIds);
  const commandMetadata = metadata(input);
  const candidateNodes = input.snapshot.nodes
    .filter(
      (node) =>
        sourceIds.has(node.id) &&
        node.type === "raw" &&
        node.visibility !== "default" &&
        sameScope(node.ownerScope, input.ownerScope),
    )
    .map((node) => ({
      ...copyNode(node),
      visibility: "default" as const,
      updatedAt: input.now,
      metadata: {
        ...(node.metadata ?? {}),
        rollbackPreparedForSummaryId: input.summaryId,
        ...commandMetadata,
      },
    }));
  const operations = candidateNodes.map(
    (node): MemoryGraphOperation => ({
      operationId: operationId(input.commandId, `restore-node:${node.id}`),
      ownerScope: { ...input.ownerScope },
      kind: "restore-node",
      nodeIds: [node.id],
      supersededByNodeId: input.summaryId,
      reasonCodes: ["memory_graph_rollback_raw_visibility_prepared"],
      metadata: commandMetadata,
    }),
  );
  return {
    ...emptyPlan(input, ["memory_graph_rollback_prepare_planned"]),
    planId: `memory-graph-rollback-prepare:${encodeURIComponent(input.commandId)}`,
    candidateNodes,
    operations,
  };
}

export function buildMemoryGraphRollbackFinalizePlan(
  input: BuildMemoryGraphRollbackFinalizePlanInput,
): MemoryGraphUpdatePlan {
  const commandMetadata = metadata(input);
  const summaryNode = input.snapshot.nodes.find(
    (node) =>
      node.id === input.summaryId &&
      sameScope(node.ownerScope, input.ownerScope),
  );
  if (!summaryNode) {
    return emptyPlan(input, ["memory_graph_rollback_summary_not_found"]);
  }
  const candidateNodes: MemoryGraphNode[] = [];
  if (summaryNode.visibility !== "audit-only") {
    candidateNodes.push({
      ...copyNode(summaryNode),
      visibility: "audit-only",
      updatedAt: input.now,
      metadata: {
        ...(summaryNode.metadata ?? {}),
        rolledBack: true,
        ...commandMetadata,
      },
    });
  }
  const predecessorIds = new Set(input.predecessorSummaryNodeIds ?? []);
  for (const predecessor of input.snapshot.nodes) {
    if (
      !predecessorIds.has(predecessor.id) ||
      (predecessor.type !== "summary" && predecessor.type !== "artifact") ||
      predecessor.visibility === "default" ||
      !sameScope(predecessor.ownerScope, input.ownerScope)
    ) {
      continue;
    }
    candidateNodes.push({
      ...copyNode(predecessor),
      visibility: "default",
      updatedAt: input.now,
      metadata: {
        ...(predecessor.metadata ?? {}),
        supersededBySummaryId: undefined,
        restoredByRollbackSummaryId: input.summaryId,
        ...commandMetadata,
      },
    });
  }
  const candidateEdges = input.snapshot.edges
    .filter(
      (edge) =>
        edge.kind === "supersede" &&
        edge.toNodeId === input.summaryId &&
        sameScope(edge.ownerScope, input.ownerScope) &&
        edge.metadata?.inactive !== true,
    )
    .map((edge) => ({
      ...copyEdge(edge),
      weight: 0,
      updatedAt: input.now,
      reasonCodes: unique([
        ...edge.reasonCodes,
        "memory_graph_rollback_applied",
      ]),
      metadata: {
        ...(edge.metadata ?? {}),
        inactive: true,
        rolledBack: true,
        ...commandMetadata,
      },
    }));
  const candidateClusters: MemoryGraphClusterSnapshot[] = [];
  for (const cluster of input.snapshot.clusters) {
    if (!sameScope(cluster.ownerScope, input.ownerScope)) continue;
    const isRepresentative = cluster.representativeNodeId === input.summaryId;
    const supersededBySummaryId = cluster.metadata?.supersededBySummaryId;
    if (!isRepresentative && supersededBySummaryId !== input.summaryId)
      continue;
    const updated = copyCluster(cluster);
    if (isRepresentative) {
      updated.representativeNodeId = (
        input.predecessorSummaryNodeIds ?? []
      ).find((nodeId) => updated.nodeIds.includes(nodeId));
    }
    const previousStatus =
      input.previousLifecycleByClusterId?.[cluster.clusterId];
    if (previousStatus) updated.lifecycleStatus = previousStatus;
    else if (isRepresentative || updated.lifecycleStatus === "superseded") {
      updated.lifecycleStatus = "active";
    }
    updated.updatedAt = input.now;
    updated.reasonCodes = unique([
      ...updated.reasonCodes,
      "memory_graph_rollback_applied",
    ]);
    updated.metadata = {
      ...(updated.metadata ?? {}),
      supersededByClusterId: undefined,
      supersededBySummaryId: undefined,
      rolledBack: true,
      ...commandMetadata,
    };
    candidateClusters.push(updated);
  }
  const operations: MemoryGraphOperation[] = [];
  if (candidateNodes.length > 0 || candidateEdges.length > 0) {
    operations.push({
      operationId: operationId(
        input.commandId,
        `rollback-summary:${input.summaryId}`,
      ),
      ownerScope: { ...input.ownerScope },
      kind: "rollback-supersession",
      nodeIds: unique([
        input.summaryId,
        ...input.sourceNodeIds,
        ...(input.predecessorSummaryNodeIds ?? []),
      ]),
      supersededByNodeId: input.summaryId,
      reasonCodes: ["memory_graph_rollback_applied"],
      metadata: commandMetadata,
    });
  }
  operations.push(
    ...candidateClusters.map(
      (cluster): MemoryGraphOperation => ({
        operationId: operationId(
          input.commandId,
          `restore-cluster:${cluster.clusterId}`,
        ),
        ownerScope: { ...input.ownerScope },
        kind: "set-cluster-lifecycle",
        nodeIds: [...cluster.nodeIds],
        clusterId: cluster.clusterId,
        toStatus: cluster.lifecycleStatus,
        reasonCodes: ["memory_graph_rollback_applied"],
        metadata: commandMetadata,
      }),
    ),
  );
  return {
    ...emptyPlan(input, ["memory_graph_rollback_finalize_planned"]),
    planId: `memory-graph-rollback-finalize:${encodeURIComponent(input.commandId)}`,
    candidateNodes,
    candidateEdges,
    candidateClusters,
    operations,
  };
}
