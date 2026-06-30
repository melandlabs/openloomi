import { describe, expect, it } from "vitest";
import {
  adaptMemoryRecordsForConsolidation,
  adaptRuntimeMemoryRecordsForConsolidation,
  analyzeSemanticMemoryDraftReadiness,
  analyzeMemoryEvidenceClusters,
  assignMemoryRelationGraph,
  calculateMemoryConsolidationEvalMetrics,
  buildMemoryGovernanceAuditScenarioReport,
  buildMemoryGovernanceCommandDryRunReport,
  buildMemoryGovernanceExplanationReport,
  buildMemoryConsolidationPlan,
  buildMemoryConsolidationDiagnosticsBundle,
  buildMemoryConsolidationDiagnosticsReport,
  buildCallerProvidedMemoryRelationCandidateDiscoveryReport,
  buildMemoryEvidenceClusters,
  buildMemoryConsolidationDiagnosticsRunReport,
  buildMemoryConsolidationRuntimeRecordSelectors,
  buildMemoryWeakRelationObservationReport,
  buildMemoryRelationCandidates,
  buildMemoryRelationPipeline,
  buildMemoryRelationPipelineDiagnostics,
  buildMemorySemanticRetrievalComparisonReport,
  buildMemorySemanticRetrievalDryRunReport,
  buildMemorySemanticRetrievalEvalScenarioReport,
  buildMemorySemanticRetrievalMergedResults,
  buildMemorySemanticRetrievalPlan,
  buildSemanticMemoryArtifactStorageDryRunReport,
  buildSemanticMemoryRevisionCompetitionDiagnostics,
  buildSemanticMemoryRevisionExplanationReport,
  buildSemanticMemoryRevisionRelationPlan,
  buildSemanticMemoryRevisionStatusSignal,
  buildSemanticMemoryDraftSummarizerInputContract,
  buildSemanticMemoryDraftSummarizerDiagnostics,
  buildSemanticMemoryDraftCandidates,
  deserializeSemanticMemoryArtifactStorageRecord,
  deriveMemoryRelationGraphLifecycle,
  invokeSemanticMemoryDraftSummarizerProvider,
  logMemoryConsolidationDiagnosticsRun,
  judgeMemoryRelationCandidates,
  persistSemanticMemoryDrafts,
  invokeMemoryRelationJudgeProvider,
  runMemoryConsolidationDiagnostics,
  serializeSemanticMemoryArtifactStorageRecord,
  summarizeSemanticMemoryDraftCandidate,
  resolveMemorySemanticRetrievalConfig,
  type MemoryEvidenceRecord,
  type MemorySemanticRetrievalConfig,
  type MemorySemanticRetrievalCandidate,
  type MemorySemanticRetrievalComparisonReport,
  type MemorySemanticRetrievalDryRunReport,
  type MemorySemanticRetrievalDraft,
  type MemorySemanticRetrievalEvalScenarioReport,
  type MemorySemanticRetrievalMergedResultSet,
  type MemorySemanticRetrievalPlanningInput,
  type MemorySemanticRetrievalPlanningResult,
  type SemanticMemoryRevisionCompetitionDiagnostics,
  type SemanticMemoryRevisionExplanationReport,
  type SemanticMemoryRevisionRelationPlan,
  type SemanticMemoryRevisionStatusSignal,
  type SemanticMemoryArtifactStorageAdapter,
  type SemanticMemoryArtifactStorageRecord,
  type SemanticMemoryDraftStore,
  type SemanticMemoryDraftSummarizerProviderInvoke,
  type SemanticMemoryDraftSummarizer,
} from "@openloomi/memory-consolidation";
import {
  DefaultMemoryRecordScorer,
  type MemoryRecord,
} from "../../../../packages/ai/src/memory";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 120 * DAY_MS;

type EvalTrace = {
  id: string;
  topic: string;
  text: string;
  day: number;
  accessCount?: number;
  importanceScore?: number;
};

type EvalScenario = {
  id: string;
  description: string;
  expectedLongTermTopic: string;
  metricTags: Array<"noise" | "temporary-override" | "adaptation">;
  traces: EvalTrace[];
};

type ClusterScore = {
  topic: string;
  score: number;
  evidenceCount: number;
  traceIds: string[];
};

type ScenarioEvaluation = {
  scenarioId: string;
  expectedLongTermTopic: string;
  metricTags: EvalScenario["metricTags"];
  singleTraceTopTopic: string | undefined;
  clusterTopTopic: string | undefined;
  clusterScores: ClusterScore[];
};

type ConsolidationEvalMetrics = {
  scenarioCount: number;
  singleTraceExpectedTopicAccuracy: number;
  clusterExpectedTopicAccuracy: number;
  singleTraceNoiseTopRankRate: number;
  clusterNoiseTopRankRate: number;
  clusterTemporaryOverrideLeakageRate: number;
  clusterAdaptationAccuracy: number;
};

function trace(
  id: string,
  topic: string,
  text: string,
  day: number,
  options: Pick<EvalTrace, "accessCount" | "importanceScore"> = {},
): EvalTrace {
  return { id, topic, text, day, ...options };
}

function traceSeries(
  prefix: string,
  topic: string,
  text: string,
  days: number[],
  accessCounts: number[],
): EvalTrace[] {
  return days.map((day, index) =>
    trace(`${prefix}-${index + 1}`, topic, text, day, {
      accessCount: accessCounts[index] ?? 1,
    }),
  );
}

const scenarios: EvalScenario[] = [
  {
    id: "one-shot-noise",
    description:
      "Repeated quiet preference traces should compete with a single noisy but highly activated trace.",
    expectedLongTermTopic: "answer-language:zh",
    metricTags: ["noise"],
    traces: [
      ...traceSeries(
        "zh",
        "answer-language:zh",
        "Prefer Chinese explanations for technical repo work.",
        [3, 5, 7, 9],
        [1, 1, 1, 1],
      ),
      trace(
        "noise-urgent",
        "one-shot:noise",
        "urgent todo blocker deadline random scratch note",
        119,
        { accessCount: 8, importanceScore: 0.9 },
      ),
    ],
  },
  {
    id: "temporary-override",
    description:
      "A recent one-off instruction should be separable from a long-term preference.",
    expectedLongTermTopic: "answer-language:zh",
    metricTags: ["temporary-override"],
    traces: [
      ...traceSeries(
        "pref-zh",
        "answer-language:zh",
        "Use Chinese by default for project explanations.",
        [55, 64, 73, 82],
        [1, 2, 1, 1],
      ),
      trace(
        "override-en",
        "answer-language:en",
        "For this one reply, use English.",
        119,
        { accessCount: 5, importanceScore: 0.6 },
      ),
    ],
  },
  {
    id: "preference-adaptation",
    description:
      "Repeated recent evidence should be able to beat older stable evidence when a preference changes.",
    expectedLongTermTopic: "answer-language:en",
    metricTags: ["adaptation"],
    traces: [
      ...traceSeries(
        "old-zh",
        "answer-language:zh",
        "Use Chinese for repo work.",
        [5, 8, 12],
        [2, 1, 1],
      ),
      ...traceSeries(
        "new-en",
        "answer-language:en",
        "Use English-first responses for this workspace.",
        [90, 101, 112, 119],
        [1, 1, 2, 2],
      ),
    ],
  },
];

function traceToRecord(trace: EvalTrace): MemoryRecord {
  return {
    id: trace.id,
    userId: "eval-user",
    timestamp: trace.day * DAY_MS,
    text: trace.text,
    tier: "short",
    accessCount: trace.accessCount,
    importanceScore: trace.importanceScore,
    metadata: {
      topic: trace.topic,
    },
  };
}

function rankSingleTraces(scenario: EvalScenario): EvalTrace[] {
  const scorer = new DefaultMemoryRecordScorer();
  return [...scenario.traces].sort(
    (a, b) =>
      scorer.score(traceToRecord(b), { now: NOW }) -
      scorer.score(traceToRecord(a), { now: NOW }),
  );
}

function scoreClusters(scenario: EvalScenario): ClusterScore[] {
  return buildMemoryEvidenceClusters({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
  }).map((cluster) => ({
    topic: cluster.key,
    score: cluster.score,
    evidenceCount: cluster.evidenceCount,
    traceIds: cluster.recordIds,
  }));
}

function evaluateScenario(scenario: EvalScenario): ScenarioEvaluation {
  const singleTraceTop = rankSingleTraces(scenario)[0];
  const clusterScores = scoreClusters(scenario);
  const clusterTop = clusterScores[0];

  return {
    scenarioId: scenario.id,
    expectedLongTermTopic: scenario.expectedLongTermTopic,
    metricTags: scenario.metricTags,
    singleTraceTopTopic: singleTraceTop?.topic,
    clusterTopTopic: clusterTop?.topic,
    clusterScores,
  };
}

function hasTag(
  result: ScenarioEvaluation,
  tag: EvalScenario["metricTags"][number],
): boolean {
  return result.metricTags.includes(tag);
}

function mean(values: boolean[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.filter(Boolean).length / values.length;
}

function isNoiseTopic(topic: string | undefined): boolean {
  return topic?.startsWith("one-shot:") ?? false;
}

function calculateConsolidationMetrics(
  results: ScenarioEvaluation[],
): ConsolidationEvalMetrics {
  const noiseResults = results.filter((result) => hasTag(result, "noise"));
  const temporaryOverrideResults = results.filter((result) =>
    hasTag(result, "temporary-override"),
  );
  const adaptationResults = results.filter((result) =>
    hasTag(result, "adaptation"),
  );

  return {
    scenarioCount: results.length,
    singleTraceExpectedTopicAccuracy: mean(
      results.map(
        (result) => result.singleTraceTopTopic === result.expectedLongTermTopic,
      ),
    ),
    clusterExpectedTopicAccuracy: mean(
      results.map(
        (result) => result.clusterTopTopic === result.expectedLongTermTopic,
      ),
    ),
    singleTraceNoiseTopRankRate: mean(
      noiseResults.map((result) => isNoiseTopic(result.singleTraceTopTopic)),
    ),
    clusterNoiseTopRankRate: mean(
      noiseResults.map((result) => isNoiseTopic(result.clusterTopTopic)),
    ),
    clusterTemporaryOverrideLeakageRate: mean(
      temporaryOverrideResults.map(
        (result) => result.clusterTopTopic !== result.expectedLongTermTopic,
      ),
    ),
    clusterAdaptationAccuracy: mean(
      adaptationResults.map(
        (result) => result.clusterTopTopic === result.expectedLongTermTopic,
      ),
    ),
  };
}

function analyzeScenario(scenario: EvalScenario) {
  return analyzeMemoryEvidenceClusters({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
    highClusterScoreThreshold: 0.6,
  });
}

function getCompetitionKey(clusterKey: string): string {
  if (clusterKey.startsWith("answer-language:")) {
    return "answer-language";
  }
  return clusterKey;
}

function planScenario(scenario: EvalScenario) {
  return buildMemoryConsolidationPlan({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
    getCompetitionKey: (cluster) => getCompetitionKey(cluster.key),
  });
}

function findPlanEntry(
  plan: ReturnType<typeof planScenario>,
  clusterKey: string,
) {
  const entry = plan.entries.find((item) => item.clusterKey === clusterKey);
  if (!entry) {
    throw new Error(`Missing consolidation plan entry for ${clusterKey}`);
  }
  return entry;
}

function buildRelationGraphFixture() {
  const records = [
    trace("zh-a", "graph-input", "Use Chinese for repo work.", 20, {
      accessCount: 1,
    }),
    trace("zh-b", "graph-input", "Prefer Chinese technical explanations.", 30, {
      accessCount: 1,
    }),
    trace(
      "zh-c",
      "graph-input",
      "Code explanations are easier in Chinese.",
      40,
      {
        accessCount: 1,
      },
    ),
    trace(
      "en-a",
      "graph-input",
      "Use English-first answers for this workspace.",
      100,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-b",
      "graph-input",
      "Default to English for technical discussions.",
      110,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-c",
      "graph-input",
      "English is now preferred for repo work.",
      118,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-d",
      "graph-input",
      "Please keep future technical answers in English.",
      119,
      {
        accessCount: 2,
      },
    ),
    trace("temp-en", "graph-input", "For this one reply, use English.", 119),
    trace("noise", "graph-input", "random scratch note", 119),
  ].map(traceToRecord);

  const assignment = assignMemoryRelationGraph({
    records,
    nodes: records.map((record) => ({
      id: `trace:${record.id}`,
      recordId: record.id,
      timestamp: record.timestamp,
      activationCount: record.accessCount,
      lastActivatedAt: record.lastAccessAt,
    })),
    now: NOW,
    thresholds: {
      relationDecayHalfLifeMs: 30 * DAY_MS,
    },
    relations: [
      {
        fromRecordId: "zh-a",
        toRecordId: "zh-b",
        relation: "support",
        weight: 0.62,
        evidenceCount: 2,
        activationCount: 1,
        lastActivatedAt: NOW,
      },
      {
        fromRecordId: "zh-b",
        toRecordId: "zh-c",
        relation: "support",
        weight: 0.78,
      },
      {
        fromRecordId: "en-a",
        toRecordId: "en-b",
        relation: "support",
        weight: 0.78,
      },
      {
        fromRecordId: "en-b",
        toRecordId: "en-c",
        relation: "support",
        weight: 0.8,
      },
      {
        fromRecordId: "en-c",
        toRecordId: "en-d",
        relation: "support",
        weight: 0.82,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "en-a",
        relation: "support",
        weight: 0.95,
        lastActivatedAt: 10 * DAY_MS,
      },
      {
        fromRecordId: "zh-a",
        toRecordId: "en-a",
        relation: "compete",
        weight: 0.82,
      },
      {
        fromRecordId: "zh-c",
        toRecordId: "en-d",
        relation: "compete",
        weight: 0.74,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "en-a",
        relation: "related",
        weight: 0.9,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "missing-record",
        relation: "related",
        weight: 0.9,
      },
    ],
  });
  const plan = buildMemoryConsolidationPlan({
    records,
    now: NOW,
    getClusterKey: assignment.getClusterKey,
    getCompetitionKey: assignment.getCompetitionKey,
    thresholds: {
      preserveScore: 0.5,
      preserveEvidence: 3,
      competitionMargin: 0.05,
    },
  });
  const lifecycle = deriveMemoryRelationGraphLifecycle({
    assignment,
    consolidatedClusterKeys: plan.actions.preserve.map(
      (entry) => entry.clusterKey,
    ),
  });

  return {
    records,
    assignment,
    plan,
    lifecycle,
    zhClusterKey: assignment.recordClusterKeys["zh-a"],
    enClusterKey: assignment.recordClusterKeys["en-a"],
    tempClusterKey: assignment.recordClusterKeys["temp-en"],
    noiseClusterKey: assignment.recordClusterKeys.noise,
  };
}

function findGraphCluster(
  assignment: ReturnType<typeof buildRelationGraphFixture>["assignment"],
  clusterId: string,
) {
  const cluster = assignment.clusters.find(
    (item) => item.clusterId === clusterId,
  );
  if (!cluster) {
    throw new Error(`Missing graph cluster ${clusterId}`);
  }
  return cluster;
}

function relationPipelineRecord(
  id: string,
  text: string,
  day: number,
  relationValue: "zh" | "en",
  options: {
    accessCount?: number;
    scope?: "temporary" | "long-term";
  } = {},
): MemoryRecord {
  return {
    id,
    userId: "eval-user",
    timestamp: day * DAY_MS,
    text,
    tier: "short",
    accessCount: options.accessCount,
    metadata: {
      relationGroup: "answer-language",
      relationValue,
      relationScope: options.scope ?? "long-term",
    },
  };
}

function buildRelationPipelineFixture() {
  const records: MemoryRecord[] = [
    relationPipelineRecord(
      "pipe-zh-a",
      "Use Chinese for repo work.",
      20,
      "zh",
      {
        accessCount: 1,
      },
    ),
    relationPipelineRecord(
      "pipe-zh-b",
      "Prefer Chinese technical explanations.",
      30,
      "zh",
      { accessCount: 1 },
    ),
    relationPipelineRecord(
      "pipe-zh-c",
      "Code explanations are easier in Chinese.",
      40,
      "zh",
      { accessCount: 1 },
    ),
    relationPipelineRecord(
      "pipe-en-a",
      "Use English-first answers for this workspace.",
      100,
      "en",
      { accessCount: 2 },
    ),
    relationPipelineRecord(
      "pipe-en-b",
      "Default to English for technical discussions.",
      110,
      "en",
      { accessCount: 2 },
    ),
    relationPipelineRecord(
      "pipe-en-c",
      "English is now preferred for repo work.",
      118,
      "en",
      { accessCount: 2 },
    ),
    relationPipelineRecord(
      "pipe-en-d",
      "Please keep future technical answers in English.",
      119,
      "en",
      { accessCount: 2 },
    ),
    relationPipelineRecord(
      "pipe-temp-en",
      "For this one reply, use English.",
      119,
      "en",
      { scope: "temporary" },
    ),
    {
      id: "pipe-noise",
      userId: "eval-user",
      timestamp: 119 * DAY_MS,
      text: "random scratch note",
      tier: "short",
    },
  ];

  return buildMemoryRelationPipeline({
    records,
    now: NOW,
    candidate: {
      maxCandidatesPerRecord: 12,
    },
    judgment: {
      judgeCandidate(candidate, context) {
        const fromScope = context.fromRecord.metadata?.relationScope;
        const toScope = context.toRecord.metadata?.relationScope;

        if (fromScope === "temporary" || toScope === "temporary") {
          return {
            relation: "related",
            weight: 0.45,
            reasonCodes: ["candidate_related"],
          };
        }

        return context.defaultDecision;
      },
    },
    plan: {
      thresholds: {
        preserveScore: 0.5,
        preserveEvidence: 3,
        competitionMargin: 0.05,
      },
    },
  });
}

type AdapterSourceRecord = {
  uid?: string;
  owner?: string;
  createdAt?: number;
  body?: string;
  reads?: number;
  fields?: {
    preference?: string;
    value?: string;
  };
  meta?: {
    scope?: "temporary" | "long-term";
  };
};

function adapterSourceRecord(
  uid: string,
  body: string,
  day: number,
  value: string,
  options: {
    reads?: number;
    preference?: string;
    scope?: "temporary" | "long-term";
  } = {},
): AdapterSourceRecord {
  return {
    uid,
    owner: "adapter-user",
    createdAt: day * DAY_MS,
    body,
    reads: options.reads,
    fields: {
      preference: options.preference ?? "answer-language",
      value,
    },
    meta: {
      scope: options.scope ?? "long-term",
    },
  };
}

type AdapterSourceRecordSpec = [
  uid: string,
  body: string,
  day: number,
  value: string,
  options?: Parameters<typeof adapterSourceRecord>[4],
];

function adapterSourceRecords(
  specs: AdapterSourceRecordSpec[],
): AdapterSourceRecord[] {
  return specs.map(([uid, body, day, value, options]) =>
    adapterSourceRecord(uid, body, day, value, options),
  );
}

const adapterSelectors = {
  getId: (record: AdapterSourceRecord) => record.uid,
  getUserId: (record: AdapterSourceRecord) => record.owner,
  getTimestamp: (record: AdapterSourceRecord) => record.createdAt,
  getText: (record: AdapterSourceRecord) => record.body,
  getAccessCount: (record: AdapterSourceRecord) => record.reads,
  getDimensions: (record: AdapterSourceRecord) =>
    record.fields ? { ...record.fields } : undefined,
  getMetadata: (record: AdapterSourceRecord) =>
    record.meta ? { ...record.meta } : undefined,
  getRelationGroup: (record: AdapterSourceRecord) => record.fields?.preference,
  getRelationValue: (record: AdapterSourceRecord) => record.fields?.value,
  getRelationScope: (record: AdapterSourceRecord) => record.meta?.scope,
};

function buildAdapterDiagnosticsInput() {
  return {
    records: [
      adapterSourceRecord(
        "adapter-zh-a",
        "Use Chinese for repo work.",
        30,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "adapter-zh-b",
        "Prefer Chinese technical explanations.",
        45,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "adapter-zh-c",
        "Code explanations are easier in Chinese.",
        60,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "adapter-en-a",
        "Use English-first answers for this workspace.",
        115,
        "en",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "adapter-en-b",
        "Default to English for this one discussion.",
        118,
        "en",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "adapter-temp-en",
        "For this one reply, use English.",
        119,
        "en",
        { scope: "temporary" },
      ),
    ],
    now: NOW,
    selectors: adapterSelectors,
    plan: {
      thresholds: {
        preserveScore: 0.5,
        preserveEvidence: 3,
        competitionMargin: 0.05,
      },
    },
  };
}

function buildAdapterDiagnosticsFixture() {
  return buildMemoryRelationPipelineDiagnostics(buildAdapterDiagnosticsInput());
}

function buildAdapterDiagnosticsForRecords(records: AdapterSourceRecord[]) {
  return buildMemoryRelationPipelineDiagnostics({
    ...buildAdapterDiagnosticsInput(),
    records,
  });
}

function clusterKeyForRecord(
  diagnostics: ReturnType<typeof buildAdapterDiagnosticsFixture>,
  recordId: string,
): string {
  const clusterKey =
    diagnostics.pipeline.assignment.recordClusterKeys[recordId];

  if (!clusterKey) {
    throw new Error(`Missing cluster key for ${recordId}`);
  }

  return clusterKey;
}

function uniqueClusterKeys(keys: Array<string | undefined>): string[] {
  return [...new Set(keys.filter((key): key is string => Boolean(key)))].sort();
}

function reportClusterKeys(
  diagnostics: ReturnType<typeof buildAdapterDiagnosticsFixture>,
) {
  const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);

  return {
    report,
    preservedClusterKeys: report.preservedClusters
      .map((cluster) => cluster.clusterKey)
      .sort(),
    contestedClusterKeys: report.contestedClusters
      .map((cluster) => cluster.clusterKey)
      .sort(),
    decayedClusterKeys: uniqueClusterKeys(
      report.decayedRecords.map((record) => record.clusterKey),
    ),
  };
}

