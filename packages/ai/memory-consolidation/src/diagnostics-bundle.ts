import {
  buildMemoryConsolidationDiagnosticsReport,
  type MemoryConsolidationDiagnosticsReport,
  type MemoryRelationPipelineDiagnostics,
} from "./adapter";
import type { MemoryGovernanceExplanationReport } from "./governance";
import type { SemanticMemoryArtifactStorageDryRunReport } from "./persistence";
import {
  buildMemoryWeakRelationObservationReport,
  type MemoryRelationCandidateDiscoveryReport,
  type MemoryWeakRelationObservationReport,
} from "./pipeline";
import type { SemanticMemoryRevisionExplanationReport } from "./revision";
import {
  buildSemanticMemoryDraftCandidates,
  type MemorySemanticDraftCandidate,
} from "./semantic-draft";

export type MemoryConsolidationDiagnosticsBundleReasonCode =
  | "diagnostics_bundle"
  | "dry_run_only"
  | "storage_write_ready_attached"
  | "runtime_unchanged"
  | "storage_unchanged"
  | "retrieval_unchanged"
  | "relation_discovery_attached"
  | "weak_relations_observed"
  | "semantic_draft_candidates_found"
  | "storage_dry_run_attached"
  | "revision_report_attached"
  | "governance_report_attached"
  | (string & {});

export interface BuildMemoryConsolidationDiagnosticsBundleInput {
  diagnostics: MemoryRelationPipelineDiagnostics;
  relationDiscoveryReport?: MemoryRelationCandidateDiscoveryReport;
  weakRelationObservationReport?: MemoryWeakRelationObservationReport;
  consolidationReport?: MemoryConsolidationDiagnosticsReport;
  semanticDraftCandidates?: MemorySemanticDraftCandidate[];
  storageDryRunReport?: SemanticMemoryArtifactStorageDryRunReport;
  revisionExplanationReport?: SemanticMemoryRevisionExplanationReport;
  governanceExplanationReport?: MemoryGovernanceExplanationReport;
  metadata?: Record<string, unknown>;
}

export interface MemoryConsolidationDiagnosticsBundleSummary {
  sourceRecordCount: number;
  adaptedRecordCount: number;
  skippedRecordCount: number;
  relationCandidateCount: number;
  discoveredRelationCandidateCount?: number;
  skippedDiscoveredRelationCandidateCount?: number;
  relationCount: number;
  weakObservationCount: number;
  preservedClusterCount: number;
  contestedClusterCount: number;
  decayedRecordCount: number;
  semanticDraftCandidateCount: number;
  storageArtifactCount?: number;
  storageWouldWriteCount?: number;
  revisionMemoryCount?: number;
  governanceMemoryCount?: number;
  dryRunOnly: boolean;
  mutatesRuntime: false;
  mutatesStorage: false;
  mutatesRetrieval: false;
}

export interface MemoryConsolidationDiagnosticsBundle {
  summary: MemoryConsolidationDiagnosticsBundleSummary;
  stages: {
    relationDiscovery?: MemoryRelationCandidateDiscoveryReport;
    weakRelationObservation: MemoryWeakRelationObservationReport;
    diagnostics: MemoryRelationPipelineDiagnostics;
    consolidationReport: MemoryConsolidationDiagnosticsReport;
    semanticDraftCandidates: MemorySemanticDraftCandidate[];
    storageDryRunReport?: SemanticMemoryArtifactStorageDryRunReport;
    revisionExplanationReport?: SemanticMemoryRevisionExplanationReport;
    governanceExplanationReport?: MemoryGovernanceExplanationReport;
  };
  reasonCodes: MemoryConsolidationDiagnosticsBundleReasonCode[];
  metadata?: Record<string, unknown>;
}

function addIf(
  reasonCodes: Set<MemoryConsolidationDiagnosticsBundleReasonCode>,
  condition: boolean,
  reasonCode: MemoryConsolidationDiagnosticsBundleReasonCode,
): void {
  if (condition) {
    reasonCodes.add(reasonCode);
  }
}

