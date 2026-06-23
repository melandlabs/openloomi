import { describe, expect, it } from "vitest";
import {
  adaptMemoryRecordsForConsolidation,
  analyzeMemoryEvidenceClusters,
  assignMemoryRelationGraph,
  calculateMemoryConsolidationEvalMetrics,
  buildMemoryConsolidationPlan,
  buildMemoryConsolidationDiagnosticsReport,
  buildMemoryEvidenceClusters,
  buildMemoryRelationCandidates,
  buildMemoryRelationPipeline,
  buildMemoryRelationPipelineDiagnostics,
  buildSemanticMemoryDraftCandidates,
  deriveMemoryRelationGraphLifecycle,
  persistSemanticMemoryDrafts,
  runMemoryConsolidationDiagnostics,
  summarizeSemanticMemoryDraftCandidate,
  type SemanticMemoryDraftStore,
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
});