function buildExpandedEvalDiagnosticsFixtures() {
  return {
    projectDiagnostics: buildAdapterDiagnosticsForRecords(
      adapterSourceRecords([
        [
          "project-ready-a",
          "Project state is ready for release.",
          92,
          "ready",
          { preference: "project-state", reads: 1 },
        ],
        [
          "project-ready-b",
          "The release checklist is ready.",
          105,
          "ready",
          { preference: "project-state", reads: 1 },
        ],
        [
          "project-ready-c",
          "Current project status remains ready.",
          118,
          "ready",
          { preference: "project-state", reads: 1 },
        ],
        [
          "project-blocked-old",
          "The project was blocked during setup.",
          12,
          "blocked",
          { preference: "project-state" },
        ],
      ]),
    ),
    conflictDiagnostics: buildAdapterDiagnosticsForRecords(
      adapterSourceRecords([
        [
          "conflict-oauth-a",
          "Use OAuth for API authentication.",
          95,
          "oauth",
          { preference: "auth-decision", reads: 1 },
        ],
        [
          "conflict-oauth-b",
          "OAuth remains the selected auth direction.",
          106,
          "oauth",
          { preference: "auth-decision", reads: 1 },
        ],
        [
          "conflict-oauth-c",
          "The integration notes mention OAuth.",
          117,
          "oauth",
          { preference: "auth-decision", reads: 1 },
        ],
        [
          "conflict-key-a",
          "Use API keys for service authentication.",
          95,
          "api-key",
          { preference: "auth-decision", reads: 1 },
        ],
        [
          "conflict-key-b",
          "API keys remain the selected auth direction.",
          106,
          "api-key",
          { preference: "auth-decision", reads: 1 },
        ],
        [
          "conflict-key-c",
          "The integration notes mention API keys.",
          117,
          "api-key",
          { preference: "auth-decision", reads: 1 },
        ],
      ]),
    ),
    staleDiagnostics: buildAdapterDiagnosticsForRecords(
      adapterSourceRecords([
        [
          "stage-active-a",
          "The current project phase is implementation.",
          95,
          "implementation",
          { preference: "project-phase", reads: 1 },
        ],
        [
          "stage-active-b",
          "Implementation is the active project phase.",
          108,
          "implementation",
          { preference: "project-phase", reads: 1 },
        ],
        [
          "stage-active-c",
          "Continue treating implementation as current.",
          119,
          "implementation",
          { preference: "project-phase", reads: 1 },
        ],
        [
          "stage-stale-planning",
          "The project was in planning.",
          5,
          "planning",
          { preference: "project-phase" },
        ],
      ]),
    ),
  };
}

function buildSemanticDraftPersistenceFixture() {
  const diagnostics = buildAdapterDiagnosticsFixture();
  const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
  const candidate = buildSemanticMemoryDraftCandidates({
    report,
    records: diagnostics.records,
  })[0];

  if (!candidate) {
    throw new Error("Expected a semantic draft candidate");
  }

  return {
    diagnostics,
    candidate,
    item: {
      candidate,
      draft: {
        type: candidate.suggestedType,
        content: "User prefers Chinese explanations for technical repo work.",
        sourceRecordIds: [...candidate.sourceRecordIds],
        confidence: candidate.confidence,
        metadata: {
          sourceClusterKey: candidate.sourceClusterKey,
          competitionKey: candidate.competitionKey,
        },
      },
    },
  };
}

function buildSemanticDraftSummarizerFixture() {
  return buildSemanticDraftPersistenceFixture();
}

function recordingSemanticDraftStore() {
  const calls: Array<Parameters<SemanticMemoryDraftStore["saveDrafts"]>[0]> =
    [];

  return {
    calls,
    store: {
      async saveDrafts(input) {
        calls.push(input);
      },
    } satisfies SemanticMemoryDraftStore,
  };
}

function semanticArtifactStorageFixture() {
  return {
    artifactId: "artifact:semantic-draft:answer-language-zh",
    userId: "adapter-user",
    type: "preference",
    content: "User prefers Chinese explanations for technical repo work.",
    status: "draft",
    confidence: 0.82,
    sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
    sourceClusterKey: "answer-language:zh",
    competitionKey: "answer-language",
    reasonCodes: ["strong_repeated_evidence", "wins_competition"],
    createdAt: NOW,
    updatedAt: NOW,
    rollback: {
      operationId: "memory-consolidation-dry-run",
      sourceArtifactId: "artifact:previous",
      reason: "semantic artifact storage test",
      metadata: {
        packageLocal: true,
      },
    },
    metadata: {
      dryRun: true,
    },
  } satisfies SemanticMemoryArtifactStorageRecord;
}

async function buildDiagnosticsRunFixture() {
  const input = buildAdapterDiagnosticsInput();

  return runMemoryConsolidationDiagnostics({
    userId: "adapter-user",
    now: NOW,
    dryRun: true,
    limit: 25,
    reader: {
      async listCandidateRecords() {
        return input.records;
      },
    },
    selectors: adapterSelectors,
    plan: input.plan,
  });
}