export function buildMemoryConsolidationDiagnosticsBundle(
  input: BuildMemoryConsolidationDiagnosticsBundleInput,
): MemoryConsolidationDiagnosticsBundle {
  const consolidationReport =
    input.consolidationReport ??
    buildMemoryConsolidationDiagnosticsReport(input.diagnostics);
  const semanticDraftCandidates =
    input.semanticDraftCandidates ??
    buildSemanticMemoryDraftCandidates({
      report: consolidationReport,
      records: input.diagnostics.records,
    });
  const weakRelationObservation =
    input.weakRelationObservationReport ??
    buildMemoryWeakRelationObservationReport({
      judgments: input.diagnostics.pipeline.judgments,
    });
  const dryRunOnly = input.storageDryRunReport?.summary.dryRun ?? true;
  const reasonCodes = new Set<MemoryConsolidationDiagnosticsBundleReasonCode>([
    "diagnostics_bundle",
    "runtime_unchanged",
    "storage_unchanged",
    "retrieval_unchanged",
  ]);

  reasonCodes.add(dryRunOnly ? "dry_run_only" : "storage_write_ready_attached");

  addIf(
    reasonCodes,
    Boolean(input.relationDiscoveryReport),
    "relation_discovery_attached",
  );
  addIf(
    reasonCodes,
    weakRelationObservation.summary.observationCount > 0,
    "weak_relations_observed",
  );
  addIf(
    reasonCodes,
    semanticDraftCandidates.length > 0,
    "semantic_draft_candidates_found",
  );
  addIf(
    reasonCodes,
    input.storageDryRunReport?.summary.dryRun === true,
    "storage_dry_run_attached",
  );
  addIf(
    reasonCodes,
    Boolean(input.revisionExplanationReport),
    "revision_report_attached",
  );
  addIf(
    reasonCodes,
    Boolean(input.governanceExplanationReport),
    "governance_report_attached",
  );

  return {
    summary: {
      sourceRecordCount: consolidationReport.summary.sourceRecordCount,
      adaptedRecordCount: consolidationReport.summary.adaptedRecordCount,
      skippedRecordCount: consolidationReport.summary.skippedRecordCount,
      relationCandidateCount: consolidationReport.summary.candidateCount,
      discoveredRelationCandidateCount:
        input.relationDiscoveryReport?.candidates.length,
      skippedDiscoveredRelationCandidateCount:
        input.relationDiscoveryReport?.skippedCandidates.length,
      relationCount: consolidationReport.summary.relationCount,
      weakObservationCount: weakRelationObservation.summary.observationCount,
      preservedClusterCount: consolidationReport.preservedClusters.length,
      contestedClusterCount: consolidationReport.contestedClusters.length,
      decayedRecordCount: consolidationReport.decayedRecords.length,
      semanticDraftCandidateCount: semanticDraftCandidates.length,
      storageArtifactCount: input.storageDryRunReport?.summary.artifactCount,
      storageWouldWriteCount:
        input.storageDryRunReport?.summary.wouldWriteCount,
      revisionMemoryCount: input.revisionExplanationReport?.summary.memoryCount,
      governanceMemoryCount:
        input.governanceExplanationReport?.summary.memoryCount,
      dryRunOnly,
      mutatesRuntime: false,
      mutatesStorage: false,
      mutatesRetrieval: false,
    },
    stages: {
      relationDiscovery: input.relationDiscoveryReport,
      weakRelationObservation,
      diagnostics: input.diagnostics,
      consolidationReport,
      semanticDraftCandidates,
      storageDryRunReport: input.storageDryRunReport,
      revisionExplanationReport: input.revisionExplanationReport,
      governanceExplanationReport: input.governanceExplanationReport,
    },
    reasonCodes: [...reasonCodes],
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}
