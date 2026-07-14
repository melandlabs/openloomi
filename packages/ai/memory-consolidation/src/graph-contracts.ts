export interface OwnerScope {
  userId: string;
  workspaceId?: string;
  tenantId?: string;
}

export type MemoryApplicabilityScope =
  | "global"
  | "task"
  | "conversation"
  | "channel"
  | "project"
  | "custom";

export interface MemoryApplicabilityContext {
  scope: MemoryApplicabilityScope;
  key?: string;
  validFrom?: number;
  validUntil?: number;
  metadata?: Record<string, unknown>;
}

export type MemoryGraphNodeType = "raw" | "summary" | "artifact";

export type MemoryGraphRelationKind =
  | "support"
  | "compete"
  | "related"
  | "supersede";

export type MemoryClusterLifecycleStatus =
  | "forming"
  | "active"
  | "stable"
  | "decaying"
  | "superseded"
  | "audit-only";

export type MemoryGraphVisibility = "default" | "deprecated" | "audit-only";

export interface MemoryGraphNode {
  id: string;
  ownerScope: OwnerScope;
  type: MemoryGraphNodeType;
  sourceId?: string;
  createdAt: number;
  updatedAt?: number;
  visibility: MemoryGraphVisibility;
  applicability?: MemoryApplicabilityContext;
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphEdge {
  id: string;
  ownerScope: OwnerScope;
  fromNodeId: string;
  toNodeId: string;
  kind: MemoryGraphRelationKind;
  weight: number;
  confidence?: number;
  evidenceNodeIds: string[];
  reasonCodes: string[];
  applicability?: MemoryApplicabilityContext;
  createdAt: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphClusterSnapshot {
  clusterId: string;
  ownerScope: OwnerScope;
  nodeIds: string[];
  lifecycleStatus: MemoryClusterLifecycleStatus;
  representativeNodeId?: string;
  supportScore?: number;
  competitionKey?: string;
  updatedAt: number;
  reasonCodes: string[];
  applicability?: MemoryApplicabilityContext;
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphSnapshot {
  ownerScope: OwnerScope;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  clusters: MemoryGraphClusterSnapshot[];
  version?: string;
  capturedAt: number;
}

export type MemoryGraphOperationKind =
  | "create-node"
  | "create-edge"
  | "reinforce-edge"
  | "weaken-edge"
  | "upsert-cluster"
  | "set-cluster-lifecycle"
  | "set-cluster-representative"
  | "supersede-node";

export interface MemoryGraphOperation {
  operationId: string;
  ownerScope: OwnerScope;
  kind: MemoryGraphOperationKind;
  nodeIds: string[];
  edgeIds?: string[];
  clusterId?: string;
  fromStatus?: MemoryClusterLifecycleStatus;
  toStatus?: MemoryClusterLifecycleStatus;
  supersededByNodeId?: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphPersistenceMode {
  mode: "dry-run" | "write";
  enabled: boolean;
}

export interface MemoryGraphUpdatePlan {
  planId?: string;
  ownerScope: OwnerScope;
  candidateNodes: MemoryGraphNode[];
  candidateEdges: MemoryGraphEdge[];
  candidateClusters?: MemoryGraphClusterSnapshot[];
  operations: MemoryGraphOperation[];
  expectedVersion?: string;
  persistence: MemoryGraphPersistenceMode;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphUpdateResult {
  ownerScope: OwnerScope;
  appliedOperations: MemoryGraphOperation[];
  skippedOperations: Array<{
    operation: MemoryGraphOperation;
    reasonCodes: string[];
  }>;
  mutatesGraph: boolean;
  version?: string;
  replayed?: boolean;
  conflict?: boolean;
  diagnostics: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphSnapshotQuery {
  ownerScope: OwnerScope;
  nodeIds?: string[];
  clusterIds?: string[];
  includeAuditOnly?: boolean;
}

export interface MemoryGraphAuditQuery {
  ownerScope: OwnerScope;
  nodeId: string;
  includeDeprecated?: boolean;
}

export interface MemoryGraphAuditTrail {
  ownerScope: OwnerScope;
  nodeId: string;
  sourceNodeIds: string[];
  edgeIds: string[];
  operationIds: string[];
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphStore {
  readSnapshot(query: MemoryGraphSnapshotQuery): Promise<MemoryGraphSnapshot>;
  persistPlan(plan: MemoryGraphUpdatePlan): Promise<MemoryGraphUpdateResult>;
  readAuditTrail(query: MemoryGraphAuditQuery): Promise<MemoryGraphAuditTrail>;
}

export interface GraphInteractionInput {
  ownerScope: OwnerScope;
  newNodes: MemoryGraphNode[];
  candidateSnapshot: MemoryGraphSnapshot;
  now: number;
  metadata?: Record<string, unknown>;
}

export interface GraphInteractionEngine {
  planInteraction(input: GraphInteractionInput): Promise<MemoryGraphUpdatePlan>;
}

export interface ClusterLifecyclePolicyInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  now: number;
  metadata?: Record<string, unknown>;
}

export interface ClusterLifecycleTransition {
  ownerScope: OwnerScope;
  clusterId: string;
  fromStatus: MemoryClusterLifecycleStatus;
  toStatus: MemoryClusterLifecycleStatus;
  representativeNodeId?: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface ClusterLifecyclePolicyResult {
  ownerScope: OwnerScope;
  transitions: ClusterLifecycleTransition[];
  consolidationEligibleClusterIds: string[];
  auditOnlyClusterIds: string[];
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface ClusterLifecyclePolicy {
  evaluate(
    input: ClusterLifecyclePolicyInput,
  ): Promise<ClusterLifecyclePolicyResult>;
}

export interface MemoryGraphConsolidationInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  lifecycle: ClusterLifecyclePolicyResult;
  now: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphSummaryCandidate {
  candidateId: string;
  ownerScope: OwnerScope;
  clusterId: string;
  sourceNodeIds: string[];
  representativeNodeId?: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphDeprecationPlan {
  ownerScope: OwnerScope;
  sourceNodeIds: string[];
  supersededByNodeId: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphConsolidationPlan {
  ownerScope: OwnerScope;
  summaryCandidates: MemoryGraphSummaryCandidate[];
  deprecationPlans: MemoryGraphDeprecationPlan[];
  archiveCandidateNodeIds: string[];
  preserveClusterIds: string[];
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryConsolidationPlanner {
  plan(
    input: MemoryGraphConsolidationInput,
  ): Promise<MemoryGraphConsolidationPlan>;
}

export type GraphRetrievalVisibilityMode = "default" | "audit";

export interface GraphAwareRetrievalInput {
  ownerScope: OwnerScope;
  query: string;
  baselineNodeIds: string[];
  snapshot: MemoryGraphSnapshot;
  visibilityMode: GraphRetrievalVisibilityMode;
  includeDeprecated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GraphAwareRetrievalResult {
  ownerScope: OwnerScope;
  rankedNodeIds: string[];
  hiddenDeprecatedNodeIds: string[];
  expandedClusterIds: string[];
  auditTrail?: MemoryGraphAuditTrail[];
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphAwareRetriever {
  compare(input: GraphAwareRetrievalInput): Promise<GraphAwareRetrievalResult>;
}

export interface GraphEvolutionReportSummary {
  ownerScope: OwnerScope;
  dryRun: boolean;
  mutatesGraph: boolean;
  mutatesStorage: boolean;
  mutatesRuntime: boolean;
  mutatesRetrieval: boolean;
  operationCount: number;
  warningCount: number;
  candidateNodeCount?: number;
  candidateEdgeCount?: number;
  skippedSignalCount?: number;
  operationCounts?: Record<string, number>;
  explanationCounts?: Record<string, number>;
}

export type GraphEvolutionExplanationCategory =
  | "node"
  | "relation"
  | "reinforcement"
  | "weakening"
  | "competition"
  | "sedimentation"
  | "lifecycle"
  | "audit";

export interface GraphEvolutionOperationExplanation {
  operationId: string;
  category: GraphEvolutionExplanationCategory;
  kind: MemoryGraphOperationKind;
  nodeIds: string[];
  edgeIds?: string[];
  relationKind?: MemoryGraphRelationKind;
  supersededByNodeId?: string;
  summary: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphEvolutionSkippedSignalExplanation {
  signalType: string;
  id: string;
  summary: string;
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphEvolutionReport {
  reportId: string;
  generatedAt: number;
  ownerScope: OwnerScope;
  summary: GraphEvolutionReportSummary;
  plan?: MemoryGraphUpdatePlan;
  persistenceResult?: MemoryGraphUpdateResult;
  lifecycleResult?: ClusterLifecyclePolicyResult;
  consolidationPlan?: MemoryGraphConsolidationPlan;
  retrievalResult?: GraphAwareRetrievalResult;
  operationExplanations?: GraphEvolutionOperationExplanation[];
  skippedSignalExplanations?: GraphEvolutionSkippedSignalExplanation[];
  warnings: string[];
  reasonCodes: string[];
  metadata?: Record<string, unknown>;
}