describe("memory consolidation evaluation scenarios", () => {
  it("keeps expected long-term outcomes backed by repeated evidence", () => {
    for (const scenario of scenarios) {
      const expectedEvidence = scenario.traces.filter(
        (trace) => trace.topic === scenario.expectedLongTermTopic,
      );

      expect(expectedEvidence.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("captures measurable differences between trace and cluster ranking", () => {
    const results = scenarios.map(evaluateScenario);

    expect(results).toEqual([
      expect.objectContaining({
        scenarioId: "one-shot-noise",
        singleTraceTopTopic: "one-shot:noise",
        clusterTopTopic: "answer-language:zh",
      }),
      expect.objectContaining({
        scenarioId: "temporary-override",
        singleTraceTopTopic: "answer-language:en",
        clusterTopTopic: "answer-language:zh",
      }),
      expect.objectContaining({
        scenarioId: "preference-adaptation",
        clusterTopTopic: "answer-language:en",
      }),
    ]);
  });

  it("reports consolidation metrics for the scenario suite", () => {
    const results = scenarios.map(evaluateScenario);
    const metrics = calculateConsolidationMetrics(results);

    expect(metrics).toEqual({
      scenarioCount: 3,
      singleTraceExpectedTopicAccuracy: 1 / 3,
      clusterExpectedTopicAccuracy: 1,
      singleTraceNoiseTopRankRate: 1,
      clusterNoiseTopRankRate: 0,
      clusterTemporaryOverrideLeakageRate: 0,
      clusterAdaptationAccuracy: 1,
    });
  });

  it("reports expanded eval metrics for project state, conflict, and stale memory", () => {
    const { projectDiagnostics, conflictDiagnostics, staleDiagnostics } =
      buildExpandedEvalDiagnosticsFixtures();
    const projectKeys = reportClusterKeys(projectDiagnostics);
    const conflictKeys = reportClusterKeys(conflictDiagnostics);
    const staleKeys = reportClusterKeys(staleDiagnostics);
    const projectReadyKey = clusterKeyForRecord(
      projectDiagnostics,
      "project-ready-a",
    );
    const projectBlockedKey = clusterKeyForRecord(
      projectDiagnostics,
      "project-blocked-old",
    );
    const conflictOauthKey = clusterKeyForRecord(
      conflictDiagnostics,
      "conflict-oauth-a",
    );
    const conflictApiKey = clusterKeyForRecord(
      conflictDiagnostics,
      "conflict-key-a",
    );
    const staleActiveKey = clusterKeyForRecord(
      staleDiagnostics,
      "stage-active-a",
    );
    const stalePlanningKey = clusterKeyForRecord(
      staleDiagnostics,
      "stage-stale-planning",
    );
    const metrics = calculateMemoryConsolidationEvalMetrics([
      {
        scenarioId: "project-state-update",
        metricTags: ["project-state"],
        expectedPreservedClusterKey: projectReadyKey,
        preservedClusterKeys: projectKeys.preservedClusterKeys,
        decayedClusterKeys: projectKeys.decayedClusterKeys,
        expectedDecayedClusterKeys: [projectBlockedKey],
      },
      {
        scenarioId: "conflicting-auth-facts",
        metricTags: ["conflict"],
        preservedClusterKeys: conflictKeys.preservedClusterKeys,
        contestedClusterKeys: conflictKeys.contestedClusterKeys,
        expectedContestedClusterKeys: [conflictOauthKey, conflictApiKey],
      },
      {
        scenarioId: "stale-project-phase",
        metricTags: ["stale"],
        expectedPreservedClusterKey: staleActiveKey,
        preservedClusterKeys: staleKeys.preservedClusterKeys,
        decayedClusterKeys: staleKeys.decayedClusterKeys,
        expectedDecayedClusterKeys: [stalePlanningKey],
      },
    ]);

    expect(projectKeys.preservedClusterKeys).toContain(projectReadyKey);
    expect(projectKeys.decayedClusterKeys).toContain(projectBlockedKey);
    expect(conflictKeys.preservedClusterKeys).toEqual([]);
    expect(conflictKeys.contestedClusterKeys).toEqual(
      expect.arrayContaining([conflictOauthKey, conflictApiKey]),
    );
    expect(staleKeys.preservedClusterKeys).toContain(staleActiveKey);
    expect(staleKeys.decayedClusterKeys).toContain(stalePlanningKey);
    expect(metrics).toEqual({
      scenarioCount: 3,
      expectedCandidateAccuracy: 1,
      noisePromotionRate: 0,
      temporaryOverrideLeakageRate: 0,
      adaptationAccuracy: 0,
      projectStateAccuracy: 1,
      contestedClusterCoverage: 1,
      decayPrecisionProxy: 1,
    });
  });

  it("surfaces low-record-score traces that belong to high-evidence clusters", () => {
    const scenario = scenarios.find(
      (item) => item.id === "one-shot-noise",
    ) as EvalScenario;
    const analysis = analyzeScenario(scenario);
    const flaggedRecordIds = analysis.recordSignals
      .filter((signal) => signal.lowRecordScoreHighClusterScore)
      .map((signal) => signal.recordId);

    expect(flaggedRecordIds).toEqual(["zh-1", "zh-2", "zh-3", "zh-4"]);
    expect(flaggedRecordIds).not.toContain("noise-urgent");
    expect(analysis.clusters[0]?.key).toBe("answer-language:zh");
  });

  it("builds an explainable consolidation plan from cluster competition", () => {
    const noisePlan = planScenario(
      scenarios.find((item) => item.id === "one-shot-noise") as EvalScenario,
    );
    const overridePlan = planScenario(
      scenarios.find(
        (item) => item.id === "temporary-override",
      ) as EvalScenario,
    );
    const adaptationPlan = planScenario(
      scenarios.find(
        (item) => item.id === "preference-adaptation",
      ) as EvalScenario,
    );

    expect(findPlanEntry(noisePlan, "answer-language:zh")).toEqual(
      expect.objectContaining({
        action: "preserve",
        winningClusterKey: "answer-language:zh",
        reasonCodes: ["strong_repeated_evidence"],
      }),
    );
    expect(findPlanEntry(noisePlan, "one-shot:noise")).toEqual(
      expect.objectContaining({
        action: "decay",
        reasonCodes: ["isolated_low_confidence"],
      }),
    );
    expect(findPlanEntry(overridePlan, "answer-language:en")).toEqual(
      expect.objectContaining({
        action: "decay",
        winningClusterKey: "answer-language:zh",
        reasonCodes: ["outscored_by_competitor", "isolated_low_confidence"],
      }),
    );
    expect(findPlanEntry(adaptationPlan, "answer-language:en")).toEqual(
      expect.objectContaining({
        action: "preserve",
        winningClusterKey: "answer-language:en",
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    );
    expect(findPlanEntry(adaptationPlan, "answer-language:zh").action).not.toBe(
      "preserve",
    );
  });

  it("forms graph clusters from reinforced support edges", () => {
    const { assignment, zhClusterKey, enClusterKey } =
      buildRelationGraphFixture();
    const zhCluster = findGraphCluster(assignment, zhClusterKey);
    const enCluster = findGraphCluster(assignment, enClusterKey);

    expect(assignment.nodes.map((node) => node.id)).toContain("trace:zh-a");
    expect(assignment.recordClusterKeys["zh-b"]).toBe(zhClusterKey);
    expect(assignment.recordClusterKeys["zh-c"]).toBe(zhClusterKey);
    expect(assignment.recordClusterKeys["en-b"]).toBe(enClusterKey);
    expect(assignment.recordClusterKeys["en-c"]).toBe(enClusterKey);
    expect(assignment.recordClusterKeys["en-d"]).toBe(enClusterKey);
    expect(zhCluster.supportEdgeIds).toEqual([
      "zh-a:support:zh-b",
      "zh-b:support:zh-c",
    ]);
    expect(enCluster.supportEdgeIds).toEqual([
      "en-a:support:en-b",
      "en-b:support:en-c",
      "en-c:support:en-d",
    ]);
  });

  it("generates stable graph keys without delimiter collisions", () => {
    const relationRecords = ["a+b", "c", "a", "b+c"].map((id) =>
      trace(id, "graph-input", id, 119),
    );
    const leftAssignment = assignMemoryRelationGraph({
      records: [relationRecords[0], relationRecords[1]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "a+b",
          toRecordId: "c",
          relation: "support",
          weight: 0.9,
        },
      ],
    });
    const reversedLeftAssignment = assignMemoryRelationGraph({
      records: [relationRecords[1], relationRecords[0]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "c",
          toRecordId: "a+b",
          relation: "support",
          weight: 0.9,
        },
      ],
    });
    const rightAssignment = assignMemoryRelationGraph({
      records: [relationRecords[2], relationRecords[3]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "a",
          toRecordId: "b+c",
          relation: "support",
          weight: 0.9,
        },
      ],
    });

    expect(leftAssignment.recordClusterKeys["a+b"]).toBe(
      reversedLeftAssignment.recordClusterKeys["a+b"],
    );
    expect(leftAssignment.recordClusterKeys["a+b"]).not.toBe(
      rightAssignment.recordClusterKeys.a,
    );

    const competitionRecords = ["left+a", "left-b", "right+a", "right-b"].map(
      (id) => trace(id, "graph-input", id, 119),
    );
    const relations = [
      {
        fromRecordId: "left+a",
        toRecordId: "left-b",
        relation: "support" as const,
        weight: 0.9,
      },
      {
        fromRecordId: "right+a",
        toRecordId: "right-b",
        relation: "support" as const,
        weight: 0.9,
      },
      {
        fromRecordId: "left+a",
        toRecordId: "right+a",
        relation: "compete" as const,
        weight: 0.9,
      },
    ];
    const competitionAssignment = assignMemoryRelationGraph({
      records: competitionRecords.map(traceToRecord),
      now: NOW,
      relations,
    });
    const reversedCompetitionAssignment = assignMemoryRelationGraph({
      records: [...competitionRecords].reverse().map(traceToRecord),
      now: NOW,
      relations,
    });

    expect(
      competitionAssignment.getCompetitionKey({
        key: competitionAssignment.recordClusterKeys["left+a"],
      }),
    ).toBe(
      reversedCompetitionAssignment.getCompetitionKey({
        key: reversedCompetitionAssignment.recordClusterKeys["left+a"],
      }),
    );
  });

  it("keeps weak related traces separate from stable support clusters", () => {
    const { assignment, enClusterKey, tempClusterKey } =
      buildRelationGraphFixture();
    const enCluster = findGraphCluster(assignment, enClusterKey);
    const tempCluster = findGraphCluster(assignment, tempClusterKey);

    expect(tempClusterKey).not.toBe(enClusterKey);
    expect(
      assignment.edges.find((edge) => edge.id === "temp-en:support:en-a")
        ?.effectiveWeight,
    ).toBeLessThan(0.7);
    expect(tempCluster.status).toBe("tentative");
    expect(tempCluster.relatedEdgeIds).toEqual(["temp-en:related:en-a"]);
    expect(enCluster.relatedEdgeIds).toEqual(["temp-en:related:en-a"]);
  });

  it("lets recent repeated evidence compete with and replace an older stable cluster", () => {
    const { assignment, plan, lifecycle, zhClusterKey, enClusterKey } =
      buildRelationGraphFixture();
    const enLifecycle = lifecycle.find(
      (entry) => entry.clusterId === enClusterKey,
    );
    const zhLifecycle = lifecycle.find(
      (entry) => entry.clusterId === zhClusterKey,
    );

    expect(assignment.getCompetitionKey({ key: zhClusterKey })).toBe(
      assignment.getCompetitionKey({ key: enClusterKey }),
    );
    expect(findGraphCluster(assignment, zhClusterKey).status).toBe("contested");
    expect(findGraphCluster(assignment, enClusterKey).status).toBe("contested");
    expect(findPlanEntry(plan, enClusterKey)).toEqual(
      expect.objectContaining({
        action: "preserve",
        competitionKey: assignment.getCompetitionKey({ key: enClusterKey }),
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    );
    expect(findPlanEntry(plan, zhClusterKey).action).not.toBe("preserve");
    expect(enLifecycle).toEqual(
      expect.objectContaining({
        graphStatus: "contested",
        status: "consolidated",
        consolidated: true,
      }),
    );
    expect(zhLifecycle).toEqual(
      expect.objectContaining({
        graphStatus: "contested",
        status: "contested",
        consolidated: false,
      }),
    );
  });

  it("keeps isolated noise as a tentative micro-cluster that decays in the plan", () => {
    const { assignment, plan, noiseClusterKey } = buildRelationGraphFixture();
    const noiseCluster = findGraphCluster(assignment, noiseClusterKey);

    expect(noiseCluster.recordIds).toEqual(["noise"]);
    expect(noiseCluster.supportEdgeIds).toEqual([]);
    expect(noiseCluster.status).toBe("tentative");
    expect(findPlanEntry(plan, noiseClusterKey)).toEqual(
      expect.objectContaining({
        action: "decay",
        reasonCodes: ["isolated_low_confidence"],
      }),
    );
  });

  it("builds relation candidates and judgments without promoting temporary traces", () => {
    const pipeline = buildRelationPipelineFixture();
    const supportRelations = pipeline.relations.filter(
      (relation) => relation.relation === "support",
    );
    const competeRelations = pipeline.relations.filter(
      (relation) => relation.relation === "compete",
    );
    const relatedRelations = pipeline.relations.filter(
      (relation) => relation.relation === "related",
    );

    expect(pipeline.candidates.length).toBeGreaterThan(0);
    expect(supportRelations.length).toBeGreaterThan(0);
    expect(competeRelations.length).toBeGreaterThan(0);
    expect(relatedRelations).toEqual([
      expect.objectContaining({
        fromRecordId: "pipe-en-a",
        toRecordId: "pipe-temp-en",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-en-b",
        toRecordId: "pipe-temp-en",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-en-c",
        toRecordId: "pipe-temp-en",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-en-d",
        toRecordId: "pipe-temp-en",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-temp-en",
        toRecordId: "pipe-zh-a",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-temp-en",
        toRecordId: "pipe-zh-b",
        relation: "related",
      }),
      expect.objectContaining({
        fromRecordId: "pipe-temp-en",
        toRecordId: "pipe-zh-c",
        relation: "related",
      }),
    ]);
    expect(pipeline.assignment.recordClusterKeys["pipe-temp-en"]).not.toBe(
      pipeline.assignment.recordClusterKeys["pipe-en-a"],
    );
    expect(pipeline.assignment.recordClusterKeys["pipe-noise"]).toBeDefined();
  });

  it("keeps default candidate keys collision-safe", () => {
    const candidates = buildMemoryRelationCandidates({
      records: [
        {
          id: "colon-left",
          userId: "eval-user",
          timestamp: NOW,
          text: "left",
          tier: "short",
          metadata: {
            a: "b:c",
          },
        },
        {
          id: "colon-right",
          userId: "eval-user",
          timestamp: NOW,
          text: "right",
          tier: "short",
          metadata: {
            "a:b": "c",
          },
        },
      ],
    });

    expect(candidates).toEqual([]);
  });

  it("uses the final judgment relation when resolving default edge weight", () => {
    const pipeline = buildMemoryRelationPipeline({
      records: [
        {
          id: "override-a",
          userId: "eval-user",
          timestamp: NOW,
          text: "first",
          tier: "short",
          metadata: {
            candidateKey: "manual-support",
          },
        },
        {
          id: "override-b",
          userId: "eval-user",
          timestamp: NOW,
          text: "second",
          tier: "short",
          metadata: {
            candidateKey: "manual-support",
          },
        },
      ],
      now: NOW,
      getCandidateKeys: (record) => [
        String(record.metadata?.candidateKey ?? ""),
      ],
      judgment: {
        judgeCandidate() {
          return {
            relation: "support",
          };
        },
      },
    });
    const supportRelation = pipeline.relations.find(
      (relation) => relation.relation === "support",
    );

    expect(supportRelation?.weight).toBeGreaterThanOrEqual(0.7);
    expect(pipeline.assignment.recordClusterKeys["override-a"]).toBe(
      pipeline.assignment.recordClusterKeys["override-b"],
    );
  });

  it("runs the relation pipeline through graph assignment, plan, and summary candidates", () => {
    const pipeline = buildRelationPipelineFixture();
    const enClusterKey = pipeline.assignment.recordClusterKeys["pipe-en-a"];
    const zhClusterKey = pipeline.assignment.recordClusterKeys["pipe-zh-a"];
    const tempClusterKey =
      pipeline.assignment.recordClusterKeys["pipe-temp-en"];
    const noiseClusterKey = pipeline.assignment.recordClusterKeys["pipe-noise"];

    expect(pipeline.assignment.getCompetitionKey({ key: enClusterKey })).toBe(
      pipeline.assignment.getCompetitionKey({ key: zhClusterKey }),
    );
    expect(findPlanEntry(pipeline.plan, enClusterKey)).toEqual(
      expect.objectContaining({
        action: "preserve",
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    );
    expect(findPlanEntry(pipeline.plan, zhClusterKey).action).not.toBe(
      "preserve",
    );
    expect(findPlanEntry(pipeline.plan, tempClusterKey).action).not.toBe(
      "preserve",
    );
    expect(findPlanEntry(pipeline.plan, noiseClusterKey)).toEqual(
      expect.objectContaining({
        action: "decay",
        reasonCodes: ["isolated_low_confidence"],
      }),
    );
    expect(pipeline.summaryCandidates).toEqual([
      expect.objectContaining({
        clusterKey: enClusterKey,
        sourceAction: "preserve",
      }),
    ]);
  });

  it("adapts structural memory records into relation pipeline diagnostics", () => {
    const diagnostics = buildAdapterDiagnosticsFixture();
    const zhDiagnostic = diagnostics.recordDiagnostics.find(
      (item) => item.recordId === "adapter-zh-a",
    );
    const tempDiagnostic = diagnostics.recordDiagnostics.find(
      (item) => item.recordId === "adapter-temp-en",
    );
    const enClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-en-a"];
    const tempClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-temp-en"];

    expect(diagnostics.summary).toEqual(
      expect.objectContaining({
        sourceRecordCount: 6,
        adaptedRecordCount: 6,
        skippedRecordCount: 0,
        recordsWithCandidateKeys: 6,
        recordsWithRelationGroup: 6,
        recordsWithRelationValue: 6,
        preserveCount: 1,
        summaryCandidateCount: 1,
      }),
    );
    expect(zhDiagnostic).toEqual(
      expect.objectContaining({
        graphStatus: "contested",
        planAction: "preserve",
        selectedForSummary: true,
      }),
    );
    expect(tempDiagnostic).toEqual(
      expect.objectContaining({
        graphStatus: "tentative",
        planAction: "decay",
        supportRelationCount: 0,
        selectedForSummary: false,
      }),
    );
    expect(tempDiagnostic?.relatedRelationCount).toBeGreaterThan(0);
    expect(tempClusterKey).not.toBe(enClusterKey);
  });

  it("builds a compact diagnostics report from relation pipeline diagnostics", () => {
    const diagnostics = buildAdapterDiagnosticsFixture();
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
    const zhClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-zh-a"];
    const enClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-en-a"];
    const tempClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-temp-en"];

    expect(report.summary).toEqual({
      sourceRecordCount: 6,
      adaptedRecordCount: 6,
      skippedRecordCount: 0,
      candidateCount: diagnostics.pipeline.candidates.length,
      relationCount: diagnostics.pipeline.relations.length,
      clusterCount: diagnostics.pipeline.assignment.clusters.length,
      competitionGroupCount:
        diagnostics.pipeline.assignment.competitionGroups.length,
      preserveCount: 1,
      observeCount: 1,
      decayCount: 1,
      summaryCandidateCount: 1,
    });
    expect(report.preservedClusters).toEqual([
      expect.objectContaining({
        clusterKey: zhClusterKey,
        competitionKey:
          diagnostics.pipeline.assignment.clusterCompetitionKeys[zhClusterKey],
        recordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        evidenceCount: 3,
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    ]);
    expect(report.preservedClusters[0]?.summaryPriority).toBeGreaterThan(0);
    expect(
      report.contestedClusters.map((cluster) => cluster.clusterKey),
    ).toEqual([zhClusterKey, enClusterKey]);
    expect(report.contestedClusters).toContainEqual(
      expect.objectContaining({
        clusterKey: enClusterKey,
        action: "observe",
        competingClusterKeys: [zhClusterKey],
        winningClusterKey: zhClusterKey,
        reasonCodes: ["outscored_by_competitor"],
      }),
    );
    expect(report.decayedRecords).toEqual([
      {
        recordId: "adapter-temp-en",
        sourceIndex: 5,
        clusterKey: tempClusterKey,
        reasonCodes: ["isolated_low_confidence"],
      },
    ]);
    expect(report.skippedRecords).toEqual([]);
    expect(report.recordSignals).toContainEqual(
      expect.objectContaining({
        recordId: "adapter-temp-en",
        sourceIndex: 5,
        clusterKey: tempClusterKey,
        graphStatus: "tentative",
        planAction: "decay",
        supportRelationCount: 0,
        selectedForSummary: false,
      }),
    );
  });

  it("builds semantic draft candidates from preserved diagnostics clusters", () => {
    const diagnostics = buildAdapterDiagnosticsFixture();
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
    const zhClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-zh-a"];
    const tempClusterKey =
      diagnostics.pipeline.assignment.recordClusterKeys["adapter-temp-en"];
    const candidates = buildSemanticMemoryDraftCandidates({
      report,
      records: diagnostics.records,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        draftId: `semantic-draft:${encodeURIComponent(zhClusterKey)}`,
        sourceClusterKey: zhClusterKey,
        competitionKey:
          diagnostics.pipeline.assignment.clusterCompetitionKeys[zhClusterKey],
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        suggestedType: "preference",
        confidence: report.preservedClusters[0]?.score,
        evidenceCount: 3,
        score: report.preservedClusters[0]?.score,
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
        needsSummary: true,
        summaryPriority: report.preservedClusters[0]?.summaryPriority,
      }),
    ]);
    expect(candidates[0]?.sourceRecordIds).not.toContain("adapter-temp-en");
    expect(candidates[0]?.sourceClusterKey).not.toBe(tempClusterKey);
  });

  it("keeps semantic draft candidates limited to preserved clusters", () => {
    const diagnostics = buildAdapterDiagnosticsFixture();
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);

    expect(
      buildSemanticMemoryDraftCandidates({
        report: {
          ...report,
          preservedClusters: [],
        },
        records: diagnostics.records,
      }),
    ).toEqual([]);
  });

  it("summarizes semantic draft candidates through a caller-provided summarizer", async () => {
    const diagnostics = buildAdapterDiagnosticsFixture();
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
    const candidate = buildSemanticMemoryDraftCandidates({
      report,
      records: diagnostics.records,
    })[0];
    const receivedRecordIds: string[] = [];
    const summarizer: SemanticMemoryDraftSummarizer = {
      async summarizeDraft(candidate, records, context) {
        receivedRecordIds.push(...records.map((record) => record.id));

        return {
          type: candidate.suggestedType,
          content: records
            .map((record) => record.text)
            .filter((text): text is string => Boolean(text))
            .join("\n"),
          sourceRecordIds: [...candidate.sourceRecordIds],
          confidence: candidate.confidence,
          metadata: {
            sourceClusterKey: candidate.sourceClusterKey,
            competitionKey: candidate.competitionKey,
            sourceRecordCount: records.length,
            now: context?.now,
          },
        };
      },
    };

    if (!candidate) {
      throw new Error("Expected a semantic draft candidate");
    }

    const draft = await summarizeSemanticMemoryDraftCandidate({
      candidate,
      records: diagnostics.records,
      summarizer,
      context: {
        now: NOW,
      },
    });

    expect(receivedRecordIds).toEqual([
      "adapter-zh-a",
      "adapter-zh-b",
      "adapter-zh-c",
    ]);
    expect(receivedRecordIds).not.toContain("adapter-temp-en");
    expect(draft).toEqual(
      expect.objectContaining({
        type: "preference",
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        confidence: candidate.confidence,
        metadata: expect.objectContaining({
          sourceClusterKey: candidate.sourceClusterKey,
          competitionKey: candidate.competitionKey,
          sourceRecordCount: 3,
          now: NOW,
        }),
      }),
    );
  });

  it("reports when a semantic draft candidate is ready for summarization", () => {
    const { diagnostics, candidate } = buildSemanticDraftPersistenceFixture();
    const readiness = analyzeSemanticMemoryDraftReadiness({
      candidate,
      records: diagnostics.records,
      minConfidence: 0.5,
    });

    expect(readiness).toEqual({
      draftId: candidate.draftId,
      ready: true,
      confidence: candidate.confidence,
      minConfidence: 0.5,
      sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
      availableSourceRecordIds: [
        "adapter-zh-a",
        "adapter-zh-b",
        "adapter-zh-c",
      ],
      missingSourceRecordIds: [],
      recordsMissingTextIds: [],
      reasonCodes: [],
    });
  });

  it("explains why a semantic draft candidate is not ready for summarization", () => {
    const { diagnostics, candidate } = buildSemanticDraftPersistenceFixture();
    const incompleteCandidate = {
      ...candidate,
      confidence: 0.2,
      sourceClusterKey: "",
      sourceRecordIds: ["adapter-zh-a", "missing-source", "adapter-no-text"],
      reasonCodes: [],
    };
    const readiness = analyzeSemanticMemoryDraftReadiness({
      candidate: incompleteCandidate,
      records: [
        ...diagnostics.records,
        {
          id: "adapter-no-text",
          userId: "adapter-user",
          timestamp: NOW,
          tier: "short",
        },
      ],
      minConfidence: 0.5,
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        ready: false,
        confidence: 0.2,
        availableSourceRecordIds: ["adapter-zh-a", "adapter-no-text"],
        missingSourceRecordIds: ["missing-source"],
        recordsMissingTextIds: ["adapter-no-text"],
        reasonCodes: [
          "low_confidence",
          "missing_provenance",
          "missing_source_records",
          "missing_source_text",
        ],
      }),
    );
  });

  it("rejects semantic draft readiness when confidence is not finite", () => {
    const { diagnostics, candidate } = buildSemanticDraftPersistenceFixture();
    const readiness = analyzeSemanticMemoryDraftReadiness({
      candidate: {
        ...candidate,
        confidence: Number.NaN,
      },
      records: diagnostics.records,
      minConfidence: 0.5,
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        ready: false,
        confidence: Number.NaN,
        reasonCodes: ["invalid_confidence"],
      }),
    );
  });

  it("builds summarizer request diagnostics from semantic draft readiness", () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    const report = buildSemanticMemoryDraftSummarizerDiagnostics({
      candidate,
      records: diagnostics.records,
      minConfidence: 0.5,
    });

    expect(report).toEqual({
      request: {
        draftId: candidate.draftId,
        sourceClusterKey: candidate.sourceClusterKey,
        competitionKey: candidate.competitionKey,
        suggestedType: candidate.suggestedType,
        confidence: candidate.confidence,
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        availableSourceRecordIds: [
          "adapter-zh-a",
          "adapter-zh-b",
          "adapter-zh-c",
        ],
        missingSourceRecordIds: [],
        recordsMissingTextIds: [],
        ready: true,
        reasonCodes: [],
      },
      response: undefined,
    });
  });

  it("reports summarizer response provenance mismatches without provider calls", () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    const report = buildSemanticMemoryDraftSummarizerDiagnostics({
      candidate,
      records: diagnostics.records,
      draft: {
        type: "unknown",
        content: "",
        sourceRecordIds: ["adapter-zh-a"],
        confidence: Number.NaN,
      },
    });

    expect(report.response).toEqual({
      draftId: candidate.draftId,
      outputType: "unknown",
      outputConfidence: Number.NaN,
      outputSourceRecordIds: ["adapter-zh-a"],
      preservesType: false,
      preservesSourceRecordIds: false,
      hasContent: false,
      reasonCodes: [
        "missing_output_content",
        "output_source_record_mismatch",
        "output_type_mismatch",
        "invalid_output_confidence",
      ],
    });
    expect(report.request.ready).toBe(true);

    const duplicateSourceReport = buildSemanticMemoryDraftSummarizerDiagnostics(
      {
        candidate,
        records: diagnostics.records,
        draft: {
          type: candidate.suggestedType,
          content: "Duplicated source ids should not hide missing provenance.",
          sourceRecordIds: ["adapter-zh-a", "adapter-zh-a", "adapter-zh-b"],
          confidence: candidate.confidence,
        },
      },
    );

    expect(duplicateSourceReport.response).toEqual(
      expect.objectContaining({
        preservesSourceRecordIds: false,
        reasonCodes: ["output_source_record_mismatch"],
      }),
    );
  });

  it("builds a stable summarizer input contract from candidate source records", () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    const inputContract = buildSemanticMemoryDraftSummarizerInputContract({
      candidate,
      records: diagnostics.records,
      context: {
        now: NOW,
        metadata: {
          locale: "zh-CN",
        },
      },
      minConfidence: 0.5,
    });

    expect(inputContract).toEqual({
      candidate: {
        draftId: candidate.draftId,
        sourceClusterKey: candidate.sourceClusterKey,
        competitionKey: candidate.competitionKey,
        suggestedType: "preference",
        confidence: candidate.confidence,
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
        needsSummary: true,
        summaryPriority: candidate.summaryPriority,
      },
      request: {
        draftId: candidate.draftId,
        sourceClusterKey: candidate.sourceClusterKey,
        competitionKey: candidate.competitionKey,
        suggestedType: "preference",
        confidence: candidate.confidence,
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        availableSourceRecordIds: [
          "adapter-zh-a",
          "adapter-zh-b",
          "adapter-zh-c",
        ],
        missingSourceRecordIds: [],
        recordsMissingTextIds: [],
        ready: true,
        reasonCodes: [],
      },
      sourceRecords: [
        {
          recordId: "adapter-zh-a",
          text: "Use Chinese for repo work.",
          timestamp: 30 * DAY_MS,
          metadata: {
            relationGroup: "answer-language",
            relationScope: "long-term",
            relationValue: "zh",
            scope: "long-term",
          },
        },
        {
          recordId: "adapter-zh-b",
          text: "Prefer Chinese technical explanations.",
          timestamp: 45 * DAY_MS,
          metadata: {
            relationGroup: "answer-language",
            relationScope: "long-term",
            relationValue: "zh",
            scope: "long-term",
          },
        },
        {
          recordId: "adapter-zh-c",
          text: "Code explanations are easier in Chinese.",
          timestamp: 60 * DAY_MS,
          metadata: {
            relationGroup: "answer-language",
            relationScope: "long-term",
            relationValue: "zh",
            scope: "long-term",
          },
        },
      ],
      context: {
        now: NOW,
        metadata: {
          locale: "zh-CN",
        },
      },
    });
    expect(
      inputContract.sourceRecords.map((record) => record.recordId),
    ).toEqual(candidate.sourceRecordIds);
  });

  it("lets a fake provider consume the summarizer input contract deterministically", async () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    const inputContract = buildSemanticMemoryDraftSummarizerInputContract({
      candidate,
      records: diagnostics.records,
      context: {
        metadata: {
          source: "golden-test",
        },
      },
    });
    const fakeProvider = async (
      input: ReturnType<typeof buildSemanticMemoryDraftSummarizerInputContract>,
    ) => ({
      type: input.candidate.suggestedType,
      content: input.sourceRecords.map((record) => record.text).join(" "),
      sourceRecordIds: [...input.candidate.sourceRecordIds],
      confidence: input.candidate.confidence,
      metadata: {
        sourceClusterKey: input.candidate.sourceClusterKey,
        competitionKey: input.candidate.competitionKey,
        reasonCodes: [...input.candidate.reasonCodes],
        requestReady: input.request.ready,
        source: input.context?.metadata?.source,
      },
    });

    const draft = await fakeProvider(inputContract);

    expect(draft).toEqual({
      type: "preference",
      content:
        "Use Chinese for repo work. Prefer Chinese technical explanations. Code explanations are easier in Chinese.",
      sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
      confidence: candidate.confidence,
      metadata: {
        sourceClusterKey: candidate.sourceClusterKey,
        competitionKey: candidate.competitionKey,
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
        requestReady: true,
        source: "golden-test",
      },
    });
    expect(draft.sourceRecordIds).not.toContain("adapter-temp-en");
  });

  it("invokes a caller-provided summarizer provider through the adapter boundary", async () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    const receivedDraftIds: string[] = [];
    const invoke: SemanticMemoryDraftSummarizerProviderInvoke = async (
      input,
    ) => {
      receivedDraftIds.push(input.candidate.draftId);

      return {
        type: input.candidate.suggestedType,
        content: input.sourceRecords.map((record) => record.text).join(" "),
        sourceRecordIds: [...input.candidate.sourceRecordIds],
        confidence: input.candidate.confidence,
        metadata: {
          sourceClusterKey: input.candidate.sourceClusterKey,
          competitionKey: input.candidate.competitionKey,
          inputReady: input.request.ready,
          sourceRecordCount: input.sourceRecords.length,
        },
      };
    };

    const result = await invokeSemanticMemoryDraftSummarizerProvider({
      candidate,
      records: diagnostics.records,
      invoke,
      minConfidence: 0.5,
    });

    expect(receivedDraftIds).toEqual([candidate.draftId]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "summarized",
        reasonCodes: [],
        draft: expect.objectContaining({
          type: "preference",
          sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
          confidence: candidate.confidence,
          metadata: expect.objectContaining({
            sourceClusterKey: candidate.sourceClusterKey,
            competitionKey: candidate.competitionKey,
            inputReady: true,
            sourceRecordCount: 3,
          }),
        }),
      }),
    );
    expect(result.input.sourceRecords.map((record) => record.recordId)).toEqual(
      ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
    );
    expect(result.diagnostics.response).toEqual(
      expect.objectContaining({
        preservesType: true,
        preservesSourceRecordIds: true,
        hasContent: true,
        reasonCodes: [],
      }),
    );
  });

  it("keeps provider adapter failure paths observable without real provider calls", async () => {
    const { diagnostics, candidate } = buildSemanticDraftSummarizerFixture();
    let skippedInvokeCount = 0;
    const skipped = await invokeSemanticMemoryDraftSummarizerProvider({
      candidate: {
        ...candidate,
        confidence: 0.2,
      },
      records: diagnostics.records,
      minConfidence: 0.5,
      invoke: async () => {
        skippedInvokeCount += 1;
        throw new Error("should not be called");
      },
    });

    expect(skippedInvokeCount).toBe(0);
    expect(skipped).toEqual(
      expect.objectContaining({
        status: "skipped",
        reasonCodes: ["request_not_ready", "low_confidence"],
      }),
    );
    expect(skipped.draft).toBeUndefined();
    expect(skipped.error).toBeUndefined();
    expect(skipped.diagnostics.request.ready).toBe(false);

    const failed = await invokeSemanticMemoryDraftSummarizerProvider({
      candidate,
      records: diagnostics.records,
      invoke: async () => {
        throw new Error("fake provider unavailable");
      },
    });

    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        error: {
          name: "Error",
          message: "fake provider unavailable",
        },
        reasonCodes: ["provider_error"],
      }),
    );
    expect(failed.draft).toBeUndefined();
    expect(failed.diagnostics.request.ready).toBe(true);
    expect(failed.diagnostics.response).toBeUndefined();
  });

  it("documents fake summarizer failure cases without adding a real provider", async () => {
    const { diagnostics, candidate } = buildSemanticDraftPersistenceFixture();
    const fakeSummarizer: SemanticMemoryDraftSummarizer = {
      async summarizeDraft(candidate, records, context) {
        if (context?.metadata?.emptyOutput === true) {
          return {
            type: candidate.suggestedType,
            content: "",
            sourceRecordIds: [...candidate.sourceRecordIds],
            confidence: candidate.confidence,
          };
        }

        if (records.length === 0) {
          throw new Error("missing source records");
        }

        if (candidate.confidence < 0.5) {
          throw new Error("low confidence draft");
        }

        if (context?.metadata?.graphStatus === "contested") {
          throw new Error("contested draft");
        }

        return {
          type: candidate.suggestedType,
          content: records
            .map((record) => record.text)
            .filter((text): text is string => Boolean(text))
            .join("\n"),
          sourceRecordIds: [...candidate.sourceRecordIds],
          confidence: candidate.confidence,
        };
      },
    };

    await expect(
      summarizeSemanticMemoryDraftCandidate({
        candidate: {
          ...candidate,
          sourceRecordIds: ["missing-source"],
        },
        records: diagnostics.records,
        summarizer: fakeSummarizer,
      }),
    ).rejects.toThrow("missing source records");
    await expect(
      summarizeSemanticMemoryDraftCandidate({
        candidate: {
          ...candidate,
          confidence: 0.2,
        },
        records: diagnostics.records,
        summarizer: fakeSummarizer,
      }),
    ).rejects.toThrow("low confidence draft");
    await expect(
      summarizeSemanticMemoryDraftCandidate({
        candidate,
        records: diagnostics.records,
        summarizer: fakeSummarizer,
        context: {
          metadata: {
            graphStatus: "contested",
          },
        },
      }),
    ).rejects.toThrow("contested draft");

    const emptyDraft = await summarizeSemanticMemoryDraftCandidate({
      candidate,
      records: diagnostics.records,
      summarizer: fakeSummarizer,
      context: {
        metadata: {
          emptyOutput: true,
        },
      },
    });

    expect(emptyDraft).toEqual(
      expect.objectContaining({
        content: "",
        sourceRecordIds: candidate.sourceRecordIds,
      }),
    );
  });

  it("describes semantic draft retrieval candidates without planning logic", () => {
    const draft = {
      draftId: "semantic-draft:answer-language-zh",
      type: "preference",
      content: "User prefers Chinese explanations for technical repo work.",
      sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
      confidence: 0.82,
      metadata: {
        sourceClusterKey: "answer-language:zh",
      },
    } satisfies MemorySemanticRetrievalDraft;
    const planningInput = {
      query: "How should replies be written?",
      drafts: [draft],
      existingRecordIds: ["adapter-zh-a"],
      now: NOW,
    } satisfies MemorySemanticRetrievalPlanningInput;
    const retrievalCandidate = {
      ...draft,
      queryRelevance: 0.7,
      draftStatus: "active",
      status: "eligible",
      reasonCodes: ["semantic_draft_candidate"],
    } satisfies MemorySemanticRetrievalCandidate;
    const planningResult = {
      query: planningInput.query,
      candidates: [retrievalCandidate],
      fallbackRecordIds: planningInput.existingRecordIds,
    } satisfies MemorySemanticRetrievalPlanningResult;

    expect(planningResult).toEqual({
      query: "How should replies be written?",
      candidates: [
        expect.objectContaining({
          draftId: "semantic-draft:answer-language-zh",
          queryRelevance: 0.7,
          draftStatus: "active",
          status: "eligible",
          reasonCodes: ["semantic_draft_candidate"],
          sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        }),
      ],
      fallbackRecordIds: ["adapter-zh-a"],
    });
  });

  it("keeps semantic retrieval integration disabled by default", () => {
    const config =
      resolveMemorySemanticRetrievalConfig() satisfies MemorySemanticRetrievalConfig;

    expect(config).toEqual({
      enabled: false,
      status: "disabled",
      minConfidence: 0,
      allowContested: false,
      maxCandidates: undefined,
      reasonCodes: ["semantic_retrieval_disabled"],
      metadata: undefined,
    });
  });

  it("resolves explicit semantic retrieval opt-in config without ranking changes", () => {
    const config = resolveMemorySemanticRetrievalConfig({
      enabled: true,
      minConfidence: 1.5,
      allowContested: true,
      maxCandidates: 2.8,
      reasonCodes: ["semantic_draft_candidate"],
      metadata: {
        source: "unit-test",
      },
    });

    expect(config).toEqual({
      enabled: true,
      status: "enabled",
      minConfidence: 1,
      allowContested: true,
      maxCandidates: 2,
      reasonCodes: ["semantic_draft_candidate", "semantic_retrieval_enabled"],
      metadata: {
        source: "unit-test",
      },
    });
  });

  it("keeps raw trace fallback when semantic retrieval merge is disabled", () => {
    const plan = buildMemorySemanticRetrievalPlan({
      query: "Which preference is relevant?",
      drafts: [
        {
          draftId: "semantic-draft:selected",
          type: "preference",
          content: "User prefers Chinese technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          confidence: 0.88,
        },
      ],
      existingRecordIds: ["raw-trace:zh-a"],
      getDraftRelevance: () => 0.9,
    });
    const merged = buildMemorySemanticRetrievalMergedResults({
      plan,
      sourceResults: [
        {
          recordId: "raw-trace:zh-a",
          content: "Prefer Chinese technical explanations.",
          reasonCodes: ["query_relevance"],
        },
      ],
    }) satisfies MemorySemanticRetrievalMergedResultSet;

    expect(merged.enabled).toBe(false);
    expect(merged.results).toEqual([
      expect.objectContaining({
        resultId: "raw-trace:zh-a",
        kind: "source-trace",
        status: "fallback",
        sourceRecordIds: ["raw-trace:zh-a"],
        reasonCodes: [
          "source_trace_fallback",
          "semantic_retrieval_disabled",
          "query_relevance",
        ],
      }),
    ]);
    expect(merged.semanticResults).toEqual([]);
    expect(merged.suppressedDrafts).toEqual([
      expect.objectContaining({
        draftId: "semantic-draft:selected",
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "semantic_retrieval_disabled",
        ],
      }),
    ]);
  });

  it("merges raw trace fallback with eligible semantic drafts only after opt-in", () => {
    const plan = buildMemorySemanticRetrievalPlan({
      query: "Which long-term preference should guide this answer?",
      minConfidence: 0.7,
      drafts: [
        {
          draftId: "semantic-draft:selected",
          type: "preference",
          content: "User prefers Chinese technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          confidence: 0.88,
          metadata: {
            sourceClusterKey: "answer-language:zh",
          },
        },
        {
          draftId: "semantic-draft:low-confidence",
          type: "preference",
          content: "User might prefer terse answers.",
          sourceRecordIds: ["raw-trace:style-a"],
          confidence: 0.4,
        },
      ],
      existingRecordIds: ["raw-trace:zh-a"],
      getDraftRelevance: () => 0.9,
    });
    const merged = buildMemorySemanticRetrievalMergedResults({
      plan,
      config: {
        enabled: true,
        reasonCodes: ["semantic_draft_candidate"],
      },
    });

    expect(merged.enabled).toBe(true);
    expect(merged.results).toEqual([
      expect.objectContaining({
        resultId: "raw-trace:zh-a",
        kind: "source-trace",
        status: "fallback",
        sourceRecordIds: ["raw-trace:zh-a"],
        reasonCodes: expect.arrayContaining([
          "source_trace_fallback",
          "semantic_retrieval_enabled",
        ]),
      }),
      expect.objectContaining({
        resultId: "semantic-draft:selected",
        kind: "semantic-draft",
        draftId: "semantic-draft:selected",
        status: "eligible",
        confidence: 0.88,
        queryRelevance: 0.9,
        sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
        reasonCodes: expect.arrayContaining([
          "semantic_draft_candidate",
          "query_relevance",
          "semantic_retrieval_enabled",
        ]),
        metadata: {
          sourceClusterKey: "answer-language:zh",
        },
      }),
    ]);
    expect(merged.suppressedDrafts).toEqual([
      expect.objectContaining({
        draftId: "semantic-draft:low-confidence",
        status: "suppressed",
        reasonCodes: expect.arrayContaining([
          "semantic_draft_candidate",
          "query_relevance",
          "low_confidence",
          "semantic_retrieval_enabled",
        ]),
      }),
    ]);
    expect(plan.fallbackRecordIds).toEqual(["raw-trace:zh-a"]);
  });

  it("reports opt-in semantic retrieval eval scenarios for selected, suppressed, and fallback results", () => {
    const plan = buildMemorySemanticRetrievalPlan({
      query: "Which language preference should guide this answer?",
      minConfidence: 0.7,
      drafts: [
        {
          draftId: "semantic-draft:selected-zh",
          type: "preference",
          content: "User prefers Chinese for technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          confidence: 0.9,
        },
        {
          draftId: "semantic-draft:temporary-en",
          type: "preference",
          content: "User once asked for English in a temporary reply.",
          sourceRecordIds: ["raw-trace:en-temp"],
          confidence: 0.5,
        },
      ],
      existingRecordIds: ["raw-trace:zh-a"],
      getDraftRelevance({ draft }) {
        return draft.draftId === "semantic-draft:selected-zh" ? 0.95 : 0.8;
      },
    });
    const merged = buildMemorySemanticRetrievalMergedResults({
      plan,
      config: {
        enabled: true,
      },
      sourceResults: [
        {
          recordId: "raw-trace:zh-a",
          content: "Prefer Chinese technical explanations.",
          reasonCodes: ["query_relevance"],
        },
      ],
    });
    const report = buildMemorySemanticRetrievalEvalScenarioReport({
      scenarioId: "retrieval-opt-in-language-preference",
      merged,
      expectations: {
        selectedDraftIds: ["semantic-draft:selected-zh"],
        suppressedDraftIds: ["semantic-draft:temporary-en"],
        fallbackRecordIds: ["raw-trace:zh-a"],
      },
      metadata: {
        category: "opt-in-retrieval",
      },
    }) satisfies MemorySemanticRetrievalEvalScenarioReport;

    expect(report).toEqual({
      scenarioId: "retrieval-opt-in-language-preference",
      query: "Which language preference should guide this answer?",
      enabled: true,
      selectedDraftIds: ["semantic-draft:selected-zh"],
      suppressedDraftIds: ["semantic-draft:temporary-en"],
      fallbackRecordIds: ["raw-trace:zh-a"],
      missingSelectedDraftIds: [],
      missingSuppressedDraftIds: [],
      missingFallbackRecordIds: [],
      selectedPassed: true,
      suppressedPassed: true,
      fallbackPassed: true,
      passed: true,
      reasonCodes: expect.arrayContaining([
        "semantic_retrieval_enabled",
        "semantic_draft_candidate",
        "query_relevance",
        "source_trace_fallback",
        "low_confidence",
      ]),
      metadata: {
        category: "opt-in-retrieval",
      },
    });
    expect(merged.results.map((result) => result.kind)).toEqual([
      "source-trace",
      "semantic-draft",
    ]);
  });

  it("builds a log-only semantic retrieval comparison report without mutating snapshots", () => {
    const plan = buildMemorySemanticRetrievalPlan({
      query: "Which language preference should guide this answer?",
      minConfidence: 0.7,
      drafts: [
        {
          draftId: "semantic-draft:selected-zh",
          type: "preference",
          content: "User prefers Chinese for technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          confidence: 0.9,
        },
        {
          draftId: "semantic-draft:low-confidence",
          type: "preference",
          content: "User might prefer terse answers.",
          sourceRecordIds: ["raw-trace:style-a"],
          confidence: 0.4,
        },
      ],
      existingRecordIds: ["raw-trace:zh-a"],
      getDraftRelevance: () => 0.9,
    });
    const baseline = buildMemorySemanticRetrievalMergedResults({
      plan,
      sourceResults: [
        {
          recordId: "raw-trace:zh-a",
          content: "Prefer Chinese technical explanations.",
        },
      ],
    });
    const candidate = buildMemorySemanticRetrievalMergedResults({
      plan,
      config: {
        enabled: true,
      },
      sourceResults: [
        {
          recordId: "raw-trace:zh-a",
          content: "Prefer Chinese technical explanations.",
        },
      ],
    });
    const baselineSnapshot = JSON.stringify(baseline);
    const candidateSnapshot = JSON.stringify(candidate);
    const report = buildMemorySemanticRetrievalComparisonReport({
      baseline,
      candidate,
      metadata: {
        mode: "log-only",
      },
    }) satisfies MemorySemanticRetrievalComparisonReport;

    expect(report).toEqual({
      summary: {
        query: "Which language preference should guide this answer?",
        baselineResultCount: 1,
        candidateResultCount: 2,
        addedSemanticDraftCount: 1,
        retainedFallbackRecordCount: 1,
        suppressedDraftCount: 1,
      },
      query: "Which language preference should guide this answer?",
      baselineEnabled: false,
      candidateEnabled: true,
      baselineResultIds: ["raw-trace:zh-a"],
      candidateResultIds: ["raw-trace:zh-a", "semantic-draft:selected-zh"],
      retainedFallbackRecordIds: ["raw-trace:zh-a"],
      addedSemanticDrafts: [
        {
          draftId: "semantic-draft:selected-zh",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          reasonCodes: [
            "semantic_draft_candidate",
            "query_relevance",
            "semantic_retrieval_enabled",
          ],
        },
      ],
      suppressedDrafts: [
        {
          draftId: "semantic-draft:low-confidence",
          sourceRecordIds: ["raw-trace:style-a"],
          reasonCodes: [
            "semantic_draft_candidate",
            "query_relevance",
            "low_confidence",
            "semantic_retrieval_enabled",
          ],
        },
      ],
      reasonCodes: expect.arrayContaining([
        "semantic_retrieval_comparison",
        "semantic_retrieval_log_only",
        "semantic_retrieval_disabled",
        "semantic_retrieval_enabled",
      ]),
      metadata: {
        mode: "log-only",
      },
    });
    expect(JSON.stringify(baseline)).toBe(baselineSnapshot);
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
  });

  it("plans semantic draft retrieval candidates with caller-provided relevance", () => {
    const drafts: MemorySemanticRetrievalDraft[] = [
      {
        draftId: "semantic-draft:low-relevance",
        type: "preference",
        content: "User prefers compact answers.",
        sourceRecordIds: ["adapter-style-a"],
        confidence: 0.99,
      },
      {
        draftId: "semantic-draft:answer-language-zh",
        type: "preference",
        content: "User prefers Chinese explanations for technical repo work.",
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b"],
        confidence: 0.82,
      },
      {
        draftId: "semantic-draft:answer-language-en",
        type: "preference",
        content: "User once asked for English in one reply.",
        sourceRecordIds: ["adapter-en-a"],
        confidence: 0.72,
      },
    ];
    const result = buildMemorySemanticRetrievalPlan({
      query: "What language should technical replies use?",
      drafts,
      existingRecordIds: ["adapter-zh-a"],
      now: NOW,
      getDraftRelevance({ draft }) {
        if (draft.draftId.endsWith("answer-language-zh")) {
          return 0.9;
        }

        if (draft.draftId.endsWith("answer-language-en")) {
          return 0.9;
        }

        return 0.2;
      },
    });

    expect(result.candidates.map((candidate) => candidate.draftId)).toEqual([
      "semantic-draft:answer-language-zh",
      "semantic-draft:answer-language-en",
      "semantic-draft:low-relevance",
    ]);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        queryRelevance: 0.9,
        confidence: 0.82,
        status: "eligible",
        reasonCodes: ["semantic_draft_candidate", "query_relevance"],
      }),
    );
    expect(result.fallbackRecordIds).toEqual(["adapter-zh-a"]);
    expect(drafts[0]?.sourceRecordIds).toEqual(["adapter-style-a"]);
  });

  it("suppresses semantic retrieval candidates conservatively", () => {
    const result = buildMemorySemanticRetrievalPlan({
      query: "What should be recalled?",
      minConfidence: 0.7,
      maxCandidates: 1,
      drafts: [
        {
          draftId: "semantic-draft:strong",
          type: "preference",
          content: "User prefers Chinese technical explanations.",
          sourceRecordIds: ["adapter-zh-a"],
          confidence: 0.9,
          status: "active",
        },
        {
          draftId: "semantic-draft:contested",
          type: "preference",
          content: "User may prefer English.",
          sourceRecordIds: ["adapter-en-a"],
          confidence: 0.95,
          status: "contested",
        },
        {
          draftId: "semantic-draft:low-confidence",
          type: "preference",
          content: "User may prefer very short answers.",
          sourceRecordIds: ["adapter-style-a"],
          confidence: 0.4,
          status: "active",
        },
        {
          draftId: "semantic-draft:extra",
          type: "preference",
          content: "User prefers detailed citations.",
          sourceRecordIds: ["adapter-citation-a"],
          confidence: 0.85,
          status: "active",
        },
      ],
      getDraftRelevance({ draft }) {
        return draft.draftId === "semantic-draft:low-confidence" ? 0.6 : 0.9;
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        draftId: "semantic-draft:contested",
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "contested_memory",
        ],
      }),
      expect.objectContaining({
        draftId: "semantic-draft:strong",
        status: "eligible",
      }),
      expect.objectContaining({
        draftId: "semantic-draft:extra",
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "max_candidates",
        ],
      }),
      expect.objectContaining({
        draftId: "semantic-draft:low-confidence",
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "low_confidence",
        ],
      }),
    ]);
  });

  it("covers semantic retrieval eval scenarios for selected, suppressed, contested, and fallback candidates", () => {
    const result = buildMemorySemanticRetrievalPlan({
      query: "Which long-term preference should guide this answer?",
      minConfidence: 0.7,
      existingRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
      drafts: [
        {
          draftId: "semantic-draft:selected",
          type: "preference",
          content: "User prefers Chinese for technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a", "raw-trace:zh-b"],
          confidence: 0.88,
          status: "active",
        },
        {
          draftId: "semantic-draft:low-confidence",
          type: "preference",
          content: "User might prefer terse answers.",
          sourceRecordIds: ["raw-trace:style-a"],
          confidence: 0.4,
          status: "active",
        },
        {
          draftId: "semantic-draft:contested",
          type: "preference",
          content: "User may prefer English now.",
          sourceRecordIds: ["raw-trace:en-a"],
          confidence: 0.91,
          status: "contested",
        },
      ],
      getDraftRelevance({ draft }) {
        return draft.draftId === "semantic-draft:selected" ? 0.9 : 0.8;
      },
    });
    const candidatesById = new Map(
      result.candidates.map((candidate) => [candidate.draftId, candidate]),
    );

    expect(candidatesById.get("semantic-draft:selected")).toEqual(
      expect.objectContaining({
        status: "eligible",
        reasonCodes: ["semantic_draft_candidate", "query_relevance"],
      }),
    );
    expect(candidatesById.get("semantic-draft:low-confidence")).toEqual(
      expect.objectContaining({
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "low_confidence",
        ],
      }),
    );
    expect(candidatesById.get("semantic-draft:contested")).toEqual(
      expect.objectContaining({
        status: "suppressed",
        reasonCodes: [
          "semantic_draft_candidate",
          "query_relevance",
          "contested_memory",
        ],
      }),
    );
    expect(result.fallbackRecordIds).toEqual([
      "raw-trace:zh-a",
      "raw-trace:zh-b",
    ]);
  });

  it("builds a semantic retrieval dry-run report without changing retrieval results", () => {
    const result = buildMemorySemanticRetrievalPlan({
      query: "Which preference is relevant?",
      existingRecordIds: ["raw-trace:zh-a"],
      minConfidence: 0.7,
      drafts: [
        {
          draftId: "semantic-draft:selected",
          type: "preference",
          content: "User prefers Chinese technical explanations.",
          sourceRecordIds: ["raw-trace:zh-a"],
          confidence: 0.88,
        },
        {
          draftId: "semantic-draft:low-confidence",
          type: "preference",
          content: "User may prefer terse answers.",
          sourceRecordIds: ["raw-trace:style-a"],
          confidence: 0.4,
        },
      ],
      getDraftRelevance: () => 0.8,
    });
    const report = buildMemorySemanticRetrievalDryRunReport({
      plan: result,
      existingRecordIds: ["raw-trace:zh-a"],
    }) satisfies MemorySemanticRetrievalDryRunReport;

    expect(report).toEqual(
      expect.objectContaining({
        summary: {
          query: "Which preference is relevant?",
          existingRecordCount: 1,
          draftCandidateCount: 2,
          addedDraftCount: 1,
          suppressedDraftCount: 1,
          fallbackRecordCount: 1,
        },
        existingRecordIds: ["raw-trace:zh-a"],
        draftCandidateIds: [
          "semantic-draft:selected",
          "semantic-draft:low-confidence",
        ],
        reasonCodes: expect.arrayContaining([
          "semantic_draft_candidate",
          "query_relevance",
          "low_confidence",
          "source_trace_fallback",
        ]),
      }),
    );
    expect(result.fallbackRecordIds).toEqual(["raw-trace:zh-a"]);
  });

  it("does not persist semantic drafts when persistence is disabled", async () => {
    const { item } = buildSemanticDraftPersistenceFixture();
    const result = await persistSemanticMemoryDrafts({
      userId: "adapter-user",
      now: NOW,
      enabled: false,
      dryRun: false,
      items: [item],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "disabled",
        userId: "adapter-user",
        dryRun: false,
        persistedCount: 0,
        skippedReason: "persistence_disabled",
      }),
    );
    expect(result.plannedDrafts).toEqual([
      expect.objectContaining({
        draftId: item.candidate.draftId,
        sourceRecordIds: item.candidate.sourceRecordIds,
        sourceClusterKey: item.candidate.sourceClusterKey,
        competitionKey: item.candidate.competitionKey,
        createdAt: NOW,
      }),
    ]);
  });

  it("keeps semantic draft persistence as a dry-run by default", async () => {
    const { item } = buildSemanticDraftPersistenceFixture();
    const result = await persistSemanticMemoryDrafts({
      userId: "adapter-user",
      now: NOW,
      enabled: true,
      items: [item],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "dry-run",
        dryRun: true,
        persistedCount: 0,
        skippedReason: "dry_run",
      }),
    );
    expect(result.plannedDrafts[0]).toEqual(
      expect.objectContaining({
        type: "preference",
        content: item.draft.content,
        confidence: item.draft.confidence,
        evidenceCount: item.candidate.evidenceCount,
        reasonCodes: item.candidate.reasonCodes,
      }),
    );
  });

  it("requires a caller-provided store for non-dry-run persistence", async () => {
    const { item } = buildSemanticDraftPersistenceFixture();

    await expect(
      persistSemanticMemoryDrafts({
        userId: "adapter-user",
        now: NOW,
        enabled: true,
        dryRun: false,
        items: [item],
      }),
    ).rejects.toThrow("requires a store");
  });

  it("persists semantic drafts only through a caller-provided store", async () => {
    const { diagnostics, item } = buildSemanticDraftPersistenceFixture();
    const originalRecordIds = diagnostics.records.map((record) => record.id);
    const { calls, store } = recordingSemanticDraftStore();
    const result = await persistSemanticMemoryDrafts({
      userId: "adapter-user",
      now: NOW,
      enabled: true,
      dryRun: false,
      items: [item],
      store,
    });

    expect(calls).toEqual([
      {
        userId: "adapter-user",
        now: NOW,
        dryRun: false,
        drafts: [
          expect.objectContaining({
            draftId: item.candidate.draftId,
            type: "preference",
            content: item.draft.content,
            sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
            metadata: expect.objectContaining({
              sourceClusterKey: item.candidate.sourceClusterKey,
              competitionKey: item.candidate.competitionKey,
            }),
            sourceClusterKey: item.candidate.sourceClusterKey,
            competitionKey: item.candidate.competitionKey,
          }),
        ],
      },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "persisted",
        dryRun: false,
        persistedCount: 1,
      }),
    );
    expect(diagnostics.records.map((record) => record.id)).toEqual(
      originalRecordIds,
    );
  });

  it("describes a caller-provided semantic memory artifact storage adapter contract", async () => {
    const artifact = {
      artifactId: "artifact:semantic-draft:answer-language-zh",
      userId: "adapter-user",
      type: "preference",
      content: "User prefers Chinese explanations for technical repo work.",
      status: "draft",
      confidence: 0.82,
      sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
      sourceClusterKey: "answer-language:zh",
      competitionKey: "answer-language",
      reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      createdAt: NOW,
      updatedAt: NOW,
      rollback: {
        operationId: "memory-consolidation-dry-run",
        reason: "semantic draft storage contract test",
      },
      metadata: {
        packageLocal: true,
      },
    } satisfies SemanticMemoryArtifactStorageRecord;
    const saveCalls: Array<{
      userId: string;
      artifacts: SemanticMemoryArtifactStorageRecord[];
      now: number;
      dryRun: boolean;
    }> = [];
    const adapter = {
      async saveArtifacts(input) {
        saveCalls.push(input);

        return {
          artifactIds: input.artifacts.map((artifact) => artifact.artifactId),
          dryRun: input.dryRun,
        };
      },
    } satisfies SemanticMemoryArtifactStorageAdapter;
    const result = await adapter.saveArtifacts({
      userId: "adapter-user",
      artifacts: [artifact],
      now: NOW,
      dryRun: true,
    });

    expect(result).toEqual({
      artifactIds: ["artifact:semantic-draft:answer-language-zh"],
      dryRun: true,
    });
    expect(saveCalls).toEqual([
      expect.objectContaining({
        userId: "adapter-user",
        dryRun: true,
        artifacts: [
          expect.objectContaining({
            sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
            rollback: expect.objectContaining({
              operationId: "memory-consolidation-dry-run",
            }),
          }),
        ],
      }),
    ]);
  });

  it("serializes and deserializes semantic memory artifacts with rollback provenance", () => {
    const artifact = semanticArtifactStorageFixture();
    artifact.confidence = 1.4;
    const serialized = serializeSemanticMemoryArtifactStorageRecord(artifact);
    const deserialized =
      deserializeSemanticMemoryArtifactStorageRecord(serialized);

    artifact.sourceRecordIds.push("mutated-after-serialize");
    artifact.rollback.metadata = {
      packageLocal: false,
    };

    expect(serialized).toEqual({
      schemaVersion: 1,
      artifact: expect.objectContaining({
        artifactId: "artifact:semantic-draft:answer-language-zh",
        userId: "adapter-user",
        status: "draft",
        confidence: 1,
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        rollback: expect.objectContaining({
          operationId: "memory-consolidation-dry-run",
          sourceArtifactId: "artifact:previous",
          metadata: {
            packageLocal: true,
          },
        }),
      }),
    });
    expect(deserialized).toEqual({
      valid: true,
      artifact: expect.objectContaining({
        artifactId: "artifact:semantic-draft:answer-language-zh",
        userId: "adapter-user",
        status: "draft",
        confidence: 1,
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        rollback: expect.objectContaining({
          operationId: "memory-consolidation-dry-run",
          sourceArtifactId: "artifact:previous",
          metadata: {
            packageLocal: true,
          },
        }),
      }),
      reasonCodes: [],
    });
  });

  it("reports invalid semantic memory artifact payloads without storage writes", () => {
    const result = deserializeSemanticMemoryArtifactStorageRecord({
      schemaVersion: 1,
      artifact: {
        artifactId: "",
        userId: "",
        type: "",
        content: "",
        status: "",
        confidence: Number.NaN,
        sourceRecordIds: [],
        sourceClusterKey: "",
        competitionKey: "",
        reasonCodes: [],
      },
    });

    expect(result).toEqual({
      valid: false,
      reasonCodes: [
        "missing_artifact_id",
        "missing_user_id",
        "missing_type",
        "missing_content",
        "missing_status",
        "invalid_confidence",
        "missing_source_record_ids",
        "missing_source_cluster_key",
        "missing_competition_key",
        "missing_timestamps",
        "missing_rollback_metadata",
      ],
    });
    expect(
      deserializeSemanticMemoryArtifactStorageRecord({
        schemaVersion: 2,
        artifact: {},
      }),
    ).toEqual({
      valid: false,
      reasonCodes: ["unsupported_schema_version"],
    });
  });

  it("builds semantic artifact storage write reports without performing writes", () => {
    const disabledArtifact = semanticArtifactStorageFixture();
    const disabledReport = buildSemanticMemoryArtifactStorageDryRunReport({
      userId: "adapter-user",
      artifacts: [disabledArtifact],
      enabled: false,
      dryRun: false,
    });
    const writeReadyArtifact = semanticArtifactStorageFixture();
    const writeReadyReport = buildSemanticMemoryArtifactStorageDryRunReport({
      userId: "adapter-user",
      artifacts: [writeReadyArtifact],
      enabled: true,
      dryRun: false,
    });

    disabledArtifact.sourceRecordIds.push("mutated-after-report");
    writeReadyArtifact.sourceRecordIds.push("mutated-after-report");

    expect(disabledReport.summary).toEqual({
      userId: "adapter-user",
      status: "disabled",
      dryRun: true,
      artifactCount: 1,
      wouldWriteCount: 1,
      actualWriteCount: 0,
      skippedWriteCount: 1,
    });
    expect(disabledReport.reasonCodes).toEqual([
      "artifact_storage_candidate",
      "persistence_disabled",
    ]);
    expect(disabledReport.artifacts[0]).toEqual(
      expect.objectContaining({
        artifactId: "artifact:semantic-draft:answer-language-zh",
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        rollbackOperationId: "memory-consolidation-dry-run",
        rollbackSourceArtifactId: "artifact:previous",
        reasonCodes: ["artifact_storage_candidate", "persistence_disabled"],
      }),
    );
    expect(writeReadyReport.summary).toEqual({
      userId: "adapter-user",
      status: "write-ready",
      dryRun: false,
      artifactCount: 1,
      wouldWriteCount: 1,
      actualWriteCount: 0,
      skippedWriteCount: 0,
    });
    expect(writeReadyReport.reasonCodes).toEqual([
      "artifact_storage_candidate",
      "write_ready",
    ]);
    expect(
      writeReadyReport.serializedArtifacts[0]?.artifact.sourceRecordIds,
    ).toEqual(["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"]);
  });

  it("runs opt-in memory consolidation diagnostics as a dry-run", async () => {
    const input = buildAdapterDiagnosticsInput();
    const readerCalls: Array<{
      userId: string;
      now: number;
      limit: number;
    }> = [];
    const result = await runMemoryConsolidationDiagnostics({
      userId: "adapter-user",
      now: NOW,
      dryRun: true,
      limit: 25,
      reader: {
        async listCandidateRecords(request) {
          readerCalls.push(request);
          return input.records;
        },
      },
      selectors: adapterSelectors,
      plan: input.plan,
    });

    expect(readerCalls).toEqual([
      {
        userId: "adapter-user",
        now: NOW,
        limit: 25,
      },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        dryRun: true,
        userId: "adapter-user",
        scannedRecords: input.records.length,
      }),
    );
    expect(result.report.summary).toEqual(
      expect.objectContaining({
        sourceRecordCount: input.records.length,
        preserveCount: 1,
        decayCount: 1,
      }),
    );
    expect(result.semanticDraftCandidates).toEqual([
      expect.objectContaining({
        suggestedType: "preference",
        sourceRecordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
        needsSummary: true,
      }),
    ]);
  });

  it("adapts structurally compatible runtime memory records for consolidation", () => {
    const records: MemoryRecord[] = [
      {
        ...relationPipelineRecord(
          "runtime-zh-a",
          "Use Chinese for repo work.",
          119,
          "zh",
          { accessCount: 2 },
        ),
        importanceScore: 0.8,
        dimensions: {
          project: "openloomi",
        },
      },
    ];
    const adapted = adaptRuntimeMemoryRecordsForConsolidation({ records });

    expect(adapted).toEqual({
      records: [
        expect.objectContaining({
          id: "runtime-zh-a",
          userId: "eval-user",
          timestamp: 119 * DAY_MS,
          text: "Use Chinese for repo work.",
          tier: "short",
          accessCount: 2,
          importanceScore: 0.8,
          dimensions: {
            project: "openloomi",
          },
          metadata: expect.objectContaining({
            relationGroup: "answer-language",
            relationValue: "zh",
            relationScope: "long-term",
          }),
        }),
      ],
      skippedRecords: [],
      sourceIndexesByRecordId: {
        "runtime-zh-a": 0,
      },
    });
  });

  it("uses runtime memory record selectors in diagnostics without storage writes", () => {
    const records: MemoryRecord[] = [
      relationPipelineRecord(
        "runtime-zh-a",
        "Use Chinese for repo work.",
        30,
        "zh",
        { accessCount: 1 },
      ),
      relationPipelineRecord(
        "runtime-zh-b",
        "Prefer Chinese technical explanations.",
        45,
        "zh",
        { accessCount: 1 },
      ),
      relationPipelineRecord(
        "runtime-zh-c",
        "Code explanations are easier in Chinese.",
        60,
        "zh",
        { accessCount: 1 },
      ),
      relationPipelineRecord(
        "runtime-temp-en",
        "Use English for this one reply.",
        119,
        "en",
        { scope: "temporary" },
      ),
    ];
    const diagnostics = buildMemoryRelationPipelineDiagnostics({
      records,
      now: NOW,
      selectors: buildMemoryConsolidationRuntimeRecordSelectors<MemoryRecord>(),
      plan: {
        thresholds: {
          preserveScore: 0.5,
          preserveEvidence: 3,
          competitionMargin: 0.05,
        },
      },
    });
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);

    expect(report.summary).toEqual(
      expect.objectContaining({
        sourceRecordCount: 4,
        adaptedRecordCount: 4,
        skippedRecordCount: 0,
        preserveCount: 1,
        decayCount: 1,
      }),
    );
    expect(report.preservedClusters).toEqual([
      expect.objectContaining({
        recordIds: ["runtime-zh-a", "runtime-zh-b", "runtime-zh-c"],
        reasonCodes: ["strong_repeated_evidence"],
      }),
    ]);
    expect(report.decayedRecords).toEqual([
      expect.objectContaining({
        recordId: "runtime-temp-en",
      }),
    ]);
  });

  it("builds a compact diagnostics run report for real-record batches", async () => {
    const records: AdapterSourceRecord[] = [
      {
        owner: "adapter-user",
        createdAt: NOW,
        body: "Missing id.",
      },
      adapterSourceRecord(
        "runtime-report-zh-a",
        "Use Chinese for repo work.",
        30,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "runtime-report-zh-b",
        "Prefer Chinese technical explanations.",
        45,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "runtime-report-zh-c",
        "Code explanations are easier in Chinese.",
        60,
        "zh",
        { reads: 1 },
      ),
      adapterSourceRecord(
        "runtime-report-temp-en",
        "Use English for this one reply.",
        119,
        "en",
        { scope: "temporary" },
      ),
    ];
    const result = await runMemoryConsolidationDiagnostics({
      userId: "adapter-user",
      now: NOW,
      dryRun: true,
      reader: {
        async listCandidateRecords() {
          return records;
        },
      },
      selectors: adapterSelectors,
      plan: {
        thresholds: {
          preserveScore: 0.5,
          preserveEvidence: 3,
          competitionMargin: 0.05,
        },
      },
    });
    const report = buildMemoryConsolidationDiagnosticsRunReport(result);

    expect(report.summary).toEqual(
      expect.objectContaining({
        status: "success",
        dryRun: true,
        userId: "adapter-user",
        scannedRecordCount: 5,
        adaptedRecordCount: 4,
        skippedRecordCount: 1,
        preservedClusterCount: 1,
        suppressedRecordCount: 1,
        semanticDraftCandidateCount: 1,
      }),
    );
    expect(report.skippedRecords).toEqual([
      {
        sourceIndex: 0,
        reasonCodes: ["missing_id"],
      },
    ]);
    expect(report.preservedClusters).toEqual([
      expect.objectContaining({
        recordIds: [
          "runtime-report-zh-a",
          "runtime-report-zh-b",
          "runtime-report-zh-c",
        ],
        reasonCodes: ["strong_repeated_evidence"],
        semanticDraftCandidateIds: [expect.stringContaining("semantic-draft:")],
      }),
    ]);
    expect(report.suppressedRecords).toEqual([
      expect.objectContaining({
        recordId: "runtime-report-temp-en",
        reasonCodes: ["isolated_low_confidence"],
      }),
    ]);
    expect(report.semanticDraftCandidateIds).toEqual([
      expect.stringContaining("semantic-draft:"),
    ]);
  });

  it("logs diagnostics run reports only through an explicitly enabled caller sink", async () => {
    const result = await buildDiagnosticsRunFixture();
    const disabledSinkCalls: unknown[] = [];
    const disabled = await logMemoryConsolidationDiagnosticsRun({
      result,
      sink: {
        logDiagnosticsRun(report) {
          disabledSinkCalls.push(report);
        },
      },
    });
    const enabledSinkCalls: ReturnType<
      typeof buildMemoryConsolidationDiagnosticsRunReport
    >[] = [];
    const logged = await logMemoryConsolidationDiagnosticsRun({
      result,
      enabled: true,
      sink: {
        logDiagnosticsRun(report) {
          enabledSinkCalls.push(report);
        },
      },
    });

    expect(disabledSinkCalls).toEqual([]);
    expect(disabled).toEqual(
      expect.objectContaining({
        status: "disabled",
        reasonCodes: ["log_disabled"],
      }),
    );
    await expect(
      logMemoryConsolidationDiagnosticsRun({
        result,
        enabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "disabled",
        reasonCodes: ["log_sink_missing"],
      }),
    );
    expect(logged).toEqual(
      expect.objectContaining({
        status: "logged",
        reasonCodes: ["log_only"],
      }),
    );
    expect(enabledSinkCalls).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          dryRun: true,
          userId: "adapter-user",
          preservedClusterCount: 1,
          suppressedRecordCount: 1,
        }),
        preservedClusters: [
          expect.objectContaining({
            recordIds: ["adapter-zh-a", "adapter-zh-b", "adapter-zh-c"],
          }),
        ],
      }),
    ]);
  });

  it("rejects non-dry-run memory consolidation diagnostics", async () => {
    await expect(
      runMemoryConsolidationDiagnostics({
        userId: "adapter-user",
        now: NOW,
        dryRun: false,
        reader: {
          async listCandidateRecords() {
            return buildAdapterDiagnosticsInput().records;
          },
        },
        selectors: adapterSelectors,
      }),
    ).rejects.toThrow("only supports dryRun");
  });

  it("skips incomplete source records before running diagnostics", () => {
    const adapted = adaptMemoryRecordsForConsolidation({
      records: [
        {
          owner: "adapter-user",
          createdAt: NOW,
          body: "Missing id.",
        },
        {
          uid: "missing-time",
          owner: "adapter-user",
          body: "Missing timestamp.",
        },
        adapterSourceRecord(
          "adapter-valid",
          "Use Chinese for repo work.",
          119,
          "zh",
        ),
      ],
      selectors: adapterSelectors,
    });
    const diagnostics = buildMemoryRelationPipelineDiagnostics({
      records: [
        {
          owner: "adapter-user",
          createdAt: NOW,
          body: "Missing id.",
        },
        {
          uid: "missing-time",
          owner: "adapter-user",
          body: "Missing timestamp.",
        },
        adapterSourceRecord(
          "adapter-valid",
          "Use Chinese for repo work.",
          119,
          "zh",
        ),
      ],
      now: NOW,
      selectors: adapterSelectors,
    });
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);

    expect(adapted.records.map((record) => record.id)).toEqual([
      "adapter-valid",
    ]);
    expect(adapted.skippedRecords).toEqual([
      {
        sourceIndex: 0,
        reasonCodes: ["missing_id"],
      },
      {
        sourceIndex: 1,
        reasonCodes: ["missing_timestamp"],
      },
    ]);
    expect(diagnostics.summary).toEqual(
      expect.objectContaining({
        sourceRecordCount: 3,
        adaptedRecordCount: 1,
        skippedRecordCount: 2,
        candidateCount: 0,
        relationCount: 0,
      }),
    );
    expect(report.summary).toEqual(
      expect.objectContaining({
        sourceRecordCount: 3,
        adaptedRecordCount: 1,
        skippedRecordCount: 2,
      }),
    );
    expect(report.skippedRecords).toEqual(adapted.skippedRecords);
    expect(diagnostics.recordDiagnostics).toEqual([
      expect.objectContaining({
        recordId: "adapter-valid",
        graphStatus: "tentative",
      }),
    ]);
  });

  it("normalizes semantic memory revision statuses without applying replacements", () => {
    const active = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:active",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-a", "trace-b"],
      confidence: 1.2,
      metadata: {
        scope: "long-term",
      },
    }) satisfies SemanticMemoryRevisionStatusSignal;
    const deprecated = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:deprecated",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-old"],
      confidence: 0.8,
      reasonCodes: ["manual_review"],
      rollback: {
        operationId: "revision-dry-run",
        sourceArtifactId: "artifact:active",
        metadata: {
          reversible: true,
        },
      },
    });
    const conflicted = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:conflicted",
      artifactStatus: "conflicted",
      sourceRecordIds: ["trace-conflict-a", "trace-conflict-b"],
      confidence: Number.NaN,
    });

    expect(active).toEqual({
      artifactId: "artifact:active",
      artifactStatus: "consolidated",
      revisionStatus: "active",
      sourceRecordIds: ["trace-a", "trace-b"],
      confidence: 1,
      reasonCodes: ["active_memory"],
      rollback: undefined,
      metadata: {
        scope: "long-term",
      },
    });
    expect(deprecated).toEqual(
      expect.objectContaining({
        revisionStatus: "deprecated",
        reasonCodes: ["deprecated_memory", "manual_review"],
        sourceRecordIds: ["trace-old"],
        rollback: {
          operationId: "revision-dry-run",
          sourceArtifactId: "artifact:active",
          metadata: {
            reversible: true,
          },
        },
      }),
    );
    expect(conflicted).toEqual(
      expect.objectContaining({
        revisionStatus: "conflicted",
        confidence: 0,
        reasonCodes: ["conflicted_memory"],
        sourceRecordIds: ["trace-conflict-a", "trace-conflict-b"],
      }),
    );

    deprecated.sourceRecordIds.push("mutated");
    expect(deprecated.rollback).toBeDefined();
    const rollback = deprecated.rollback;
    if (!rollback) {
      throw new Error("Expected rollback metadata for deprecated memory.");
    }
    rollback.metadata = {
      reversible: false,
    };
    expect(active.sourceRecordIds).toEqual(["trace-a", "trace-b"]);
    expect(conflicted.sourceRecordIds).toEqual([
      "trace-conflict-a",
      "trace-conflict-b",
    ]);
  });

  it("builds explicit supersedes and deprecated-by revision relations without applying them", () => {
    const oldMemory = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-en-old"],
      confidence: 0.72,
      reasonCodes: ["manual_review"],
    });
    const newMemory = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:chinese",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-zh-a", "trace-zh-b"],
      confidence: 0.93,
    });
    const plan = buildSemanticMemoryRevisionRelationPlan({
      oldMemory,
      newMemory,
      reasonCodes: ["preference_changed"],
      rollback: {
        operationId: "revision-relation-dry-run",
        sourceArtifactId: oldMemory.artifactId,
      },
      metadata: {
        relationGroup: "answer-language",
      },
    }) satisfies SemanticMemoryRevisionRelationPlan;

    expect(plan).toEqual({
      oldArtifactId: "artifact:preference:english",
      newArtifactId: "artifact:preference:chinese",
      relations: [
        {
          type: "supersedes",
          sourceArtifactId: "artifact:preference:chinese",
          targetArtifactId: "artifact:preference:english",
          sourceRecordIds: ["trace-en-old", "trace-zh-a", "trace-zh-b"],
          confidence: 0.72,
          reasonCodes: ["supersedes_memory", "preference_changed"],
          rollback: {
            operationId: "revision-relation-dry-run",
            sourceArtifactId: "artifact:preference:english",
          },
          metadata: {
            relationGroup: "answer-language",
          },
        },
        {
          type: "deprecated-by",
          sourceArtifactId: "artifact:preference:english",
          targetArtifactId: "artifact:preference:chinese",
          sourceRecordIds: ["trace-en-old", "trace-zh-a", "trace-zh-b"],
          confidence: 0.72,
          reasonCodes: ["deprecated_by_memory", "preference_changed"],
          rollback: {
            operationId: "revision-relation-dry-run",
            sourceArtifactId: "artifact:preference:english",
          },
          metadata: {
            relationGroup: "answer-language",
          },
        },
      ],
      reasonCodes: [
        "supersedes_memory",
        "deprecated_by_memory",
        "preference_changed",
      ],
      rollback: {
        operationId: "revision-relation-dry-run",
        sourceArtifactId: "artifact:preference:english",
      },
      metadata: {
        relationGroup: "answer-language",
      },
    });
    expect(oldMemory.revisionStatus).toBe("deprecated");
    expect(newMemory.revisionStatus).toBe("active");
  });

  it("uses recent repeated evidence for temporal competition diagnostics without retrieval activation", () => {
    const oldEnglish = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-en-a", "trace-en-b", "trace-en-c"],
      confidence: 0.95,
    });
    const recentChinese = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:chinese",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-zh-a", "trace-zh-b", "trace-zh-c"],
      confidence: 0.82,
    });
    const diagnostics = buildSemanticMemoryRevisionCompetitionDiagnostics({
      competitionKey: "answer-language",
      now: NOW,
      recentWindowMs: 14 * DAY_MS,
      minRecentEvidence: 2,
      candidates: [
        {
          memory: oldEnglish,
          evidenceTimestamps: [20 * DAY_MS, 30 * DAY_MS, 40 * DAY_MS],
        },
        {
          memory: recentChinese,
          evidenceTimestamps: [NOW - 5 * DAY_MS, NOW - 2 * DAY_MS, NOW],
        },
      ],
      metadata: {
        mode: "diagnostic-only",
      },
    }) satisfies SemanticMemoryRevisionCompetitionDiagnostics;

    expect(diagnostics.summary).toEqual({
      competitionKey: "answer-language",
      now: NOW,
      candidateCount: 2,
      leadingArtifactId: "artifact:preference:chinese",
      recentWindowMs: 14 * DAY_MS,
      minRecentEvidence: 2,
    });
    expect(diagnostics.diagnostics).toEqual([
      expect.objectContaining({
        artifactId: "artifact:preference:chinese",
        revisionStatus: "active",
        role: "leading",
        sourceRecordIds: ["trace-zh-a", "trace-zh-b", "trace-zh-c"],
        confidence: 0.82,
        evidenceCount: 3,
        recentEvidenceCount: 3,
        latestEvidenceTimestamp: NOW,
        recencyScore: 1,
        reasonCodes: expect.arrayContaining([
          "recency_competition_observation",
          "recent_repeated_evidence",
          "active_memory",
        ]),
      }),
      expect.objectContaining({
        artifactId: "artifact:preference:english",
        revisionStatus: "active",
        role: "competing",
        sourceRecordIds: ["trace-en-a", "trace-en-b", "trace-en-c"],
        confidence: 0.95,
        evidenceCount: 3,
        recentEvidenceCount: 0,
        reasonCodes: expect.arrayContaining([
          "recency_competition_observation",
          "older_competing_memory",
          "active_memory",
        ]),
      }),
    ]);
    expect(diagnostics.reasonCodes).toEqual(
      expect.arrayContaining([
        "recency_competition_observation",
        "recent_repeated_evidence",
        "older_competing_memory",
      ]),
    );
    expect(oldEnglish.revisionStatus).toBe("active");
    expect(recentChinese.revisionStatus).toBe("active");
  });

  it("builds a revision explanation report that preserves sources and reasons", () => {
    const oldEnglish = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-en-a", "trace-en-b"],
      confidence: 0.74,
      reasonCodes: ["manual_review"],
      rollback: {
        operationId: "revision-explanation-dry-run",
      },
    });
    const recentChinese = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:chinese",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-zh-a", "trace-zh-b", "trace-zh-c"],
      confidence: 0.9,
    });
    const relationPlan = buildSemanticMemoryRevisionRelationPlan({
      oldMemory: oldEnglish,
      newMemory: recentChinese,
      reasonCodes: ["preference_changed"],
    });
    const competitionDiagnostics =
      buildSemanticMemoryRevisionCompetitionDiagnostics({
        competitionKey: "answer-language",
        now: NOW,
        recentWindowMs: 14 * DAY_MS,
        candidates: [
          {
            memory: oldEnglish,
            evidenceTimestamps: [20 * DAY_MS, 30 * DAY_MS],
          },
          {
            memory: recentChinese,
            evidenceTimestamps: [NOW - DAY_MS, NOW],
          },
        ],
      });
    const report = buildSemanticMemoryRevisionExplanationReport({
      memories: [oldEnglish, recentChinese],
      relationPlan,
      competitionDiagnostics,
      metadata: {
        mode: "review-only",
      },
    }) satisfies SemanticMemoryRevisionExplanationReport;

    expect(report.summary).toEqual({
      memoryCount: 2,
      relationCount: 2,
      competitionDiagnosticCount: 2,
      activeCount: 1,
      deprecatedCount: 1,
      conflictedCount: 0,
      leadingArtifactId: "artifact:preference:chinese",
    });
    expect(report.memories).toEqual([
      expect.objectContaining({
        artifactId: "artifact:preference:english",
        revisionStatus: "deprecated",
        sourceRecordIds: ["trace-en-a", "trace-en-b"],
        reasonCodes: ["deprecated_memory", "manual_review"],
        rollback: {
          operationId: "revision-explanation-dry-run",
        },
      }),
      expect.objectContaining({
        artifactId: "artifact:preference:chinese",
        revisionStatus: "active",
        sourceRecordIds: ["trace-zh-a", "trace-zh-b", "trace-zh-c"],
        reasonCodes: ["active_memory"],
      }),
    ]);
    expect(report.relations).toEqual([
      expect.objectContaining({
        type: "supersedes",
        sourceArtifactId: "artifact:preference:chinese",
        targetArtifactId: "artifact:preference:english",
        sourceRecordIds: [
          "trace-en-a",
          "trace-en-b",
          "trace-zh-a",
          "trace-zh-b",
          "trace-zh-c",
        ],
        reasonCodes: ["supersedes_memory", "preference_changed"],
      }),
      expect.objectContaining({
        type: "deprecated-by",
        sourceArtifactId: "artifact:preference:english",
        targetArtifactId: "artifact:preference:chinese",
        reasonCodes: ["deprecated_by_memory", "preference_changed"],
      }),
    ]);
    expect(report.competitionDiagnostics[0]).toEqual(
      expect.objectContaining({
        artifactId: "artifact:preference:chinese",
        role: "leading",
        sourceRecordIds: ["trace-zh-a", "trace-zh-b", "trace-zh-c"],
        reasonCodes: expect.arrayContaining([
          "recency_competition_observation",
          "recent_repeated_evidence",
        ]),
      }),
    );
    expect(report.reasonCodes).toEqual(
      expect.arrayContaining([
        "deprecated_memory",
        "active_memory",
        "supersedes_memory",
        "deprecated_by_memory",
        "preference_changed",
        "recency_competition_observation",
        "recent_repeated_evidence",
      ]),
    );
    expect(report.metadata).toEqual({
      mode: "review-only",
    });
  });

  it("builds a governance explanation report with supporting traces and rollback", () => {
    const oldEnglish = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-en-a", "trace-en-missing"],
      confidence: 0.74,
      reasonCodes: ["manual_review"],
      rollback: {
        operationId: "governance-explanation-dry-run",
        sourceArtifactId: "artifact:preference:chinese",
      },
    });
    const recentChinese = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:chinese",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-zh-a", "trace-zh-b"],
      confidence: 0.9,
      metadata: {
        relationGroup: "answer-language",
      },
    });
    const relationPlan = buildSemanticMemoryRevisionRelationPlan({
      oldMemory: oldEnglish,
      newMemory: recentChinese,
      reasonCodes: ["preference_changed"],
    });
    const competitionDiagnostics =
      buildSemanticMemoryRevisionCompetitionDiagnostics({
        competitionKey: "answer-language",
        now: NOW,
        recentWindowMs: 14 * DAY_MS,
        candidates: [
          {
            memory: oldEnglish,
            evidenceTimestamps: [20 * DAY_MS],
          },
          {
            memory: recentChinese,
            evidenceTimestamps: [NOW - DAY_MS, NOW],
          },
        ],
      });
    const report = buildMemoryGovernanceExplanationReport({
      memories: [oldEnglish, recentChinese],
      sourceRecords: [
        {
          id: "trace-en-a",
          userId: "eval-user",
          timestamp: 20 * DAY_MS,
          text: "Use English for technical replies.",
          tier: "long",
        },
        {
          id: "trace-zh-a",
          userId: "eval-user",
          timestamp: NOW - DAY_MS,
          text: "Use Chinese for repo work.",
          tier: "short",
          metadata: {
            source: "chat",
          },
        },
        {
          id: "trace-zh-b",
          userId: "eval-user",
          timestamp: NOW,
          text: "Chinese explanations are easier.",
          tier: "short",
        },
      ],
      relations: relationPlan.relations,
      competitionDiagnostics: competitionDiagnostics.diagnostics,
      metadata: {
        mode: "governance-review",
      },
    });

    expect(report.summary).toEqual({
      memoryCount: 2,
      sourceRecordCount: 3,
      missingSourceRecordCount: 1,
      relationCount: 2,
      activeCount: 1,
      deprecatedCount: 1,
      conflictedCount: 0,
      rollbackAvailableCount: 1,
    });
    expect(report.memories[0]).toEqual(
      expect.objectContaining({
        artifactId: "artifact:preference:english",
        revisionStatus: "deprecated",
        sourceRecordIds: ["trace-en-a", "trace-en-missing"],
        rollbackAvailable: true,
        rollback: {
          operationId: "governance-explanation-dry-run",
          sourceArtifactId: "artifact:preference:chinese",
        },
        supportingTraces: [
          expect.objectContaining({
            recordId: "trace-en-a",
            found: true,
            text: "Use English for technical replies.",
          }),
          {
            recordId: "trace-en-missing",
            found: false,
          },
        ],
        relations: [
          expect.objectContaining({
            type: "supersedes",
            sourceArtifactId: "artifact:preference:chinese",
            targetArtifactId: "artifact:preference:english",
            reasonCodes: ["supersedes_memory", "preference_changed"],
          }),
          expect.objectContaining({
            type: "deprecated-by",
            sourceArtifactId: "artifact:preference:english",
            targetArtifactId: "artifact:preference:chinese",
            reasonCodes: ["deprecated_by_memory", "preference_changed"],
          }),
        ],
        reasonCodes: expect.arrayContaining([
          "memory_explanation",
          "source_trace_found",
          "source_trace_missing",
          "rollback_available",
          "deprecated_memory",
          "manual_review",
        ]),
      }),
    );
    expect(report.memories[1]).toEqual(
      expect.objectContaining({
        artifactId: "artifact:preference:chinese",
        revisionStatus: "active",
        rollbackAvailable: false,
        competitionDiagnostic: expect.objectContaining({
          artifactId: "artifact:preference:chinese",
          role: "leading",
          reasonCodes: expect.arrayContaining([
            "recency_competition_observation",
            "recent_repeated_evidence",
          ]),
        }),
        supportingTraces: [
          expect.objectContaining({
            recordId: "trace-zh-a",
            found: true,
            metadata: {
              source: "chat",
            },
          }),
          expect.objectContaining({
            recordId: "trace-zh-b",
            found: true,
          }),
        ],
      }),
    );
    expect(report.missingSourceRecordIds).toEqual(["trace-en-missing"]);
    expect(report.reasonCodes).toEqual(
      expect.arrayContaining([
        "memory_explanation",
        "source_trace_missing",
        "rollback_available",
        "supersedes_memory",
        "deprecated_by_memory",
        "recency_competition_observation",
      ]),
    );
    expect(report.metadata).toEqual({
      mode: "governance-review",
    });
  });

  it("builds governance correction and rollback command dry-runs without applying changes", () => {
    const oldEnglish = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-en-a"],
      confidence: 0.74,
      rollback: {
        operationId: "governance-command-dry-run",
        sourceArtifactId: "artifact:preference:chinese",
      },
    });
    const recentChinese = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:chinese",
      artifactStatus: "consolidated",
      sourceRecordIds: ["trace-zh-a", "trace-zh-b"],
      confidence: 0.9,
    });
    const explanation = buildMemoryGovernanceExplanationReport({
      memories: [oldEnglish, recentChinese],
      sourceRecords: [
        {
          id: "trace-en-a",
          userId: "eval-user",
          timestamp: 20 * DAY_MS,
          text: "Use English for technical replies.",
          tier: "long",
        },
        {
          id: "trace-zh-a",
          userId: "eval-user",
          timestamp: NOW - DAY_MS,
          text: "Use Chinese for repo work.",
          tier: "short",
        },
        {
          id: "trace-zh-b",
          userId: "eval-user",
          timestamp: NOW,
          text: "Chinese explanations are easier.",
          tier: "short",
        },
      ],
    });
    const report = buildMemoryGovernanceCommandDryRunReport({
      explanationReport: explanation,
      commands: [
        {
          commandId: "cmd:correct-chinese",
          type: "correct-content",
          artifactId: "artifact:preference:chinese",
          correctedContent: "User prefers Chinese for technical repo work.",
          requestedBy: "reviewer",
          reasonCodes: ["manual_review"],
          metadata: {
            source: "unit-test",
          },
        },
        {
          commandId: "cmd:rollback-english",
          type: "rollback-artifact",
          artifactId: "artifact:preference:english",
        },
        {
          commandId: "cmd:missing-artifact",
          type: "change-status",
          artifactId: "artifact:missing",
          targetStatus: "conflicted",
        },
        {
          commandId: "cmd:empty-correction",
          type: "correct-content",
          artifactId: "artifact:preference:chinese",
          correctedContent: " ",
        },
      ],
      metadata: {
        mode: "command-review",
      },
    });

    expect(report.summary).toEqual({
      commandCount: 4,
      validCommandCount: 2,
      invalidCommandCount: 2,
      dryRun: true,
    });
    expect(report.commands).toEqual([
      expect.objectContaining({
        commandId: "cmd:correct-chinese",
        type: "correct-content",
        artifactId: "artifact:preference:chinese",
        valid: true,
        dryRun: true,
        currentRevisionStatus: "active",
        correctedContent: "User prefers Chinese for technical repo work.",
        sourceRecordIds: ["trace-zh-a", "trace-zh-b"],
        rollbackAvailable: false,
        reasonCodes: ["command_valid", "dry_run_only", "manual_review"],
        requestedBy: "reviewer",
        metadata: {
          source: "unit-test",
        },
      }),
      expect.objectContaining({
        commandId: "cmd:rollback-english",
        type: "rollback-artifact",
        artifactId: "artifact:preference:english",
        valid: true,
        dryRun: true,
        currentRevisionStatus: "deprecated",
        sourceRecordIds: ["trace-en-a"],
        rollbackAvailable: true,
        rollback: {
          operationId: "governance-command-dry-run",
          sourceArtifactId: "artifact:preference:chinese",
        },
        reasonCodes: ["command_valid", "dry_run_only", "rollback_available"],
      }),
      expect.objectContaining({
        commandId: "cmd:missing-artifact",
        type: "change-status",
        artifactId: "artifact:missing",
        valid: false,
        dryRun: true,
        targetRevisionStatus: "conflicted",
        sourceRecordIds: [],
        reasonCodes: ["dry_run_only", "missing_artifact"],
      }),
      expect.objectContaining({
        commandId: "cmd:empty-correction",
        type: "correct-content",
        artifactId: "artifact:preference:chinese",
        valid: false,
        dryRun: true,
        correctedContent: " ",
        reasonCodes: ["dry_run_only", "missing_corrected_content"],
      }),
    ]);
    expect(report.reasonCodes).toEqual(
      expect.arrayContaining([
        "command_valid",
        "dry_run_only",
        "rollback_available",
        "missing_artifact",
        "missing_corrected_content",
      ]),
    );
    expect(report.metadata).toEqual({
      mode: "command-review",
    });
    expect(recentChinese.revisionStatus).toBe("active");
    expect(oldEnglish.revisionStatus).toBe("deprecated");
  });

  it("summarizes polluted memory governance audit scenarios as dry-run fixtures", () => {
    const pollutedEnglish = buildSemanticMemoryRevisionStatusSignal({
      artifactId: "artifact:preference:english",
      artifactStatus: "deprecated",
      sourceRecordIds: ["trace-en-a"],
      confidence: 0.62,
      reasonCodes: ["manual_review"],
      rollback: {
        operationId: "polluted-memory-audit",
        sourceArtifactId: "artifact:preference:chinese",
      },
      metadata: {
        pollutionType: "stale-preference",
      },
    });
    const explanation = buildMemoryGovernanceExplanationReport({
      memories: [pollutedEnglish],
      sourceRecords: [
        {
          id: "trace-en-a",
          userId: "eval-user",
          timestamp: 20 * DAY_MS,
          text: "Use English for technical replies.",
          tier: "long",
        },
      ],
    });
    const commands = buildMemoryGovernanceCommandDryRunReport({
      explanationReport: explanation,
      commands: [
        {
          commandId: "cmd:rollback-polluted-english",
          type: "rollback-artifact",
          artifactId: "artifact:preference:english",
        },
      ],
    });
    const report = buildMemoryGovernanceAuditScenarioReport({
      scenarioId: "polluted-language-preference",
      pollutedArtifactIds: [
        "artifact:preference:english",
        "artifact:preference:missing",
      ],
      explanationReport: explanation,
      commandReport: commands,
      metadata: {
        mode: "fixture-only",
      },
    });

    expect(report.summary).toEqual({
      scenarioId: "polluted-language-preference",
      pollutedArtifactCount: 2,
      explainedPollutedArtifactCount: 1,
      validCommandCount: 1,
      unresolvedPollutedArtifactCount: 1,
      dryRun: true,
    });
    expect(report.pollutedMemories).toEqual([
      expect.objectContaining({
        artifactId: "artifact:preference:english",
        explained: true,
        unresolved: false,
        revisionStatus: "deprecated",
        sourceRecordIds: ["trace-en-a"],
        rollbackAvailable: true,
        commandIds: ["cmd:rollback-polluted-english"],
        validCommandIds: ["cmd:rollback-polluted-english"],
        reasonCodes: expect.arrayContaining([
          "polluted_memory_observed",
          "polluted_memory_explained",
          "dry_run_command_available",
          "rollback_available",
          "manual_review",
        ]),
        metadata: {
          pollutionType: "stale-preference",
        },
      }),
      expect.objectContaining({
        artifactId: "artifact:preference:missing",
        explained: false,
        unresolved: true,
        sourceRecordIds: [],
        rollbackAvailable: false,
        commandIds: [],
        validCommandIds: [],
        reasonCodes: ["polluted_memory_observed", "polluted_memory_unresolved"],
      }),
    ]);
    expect(report.unresolvedArtifactIds).toEqual([
      "artifact:preference:missing",
    ]);
    expect(report.reasonCodes).toEqual(
      expect.arrayContaining([
        "polluted_memory_observed",
        "polluted_memory_explained",
        "dry_run_command_available",
        "polluted_memory_unresolved",
      ]),
    );
    expect(report.metadata).toEqual({
      mode: "fixture-only",
    });
  });

  it("normalizes caller-provided relation candidates before judgment", () => {
    const records: MemoryEvidenceRecord[] = [
      {
        id: "manual-a",
        userId: "eval-user",
        timestamp: NOW,
        text: "Use Chinese for repo work.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
      {
        id: "manual-b",
        userId: "eval-user",
        timestamp: NOW,
        text: "Prefer Chinese technical explanations.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
      {
        id: "manual-c",
        userId: "eval-user",
        timestamp: NOW,
        text: "Use English for this one reply.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "en",
        },
      },
    ];
    const report = buildCallerProvidedMemoryRelationCandidateDiscoveryReport({
      records,
      candidates: [
        {
          fromRecordId: "manual-b",
          toRecordId: "manual-a",
          candidateKeys: ["manual:answer-language", "manual:answer-language"],
          score: 1.4,
          reasonCodes: ["manual_review"],
          metadata: {
            source: "reviewer",
          },
        },
        {
          fromRecordId: "manual-a",
          toRecordId: "manual-b",
        },
        {
          fromRecordId: "manual-a",
          toRecordId: "missing-record",
        },
        {
          fromRecordId: "manual-c",
          toRecordId: "manual-c",
        },
      ],
      metadata: {
        mode: "caller-provided",
      },
    });

    expect(report).toEqual({
      candidates: [
        {
          id: "candidate:manual-a|manual-b",
          fromRecordId: "manual-a",
          toRecordId: "manual-b",
          candidateKeys: ["manual:answer-language"],
          score: 1,
          reasonCodes: ["caller_provided_candidate", "manual_review"],
          metadata: {
            source: "reviewer",
          },
        },
      ],
      skippedCandidates: [
        {
          fromRecordId: "manual-a",
          toRecordId: "manual-b",
          reasonCodes: ["duplicate_candidate"],
          metadata: undefined,
        },
        {
          fromRecordId: "manual-a",
          toRecordId: "missing-record",
          reasonCodes: ["missing_record"],
          metadata: undefined,
        },
        {
          fromRecordId: "manual-c",
          toRecordId: "manual-c",
          reasonCodes: ["self_relation_candidate"],
          metadata: undefined,
        },
      ],
      reasonCodes: [
        "caller_provided_candidate",
        "manual_review",
        "duplicate_candidate",
        "missing_record",
        "self_relation_candidate",
      ],
      metadata: {
        mode: "caller-provided",
      },
    });

    const judgment = judgeMemoryRelationCandidates({
      candidates: report.candidates,
      records,
      now: NOW,
    });

    expect(judgment.relations).toEqual([
      expect.objectContaining({
        fromRecordId: "manual-a",
        toRecordId: "manual-b",
        relation: "support",
      }),
    ]);
  });

  it("keeps weak relation observations from promoting clusters", () => {
    const records: MemoryEvidenceRecord[] = [
      {
        id: "weak-a",
        userId: "eval-user",
        timestamp: NOW,
        text: "Use Chinese for repo work.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
      {
        id: "weak-b",
        userId: "eval-user",
        timestamp: NOW,
        text: "Prefer Chinese technical explanations.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
      {
        id: "weak-related",
        userId: "eval-user",
        timestamp: NOW,
        text: "Technical replies should include context.",
        tier: "short",
      },
      {
        id: "weak-uncertain",
        userId: "eval-user",
        timestamp: NOW,
        text: "Maybe mention examples.",
        tier: "short",
      },
    ];
    const discovery = buildCallerProvidedMemoryRelationCandidateDiscoveryReport(
      {
        records,
        candidates: [
          {
            fromRecordId: "weak-a",
            toRecordId: "weak-b",
            candidateKeys: ["manual:language"],
            score: 1,
          },
          {
            fromRecordId: "weak-a",
            toRecordId: "weak-related",
            candidateKeys: ["manual:style"],
            score: 0.7,
            metadata: {
              source: "weak-discovery",
            },
          },
          {
            fromRecordId: "weak-a",
            toRecordId: "weak-uncertain",
            candidateKeys: ["manual:loose"],
            score: 0.2,
          },
        ],
      },
    );
    const judgment = judgeMemoryRelationCandidates({
      candidates: discovery.candidates,
      records,
      now: NOW,
    });
    const report = buildMemoryWeakRelationObservationReport({
      judgments: judgment.judgments,
      metadata: {
        mode: "observation-only",
      },
    });
    const assignment = assignMemoryRelationGraph({
      records,
      relations: judgment.relations,
      now: NOW,
    });

    expect(report.summary).toEqual({
      judgmentCount: 3,
      observationCount: 2,
      relatedCount: 1,
      uncertainCount: 1,
      excludedStrongRelationCount: 1,
      promotesToCluster: false,
      mutatesGraph: false,
    });
    expect(report.observations).toEqual([
      expect.objectContaining({
        fromRecordId: "weak-a",
        toRecordId: "weak-related",
        relation: "related",
        status: "observed",
        score: 0.7,
        promotesToCluster: false,
        mutatesGraph: false,
        reasonCodes: expect.arrayContaining([
          "weak_related_relation",
          "candidate_related",
          "caller_provided_candidate",
        ]),
        metadata: {
          source: "weak-discovery",
        },
      }),
      expect.objectContaining({
        fromRecordId: "weak-a",
        toRecordId: "weak-uncertain",
        relation: "uncertain",
        status: "observed",
        edgeId: undefined,
        promotesToCluster: false,
        mutatesGraph: false,
        reasonCodes: expect.arrayContaining([
          "uncertain_relation_candidate",
          "uncertain_candidate",
          "caller_provided_candidate",
        ]),
      }),
    ]);
    expect(report.reasonCodes).toEqual(
      expect.arrayContaining([
        "weak_related_relation",
        "uncertain_relation_candidate",
      ]),
    );
    expect(report.metadata).toEqual({
      mode: "observation-only",
    });
    expect(assignment.recordClusterKeys["weak-a"]).toBe(
      assignment.recordClusterKeys["weak-b"],
    );
    expect(assignment.recordClusterKeys["weak-a"]).not.toBe(
      assignment.recordClusterKeys["weak-related"],
    );
  });

  it("bundles end-to-end memory consolidation diagnostics without runtime mutation", () => {
    const { diagnostics, candidate } = buildSemanticDraftPersistenceFixture();
    const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
    const draftCandidates = buildSemanticMemoryDraftCandidates({
      report,
      records: diagnostics.records,
    });
    const relationDiscovery =
      buildCallerProvidedMemoryRelationCandidateDiscoveryReport({
        records: diagnostics.records,
        candidates: [
          {
            fromRecordId: "adapter-zh-a",
            toRecordId: "adapter-zh-b",
            candidateKeys: ["manual:language"],
            score: 1,
          },
        ],
      });
    const weakRelationObservation = buildMemoryWeakRelationObservationReport({
      judgments: diagnostics.pipeline.judgments,
    });
    const artifact = semanticArtifactStorageFixture();
    const storageDryRunReport = buildSemanticMemoryArtifactStorageDryRunReport({
      userId: artifact.userId,
      artifacts: [artifact],
      enabled: true,
      dryRun: true,
    });
    const revisionMemory = buildSemanticMemoryRevisionStatusSignal({
      artifactId: artifact.artifactId,
      artifactStatus: artifact.status,
      sourceRecordIds: artifact.sourceRecordIds,
      confidence: artifact.confidence,
      reasonCodes: artifact.reasonCodes,
      rollback: artifact.rollback,
      metadata: artifact.metadata,
    });
    const revisionExplanation = buildSemanticMemoryRevisionExplanationReport({
      memories: [revisionMemory],
    });
    const governanceExplanation = buildMemoryGovernanceExplanationReport({
      memories: [revisionMemory],
      sourceRecords: diagnostics.records,
    });
    const bundle = buildMemoryConsolidationDiagnosticsBundle({
      diagnostics,
      relationDiscoveryReport: relationDiscovery,
      weakRelationObservationReport: weakRelationObservation,
      consolidationReport: report,
      semanticDraftCandidates: draftCandidates,
      storageDryRunReport,
      revisionExplanationReport: revisionExplanation,
      governanceExplanationReport: governanceExplanation,
      metadata: {
        mode: "end-to-end-diagnostics",
      },
    });

    expect(bundle.summary).toEqual({
      sourceRecordCount: report.summary.sourceRecordCount,
      adaptedRecordCount: report.summary.adaptedRecordCount,
      skippedRecordCount: report.summary.skippedRecordCount,
      relationCandidateCount: report.summary.candidateCount,
      discoveredRelationCandidateCount: 1,
      skippedDiscoveredRelationCandidateCount: 0,
      relationCount: report.summary.relationCount,
      weakObservationCount: weakRelationObservation.summary.observationCount,
      preservedClusterCount: report.preservedClusters.length,
      contestedClusterCount: report.contestedClusters.length,
      decayedRecordCount: report.decayedRecords.length,
      semanticDraftCandidateCount: draftCandidates.length,
      storageArtifactCount: 1,
      storageWouldWriteCount: 1,
      revisionMemoryCount: 1,
      governanceMemoryCount: 1,
      dryRunOnly: true,
      mutatesRuntime: false,
      mutatesStorage: false,
      mutatesRetrieval: false,
    });
    expect(bundle.stages.consolidationReport).toBe(report);
    expect(bundle.stages.semanticDraftCandidates[0]).toEqual(candidate);
    expect(bundle.stages.storageDryRunReport?.summary.dryRun).toBe(true);
    expect(bundle.stages.revisionExplanationReport?.summary.activeCount).toBe(
      1,
    );
    expect(bundle.stages.governanceExplanationReport?.memories[0]).toEqual(
      expect.objectContaining({
        artifactId: artifact.artifactId,
        rollbackAvailable: true,
      }),
    );
    expect(bundle.reasonCodes).toEqual(
      expect.arrayContaining([
        "diagnostics_bundle",
        "dry_run_only",
        "runtime_unchanged",
        "storage_unchanged",
        "retrieval_unchanged",
        "relation_discovery_attached",
        "semantic_draft_candidates_found",
        "storage_dry_run_attached",
        "revision_report_attached",
        "governance_report_attached",
      ]),
    );
    expect(bundle.metadata).toEqual({
      mode: "end-to-end-diagnostics",
    });

    const storageWriteReadyReport =
      buildSemanticMemoryArtifactStorageDryRunReport({
        userId: artifact.userId,
        artifacts: [artifact],
        enabled: true,
        dryRun: false,
      });
    const writeReadyBundle = buildMemoryConsolidationDiagnosticsBundle({
      diagnostics,
      storageDryRunReport: storageWriteReadyReport,
    });

    expect(writeReadyBundle.summary.dryRunOnly).toBe(false);
    expect(writeReadyBundle.summary.mutatesStorage).toBe(false);
    expect(writeReadyBundle.reasonCodes).toEqual(
      expect.arrayContaining(["storage_write_ready_attached"]),
    );
    expect(writeReadyBundle.reasonCodes).not.toContain("dry_run_only");
    expect(writeReadyBundle.reasonCodes).not.toContain(
      "storage_dry_run_attached",
    );
  });

  it("invokes an optional relation judge adapter without provider wiring", async () => {
    const records: MemoryEvidenceRecord[] = [
      {
        id: "judge-a",
        userId: "eval-user",
        timestamp: NOW,
        text: "Use Chinese for repo work.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
      {
        id: "judge-b",
        userId: "eval-user",
        timestamp: NOW,
        text: "Prefer Chinese technical explanations.",
        tier: "short",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
        },
      },
    ];
    const discovery = buildCallerProvidedMemoryRelationCandidateDiscoveryReport(
      {
        records,
        candidates: [
          {
            fromRecordId: "judge-a",
            toRecordId: "judge-b",
            candidateKeys: ["manual:language"],
            score: 0.9,
            reasonCodes: ["manual_review"],
            metadata: {
              source: "fake-judge-test",
            },
          },
        ],
      },
    );
    const providerInputs: string[] = [];
    const candidate = discovery.candidates[0];
    if (!candidate) {
      throw new Error("Expected relation judge candidate.");
    }
    const judged = await invokeMemoryRelationJudgeProvider({
      candidate,
      records,
      now: NOW,
      metadata: {
        mode: "fake-judge",
      },
      async invoke(input) {
        providerInputs.push(input.candidate.id);
        expect(input.defaultDecision).toEqual({
          relation: "support",
          weight: expect.any(Number),
          reasonCodes: ["same_relation_value"],
        });
        expect(input.fromRecord.id).toBe("judge-a");
        expect(input.toRecord.id).toBe("judge-b");

        return {
          relation: "related",
          weight: 0.35,
          reasonCodes: ["candidate_related"],
        };
      },
    });
    let skippedInvokeCount = 0;
    const skipped = await invokeMemoryRelationJudgeProvider({
      candidate: {
        id: "candidate:judge-a|missing-record",
        fromRecordId: "judge-a",
        toRecordId: "missing-record",
        candidateKeys: ["manual:missing"],
        score: 0.8,
        reasonCodes: ["caller_provided_candidate"],
      },
      records,
      now: NOW,
      async invoke() {
        skippedInvokeCount += 1;
        throw new Error("should not be called");
      },
    });
    const failed = await invokeMemoryRelationJudgeProvider({
      candidate,
      records,
      now: NOW,
      async invoke() {
        throw new Error("fake judge unavailable");
      },
    });

    expect(providerInputs).toEqual(["candidate:judge-a|judge-b"]);
    expect(judged).toEqual(
      expect.objectContaining({
        status: "judged",
        candidateId: "candidate:judge-a|judge-b",
        fromRecordId: "judge-a",
        toRecordId: "judge-b",
        reasonCodes: [
          "provider_invoked",
          "candidate_related",
          "caller_provided_candidate",
          "manual_review",
        ],
        metadata: {
          mode: "fake-judge",
        },
        decision: {
          relation: "related",
          weight: 0.35,
          reasonCodes: ["candidate_related"],
        },
        judgment: expect.objectContaining({
          relation: "related",
          weight: 0.35,
          edge: expect.objectContaining({
            relation: "related",
          }),
        }),
      }),
    );
    expect(judged.input).toEqual(
      expect.objectContaining({
        now: NOW,
        metadata: {
          mode: "fake-judge",
        },
      }),
    );
    expect(skippedInvokeCount).toBe(0);
    expect(skipped).toEqual(
      expect.objectContaining({
        status: "skipped",
        reasonCodes: ["missing_record"],
      }),
    );
    expect(skipped.input).toBeUndefined();
    expect(skipped.judgment).toBeUndefined();
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        reasonCodes: ["provider_error"],
        error: {
          name: "Error",
          message: "fake judge unavailable",
        },
      }),
    );
    expect(failed.input).toEqual(
      expect.objectContaining({
        candidate,
      }),
    );
    expect(failed.judgment).toBeUndefined();
  });
});
