# Memory Graph Evolution Architecture

Status: Active target architecture for
[Memory Graph Evolution Requirements](./memory-graph-evolution-requirements.md).
The graph-evolution and lifecycle foundation is accepted upstream. Phases 0
through 3 form one experimental, default-off Draft PR candidate and do not
authorize a runtime cohort or broader rollout.

Decision records: [ADR index](./adr/README.md).

Delivery order: [Execution plan](./memory-graph-evolution-execution-plan.md).

## Architecture Objective

The architecture adds a write-side memory evolution loop to OpenLoomi's existing
summary, soft-deprecation, and graph-aware retrieval capabilities.

New evidence must be able to change memory structure without turning ingestion
into an irreversible overwrite operation. The system therefore separates
candidate discovery, relation judgment, graph mutation, lifecycle policy,
consolidation, retrieval, and audit.

```text
new evidence
  -> candidate discovery
  -> interaction planning
  -> graph mutation
  -> cluster lifecycle
  -> consolidation / weakening
  -> retrieval
  -> audit / correction
```

Semantic similarity remains a candidate-discovery mechanism. The memory graph
is the durable explanation of how evidence supports, competes with, or
supersedes other memory.

## Domain Model

### Owner Scope

Every graph object belongs to a composite owner scope:

- `userId` is required
- `workspaceId` optionally narrows the user's workspace context
- `tenantId` optionally adds a tenant isolation boundary

The complete tuple is part of identity and authorization, not optional metadata.
Workspace or tenant identity does not replace user identity in the current
product model.

### Request Ownership Boundary

At an HTTP boundary, session-derived `userId` is authoritative. Client input
cannot select `workspaceId`, `tenantId`, or a corrected representative identity.
Phase 1 must add a trusted server resolver before enabling narrower cohort scope.

### Applicability Context

Applicability describes where and when evidence is valid independently of owner
scope. It may constrain evidence to:

- a task or interaction
- a conversation or channel
- a person, platform, project, or other product context
- a validity interval
- global applicability within the owner scope

Applicability is carried by evidence and by relation or cluster decisions that
depend on that evidence. Context-specific evidence must not become global solely
through recency. A plan may broaden applicability only when explicit evidence or
repeated support across independent contexts justifies generalization.

### Memory Node

A node is a graph-addressable memory unit:

- `raw`: source evidence such as messages or observations
- `summary`: compact representative of a stable cluster
- `artifact`: durable memory product derived from one or more clusters

A node records identity, owner scope, source identity, timestamps, visibility,
and provenance metadata. A summary or artifact does not replace its source nodes
in the audit model.

### Memory Edge

The operational relation vocabulary is:

- `support`: evidence reinforces a compatible memory structure
- `compete`: evidence represents a conflicting alternative
- `related`: evidence is relevant but insufficient for support or competition
- `supersede`: a preferred representative covers older evidence

Edges carry weight, confidence, evidence references, reason codes, activation
time, and mutation history. Edge weight is not equivalent to embedding
similarity; it represents accumulated graph evidence.

### Memory Cluster

A cluster is an evolving memory structure formed primarily from supporting
relations. It owns:

- member node identities
- representative node identity, when one exists
- support and activation signals
- competing cluster references
- lifecycle state
- provenance and reason codes

Related evidence does not automatically become cluster membership. Competing
clusters remain distinct.

The effective competition group is the connected component formed by active
`compete` edges within the same owner scope and exact applicability identity.
The single `competitionKey` field is diagnostic metadata, not the authoritative
grouping model.

### Cluster Lifecycle

The lifecycle states are:

- `forming`: insufficient evidence for normal long-term use
- `active`: useful and still evolving
- `stable`: eligible for durable representation
- `decaying`: losing support or activation
- `superseded`: replaced by a preferred cluster or representative
- `audit-only`: excluded from default retrieval but retained for traceability

Competition is orthogonal to lifecycle. An active or stable cluster may be
contested and must remain visible to conflict-aware policy.

## Architectural Invariants

### Scope Isolation

No default operation may read, connect, mutate, rank, or return graph objects
from another owner scope.

### Evidence Preservation

Consolidation and forgetting may change default visibility but must preserve the
source evidence chain. Hard deletion is outside this architecture.

### Plan Before Persist

Relation, membership, lifecycle, consolidation, and visibility changes are
represented as a plan before persistence. The same plan shape supports dry-run,
evaluation, persistence, and audit.

### Idempotent and Versioned Mutation

Every persisted plan has a stable operation identity and an expected graph
version or equivalent concurrency guard. Replaying a completed operation is a
no-op. Retrying a partially applied operation resumes the unapplied work without
duplicating reinforcement, membership, lifecycle, consolidation, or visibility
changes.

Version conflicts return an observable conflict result and require the plan to
be rebuilt against a current snapshot.

### Staged Publication Across Stores

The summary store, graph ledger, and raw-memory store do not share a global
transaction. A lifecycle runtime therefore stages a new summary as pending,
persists the graph representative and provenance, then publishes the summary.
Source soft-deprecation and graph visibility follow as separate, observable
steps.

