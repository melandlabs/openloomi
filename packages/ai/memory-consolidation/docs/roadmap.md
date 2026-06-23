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
  -> retrieval integration
```

The package should not be responsible for online writes, immediate salience
scoring, final semantic memory generation, real forgetting execution, or
retrieval ranking yet. These capabilities should be introduced gradually, always
behind dry-run modes, feature flags, and rollback-friendly boundaries.

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

Together, these helpers can turn existing memory traces into an explainable
offline diagnostics result:

```text
source records
  -> adaptMemoryRecordsForConsolidation
  -> buildMemoryRelationPipelineDiagnostics
  -> buildMemoryConsolidationDiagnosticsReport
```

The diagnostics can answer:

- which traces form stable clusters
- which clusters are contested or conflicting
- which records are only temporary or weak signals
- which clusters may become semantic memory candidates later
- which records should not be promoted into long-term memory

## Staged Roadmap

### Phase 1: Semantic Memory Draft Candidates

Goal: turn `preservedClusters` into draft candidates that are closer to
long-term semantic memory.

Suggested pure helper:

```ts
buildSemanticMemoryDraftCandidates(report, records);
```

Candidate shape:

```ts
{
  draftId,
  sourceClusterKey,
  sourceRecordIds,
  suggestedType,
  confidence,
  evidenceCount,
  reasonCodes,
  needsSummary: true
}
```

Boundaries:

- Do not call an LLM.
- Do not generate summary text.
- Do not write to storage.
- Do not change the forgetting runtime.
- Do not change retrieval behavior.

Value: moves `preserve` from a diagnostics action into a consumable candidate
for later semantic memory summarization.

### Phase 2: Summarizer Boundary

Goal: define the boundary for summarizing semantic memory drafts without
binding the package to a specific model provider.

Suggested interface:

```ts
interface SemanticMemoryDraftSummarizer {
  summarizeDraft(candidate, records, context): Promise<SemanticMemoryDraft>;
}
```

Possible output:

```ts
const draft: SemanticMemoryDraft = {
  type,
  content,
  sourceRecordIds,
  confidence,
  metadata,
};
```

Boundaries:

- Define only the interface and a test fake summarizer.
- Do not integrate a concrete LLM provider.
- Do not write to the database.
- Do not connect to a runtime scheduler.

Value: gives future LLM summarization a clear boundary without polluting the
consolidation core.

### Phase 3: Evaluation Suite

Goal: turn long-term memory behavior into comparable scenarios instead of
advancing the design only by intuition.

Suggested scenarios:

- temporary instructions should not pollute long-term preferences
- repeated preferences should become semantic draft candidates
- repeated recent evidence should allow a new preference to compete with an old
  one
- isolated noise should naturally decay
- project state updates should replace stale state
- conflicting facts should remain contested
- expired events should not become semantic memory

Observable metrics:

- expected candidate accuracy
- temporary override leakage rate
- noise promotion rate
- adaptation accuracy
- contested cluster coverage
- decay precision proxy

Boundaries:

- Continue using focused tests or scenario evals.
- Do not use real user data.
- Do not connect to runtime behavior.

Value: helps prove whether consolidation improves long-term memory quality over
single-trace scoring alone.

### Phase 4: Runtime Opt-in Diagnostics

Goal: connect the package to runtime for the first time, but only as dry-run
diagnostics.

Suggested entry point:

```ts
runMemoryConsolidationDiagnostics({
  userId,
  now,
  dryRun: true,
});
```

Behavior:

- read candidate records from existing storage
- call the memory-consolidation package
- output a diagnostics report
- do not write semantic memory
- do not archive or delete source records

Boundaries:

- Must be dry-run.
- Must be opt-in.
- Must not change forgetting engine decisions.
- Must not change retrieval results.

Value: verifies whether package helpers can consume real memory record shapes and
creates an observation point before persistence.

### Phase 5: Controlled Semantic Draft Persistence

Goal: persist semantic memory drafts under explicit configuration without
directly changing long-term memory retrieval.

Suggested policy:

- guard persistence with a feature flag
- persist drafts first, not final consolidated memory
- preserve source record ids
- do not delete source records
- keep rollback possible

Boundaries:

- Do not directly enter retrieval ranking.
- Do not directly replace existing summaries.
- Do not automatically delete source traces.

Value: lets offline consolidation produce auditable artifacts.

### Phase 6: Retrieval Integration

Goal: allow retrieval to use semantic drafts or consolidated memory under
controlled conditions.

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

Value: makes consolidated long-term memory useful for task-relevant recall.

### Phase 7: Temporal Memory and Belief Revision

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
- Should not be implemented in early PRs.

Value: turns long-term memory from a static fact store into an updateable memory
system.

## Near-term PR Plan

The near-term implementation should focus only on the first three phases while
keeping the package-local and pure-helper style.

### PR A: Semantic Memory Draft Candidates

Scope:

- add draft candidate types
- generate candidates from `preservedClusters` in diagnostics reports
- include confidence, suggested type, and source record ids
- add focused eval coverage
- update the README

Out of scope:

- no summary text generation
- no LLM integration
- no storage writes
- no runtime integration

### PR B: Draft Summarizer Boundary

Scope:

- define a summarizer interface
- define the `SemanticMemoryDraft` output shape
- add fake summarizer tests
- document that real LLM summarization is future work

Out of scope:

- no concrete provider integration
- no API route integration
- no persistence

### PR C: Expanded Consolidation Eval

Scope:

- organize the existing eval into a clearer scenario suite
- add project state, conflict, and stale-memory scenarios
- output a small metrics helper

Out of scope:

- no full benchmark infrastructure
- no real user data

## Integration Principles

Future changes should follow these principles:

- package-local first, runtime integration later
- diagnostics first, persistence later
- dry-run first, opt-in execution later
- evaluation first, retrieval changes later
- every runtime behavior change must be switchable, explainable, and reversible

The core direction is not to remember more. It is to gradually build a long-term
memory formation process that can explain, compete, consolidate, and forget.
