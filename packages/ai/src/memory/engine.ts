import {
  buildMemoryDeprecationEntries,
  type MemorySummaryCandidate,
} from "../../memory-consolidation/src/pipeline";
import type {
  MemoryForgettingRunInput,
  MemoryForgettingRunResult,
  MemoryGroup,
  MemoryRecord,
  MemoryRecordScorer,
  MemoryStorageAdapter,
  MemorySummary,
  MemorySummarizer,
  ScoredMemoryRecord,
} from "./contracts";
import { deprecateMemoryRecords } from "./deprecation";
import {
  bucketStart,
  type MemoryForgettingPolicy,
  type MemoryForgettingPolicyOverrides,
  resolveMemoryForgettingPolicy,
  summaryTierForTransition,
  transitionTargetTier,
} from "./policy";
import { DefaultMemoryRecordScorer } from "./scorer";
import { RuleBasedMemorySummarizer } from "./summarizer";

export interface MemoryForgettingEngine {
  readonly policy: MemoryForgettingPolicy;
  runCycle(input: MemoryForgettingRunInput): Promise<MemoryForgettingRunResult>;
}

export interface CreateMemoryForgettingEngineInput {
  storage: MemoryStorageAdapter;
  policy?: MemoryForgettingPolicyOverrides;
  scorer?: MemoryRecordScorer;
  summarizer?: MemorySummarizer;
}

function clampTimestamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function stableDimensionKey(
  record: MemoryRecord,
  dimensionKeys: string[],
): string {
  const dimensions = record.dimensions ?? {};
  return dimensionKeys
    .map((key) => `${key}=${String(dimensions[key] ?? "")}`)
    .join("|");
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Unsigned 32-bit.
  return (hash >>> 0).toString(16);
}

function buildSummaryId(input: {
  userId: string;
  summaryTier: string;
  groupId: string;
  endTimestamp: number;
}): string {
  const raw = `${input.userId}|${input.summaryTier}|${input.groupId}|${input.endTimestamp}`;
  return `ms_${hashString(raw)}`;
}

function toScoredRecords(
  records: MemoryRecord[],
  scorer: MemoryRecordScorer,
  now: number,
): ScoredMemoryRecord[] {
  return records.map((record) => ({
    ...record,
    ageMs: Math.max(0, now - record.timestamp),
    valueScore: scorer.score(record, { now }),
  }));
}

function groupRecordsForTransition(params: {
  userId: string;
  records: ScoredMemoryRecord[];
  fromTier: "short" | "mid";
  windowMs: number;
  minRecordsPerGroup: number;
  groupByDimensionKeys: string[];
}): MemoryGroup[] {
  const grouped = new Map<string, ScoredMemoryRecord[]>();
  const targetTier = transitionTargetTier(params.fromTier);
  const summaryTier = summaryTierForTransition(params.fromTier);

  for (const record of params.records) {
    const bucket = bucketStart(record.timestamp, params.windowMs);
    const dimKey = stableDimensionKey(record, params.groupByDimensionKeys);
    const key = `${params.fromTier}|${bucket}|${dimKey}`;
    const list = grouped.get(key);
    if (list) {
      list.push(record);
    } else {
      grouped.set(key, [record]);
    }
  }

  const groups: MemoryGroup[] = [];
  for (const [groupId, records] of grouped.entries()) {
    if (records.length < params.minRecordsPerGroup) {
      continue;
    }
    const startTimestamp = Math.min(
      ...records.map((record) => record.timestamp),
    );
    const endTimestamp = Math.max(...records.map((record) => record.timestamp));
    groups.push({
      groupId,
      userId: params.userId,
      sourceTier: params.fromTier,
      targetTier,
      summaryTier,
      records,
      startTimestamp,
      endTimestamp,
      dimensions: records[0]?.dimensions,
    });
  }
  return groups.sort((a, b) => b.endTimestamp - a.endTimestamp);
}

