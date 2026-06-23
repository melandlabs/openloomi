# @openloomi/memory-consolidation

Experimental memory consolidation utilities for evaluating repeated evidence,
cluster-level signals, and diagnostics before changing runtime memory behavior.

This package currently provides pure helpers only. It does not modify forgetting,
storage, retrieval, or summarization behavior.

## Design position

Long-term memory should not be treated as an append-only log. A practical memory
system usually needs an online capture phase and an offline consolidation phase:
raw events are first kept as traces, then repeated evidence, conflict, recency,
and activation decide which traces may become stable semantic memory candidates.

This package focuses on the offline consolidation phase:

```text
episodic traces
  -> relation diagnostics
  -> consolidation report
  -> semantic memory candidates
```

It helps inspect whether existing traces form stable clusters, compete with
other clusters, remain weak observations, or should decay instead of being
promoted. The output is diagnostic: `preservedClusters` are candidates for later
semantic consolidation, `contestedClusters` show conflicting or changing memory
patterns, and `decayedRecords` are signals to avoid promotion rather than direct
delete instructions.

## Roadmap

See [memory consolidation roadmap](./docs/roadmap.md) for the staged plan
from offline diagnostics to semantic memory candidates, dry-run runtime
integration, controlled persistence, retrieval integration, and temporal memory.

## Scope

- Build evidence clusters from `MemoryEvidenceRecord[]` or structurally compatible memory records.
- Build bounded relation candidates from explicit record keys.
- Judge relation candidates into `support`, `compete`, `related`, or `uncertain`.
- Assign graph clusters and competition groups from explicit trace relation edges.
- Score clusters with evidence, record score, activation, and recency signals.
- Produce per-record diagnostics for low individual scores inside high-scoring clusters.
- Build an explainable consolidation plan with `preserve`, `observe`, and `decay`
  recommendations.
- Build summary candidates from preserved consolidation plan entries.
- Adapt structurally compatible memory records into an offline relation pipeline
  diagnostics view.

## Non-goals

- No runtime integration with the forgetting engine.
- No storage schema changes.
- No retrieval behavior changes.
- No online importance scoring at memory-ingest time.
- No automatic relation generation with embeddings or LLMs.
- No automatic summary text generation.
- No final semantic memory generation.
- No direct deletion or archival of source records.

## Consolidation plan

`buildMemoryConsolidationPlan` turns cluster signals into a decision plan without
changing runtime behavior. It groups related clusters by an optional competition
key, ranks competing clusters, and emits explainable recommendations.

- `preserve`: repeated evidence is strong enough to become a consolidation candidate.
- `observe`: evidence is ambiguous, outscored, or not strong enough yet.
- `decay`: isolated or weak competing evidence should not be promoted into long-term consolidation.

## Relation graph prototype

`assignMemoryRelationGraph` is a small pure helper for the upstream side of
consolidation. Given trace nodes, records, and explicit `support` / `compete` /
`related` edges, it applies edge reinforcement and decay, forms graph clusters
from strong support edges, keeps related edges as observation signals, forms
competition groups from strong compete edges, and returns `getClusterKey` /
`getCompetitionKey` resolvers that can be passed into
`buildMemoryConsolidationPlan`.

`deriveMemoryRelationGraphLifecycle` can then mark preserved graph clusters as
`consolidated` after a consolidation plan is produced. The relation graph itself
only assigns `tentative`, `stable`, and `contested` graph states.

## Relation pipeline prototype

`buildMemoryRelationPipeline` wires the pure helpers into a small offline
prototype:

```text
records
  -> buildMemoryRelationCandidates
  -> judgeMemoryRelationCandidates
  -> assignMemoryRelationGraph
  -> buildMemoryConsolidationPlan
  -> buildMemorySummaryCandidates
```

The candidate and judgment steps are intentionally lightweight. They can use
explicit record keys, relation groups, relation values, and caller-provided
judgment logic, but they do not call embedding models, LLMs, storage, retrieval,
or runtime memory behavior.

## Diagnostics adapter

`buildMemoryRelationPipelineDiagnostics` is an adapter around the offline
pipeline. It accepts source records with caller-provided selectors, normalizes
them into `MemoryEvidenceRecord[]`, runs the relation pipeline, and returns
per-record diagnostics plus aggregate counts.

The adapter is intentionally observational:

- It skips incomplete source records instead of inventing missing identity or
  timestamp fields.
- It uses explicit relation group / value selectors as conservative default
  candidate keys.
- It can keep temporary or ephemeral traces as `related` signals instead of
  promoting them into support or competition edges.
- It reports cluster keys, competition keys, graph status, plan action, relation
  counts, and summary-candidate selection without changing runtime memory
  behavior.

`buildMemoryConsolidationDiagnosticsReport` can then format the raw diagnostics
into a compact report with summary counts, preserved clusters, contested
clusters, decayed records, skipped records, and per-record signals. It is a view
over `MemoryRelationPipelineDiagnostics`; it does not rerun the pipeline or make
new consolidation decisions.

`buildSemanticMemoryDraftCandidates` can then turn preserved clusters from the
compact report into semantic draft candidates for a later summarizer boundary.
It keeps the package observational: it does not generate summary text, call an
LLM, write storage, or change retrieval behavior.

`summarizeSemanticMemoryDraftCandidate` defines the next boundary by delegating a
single draft candidate and its source records to a caller-provided summarizer.
The package still does not provide a concrete LLM summarizer or persist the
result.

`calculateMemoryConsolidationEvalMetrics` provides a small scenario metrics
helper for comparing expected preservation, temporary/noise leakage, contested
cluster coverage, and decay precision proxies in focused eval suites.

`runMemoryConsolidationDiagnostics` is an opt-in dry-run runner. Callers provide
a record reader, and the runner returns diagnostics, a compact report, and draft
candidates without writing semantic memory, archiving source records, or changing
retrieval behavior.

`persistSemanticMemoryDrafts` defines a controlled persistence boundary for
semantic drafts. It only writes through a caller-provided draft store when
explicitly enabled with `dryRun: false`; otherwise it returns the planned draft
artifacts for review without changing storage or retrieval behavior.

Callers can keep the full diagnostics for debugging and derive the compact
report for review or logging:

```ts
const diagnostics = buildMemoryRelationPipelineDiagnostics({
  records,
  now,
  selectors: {
    getId: (record) => record.id,
    getTimestamp: (record) => record.timestamp,
    getText: (record) => record.text,
    getRelationGroup: (record) => record.metadata?.relationGroup,
    getRelationValue: (record) => record.metadata?.relationValue,
    getRelationScope: (record) => record.metadata?.relationScope,
  },
});
const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
```
