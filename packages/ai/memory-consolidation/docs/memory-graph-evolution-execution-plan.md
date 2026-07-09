# Memory Graph Evolution Execution Plan

## Purpose

This plan turns the
[Memory Graph Evolution architecture RFC](./memory-graph-evolution-architecture.md)
into an implementation route. It does not replace the RFC. The RFC defines the
target architecture and vocabulary; this document defines the order of execution,
phase gates, review boundaries, and acceptance criteria for future Codex or
human implementation sessions.

The plan is intentionally architecture-first. It should not be read as a helper
queue or a list of small implementation PRs. Each phase must leave the system
clearer, more observable, and more reversible before runtime behavior changes.

## Current Baseline

The current codebase already contains pieces that fit into the dynamic memory
graph direction:

- relation graph assignment
- relation pipeline execution
- operational relation kinds: `support`, `compete`, and `related`
- competition groups
- diagnostics reports
- semantic draft candidates
- forgetting engine
- summary plus soft-deprecation
- `includeDeprecated` audit path

These pieces are useful foundation, but they do not yet form a complete runtime
memory graph. Current graph work is mostly package-local and diagnostic. Current
forgetting/consolidation work can summarize and soft-hide source records, but it
is not yet driven by a durable graph lifecycle. Current retrieval can hide
deprecated records and run semantic draft comparisons, but default ranking is
not yet graph-aware.

## Execution Principles

- Architecture first, interfaces second, implementation third.
- Dry-run before persistence.
- Opt-in before default behavior.
- Graph state must be scoped by user, workspace, or tenant.
- Raw audit chain must be preserved.
- Do not start with a broad storage rewrite.
- Do not change runtime behavior without observability.
- Every phase must be independently reviewable.
- Every phase must describe rollback or no-op behavior before persistence.
- Existing relation helpers should be assigned to boundaries before new helpers
  are proposed.
- Production code should not be written until the phase's contract, report
  shape, and acceptance criteria are clear.

## Required Execution Order

The work must proceed in this order:

1. Architecture stability
2. Interface design
3. Dry-run / report
4. Opt-in persistence
5. Runtime integration
6. Retrieval behavior
7. Evaluation / rollout

If a future task needs to jump ahead, split it. For example, if a retrieval
change requires graph persistence, define the persistence boundary first; do not
silently merge retrieval behavior into an earlier dry-run phase.

## Phase 0: Architecture Stability Gate

Goal: stabilize the architecture RFC and make sure future phases refer to a
shared vocabulary before any new production behavior is attempted.

Inputs:

- `memory-graph-evolution-architecture.md`
- current `roadmap.md`
- current `execution-plan.md`
- current relation graph, relation pipeline, forgetting, soft-deprecation, and
  retrieval diagnostics code

Outputs:

- confirmed architecture terms
- confirmed phase sequence
- explicit mapping from existing work to architecture layers
- known open questions
- decision log for scope boundaries

Acceptance:

- The dynamic memory graph remains the main line, not a collection of isolated
  helper tasks.
- The RFC can answer how new memory affects old memory.
- The RFC can explain cluster formation, stabilization, decay, supersession, and
  audit-only visibility.
- The RFC clearly places summary and soft-deprecation after cluster
  stabilization.
- The RFC states that graph scope is isolated by user, workspace, or tenant.
- No production code, tests, storage migrations, UI, scheduler, or helper
  implementation is required in this phase.

Open questions:

- Which product scope is primary for graph state: user, workspace, tenant, or a
  composite key?
- Should cross-workspace memory sharing be impossible by default or represented
  as an explicit edge type later?
- Which existing diagnostics should become durable graph operation reports?

## Phase 1: Interface Boundary Design

Goal: turn the RFC boundaries into concrete interface drafts without requiring
implementation.

Boundaries:

- `MemoryGraphStore`
- `GraphInteractionEngine`
- `ClusterLifecyclePolicy`
- `MemoryConsolidationPlanner`
- `GraphAwareRetriever`
- `GraphEvolutionReport`

Each interface draft must describe:

- input
- output
- non-responsibilities
- existing code it maps to
- expected first consumer
- open questions

Existing-code mapping:

- `relation-graph.ts` maps mainly to `MemoryGraphStore` read models and
  `ClusterLifecyclePolicy` inputs.
- `pipeline.ts` relation candidate and judgment helpers map to
  `GraphInteractionEngine`.
- `buildMemoryConsolidationPlan` and summary candidate generation map to
  `MemoryConsolidationPlanner`.
