# Memory Graph Evolution Execution Plan

Status: Proposed delivery plan. It becomes active when the referenced
requirements, architecture, and ADRs are accepted and merged upstream.

This document defines delivery order only. It does not restate requirements,
architecture, or decisions.

Authoritative references:

- [Requirements](./memory-graph-evolution-requirements.md)
- [Architecture](./memory-graph-evolution-architecture.md)
- [ADR index](./adr/README.md)

## Current Baseline

Already available in the runtime:

- summary persistence and source soft-deprecation
- default hiding of deprecated raw records
- `includeDeprecated` audit retrieval
- opt-in graph-aware ranking and filtering of baseline retrieval candidates
- relation and competition-oriented diagnostics

The remaining product gap is dynamic write-side evolution: new evidence must
change graph relations, cluster state, lifecycle, and later consolidation in an
explainable and reversible way.

## Delivery Rules

- Deliver functional behavior, not isolated helper collections.
- Every PR must identify requirement IDs, applicable ADRs, affected architecture
  components, and user-visible acceptance scenarios.
- Mutation remains controlled until its failure, no-op, audit, and rollback
  behavior is verified.
- A later PR must build on the accepted behavior of earlier PRs instead of
  maintaining parallel implementations.
- UI, scheduler, broad storage migration, and real-time LLM requirements remain
  outside this sequence.

## PR 1: New Evidence Evolves the Graph

### Functional Outcome

New memory can interact with existing same-scope memory and produce a durable,
auditable graph change when explicitly enabled.

The capability includes:

- candidate discovery from existing memory
- support, competition, related, or no-relation decisions
- preservation of task, conversation, channel, project, and validity context
- cluster join or new-cluster decisions
- reinforcement without duplicate-source inflation
- competition without immediate overwrite
- dry-run and opt-in persistence using one evolution plan
- an explanation of considered evidence and applied operations

### References

- Requirements: MR-1, MR-2, MR-3, MR-4, MR-9, MR-10
- ADRs: ADR-0001, ADR-0002, ADR-0003, ADR-0005
- Architecture: Candidate Discovery, Graph Interaction Engine, Memory Graph
  Store, New Evidence Interaction

### Acceptance Gate

- Repeated compatible evidence reinforces one cluster.
- Duplicate evidence does not create false independent support.
- Replaying the same evolution operation does not duplicate reinforcement or
  membership changes.
- Unrelated evidence remains separate.
- Contradictory evidence creates competition and preserves both alternatives.
- Context-specific evidence does not become global through recency alone.
- Cross-scope candidates cannot affect the plan or result.
- Disabled or unavailable graph behavior preserves baseline memory behavior.

## PR 2: Cluster Lifecycle Drives Consolidation and Forgetting

### Functional Outcome

Accumulated graph evidence changes cluster lifecycle, and lifecycle drives
stable representation, weakening, supersession, and default visibility.

The capability includes:

- forming, active, stable, decaying, superseded, and audit-only transitions
- competition-aware lifecycle decisions
- stable cluster representative selection
- summary or artifact persistence before source soft-deprecation
- decay of weak isolated structures without weakening supported clusters
- failure ordering that prevents partial visibility loss

### References

- Requirements: MR-3, MR-4, MR-5, MR-6, MR-9, MR-10
- ADRs: ADR-0002, ADR-0003, ADR-0004, ADR-0005
- Architecture: Cluster Lifecycle Policy, Consolidation and Forgetting Planner,
  Lifecycle and Consolidation

### Acceptance Gate

- Repeated support can move a cluster toward stable.
- A temporary exception cannot supersede stable memory.
- Sustained stronger competition can supersede an older cluster.
- A representative is persisted before source visibility changes.
- Failed representative persistence leaves source records normally retrievable.
- Retrying a partially applied plan converges without duplicating lifecycle or
  visibility changes.
- Audit retrieval recovers all retained source evidence.

## PR 3: Correction, Evaluation, and Controlled Rollout

### Functional Outcome

Automatic evolution can be inspected, corrected, rolled back, evaluated, and
enabled through explicit rollout gates.

The capability includes:

- correction of content, status, membership, or preferred representative
- rollback of persisted graph and visibility operations
- conflict-sensitive and audit retrieval explanations
- evaluation scenarios for false merge, false decay, contradiction handling,
  noise suppression, scope isolation, and audit completeness
- rollout decisions based on required evidence rather than feature presence

### References

- Requirements: MR-7, MR-8, MR-9, MR-10
- ADRs: ADR-0002, ADR-0003, ADR-0004, ADR-0005
- Architecture: Graph-aware Retriever, Evolution Report and Governance,
  Correction and Audit
- Rollout governance gate:
  [memory-graph-rollout-governance.md](./memory-graph-rollout-governance.md)

### Acceptance Gate

- An incorrect automatic merge can be corrected without deleting history.
- A persisted evolution can be rolled back or explicitly blocked.
- Default retrieval suppresses superseded noise.
- Audit retrieval exposes provenance and visibility decisions.
- Conflict-sensitive retrieval can expose competing alternatives.
- Missing required evaluation artifacts block broader rollout.

## Completion Gate

The feature is complete when the end-to-end loop defined in the requirements is
demonstrated under controlled runtime evaluation:

```text
new evidence
  -> graph evolution
  -> cluster lifecycle
  -> consolidation or weakening
  -> retrieval
  -> audit or correction
```

Completion requires all requirements to be mapped to accepted behavior and all
accepted ADRs to remain satisfied. Documentation-only completion, isolated
helpers, or dry-run reports without a validated runtime path are insufficient.
