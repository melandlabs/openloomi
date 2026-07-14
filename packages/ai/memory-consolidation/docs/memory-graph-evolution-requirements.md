# Memory Graph Evolution Requirements

Status: Proposed requirements for Dynamic Memory Cluster Evolution. They become
authoritative when accepted and merged upstream.

Related documents:

- [Architecture](./memory-graph-evolution-architecture.md)
- [ADR index](./adr/README.md)
- [Execution plan](./memory-graph-evolution-execution-plan.md)

## Product Intent

OpenLoomi memory should evolve through interaction between new and existing
evidence. Memory must not remain a collection of isolated fragments connected
only at query time by semantic similarity.

The target capability is a dynamic memory graph in which evidence forms memory
clusters, repeated support reinforces stable memory, contradictions create
competition, unsupported structures weaken, and stable clusters become compact
representatives without destroying their source evidence.

## Current Baseline

The following capabilities already exist and are not the purpose of this work:

- summary persistence can soft-deprecate covered raw records
- default retrieval can hide deprecated raw records
- `includeDeprecated` can recover deprecated records for audit
- graph-aware retrieval can reorder or filter baseline candidates when enabled
- relation work can represent `support`, `compete`, and `related` observations

The missing capability is the write-side evolution loop: new memory does not yet
reliably change graph relations, cluster strength, competition, or lifecycle.

## Required User-visible Behavior

The completed capability must produce these outcomes:

- Repeated consistent evidence makes a memory more stable and easier to recall.
- A temporary instruction does not silently replace a long-term preference.
- Sustained contradictory evidence can gradually supersede an older memory.
- Unrelated evidence remains separate instead of polluting an existing cluster.
- Weak or stale memory becomes less prominent without losing its audit trail.
- Stable clusters can be represented by summaries or artifacts while source
  records remain recoverable.
- Retrieval changes can be explained by cluster state, evidence, competition,
  and visibility decisions.
- User correction can override automatic evolution without deleting history.

## Functional Requirements

### MR-1: New Memory Interaction

When a new memory enters the system, it must be evaluated against candidate
existing memory within the same owner scope.

Candidate evaluation must also preserve applicability context so task-specific
or time-limited evidence is not compared as though it were globally valid.

The result must distinguish at least:

- support for an existing memory structure
- competition or contradiction
- topical relation without enough evidence to merge
- no meaningful relation

### MR-2: Cluster Formation

Supporting evidence may join an existing cluster or form a new cluster.

Weak similarity alone must not force cluster membership. Unrelated and uncertain
evidence must remain separate or observational until stronger evidence exists.

### MR-3: Reinforcement

Repeated supporting evidence must be able to increase the strength and stability
of a relation or cluster.

Reinforcement must remain evidence-backed and explainable. Repetition from a
single duplicated source must not be treated as independent confirmation.

### MR-4: Competition and Weakening

Contradictory evidence must create an explicit competing state rather than
immediately overwriting existing memory.

Competition may weaken an older cluster when the newer alternative gains
sustained, higher-quality support. A one-off exception must not supersede a
stable cluster by default.

Evidence that is limited to a task, conversation, channel, or validity period
must retain that applicability. Context-specific evidence competes with memory
that applies to the same context; it must not become a global preference solely
because it is newer. Broader applicability requires explicit evidence or
repeated support across independent contexts.

### MR-5: Cluster Lifecycle

Memory clusters must support the following lifecycle states:

- `forming`
- `active`
- `stable`
- `decaying`
- `superseded`
- `audit-only`

Competition is an orthogonal condition and must not be hidden by a lifecycle
transition.

Lifecycle changes must be based on evidence, activation, competition,
supersession, and policy. Age alone is insufficient.

### MR-6: Consolidation and Soft Forgetting

A stable cluster may produce a summary or artifact as its active representative.

Source raw records may be hidden from default retrieval only after the
representative is successfully persisted and provenance is available. Source
records must remain recoverable through audit retrieval.

### MR-7: Retrieval Participation

Retrieval must be able to use cluster representatives, lifecycle state,
competition, relation strength, and visibility without replacing the underlying
semantic or keyword candidate search.