- current forgetting engine behavior maps to the early
  Forgetting / Consolidation runtime consumer.
- current retrieval comparison and semantic draft retrieval helpers map to
  `GraphAwareRetriever` dry-run inputs.
- current diagnostics reports map to `GraphEvolutionReport`.

Acceptance:

- Current helpers can be assigned to one primary boundary.
- The document can explain how `support`, `compete`, and `related` map to
  higher-level relation semantics.
- The graph scope model prevents cross-user or cross-workspace pollution.
- Each boundary has at least one expected first consumer.
- Each boundary has explicit non-responsibilities, so future work does not
  collapse into a broad provider/helper layer.

Review focus:

- Are storage, interaction, policy, consolidation, retrieval, and reporting still
  separated?
- Does any boundary accidentally require a real-time LLM?
- Does any boundary imply deleting raw audit evidence?

## Phase 2: Graph Update Plan Dry Run

Goal: when new memory enters the system, produce a graph update plan without
persistence.

Inputs:

- new memory node
- candidate existing records or summaries
- explicit relation keys, metadata, or similarity candidates
- current graph snapshot if available
- owner scope such as user, workspace, or tenant

Outputs:

- proposed edges
- reinforcement events
- weakening or decay observations
- cluster assignment impact
- `GraphEvolutionReport`

Expected behavior:

- Similar new memory can propose reinforcement for an existing cluster.
- Unrelated new memory does not pollute an existing cluster.
- Conflict and competition signals can be represented.
- Weak `same-topic` or `related` observations do not force cluster merges.
- All results can be inspected as dry-run report data.
- Runtime default behavior does not change.

Acceptance:

- A dry-run report can show which existing nodes were considered.
- A dry-run report can show why an edge was proposed, weakened, or rejected.
- A dry-run report can show potential cluster impact without writing graph
  state.
- The plan remains scoped to the caller's user/workspace/tenant.
- No storage write is required.

Open questions:

- Should candidate retrieval begin from existing semantic recall, raw candidate
  listing, relation keys, or a combined strategy?
- What minimum evidence should be required before a proposed edge becomes
  persistable?
- How should explicit user feedback override automatic relation candidates?

## Phase 3: Cluster Lifecycle Policy Dry Run

Goal: make `forming`, `active`, `stable`, `decaying`, `superseded`, and
`audit-only` computable states before any default persistence or retrieval
behavior changes.

Inputs:

- graph snapshot
- edge weights
- activation history
- support count
- `compete` / conflict signals
- consolidation and deprecation status
- lifecycle thresholds

Outputs:

- lifecycle transition candidates
- representative suggestions
- consolidation eligibility
- decay recommendations
- audit-only recommendations
- lifecycle section in `GraphEvolutionReport`

Acceptance:

- Repeated support can move a cluster from `forming` to `active` to `stable`.
- Stale isolated nodes can move toward `decaying`.
- Superseded source records can move toward `audit-only`.
- Contested clusters are not summarized too early.
- Lifecycle policy is separated from storage and summarizer behavior.
- Lifecycle reports can be reviewed without changing persisted state.

Review focus:

- Are thresholds conservative enough to avoid false merges?
- Can a contested cluster remain useful without becoming a summary?
- Can the policy explain why a cluster is not eligible for consolidation?

## Phase 4: Opt-in Persistence and Graph-aware Consolidation Planning

Goal: allow graph plans and consolidation plans to persist only through explicit
opt-in boundaries. Forgetting/consolidation should start consuming cluster
lifecycle, but default runtime behavior should remain controlled.

Actions:

- persist graph update plans after dry-run approval
- summarize stable clusters
- soft-deprecate source raw records after successful summary or artifact
  persistence
- preserve contested clusters
- decay weak structures
- keep audit provenance

Inputs:

- stable or decaying lifecycle output
- source record ids
- relation evidence
- summary or artifact candidate metadata
- opt-in persistence mode

Outputs:

- persisted graph operation result
- summary candidate or artifact candidate
- soft-deprecation plan and result
- preservation or decay diagnostics
- audit provenance links

Acceptance:

- Stable cluster can produce a summary candidate.
- After summary persistence succeeds, source raw records can be soft-deprecated.
- `includeDeprecated` can recover the source evidence chain.
- Deprecation failure becomes diagnostics and does not break the main flow unless
  policy explicitly requires hard failure.
