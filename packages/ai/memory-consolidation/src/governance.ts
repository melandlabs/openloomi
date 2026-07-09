import type { MemoryConsolidationEvalMetrics } from "./evaluation";
import type { MemoryEvidenceRecord } from "./evidence-cluster";
import type { GraphAwareRetrievalResult } from "./graph-contracts";
import type { SemanticMemoryArtifactRollbackMetadata } from "./persistence";
import type { MemorySemanticRetrievalEvalScenarioReport } from "./retrieval";
import type {
  SemanticMemoryRevisionCompetitionDiagnostic,
  SemanticMemoryRevisionReasonCode,
  SemanticMemoryRevisionRelation,
  SemanticMemoryRevisionStatus,
  SemanticMemoryRevisionStatusSignal,
} from "./revision";

export type MemoryGovernanceExplanationReasonCode =
  | "memory_explanation"
  | "source_trace_found"
  | "source_trace_missing"
  | "rollback_available"
  | SemanticMemoryRevisionReasonCode
  | (string & {});

export interface MemoryGovernanceExplanationTrace {
  recordId: string;
  found: boolean;
  text?: string;
  timestamp?: number;
  tier?: MemoryEvidenceRecord["tier"];
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceExplanationRelation {
  type: SemanticMemoryRevisionRelation["type"];
  sourceArtifactId: string;
  targetArtifactId: string;
  sourceRecordIds: string[];
  confidence: number;
  reasonCodes: MemoryGovernanceExplanationReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceExplanationMemory {
  artifactId: string;
  artifactStatus?: SemanticMemoryRevisionStatusSignal["artifactStatus"];
  revisionStatus: SemanticMemoryRevisionStatus;
  sourceRecordIds: string[];
  confidence: number;
  supportingTraces: MemoryGovernanceExplanationTrace[];
  relations: MemoryGovernanceExplanationRelation[];
  competitionDiagnostic?: SemanticMemoryRevisionCompetitionDiagnostic;
  rollbackAvailable: boolean;
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  reasonCodes: MemoryGovernanceExplanationReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceExplanationReport {
  summary: {
    memoryCount: number;
    sourceRecordCount: number;
    missingSourceRecordCount: number;
    relationCount: number;
    activeCount: number;
    deprecatedCount: number;
    conflictedCount: number;
    rollbackAvailableCount: number;
  };
  memories: MemoryGovernanceExplanationMemory[];
  missingSourceRecordIds: string[];
  reasonCodes: MemoryGovernanceExplanationReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryGovernanceExplanationReportInput {
  memories: SemanticMemoryRevisionStatusSignal[];
  sourceRecords?: MemoryEvidenceRecord[];
  relations?: SemanticMemoryRevisionRelation[];
  competitionDiagnostics?: SemanticMemoryRevisionCompetitionDiagnostic[];
  metadata?: Record<string, unknown>;
}

export type MemoryGovernanceCommandType =
  | "correct-content"
  | "change-status"
  | "rollback-artifact";

export type MemoryGovernanceCommandReasonCode =
  | "command_valid"
  | "dry_run_only"
  | "missing_artifact"
  | "missing_corrected_content"
  | "missing_target_status"
  | "rollback_unavailable"
  | "rollback_available"
  | MemoryGovernanceExplanationReasonCode
  | (string & {});

export interface MemoryGovernanceCommandBase {
  commandId: string;
  type: MemoryGovernanceCommandType;
  artifactId: string;
  requestedBy?: string;
  reasonCodes?: MemoryGovernanceCommandReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceCorrectContentCommand extends MemoryGovernanceCommandBase {
  type: "correct-content";
  correctedContent: string;
}

export interface MemoryGovernanceChangeStatusCommand extends MemoryGovernanceCommandBase {
  type: "change-status";
  targetStatus: SemanticMemoryRevisionStatus;
}

export interface MemoryGovernanceRollbackArtifactCommand extends MemoryGovernanceCommandBase {
  type: "rollback-artifact";
  rollback?: SemanticMemoryArtifactRollbackMetadata;
}

export type MemoryGovernanceCommand =
  | MemoryGovernanceCorrectContentCommand
  | MemoryGovernanceChangeStatusCommand
  | MemoryGovernanceRollbackArtifactCommand;

export interface MemoryGovernanceCommandDryRunEntry {
  commandId: string;
  type: MemoryGovernanceCommandType;
  artifactId: string;
  valid: boolean;
  dryRun: true;
  currentRevisionStatus?: SemanticMemoryRevisionStatus;
  targetRevisionStatus?: SemanticMemoryRevisionStatus;
  correctedContent?: string;
  sourceRecordIds: string[];
  rollbackAvailable: boolean;
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  reasonCodes: MemoryGovernanceCommandReasonCode[];
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceCommandDryRunReport {
  summary: {
    commandCount: number;
    validCommandCount: number;
    invalidCommandCount: number;
    dryRun: true;
  };
  commands: MemoryGovernanceCommandDryRunEntry[];
  reasonCodes: MemoryGovernanceCommandReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryGovernanceCommandDryRunReportInput {
  commands: MemoryGovernanceCommand[];
  explanationReport?: MemoryGovernanceExplanationReport;
  metadata?: Record<string, unknown>;
}

export type MemoryGovernanceAuditScenarioReasonCode =
  | "polluted_memory_observed"
  | "polluted_memory_explained"
  | "dry_run_command_available"
  | "polluted_memory_unresolved"
  | MemoryGovernanceCommandReasonCode
  | MemoryGovernanceExplanationReasonCode
  | (string & {});

export interface MemoryGovernanceAuditScenarioPollutedMemory {
  artifactId: string;
  explained: boolean;
  unresolved: boolean;
  revisionStatus?: SemanticMemoryRevisionStatus;
  sourceRecordIds: string[];
  rollbackAvailable: boolean;
  commandIds: string[];
  validCommandIds: string[];
  reasonCodes: MemoryGovernanceAuditScenarioReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGovernanceAuditScenarioReport {
  summary: {
    scenarioId: string;
    pollutedArtifactCount: number;
    explainedPollutedArtifactCount: number;
    validCommandCount: number;
    unresolvedPollutedArtifactCount: number;
    dryRun: true;
  };
  pollutedMemories: MemoryGovernanceAuditScenarioPollutedMemory[];
  unresolvedArtifactIds: string[];
  reasonCodes: MemoryGovernanceAuditScenarioReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryGovernanceAuditScenarioReportInput {
  scenarioId: string;
  pollutedArtifactIds: string[];
  explanationReport?: MemoryGovernanceExplanationReport;
  commandReport?: MemoryGovernanceCommandDryRunReport;
  metadata?: Record<string, unknown>;
}

export type MemoryGraphRolloutDecision =
  | "ready-for-limited-rollout"
  | "blocked";

export type MemoryGraphRolloutGateReasonCode =
  | "memory_graph_rollout_governance"
  | "dry_run_only"
  | "metric_gate_passed"
  | "metric_gate_failed"
  | "retrieval_eval_gate_passed"
  | "retrieval_eval_gate_failed"
  | "semantic_retrieval_eval_gate_passed"
  | "semantic_retrieval_eval_gate_failed"
  | "audit_trail_gate_passed"
  | "audit_trail_gate_failed"
  | "cross_scope_gate_passed"
  | "cross_scope_gate_failed"
  | "polluted_memory_gate_passed"
  | "polluted_memory_gate_failed"
  | "correction_command_gate_passed"
  | "correction_command_gate_failed"
  | "rollback_command_gate_passed"
  | "rollback_command_gate_failed"
  | MemoryGovernanceAuditScenarioReasonCode
  | MemoryGovernanceCommandReasonCode
  | (string & {});

export interface MemoryGraphRolloutGateThresholds {
  minExpectedCandidateAccuracy?: number;
  maxNoisePromotionRate?: number;
  maxTemporaryOverrideLeakageRate?: number;
  minContestedClusterCoverage?: number;
  minDecayPrecisionProxy?: number;
  maxUnresolvedPollutedArtifactCount?: number;
  requireCorrectionCommand?: boolean;
  requireRollbackCommand?: boolean;
  requireAuditTrail?: boolean;
  requireNoCrossScopeNodes?: boolean;
}

export interface MemoryGraphRolloutRetrievalScenarioInput {
  scenarioId: string;
  result: GraphAwareRetrievalResult;
  expectedRankedNodeIds?: string[];
  expectedHiddenDeprecatedNodeIds?: string[];
  expectedAuditTrailNodeIds?: string[];
  forbiddenNodeIds?: string[];
  crossScopeNodeIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphRolloutRetrievalScenarioResult {
  scenarioId: string;
  passed: boolean;
  rankedNodeIds: string[];
  hiddenDeprecatedNodeIds: string[];
  auditTrailNodeIds: string[];
  missingRankedNodeIds: string[];
  missingHiddenDeprecatedNodeIds: string[];
  missingAuditTrailNodeIds: string[];
  leakedForbiddenNodeIds: string[];
  crossScopeLeakNodeIds: string[];
  reasonCodes: MemoryGraphRolloutGateReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphRolloutGate {
  gateId: string;
  passed: boolean;
  actual: number | boolean | string[];
  threshold?: number | boolean;
  reasonCodes: MemoryGraphRolloutGateReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryGraphRolloutGovernanceReport {
  summary: {
    scenarioId: string;
    decision: MemoryGraphRolloutDecision;
    gateCount: number;
    passedGateCount: number;
    failedGateCount: number;
    graphRetrievalScenarioCount: number;
    graphRetrievalPassedCount: number;
    semanticRetrievalScenarioCount: number;
    semanticRetrievalPassedCount: number;
    dryRun: true;
  };
  gates: MemoryGraphRolloutGate[];
  graphRetrievalScenarios: MemoryGraphRolloutRetrievalScenarioResult[];
  semanticRetrievalScenarios: MemorySemanticRetrievalEvalScenarioReport[];
  reasonCodes: MemoryGraphRolloutGateReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryGraphRolloutGovernanceReportInput {
  scenarioId: string;
  consolidationMetrics?: MemoryConsolidationEvalMetrics;
  graphRetrievalScenarios?: MemoryGraphRolloutRetrievalScenarioInput[];
  semanticRetrievalScenarios?: MemorySemanticRetrievalEvalScenarioReport[];
  auditScenarioReport?: MemoryGovernanceAuditScenarioReport;
  commandReport?: MemoryGovernanceCommandDryRunReport;
  thresholds?: MemoryGraphRolloutGateThresholds;
  metadata?: Record<string, unknown>;
}

function copyMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function copyRollback(
  rollback: SemanticMemoryArtifactRollbackMetadata | undefined,
): SemanticMemoryArtifactRollbackMetadata | undefined {
  return rollback
    ? {
        ...rollback,
        metadata: copyMetadata(rollback.metadata),
      }
    : undefined;
}

function relationTouchesArtifact(
  relation: SemanticMemoryRevisionRelation,
  artifactId: string,
): boolean {
  return (
    relation.sourceArtifactId === artifactId ||
    relation.targetArtifactId === artifactId
  );
}

function relationToExplanation(
  relation: SemanticMemoryRevisionRelation,
): MemoryGovernanceExplanationRelation {
  return {
    type: relation.type,
    sourceArtifactId: relation.sourceArtifactId,
    targetArtifactId: relation.targetArtifactId,
    sourceRecordIds: [...relation.sourceRecordIds],
    confidence: relation.confidence,
    reasonCodes: [...relation.reasonCodes],
    rollback: copyRollback(relation.rollback),
    metadata: copyMetadata(relation.metadata),
  };
}

function buildTrace(
  recordId: string,
  sourceRecordsById: Map<string, MemoryEvidenceRecord>,
): MemoryGovernanceExplanationTrace {
  const record = sourceRecordsById.get(recordId);

  if (!record) {
    return {
      recordId,
      found: false,
    };
  }

  return {
    recordId,
    found: true,
    text: record.text,
    timestamp: record.timestamp,
    tier: record.tier,
    metadata: copyMetadata(record.metadata),
  };
}

function uniqueReasonCodes<ReasonCode extends string>(
  reasonCodes: ReasonCode[],
): ReasonCode[] {
  return [...new Set(reasonCodes)];
}

function missingIds(
  actual: string[],
  expected: string[] | undefined,
): string[] {
  if (!expected || expected.length === 0) {
    return [];
  }
  const actualSet = new Set(actual);
  return expected.filter((id) => !actualSet.has(id));
}

function intersectIds(left: string[], right: string[] | undefined): string[] {
  if (!right || right.length === 0) {
    return [];
  }
  const rightSet = new Set(right);
  return [...new Set(left.filter((id) => rightSet.has(id)))].sort();
}

function auditTrailNodeIds(result: GraphAwareRetrievalResult): string[] {
  return result.auditTrail?.map((trail) => trail.nodeId) ?? [];
}

function buildMemoryGraphRolloutRetrievalScenario(
  input: MemoryGraphRolloutRetrievalScenarioInput,
): MemoryGraphRolloutRetrievalScenarioResult {
  const auditNodeIds = auditTrailNodeIds(input.result);
  const allObservedNodeIds = [
    ...input.result.rankedNodeIds,
    ...input.result.hiddenDeprecatedNodeIds,
    ...auditNodeIds,
  ];
  const missingRankedNodeIds = missingIds(
    input.result.rankedNodeIds,
    input.expectedRankedNodeIds,
  );
  const missingHiddenDeprecatedNodeIds = missingIds(
    input.result.hiddenDeprecatedNodeIds,
    input.expectedHiddenDeprecatedNodeIds,
  );
  const missingAuditTrailNodeIds = missingIds(
    auditNodeIds,
    input.expectedAuditTrailNodeIds,
  );
  const leakedForbiddenNodeIds = intersectIds(
    input.result.rankedNodeIds,
    input.forbiddenNodeIds,
  );
  const crossScopeLeakNodeIds = intersectIds(
    allObservedNodeIds,
    input.crossScopeNodeIds,
  );
  const passed =
    missingRankedNodeIds.length === 0 &&
    missingHiddenDeprecatedNodeIds.length === 0 &&
    missingAuditTrailNodeIds.length === 0 &&
    leakedForbiddenNodeIds.length === 0 &&
    crossScopeLeakNodeIds.length === 0;

  return {
    scenarioId: input.scenarioId,
    passed,
    rankedNodeIds: [...input.result.rankedNodeIds],
    hiddenDeprecatedNodeIds: [...input.result.hiddenDeprecatedNodeIds],
    auditTrailNodeIds: auditNodeIds,
    missingRankedNodeIds,
    missingHiddenDeprecatedNodeIds,
    missingAuditTrailNodeIds,
    leakedForbiddenNodeIds,
    crossScopeLeakNodeIds,
    reasonCodes: uniqueReasonCodes([
      passed ? "retrieval_eval_gate_passed" : "retrieval_eval_gate_failed",
      ...(missingAuditTrailNodeIds.length === 0
        ? (["audit_trail_gate_passed"] as const)
        : (["audit_trail_gate_failed"] as const)),
      ...(crossScopeLeakNodeIds.length === 0
        ? (["cross_scope_gate_passed"] as const)
        : (["cross_scope_gate_failed"] as const)),
      ...input.result.reasonCodes,
    ]),
    metadata: copyMetadata(input.metadata),
  };
}

function buildGate(input: {
  gateId: string;
  passed: boolean;
  actual: number | boolean | string[];
  threshold?: number | boolean;
  passReasonCode: MemoryGraphRolloutGateReasonCode;
  failReasonCode: MemoryGraphRolloutGateReasonCode;
  metadata?: Record<string, unknown>;
}): MemoryGraphRolloutGate {
  return {
    gateId: input.gateId,
    passed: input.passed,
    actual: input.actual,
    threshold: input.threshold,
    reasonCodes: [input.passed ? input.passReasonCode : input.failReasonCode],
    metadata: copyMetadata(input.metadata),
  };
}

function defaultRolloutThresholds(
  thresholds: MemoryGraphRolloutGateThresholds | undefined,
): Required<MemoryGraphRolloutGateThresholds> {
  return {
    minExpectedCandidateAccuracy: thresholds?.minExpectedCandidateAccuracy ?? 1,
    maxNoisePromotionRate: thresholds?.maxNoisePromotionRate ?? 0,
    maxTemporaryOverrideLeakageRate:
      thresholds?.maxTemporaryOverrideLeakageRate ?? 0,
    minContestedClusterCoverage: thresholds?.minContestedClusterCoverage ?? 1,
    minDecayPrecisionProxy: thresholds?.minDecayPrecisionProxy ?? 1,
    maxUnresolvedPollutedArtifactCount:
      thresholds?.maxUnresolvedPollutedArtifactCount ?? 0,
    requireCorrectionCommand: thresholds?.requireCorrectionCommand ?? true,
    requireRollbackCommand: thresholds?.requireRollbackCommand ?? true,
    requireAuditTrail: thresholds?.requireAuditTrail ?? true,
    requireNoCrossScopeNodes: thresholds?.requireNoCrossScopeNodes ?? true,
  };
}

export function buildMemoryGraphRolloutGovernanceReport(
  input: BuildMemoryGraphRolloutGovernanceReportInput,
): MemoryGraphRolloutGovernanceReport {
  const thresholds = defaultRolloutThresholds(input.thresholds);
  const gates: MemoryGraphRolloutGate[] = [];
  const graphRetrievalScenarios = (input.graphRetrievalScenarios ?? []).map(
    buildMemoryGraphRolloutRetrievalScenario,
  );
  const semanticRetrievalScenarios = [
    ...(input.semanticRetrievalScenarios ?? []),
  ];

  if (input.consolidationMetrics) {
    const metrics = input.consolidationMetrics;
    gates.push(
      buildGate({
        gateId: "consolidation.expected-candidate-accuracy",
        passed:
          metrics.expectedCandidateAccuracy >=
          thresholds.minExpectedCandidateAccuracy,
        actual: metrics.expectedCandidateAccuracy,
        threshold: thresholds.minExpectedCandidateAccuracy,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
      buildGate({
        gateId: "consolidation.noise-promotion-rate",
        passed: metrics.noisePromotionRate <= thresholds.maxNoisePromotionRate,
        actual: metrics.noisePromotionRate,
        threshold: thresholds.maxNoisePromotionRate,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
      buildGate({
        gateId: "consolidation.temporary-override-leakage-rate",
        passed:
          metrics.temporaryOverrideLeakageRate <=
          thresholds.maxTemporaryOverrideLeakageRate,
        actual: metrics.temporaryOverrideLeakageRate,
        threshold: thresholds.maxTemporaryOverrideLeakageRate,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
      buildGate({
        gateId: "consolidation.contested-cluster-coverage",
        passed:
          metrics.contestedClusterCoverage >=
          thresholds.minContestedClusterCoverage,
        actual: metrics.contestedClusterCoverage,
        threshold: thresholds.minContestedClusterCoverage,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
      buildGate({
        gateId: "consolidation.decay-precision-proxy",
        passed:
          metrics.decayPrecisionProxy >= thresholds.minDecayPrecisionProxy,
        actual: metrics.decayPrecisionProxy,
        threshold: thresholds.minDecayPrecisionProxy,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
    );
  } else {
    gates.push(
      buildGate({
        gateId: "consolidation.metrics",
        passed: false,
        actual: false,
        threshold: true,
        passReasonCode: "metric_gate_passed",
        failReasonCode: "metric_gate_failed",
      }),
    );
  }

  if (graphRetrievalScenarios.length > 0) {
    gates.push(
      buildGate({
        gateId: "retrieval.graph-scenarios",
        passed: graphRetrievalScenarios.every((scenario) => scenario.passed),
        actual: graphRetrievalScenarios.filter((scenario) => scenario.passed)
          .length,
        threshold: graphRetrievalScenarios.length,
        passReasonCode: "retrieval_eval_gate_passed",
        failReasonCode: "retrieval_eval_gate_failed",
      }),
    );

    if (thresholds.requireAuditTrail) {
      const auditScenarioCount = graphRetrievalScenarios.filter(
        (scenario) => scenario.auditTrailNodeIds.length > 0,
      ).length;
      gates.push(
        buildGate({
          gateId: "retrieval.audit-trail",
          passed:
            auditScenarioCount > 0 &&
            graphRetrievalScenarios.every(
              (scenario) => scenario.missingAuditTrailNodeIds.length === 0,
            ),
          actual: auditScenarioCount,
          threshold: 1,
          passReasonCode: "audit_trail_gate_passed",
          failReasonCode: "audit_trail_gate_failed",
        }),
      );
    }

    if (thresholds.requireNoCrossScopeNodes) {
      const crossScopeLeakNodeIds = [
        ...new Set(
          graphRetrievalScenarios.flatMap(
            (scenario) => scenario.crossScopeLeakNodeIds,
          ),
        ),
      ].sort();
      gates.push(
        buildGate({
          gateId: "retrieval.cross-scope-isolation",
          passed: crossScopeLeakNodeIds.length === 0,
          actual: crossScopeLeakNodeIds,
          threshold: true,
          passReasonCode: "cross_scope_gate_passed",
          failReasonCode: "cross_scope_gate_failed",
        }),
      );
    }
  } else {
    gates.push(
      buildGate({
        gateId: "retrieval.graph-scenarios",
        passed: false,
        actual: 0,
        threshold: 1,
        passReasonCode: "retrieval_eval_gate_passed",
        failReasonCode: "retrieval_eval_gate_failed",
      }),
    );
  }

  if (semanticRetrievalScenarios.length > 0) {
    gates.push(
      buildGate({
        gateId: "retrieval.semantic-eval-scenarios",
        passed: semanticRetrievalScenarios.every((scenario) => scenario.passed),
        actual: semanticRetrievalScenarios.filter((scenario) => scenario.passed)
          .length,
        threshold: semanticRetrievalScenarios.length,
        passReasonCode: "semantic_retrieval_eval_gate_passed",
        failReasonCode: "semantic_retrieval_eval_gate_failed",
      }),
    );
  } else {
    gates.push(
      buildGate({
        gateId: "retrieval.semantic-eval-scenarios",
        passed: false,
        actual: 0,
        threshold: 1,
        passReasonCode: "semantic_retrieval_eval_gate_passed",
        failReasonCode: "semantic_retrieval_eval_gate_failed",
      }),
    );
  }

  if (input.auditScenarioReport) {
    gates.push(
      buildGate({
        gateId: "governance.polluted-memory-unresolved",
        passed:
          input.auditScenarioReport.summary.unresolvedPollutedArtifactCount <=
          thresholds.maxUnresolvedPollutedArtifactCount,
        actual:
          input.auditScenarioReport.summary.unresolvedPollutedArtifactCount,
        threshold: thresholds.maxUnresolvedPollutedArtifactCount,
        passReasonCode: "polluted_memory_gate_passed",
        failReasonCode: "polluted_memory_gate_failed",
      }),
    );
  } else {
    gates.push(
      buildGate({
        gateId: "governance.polluted-memory-unresolved",
        passed: false,
        actual: false,
        threshold: true,
        passReasonCode: "polluted_memory_gate_passed",
        failReasonCode: "polluted_memory_gate_failed",
      }),
    );
  }

  if (thresholds.requireCorrectionCommand) {
    const validCorrectionCount =
      input.commandReport?.commands.filter(
        (command) => command.type === "correct-content" && command.valid,
      ).length ?? 0;
    gates.push(
      buildGate({
        gateId: "governance.correction-command",
        passed: validCorrectionCount > 0,
        actual: validCorrectionCount,
        threshold: 1,
        passReasonCode: "correction_command_gate_passed",
        failReasonCode: "correction_command_gate_failed",
      }),
    );
  }

  if (thresholds.requireRollbackCommand) {
    const validRollbackCount =
      input.commandReport?.commands.filter(
        (command) => command.type === "rollback-artifact" && command.valid,
      ).length ?? 0;
    gates.push(
      buildGate({
        gateId: "governance.rollback-command",
        passed: validRollbackCount > 0,
        actual: validRollbackCount,
        threshold: 1,
        passReasonCode: "rollback_command_gate_passed",
        failReasonCode: "rollback_command_gate_failed",
      }),
    );
  }

  const failedGateCount = gates.filter((gate) => !gate.passed).length;
  const decision: MemoryGraphRolloutDecision =
    failedGateCount === 0 ? "ready-for-limited-rollout" : "blocked";

  return {
    summary: {
      scenarioId: input.scenarioId,
      decision,
      gateCount: gates.length,
      passedGateCount: gates.length - failedGateCount,
      failedGateCount,
      graphRetrievalScenarioCount: graphRetrievalScenarios.length,
      graphRetrievalPassedCount: graphRetrievalScenarios.filter(
        (scenario) => scenario.passed,
      ).length,
      semanticRetrievalScenarioCount: semanticRetrievalScenarios.length,
      semanticRetrievalPassedCount: semanticRetrievalScenarios.filter(
        (scenario) => scenario.passed,
      ).length,
      dryRun: true,
    },
    gates,
    graphRetrievalScenarios,
    semanticRetrievalScenarios,
    reasonCodes: uniqueReasonCodes([
      "memory_graph_rollout_governance",
      "dry_run_only",
      ...gates.flatMap((gate) => gate.reasonCodes),
      ...graphRetrievalScenarios.flatMap((scenario) => scenario.reasonCodes),
      ...semanticRetrievalScenarios.flatMap((scenario) => scenario.reasonCodes),
      ...(input.auditScenarioReport?.reasonCodes ?? []),
      ...(input.commandReport?.reasonCodes ?? []),
    ]),
    metadata: copyMetadata(input.metadata),
  };
}

export function buildMemoryGovernanceExplanationReport(
  input: BuildMemoryGovernanceExplanationReportInput,
): MemoryGovernanceExplanationReport {
  const sourceRecordsById = new Map(
    (input.sourceRecords ?? []).map((record) => [record.id, record]),
  );
  const missingSourceRecordIds = new Set<string>();
  const memories = input.memories.map((memory) => {
    const supportingTraces = memory.sourceRecordIds.map((recordId) => {
      const trace = buildTrace(recordId, sourceRecordsById);
      if (!trace.found) {
        missingSourceRecordIds.add(recordId);
      }
      return trace;
    });
    const relations = (input.relations ?? [])
      .filter((relation) =>
        relationTouchesArtifact(relation, memory.artifactId),
      )
      .map(relationToExplanation);
    const competitionDiagnostic = input.competitionDiagnostics?.find(
      (diagnostic) => diagnostic.artifactId === memory.artifactId,
    );
    const rollback = copyRollback(memory.rollback);
    const reasonCodes = uniqueReasonCodes([
      "memory_explanation",
      ...(supportingTraces.some((trace) => trace.found)
        ? (["source_trace_found"] as const)
        : []),
      ...(supportingTraces.some((trace) => !trace.found)
        ? (["source_trace_missing"] as const)
        : []),
      ...(rollback ? (["rollback_available"] as const) : []),
      ...memory.reasonCodes,
      ...relations.flatMap((relation) => relation.reasonCodes),
      ...(competitionDiagnostic?.reasonCodes ?? []),
    ]);

    return {
      artifactId: memory.artifactId,
      artifactStatus: memory.artifactStatus,
      revisionStatus: memory.revisionStatus,
      sourceRecordIds: [...memory.sourceRecordIds],
      confidence: memory.confidence,
      supportingTraces,
      relations,
      competitionDiagnostic: competitionDiagnostic
        ? {
            ...competitionDiagnostic,
            sourceRecordIds: [...competitionDiagnostic.sourceRecordIds],
            reasonCodes: [...competitionDiagnostic.reasonCodes],
            metadata: copyMetadata(competitionDiagnostic.metadata),
          }
        : undefined,
      rollbackAvailable: Boolean(rollback),
      rollback,
      reasonCodes,
      metadata: copyMetadata(memory.metadata),
    };
  });
  const allReasonCodes = uniqueReasonCodes([
    ...memories.flatMap((memory) => memory.reasonCodes),
  ]);

  return {
    summary: {
      memoryCount: memories.length,
      sourceRecordCount: input.sourceRecords?.length ?? 0,
      missingSourceRecordCount: missingSourceRecordIds.size,
      relationCount: input.relations?.length ?? 0,
      activeCount: memories.filter(
        (memory) => memory.revisionStatus === "active",
      ).length,
      deprecatedCount: memories.filter(
        (memory) => memory.revisionStatus === "deprecated",
      ).length,
      conflictedCount: memories.filter(
        (memory) => memory.revisionStatus === "conflicted",
      ).length,
      rollbackAvailableCount: memories.filter(
        (memory) => memory.rollbackAvailable,
      ).length,
    },
    memories,
    missingSourceRecordIds: [...missingSourceRecordIds].sort(),
    reasonCodes: allReasonCodes,
    metadata: copyMetadata(input.metadata),
  };
}

function commandTargetStatus(
  command: MemoryGovernanceCommand,
): SemanticMemoryRevisionStatus | undefined {
  return command.type === "change-status" ? command.targetStatus : undefined;
}

function commandRollback(
  command: MemoryGovernanceCommand,
  memory: MemoryGovernanceExplanationMemory | undefined,
): SemanticMemoryArtifactRollbackMetadata | undefined {
  if (command.type === "rollback-artifact") {
    return copyRollback(command.rollback ?? memory?.rollback);
  }

  return copyRollback(memory?.rollback);
}

function commandValidationReasons(
  command: MemoryGovernanceCommand,
  memory: MemoryGovernanceExplanationMemory | undefined,
): MemoryGovernanceCommandReasonCode[] {
  const reasonCodes: MemoryGovernanceCommandReasonCode[] = [];

  if (!memory) {
    reasonCodes.push("missing_artifact");
  }

  if (
    command.type === "correct-content" &&
    command.correctedContent.trim().length === 0
  ) {
    reasonCodes.push("missing_corrected_content");
  }

  if (command.type === "change-status" && !command.targetStatus) {
    reasonCodes.push("missing_target_status");
  }

  if (command.type === "rollback-artifact") {
    if (command.rollback || memory?.rollbackAvailable) {
      reasonCodes.push("rollback_available");
    } else {
      reasonCodes.push("rollback_unavailable");
    }
  }

  return reasonCodes;
}

export function buildMemoryGovernanceCommandDryRunReport(
  input: BuildMemoryGovernanceCommandDryRunReportInput,
): MemoryGovernanceCommandDryRunReport {
  const memoriesByArtifactId = new Map(
    (input.explanationReport?.memories ?? []).map((memory) => [
      memory.artifactId,
      memory,
    ]),
  );
  const commands = input.commands.map((command) => {
    const memory = memoriesByArtifactId.get(command.artifactId);
    const validationReasons = commandValidationReasons(command, memory);
    const valid =
      validationReasons.length === 0 ||
      validationReasons.every(
        (reasonCode) => reasonCode === "rollback_available",
      );
    const reasonCodes = uniqueReasonCodes([
      ...(valid ? (["command_valid"] as const) : []),
      "dry_run_only",
      ...validationReasons,
      ...(command.reasonCodes ?? []),
    ]);

    return {
      commandId: command.commandId,
      type: command.type,
      artifactId: command.artifactId,
      valid,
      dryRun: true as const,
      currentRevisionStatus: memory?.revisionStatus,
      targetRevisionStatus: commandTargetStatus(command),
      correctedContent:
        command.type === "correct-content"
          ? command.correctedContent
          : undefined,
      sourceRecordIds: memory ? [...memory.sourceRecordIds] : [],
      rollbackAvailable: Boolean(
        memory?.rollbackAvailable || commandRollback(command, memory),
      ),
      rollback: commandRollback(command, memory),
      reasonCodes,
      requestedBy: command.requestedBy,
      metadata: copyMetadata(command.metadata),
    };
  });

  return {
    summary: {
      commandCount: commands.length,
      validCommandCount: commands.filter((command) => command.valid).length,
      invalidCommandCount: commands.filter((command) => !command.valid).length,
      dryRun: true,
    },
    commands,
    reasonCodes: uniqueReasonCodes(
      commands.flatMap((command) => command.reasonCodes),
    ),
    metadata: copyMetadata(input.metadata),
  };
}

export function buildMemoryGovernanceAuditScenarioReport(
  input: BuildMemoryGovernanceAuditScenarioReportInput,
): MemoryGovernanceAuditScenarioReport {
  const memoriesByArtifactId = new Map(
    (input.explanationReport?.memories ?? []).map((memory) => [
      memory.artifactId,
      memory,
    ]),
  );
  const commandsByArtifactId = new Map<
    string,
    MemoryGovernanceCommandDryRunEntry[]
  >();

  for (const command of input.commandReport?.commands ?? []) {
    const existing = commandsByArtifactId.get(command.artifactId) ?? [];
    existing.push(command);
    commandsByArtifactId.set(command.artifactId, existing);
  }

  const pollutedMemories = [...new Set(input.pollutedArtifactIds)].map(
    (artifactId) => {
      const memory = memoriesByArtifactId.get(artifactId);
      const commands = commandsByArtifactId.get(artifactId) ?? [];
      const validCommands = commands.filter((command) => command.valid);
      const explained = Boolean(memory);
      const unresolved = !explained || validCommands.length === 0;
      const reasonCodes = uniqueReasonCodes([
        "polluted_memory_observed",
        ...(explained ? (["polluted_memory_explained"] as const) : []),
        ...(validCommands.length > 0
          ? (["dry_run_command_available"] as const)
          : []),
        ...(unresolved ? (["polluted_memory_unresolved"] as const) : []),
        ...(memory?.reasonCodes ?? []),
        ...commands.flatMap((command) => command.reasonCodes),
      ]);

      return {
        artifactId,
        explained,
        unresolved,
        revisionStatus: memory?.revisionStatus,
        sourceRecordIds: memory ? [...memory.sourceRecordIds] : [],
        rollbackAvailable: Boolean(memory?.rollbackAvailable),
        commandIds: commands.map((command) => command.commandId),
        validCommandIds: validCommands.map((command) => command.commandId),
        reasonCodes,
        metadata: copyMetadata(memory?.metadata),
      };
    },
  );
  const unresolvedArtifactIds = pollutedMemories
    .filter((memory) => memory.unresolved)
    .map((memory) => memory.artifactId)
    .sort();

  return {
    summary: {
      scenarioId: input.scenarioId,
      pollutedArtifactCount: pollutedMemories.length,
      explainedPollutedArtifactCount: pollutedMemories.filter(
        (memory) => memory.explained,
      ).length,
      validCommandCount: pollutedMemories.reduce(
        (sum, memory) => sum + memory.validCommandIds.length,
        0,
      ),
      unresolvedPollutedArtifactCount: unresolvedArtifactIds.length,
      dryRun: true,
    },
    pollutedMemories,
    unresolvedArtifactIds,
    reasonCodes: uniqueReasonCodes(
      pollutedMemories.flatMap((memory) => memory.reasonCodes),
    ),
    metadata: copyMetadata(input.metadata),
  };
}