A pending summary is excluded from normal summary retrieval. If the graph
representative cannot be persisted, raw evidence remains normally retrievable.
If a later source-deprecation or visibility step fails, the result is a
retryable partial failure; temporary duplication is preferable to hidden or lost
evidence. Recovery order is defined by ADR-0006.

### No Immediate Overwrite

A new contradictory trace cannot directly replace a stable cluster. It creates
competition and contributes evidence toward a later lifecycle or supersession
decision.

Context-specific evidence competes within overlapping applicability. It cannot
supersede a broader stable cluster until policy has evidence that the new memory
also applies more broadly.

### Representative Is Not the Graph

A summary or artifact is an active cluster representative. It does not become
the sole source of truth and does not erase the cluster's graph history.

### Retrieval Does Not Own Evolution

Retrieval consumes graph state but does not mutate cluster lifecycle by default.
Any feedback-based reinforcement is a separate, explicit interaction event.

### Baseline Compatibility

When graph state, policy, or persistence is unavailable, the system falls back
to existing semantic, keyword, recency, and soft-deprecation behavior.

## Component Boundaries

### Candidate Discovery

Responsibility:

- find same-scope nodes and clusters that may relate to new evidence
- combine semantic, metadata, relation-key, recency, and activation signals
- filter or annotate candidates by applicability overlap
- return candidates without deciding graph mutation

It does not create edges or cluster membership.

### Graph Interaction Engine

Responsibility:

- classify candidate relationships as support, compete, related, or none
- propose new edges and edge reinforcement or weakening
- propose cluster joins, new clusters, or competition links
- preserve or propose applicability without silently generalizing context
- emit evidence-backed reason codes

Input:

- normalized new nodes
- candidate nodes and clusters
- current same-scope graph snapshot
- available relation signals

Output:

- graph update plan
- skipped or uncertain observations
- interaction report

It does not persist directly or decide final lifecycle transitions.

### Memory Graph Store

Responsibility:

- read owner-scoped graph snapshots
- persist validated graph update plans
- enforce operation identity, version checks, and idempotent replay
- preserve operation and provenance history
- provide audit traversal for nodes, edges, clusters, and operations

It does not judge relation meaning, generate summaries, or rank retrieval hits.

### Cluster Lifecycle Policy

Responsibility:

- evaluate support, activation, competition, supersession, applicability, and
  decay signals
- propose lifecycle transitions
- identify stable, contested, decaying, and audit-only candidates
- suggest representatives and consolidation eligibility

It does not write graph state or storage records directly.

### Consolidation and Forgetting Planner

Responsibility:

- create summary or artifact candidates from stable clusters
- plan source soft-deprecation after representative persistence
- preserve contested clusters
- plan weakening, supersession, archive, or audit-only actions

The runtime that executes this plan stages a representative before graph
publication, publishes it only after representative provenance exists, and then
applies source deprecation and visibility. It does not claim a cross-store
transaction or hide raw evidence merely because staging began.

It consumes lifecycle decisions and does not re-judge all source relations.

### Graph-aware Retriever

Responsibility:

- begin from baseline semantic, keyword, or metadata candidates
- map candidates to graph nodes and active cluster representatives
- prefer candidates whose applicability matches the current request
- apply lifecycle, competition, relation strength, and visibility signals
- expand source evidence in audit mode
- apply graph ranking only when every selected node can be materialized from
  baseline results; otherwise preserve baseline with a no-op diagnostic
- explain ranking and filtering changes

It does not replace baseline candidate search or mutate the graph by default.

### Evolution Report and Governance

Responsibility:

- describe proposed and applied graph changes
- compare graph-aware behavior with baseline behavior
- expose scope violations, uncertain judgments, and partial failures
- support correction, rollback, and rollout gates

Reports are outputs of the architecture, not an alternative source of graph
state.

## Core Flows

### New Evidence Interaction

```text
normalize new evidence
  -> resolve owner scope and applicability
  -> discover same-scope candidates
  -> classify relations
  -> build graph update plan
  -> validate scope and evidence
  -> persist when enabled
  -> evaluate affected clusters
  -> emit evolution report
```

Uncertain evidence remains a weak observation or no-op. It must not force a
cluster merge.

### Reinforcement and Competition

```text
supporting evidence
  -> reinforce edge
  -> increase cluster support
  -> update activation
  -> evaluate stability

contradictory evidence
  -> create or reinforce competition
  -> preserve alternatives
  -> evaluate relative support over time
  -> optionally supersede weaker cluster
```

Duplicate source identity must not count as independent reinforcement.
Repeated support across independent contexts may propose broader applicability;
repetition inside one context does not automatically generalize memory.

### Lifecycle and Consolidation

```text
affected cluster snapshot
  -> lifecycle policy
  -> stable / contested / decaying decision
  -> consolidation and forgetting plan
  -> stage representative (not normally retrievable)
  -> persist graph representative and provenance
  -> publish representative
  -> soft-deprecate covered source records
  -> update graph visibility
```