- Audit chain is not deleted.
- Persistence can be disabled or run in no-op mode for old adapters.

Review focus:

- Does the phase preserve raw source records?
- Are persistence writes opt-in and observable?
- Are graph operations and memory storage writes distinguishable in reports?

## Phase 5: Controlled Runtime Integration

Goal: gradually connect dry-run and opt-in persistence capabilities to real
runtime paths without changing default behavior too early.

Suggested stages:

```text
off
dry-run
log-only
developer opt-in
limited rollout
default-on
```

Runtime integration surfaces:

- ingest-time graph interaction
- batch graph maintenance
- forgetting/consolidation runtime
- audit retrieval path
- graph evolution reporting

Acceptance:

- Every stage is reversible.
- Every graph mutation has a report.
- Default behavior changes only after evaluation data exists.
- UI is not required.
- Scheduler is not required all at once.
- Old adapters without graph/deprecation support degrade to no-op diagnostics.

Review focus:

- Can operators compare runtime behavior with and without graph participation?
- Is there an escape hatch for each mutation type?
- Are graph reports sufficient to debug wrong merges or wrong decay?

## Phase 6: Graph-aware Retrieval Behavior

Goal: compare baseline retrieval with graph-aware retrieval before changing
default ranking, then enable graph-aware behavior only through controlled modes.

Inputs:

- query
- semantic candidates
- graph snapshot
- lifecycle state
- visibility mode

Outputs:

- baseline result
- graph-expanded result
- ranking differences
- hidden deprecated count
- audit expansion trace
- explanation of graph signals used in ranking

Expected behavior:

- Stable summaries can rank ahead of duplicate raw traces.
- Deprecated raw records are hidden by default.
- Audit mode can expand source evidence.
- Contested clusters can be explicitly exposed when conflict matters.
- Reports can explain why ranking changed.

Acceptance:

- Graph-aware retrieval can run as dry-run comparison before default ranking
  changes.
- `includeDeprecated` remains an audit capability, not the normal retrieval path.
- Retrieval can explain when it selected an active summary instead of source raw
  records.
- Retrieval can expose competing clusters intentionally rather than mixing them
  as noise.
- Ranking behavior remains feature-gated until evaluated.

Open questions:

- Should graph expansion happen before or after semantic score thresholds?
- How should recency interact with cluster stability?
- What should the retriever do when the best semantic hit is deprecated but its
  summary is missing?

## Phase 7: Evaluation and Rollout Criteria

Goal: define how to prove that the dynamic graph system improves on isolated
records plus similarity search.

Metrics:

- duplicate memory reduction
- stable preference recall
- contradiction handling
- retrieval noise suppression
- audit chain completeness
- graph mutation explainability
- false merge rate
- false decay rate
- runtime cost

Acceptance:

- Every metric has at least one scenario.
- Reports can compare graph-aware behavior with baseline behavior.
- Failure modes can be identified and categorized.
- Rollout gates are explicit.
- Evaluation includes both quality and safety: better recall should not come at
  the cost of lost auditability or cross-scope contamination.

Suggested rollout gates:

- No cross-user/workspace graph edges in default mode.
- No raw audit chain deletion.
- False merge rate below an agreed threshold.
- False decay cases are inspectable and reversible.
- Retrieval dry-run shows noise reduction without hiding necessary evidence.
- Runtime cost is bounded for expected candidate sizes.

Rollout governance gate:
[memory-graph-rollout-governance.md](./memory-graph-rollout-governance.md)

## Deliverables

This planning task delivers only documentation:

1. `memory-graph-evolution-execution-plan.md`
2. A link from `memory-graph-evolution-architecture.md` to this execution plan
3. No production code
4. No test changes
5. No new helper

## Review Checklist

- Does the plan still serve the dynamic memory graph direction?
- Does it avoid becoming a helper checklist?
- Does it put interface design before implementation?
- Does it make the dry-run / persistence / runtime order explicit?
- Does it preserve the audit chain?
- Does it clearly isolate graph state by user, workspace, or tenant?
- Does it leave clear phase boundaries for future Codex execution sessions?
- Does each phase have reviewable acceptance criteria?
- Does any phase accidentally require UI, scheduler, storage rewrite, or
  real-time LLM behavior?

## Final Reporting Template

Future execution sessions should report:

- documents changed
- phase being advanced
- phase goal
- new or changed interface boundary
- dry-run/report status
- persistence/runtime status
- unresolved architecture questions
- verification performed
- whether checkpoint/commit is recommended