export function createMemoryForgettingEngine(
  input: CreateMemoryForgettingEngineInput,
): MemoryForgettingEngine {
  const policy = resolveMemoryForgettingPolicy(input.policy);
  const scorer = input.scorer ?? new DefaultMemoryRecordScorer();
  const summarizer = input.summarizer ?? new RuleBasedMemorySummarizer();

  return {
    policy,
    async runCycle(runInput: MemoryForgettingRunInput) {
      const startedAt = Date.now();
      const now = runInput.now ?? startedAt;
      const dryRun = runInput.dryRun ?? false;
      const deprecateSourceRecords = runInput.deprecateSourceRecords !== false;
      const lockKey = `${policy.lock.keyPrefix}:${runInput.userId}`;

      const lock = await input.storage.acquireLock({
        key: lockKey,
        ttlMs: policy.lock.ttlMs,
        now,
      });

      if (!lock) {
        return {
          status: "skipped_locked",
          dryRun,
          userId: runInput.userId,
          startedAt,
          finishedAt: Date.now(),
          scannedRecords: 0,
          eligibleRecords: 0,
          createdSummaries: 0,
          transitionedRecords: 0,
          archivedDetailRecords: 0,
        };
      }

      let scannedRecords = 0;
      let eligibleRecords = 0;
      let createdSummaries = 0;
      let transitionedRecords = 0;
      let archivedDetailRecords = 0;
      let deprecationStatus:
        | MemoryForgettingRunResult["deprecationStatus"]
        | undefined;
      let deprecationPlannedRecords = 0;
      let deprecatedRecords = 0;
      const deprecationReasonCodes = new Set<string>();

      try {
        const phases: Array<{
          fromTier: "short" | "mid";
          olderThan: number;
          threshold: number;
          candidateLimit: number;
          windowMs: number;
        }> = [
          {
            fromTier: "short",
            olderThan: now - policy.shortMaxAgeMs,
            threshold: policy.scoreThresholds.shortToMid,
            candidateLimit: policy.maxCandidatesPerTierPerRun.short,
            windowMs: policy.groupWindowMs.short,
          },
          {
            fromTier: "mid",
            olderThan: now - policy.midMaxAgeMs,
            threshold: policy.scoreThresholds.midToLong,
            candidateLimit: policy.maxCandidatesPerTierPerRun.mid,
            windowMs: policy.groupWindowMs.mid,
          },
        ];

        for (const phase of phases) {
          const records = await input.storage.listCandidates({
            userId: runInput.userId,
            tier: phase.fromTier,
            olderThan: phase.olderThan,
            limit: phase.candidateLimit,
          });

          scannedRecords += records.length;

          const scored = toScoredRecords(records, scorer, now);
          const eligible = scored.filter(
            (record) =>
              !record.isPinned &&
              record.archivedAt === undefined &&
              record.valueScore <= phase.threshold,
          );

          eligibleRecords += eligible.length;

          if (eligible.length === 0) {
            continue;
          }

          const groups = groupRecordsForTransition({
            userId: runInput.userId,
            records: eligible,
            fromTier: phase.fromTier,
            windowMs: phase.windowMs,
            minRecordsPerGroup: policy.minRecordsPerGroup,
            groupByDimensionKeys: policy.groupByDimensionKeys,
          });

          for (const group of groups) {
            const draft = await summarizer.summarizeGroup(group, { now });
            const summary: MemorySummary = {
              summaryId: buildSummaryId({
                userId: runInput.userId,
                summaryTier: group.summaryTier,
                groupId: group.groupId,
                endTimestamp: group.endTimestamp,
              }),
              userId: runInput.userId,
              summaryTier: group.summaryTier,
              sourceTier: group.sourceTier,
              startTimestamp: clampTimestamp(group.startTimestamp),
              endTimestamp: clampTimestamp(group.endTimestamp),
              messageCount: group.records.length,
              sourceRecordIds: group.records.map((record) => record.id),
              keyPoints: draft.keyPoints,
              keywords: draft.keywords,
              summaryText: draft.summaryText,
              dimensions: group.dimensions,
              qualityScore: draft.qualityScore,
              createdAt: now,
              updatedAt: now,
            };

            createdSummaries += 1;
            transitionedRecords += group.records.length;

            if (!dryRun) {
              await input.storage.saveSummaries([summary]);
              const summaryCandidate: MemorySummaryCandidate = {
                clusterKey: group.groupId,
                competitionKey: group.groupId,
                recordIds: summary.sourceRecordIds,
                evidenceCount: summary.sourceRecordIds.length,
                score: draft.qualityScore ?? 1,
                priority: draft.qualityScore ?? 1,
                reasonCodes: ["strong_repeated_evidence"],
                sourceAction: "preserve",
              };
              const deprecationPlan = buildMemoryDeprecationEntries({
                persistedSummaryIds: [summary.summaryId],
                summaryCandidates: [summaryCandidate],
              });
              try {
                const deprecationResult = await deprecateMemoryRecords({
                  userId: runInput.userId,
                  entries: deprecationPlan.entries,
                  enabled: deprecateSourceRecords,
                  store: input.storage,
                  now,
                });
                deprecationPlannedRecords += deprecationResult.plannedCount;
                deprecatedRecords += deprecationResult.persistedCount;
                if (
                  deprecationStatus !== "failed" &&
                  (deprecationStatus !== "persisted" ||
                    deprecationResult.status === "persisted")
                ) {
                  deprecationStatus = deprecationResult.status;
                }
                for (const reasonCode of deprecationResult.reasonCodes) {
                  deprecationReasonCodes.add(reasonCode);
                }
              } catch {
                const plannedIds = new Set(
                  deprecationPlan.entries.flatMap((entry) => entry.recordIds),
                );
                deprecationStatus = "failed";
                deprecationPlannedRecords += plannedIds.size;
                deprecationReasonCodes.add("adapter_deprecate_records_error");
              }

              await input.storage.transitionRecords({
                userId: runInput.userId,
                ids: summary.sourceRecordIds,
                toTier: group.targetTier,
                transitionedAt: now,
                summaryId: summary.summaryId,
              });

              if (
                group.targetTier === "long" &&
                input.storage.archiveRecordDetails
              ) {
                await input.storage.archiveRecordDetails({
                  userId: runInput.userId,
                  ids: summary.sourceRecordIds,
                  archivedAt: now,
                });
                archivedDetailRecords += summary.sourceRecordIds.length;
              }
            }
          }
        }
      } finally {
        await input.storage.releaseLock(lock);
      }

      return {
        status: "success",
        dryRun,
        userId: runInput.userId,
        startedAt,
        finishedAt: Date.now(),
        scannedRecords,
        eligibleRecords,
        createdSummaries,
        transitionedRecords,
        archivedDetailRecords,
        deprecationStatus,
        deprecationPlannedRecords,
        deprecatedRecords,
        deprecationReasonCodes: [...deprecationReasonCodes],
      };
    },
  };
}
