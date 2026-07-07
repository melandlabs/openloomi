# Memory Consolidation Roadmap

## Goal

The long-term goal of `@openloomi/memory-consolidation` is not to make agents
store more raw conversation history. It is to help existing memory traces become
less noisy, denser, explainable, updateable, and forgettable long-term memory
structures.

From a cognitive-science-inspired perspective, this package focuses on the
offline consolidation phase of long-term memory formation:

```text
episodic traces
  -> relation diagnostics
  -> consolidation report
  -> semantic memory candidates
  -> summarization boundary
  -> runtime dry-run
  -> controlled persistence
  -> retrieval dry-run
  -> opt-in runtime usage
  -> temporal memory and belief revision
```

The package should not be responsible for online writes, immediate salience
scoring, final semantic memory generation, real forgetting execution, or
retrieval ranking by default. These capabilities should be introduced gradually,
always behind dry-run modes, feature flags, and rollback-friendly boundaries.

## Current Foundation

The package currently provides package-local pure helpers for:

- evidence cluster scoring
- consolidation planning
- relation graph assignment
- relation candidate generation
- relation judgment
- relation pipeline execution
- diagnostics adaptation
- compact diagnostics reporting
- semantic draft candidate generation
- semantic draft summarizer boundary
- consolidation evaluation metrics
- dry-run diagnostics runner
- controlled semantic draft persistence boundary

Together, these helpers can turn existing memory traces into an explainable
offline consolidation result:

```text
source records
  -> adaptMemoryRecordsForConsolidation
  -> buildMemoryRelationPipelineDiagnostics
  -> buildMemoryConsolidationDiagnosticsReport
  -> buildSemanticMemoryDraftCandidates
```

The diagnostics can answer:

- which traces form stable clusters
- which clusters are contested or conflicting
- which records are only temporary or weak signals
- which clusters may become semantic memory candidates later
- which records should not be promoted into long-term memory
- which semantic draft artifacts would be produced or persisted in dry-run mode

## Staged Roadmap

### Completed Foundation: Phases 1-5

The first five phases establish the semantic draft pipeline without changing
runtime memory behavior.

Implemented capabilities:

- turn preserved diagnostics clusters into semantic draft candidates
- define a caller-provided summarizer boundary without adding an LLM provider
- compare consolidation behavior with focused scenario metrics
- run diagnostics through an opt-in dry-run runner
- define a controlled persistence boundary for semantic drafts

Current boundary:

- no forgetting runtime changes
- no storage schema changes
- no retrieval behavior changes
- no concrete LLM provider
- no automatic deletion, archival, or replacement of source traces

### Phase 6: Retrieval Dry-Run Integration

Goal: evaluate how semantic drafts would affect memory retrieval before changing
real retrieval results.

Suggested flow:

```text
query
  -> existing retrieval result
  -> semantic draft retrieval candidates
  -> dry-run diff report
```

Concerns:

- query relevance
- confidence threshold
- competition awareness
- recency
- source trace fallback
- suppression of contested memory

Boundaries:

- Must have evaluation support.
- Must be switchable.
- Must keep raw trace fallback.
- Must not change default retrieval ranking.
- Must report what would change before enabling it.

Value: proves whether semantic drafts improve task-relevant recall without
polluting the active context.

### Phase 7: Real Summarizer Provider

Goal: add a concrete summarizer behind the existing
`SemanticMemoryDraftSummarizer` boundary.

The provider should transform a draft candidate and its source records into a
semantic draft while preserving provenance:

- source record ids
- confidence
- memory type
- competition metadata
- reason codes
- temporal metadata

Boundaries:

- Keep provider integration replaceable.
- Keep prompt and model behavior testable through fakes.
- Do not persist final consolidated memory automatically.
- Do not enter retrieval ranking directly.

Value: turns repeated trace evidence into compact semantic memory text while
keeping the output explainable and reversible.

### Phase 8: Controlled Storage Schema

Goal: persist memory artifacts with a schema that separates raw traces from
semantic drafts and future consolidated memories.

Suggested storage layers:

```text
raw traces
semantic drafts
consolidated memories
deprecated memories
```

Required fields:

- source record ids
- confidence
- status
- created / updated timestamps
- provenance metadata
- rollback metadata

Boundaries:

- Introduce migrations carefully.
- Keep source traces available.
- Do not make persisted drafts active retrieval results by default.
- Keep rollback possible.

Value: gives consolidation artifacts a durable, inspectable home without turning
them into irreversible memory facts.

### Phase 9: Opt-In Runtime Activation

Goal: let semantic memory participate in runtime behavior only through explicit
activation stages.

Suggested rollout stages:

```text
off
dry-run
log-only
developer opt-in
limited rollout
default-on
```

Boundaries:

- Every stage must be switchable.
- Every behavior change must be observable.
- Retrieval and forgetting effects should be measured before broad rollout.

Value: moves from diagnostics to product behavior without losing reversibility.

### Phase 10: Temporal Memory and Belief Revision

Goal: handle preference changes, stale facts, and project-state evolution.

Example:

```text
old: user prefers Chinese answers
new: repeated recent evidence says user prefers English answers
```

The ideal output should not simply delete the old memory. It should model the
transition:

```text
old preference -> deprecated after time T
new preference -> active after time T
```

Required capabilities:

- temporal validity
- supersedes / deprecated-by relations
- active / deprecated / conflicted status
- recency-aware competition
- explanation of preference changes

Boundaries:

- Should come after retrieval integration.
- Should not be implemented before storage and retrieval are observable.

Value: turns long-term memory from a static fact store into an updateable memory
system.

### Phase 11: Automatic Relation Discovery

Goal: reduce dependence on explicit relation keys by adding controlled relation
discovery.

Possible inputs:

- embedding similarity
- LLM relation judgment
- entity extraction
- graph expansion
- weak relation observation

Boundaries:

- Add only after evaluation and rollback paths are mature.
- Keep uncertain relations observable instead of immediately merging clusters.
- Do not let weak inferred relations override explicit evidence.

Value: lets clusters emerge from repeated evidence and relation signals instead
of relying only on manually provided grouping fields.

### Phase 12: Memory Governance

Goal: make long-term memory understandable, correctable, and reversible.

Required questions:

- Why was this memory formed?
- Which traces support it?
- Why was an older memory deprecated?
- Can users inspect, delete, or correct it?
- How can polluted memories be rolled back?
- How are low-confidence memories isolated?

Boundaries:

- Governance should be designed before memory becomes default-on.
- User-visible controls should not depend on internal implementation details.

Value: prevents long-term memory from becoming an opaque append-only system.

## Execution Plan

See [execution-plan.md](./execution-plan.md) for small reviewable tasks. The
roadmap intentionally stays high-level; the execution plan breaks the next work
into one-round implementation units.

## Integration Principles

Future changes should follow these principles:

- package-local first, runtime integration later
- diagnostics first, persistence later
- dry-run first, opt-in execution later
- evaluation first, retrieval changes later
- every runtime behavior change must be switchable, explainable, and reversible
- preserve provenance before summarizing or retrieving
- keep raw trace fallback until semantic memory is proven reliable

The core direction is not to remember more. It is to gradually build a long-term
memory formation process that can explain, compete, consolidate, and forget.

See [memory-graph-evolution-architecture.md](./memory-graph-evolution-architecture.md)
for the higher-level architecture that frames relation graph work, cluster
lifecycle, graph-aware forgetting, retrieval, and observability as one dynamic
memory graph.