Source visibility changes occur only after representative persistence succeeds.
When one represented cluster supersedes another, the previous representative
becomes audit-only and links to the new representative through a `supersede`
edge. Rollback retires the new representative only after raw visibility and raw
storage deprecation have been restored, then restores any predecessor
representative.

If representative persistence fails, the staged summary remains excluded from
normal retrieval and raw evidence remains available. A later deprecation or
visibility failure may leave duplicate evidence temporarily visible, but it must
return a partial-failure diagnostic that can be retried or explicitly rolled
back.

### Retrieval

```text
query
  -> baseline candidates
  -> graph node mapping
  -> applicability filtering
  -> representative and competition expansion
  -> lifecycle and visibility filtering
  -> graph-aware ranking
  -> explanation
```

Default retrieval suppresses superseded evidence noise. Audit retrieval can
recover deprecated raw evidence. Conflict-sensitive retrieval can expose
competing clusters.

### Correction and Audit

```text
memory or cluster
  -> source evidence
  -> relation and operation history
  -> lifecycle and visibility decisions
  -> correction or rollback plan
  -> explicit persistence
```

A correction adds an authoritative operation; it does not rewrite historical
evidence.

A corrected summary must already be a summary node in the target owner-scoped
cluster before a replacement is staged. An unrelated stored summary cannot
become a representative through a correction command.

Removing an incorrectly merged member invalidates a representative that covered
that member. The representative becomes audit-only, its covered raw evidence is
restored, predecessor representatives are restored when present, and affected
support or supersession edges become inactive without being deleted.

## Failure and Degradation Rules

- Missing graph snapshot: keep baseline behavior and report a no-op.
- Relation judgment failure: preserve candidates without mutation.
- Scope mismatch: reject the affected result or operation.
- Applicability mismatch: preserve the evidence without treating it as global
  support or competition.
- Version conflict: reject persistence and rebuild the plan from a current graph
  snapshot.
- Replayed graph operation: do not apply graph mutation twice. A retry may finish
  a failed ordered external step, such as summary publication, and report `replayed`.
- Graph persistence failure: do not apply dependent lifecycle or visibility
  changes.
- Pending representative: exclude it from normal summary retrieval until graph
  provenance and representative membership are persisted.
- Representative persistence failure: do not soft-deprecate source records.
- Source-deprecation or visibility failure: preserve audit recovery, return a
  retryable partial failure, and do not report the publication as fully applied.
- Partial persistence failure: retain applied-operation records and retry only
  unapplied operations or execute an explicit rollback plan.
- Partial candidate coverage: preserve non-hidden baseline retrieval hits.
- Unmaterialized graph candidate: preserve baseline retrieval and return a no-op;
  result materialization belongs to the real retrieval loop.
- Missing audit provenance: block consolidation or rollout when provenance is
  required by policy.
- Correction conflict: preserve both the automatic result and correction record
  until an explicit resolution is applied.

## Current Capability Mapping

Accepted upstream foundation:

- summary persistence and source soft-deprecation
- deprecated-record filtering and `includeDeprecated` audit retrieval
- graph-aware filtering and ranking of baseline retrieval candidates
- relation observations and competition-oriented diagnostics
- persisted owner-scoped graph evolution and cluster lifecycle decisions
- lifecycle-driven summary persistence and source soft-deprecation

Local integrated delivery candidate, not yet externally published:

- explicit correction, rollback, recursive audit, and dry-run governance reports
- staged summary publication and evidence-first cross-store recovery
- controlled saved-chat evidence writes through graph evolution, lifecycle, and
  soft deprecation
- trusted server scope, cohort policy, kill switch, revision protection, and
  idempotent replay for the real write path

Current authorization boundary:

- Phase 2 has passed its scoped local gate. Controlled default, audit, and
  conflict retrieval materialize graph-selected evidence into the native-agent
  context with owner-scope isolation and baseline fallback.
- Phase 3 has passed its scoped local gate. Correction and rollback commands
  reach the existing runtime only for authenticated users explicitly enabled by
  the server-side operator policy; requester and owner scope remain
  session-derived.
- Rollback restores graph visibility and raw evidence before retiring the
  representative, exposes retry and audit outcomes, and rejects stale,
  colliding, or cross-scope commands without dependent recovery.
- broader automatic enablement remains blocked until required runtime evaluation
  artifacts pass the rollout governance gates and the relevant later phase gate
  passes

## Integration Release Reference Contract

The eventual integrated release PR must state:

- requirement identifiers from
  [memory-graph-evolution-requirements.md](./memory-graph-evolution-requirements.md)
- applicable ADRs from [adr/README.md](./adr/README.md)
- architecture components changed
- invariants that must remain true
- user-visible behavior added or changed
- no-op, failure, and rollback behavior
- focused acceptance scenarios and verification

The release description must reference these documents instead of copying them.
