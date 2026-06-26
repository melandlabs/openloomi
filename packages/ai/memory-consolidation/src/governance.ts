import type { MemoryEvidenceRecord } from "./evidence-cluster";
import type { SemanticMemoryArtifactRollbackMetadata } from "./persistence";
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