Default retrieval should suppress superseded evidence noise. Audit or
conflict-sensitive retrieval must be able to expose source and competing memory.
Context-sensitive retrieval must prefer memory whose applicability matches the
current request before considering broader or competing alternatives.

### MR-8: Correction and Reversibility

Users or operators must be able to correct memory content, status, or preferred
representation through an explicit action.

Corrections must preserve prior evidence and record why automatic evolution was
overridden. A rollback path must exist for persisted graph and visibility
changes before broad automatic rollout.

### MR-9: Scope Isolation

Every node, edge, cluster, lifecycle decision, retrieval result, and mutation
must belong to an explicit composite owner scope:

- `userId` is required
- `workspaceId` is optional and narrows the user scope
- `tenantId` is optional and provides an additional isolation boundary

Workspace and tenant identity do not replace user identity in the current
product model.

Cross-user, cross-workspace, or cross-tenant relations are forbidden by default.
Shared memory requires a separate product decision and explicit authorization.

### MR-10: Explainability and Evaluation

Every proposed or applied evolution must expose:

- affected nodes and clusters
- evidence used
- relation and lifecycle changes
- reason codes
- whether storage, visibility, or retrieval changed
- rollback or no-op outcome

The system must support evaluation of false merges, false decay, contradiction
handling, retrieval noise, audit completeness, and runtime cost.

## Quality Requirements

- Evolution must be incremental; processing new memory must not require a full
  graph rebuild.
- Every persisted evolution plan must have stable operation identity and an
  expected graph version or equivalent concurrency guard.
- Replaying the same operation must not duplicate reinforcement, membership,
  lifecycle, consolidation, or visibility changes.
- Partial persistence failures must remain observable and retryable until the
  intended plan converges or is explicitly rolled back.
- Missing graph capabilities must degrade to baseline memory behavior.
- Automatic mutation must be optional until rollout gates are satisfied.
- Real-time LLM judgment must not be required for every memory write.
- Storage, relation judgment, lifecycle policy, consolidation, and retrieval
  must remain separately replaceable.
- The raw evidence chain must never be deleted as a consequence of graph
  consolidation alone.

## Non-goals

- A graph visualization UI.
- A scheduler redesign.
- A broad database migration before the evolution behavior is validated.
- Cross-user or shared organizational memory.
- Hard deletion of source evidence.
- Replacing semantic search with graph traversal.
- Treating every related memory as part of one cluster.

## Acceptance Scenarios

| Scenario                      | Required outcome                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Repeated language preference  | Consistent observations reinforce one cluster and improve its retrieval priority.                              |
| Temporary language override   | A task-specific exception remains contextual and does not replace the stable preference.                       |
| Repeated cross-context change | Consistent evidence across independent contexts can broaden applicability and challenge the stable preference. |
| Sustained preference change   | Repeated contradictory evidence creates competition and can eventually supersede the old cluster.              |
| Duplicate imported messages   | Duplicate sources do not inflate independent support.                                                          |
| Unrelated project fact        | The evidence forms or joins a separate cluster.                                                                |
| Stale isolated trace          | The trace can decay without weakening a supported stable cluster.                                              |
| Stable cluster consolidation  | A representative is persisted before source records are soft-deprecated.                                       |
| Retried evolution operation   | Replaying the same operation does not duplicate reinforcement or visibility changes.                           |
| Audit retrieval               | The representative can be traced back to all retained source evidence.                                         |
| Incorrect automatic merge     | A correction can separate or override the result while preserving history.                                     |
| Cross-scope candidate         | The candidate cannot create an edge, join a cluster, or enter a retrieval result.                              |

## Completion Criteria

Dynamic Memory Cluster Evolution is functionally complete when all acceptance
scenarios pass in controlled runtime evaluation and the system can demonstrate a
full loop:

```text
new evidence
  -> interaction
  -> graph and cluster evolution
  -> lifecycle decision
  -> consolidation or weakening
  -> graph-aware retrieval
  -> audit or correction
```

The loop must remain owner-scoped, explainable, reversible, and compatible with
baseline retrieval when graph behavior is disabled or unavailable.
