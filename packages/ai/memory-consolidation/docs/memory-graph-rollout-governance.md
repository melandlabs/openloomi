# Memory Graph Rollout Governance

This note defines the future review gate for enabling Memory Graph Evolution
beyond dry-run comparison. Phase 4 is deferred and is not part of the Phase 0–3
Draft PR candidate.

## Current Authorization

The current evaluator produces artifact-only dry-run reports. A
`ready-for-limited-rollout` dry-run is diagnostic output, not cohort
enablement, rollout approval, or evidence that real-user value has been
established.

Graph mutation, retrieval, correction, and rollback remain default-off and
server-gated. The Phase 0–3 candidate does not persist cohort comparison
evidence, collect observations, or change rollout policy.

## Future Phase 4 Inputs

A separately authorized Phase 4 must define and collect:

- consolidation evaluation metrics
- graph-aware and semantic retrieval scenarios
- labeled recall and error observations
- polluted-memory audit scenarios
- persisted correction and rollback operation identities
- latency distribution and storage-cost observations
- audit-completeness evidence
- an authorized cohort, observation protocol, and acceptance budgets

Synthetic fixtures may validate the collection mechanism but cannot substitute
for cohort observations.

## Required Functional Gates

- Stable clusters and expected representatives are preserved.
- Duplicate or noisy clusters are not promoted.
- Temporary overrides do not leak into stable memory.
- Contested clusters remain visible for review.
- Decay decisions match expected stale clusters.
- Default retrieval hides superseded raw evidence.
- Audit retrieval recovers the complete source chain.
- No cross-owner, workspace, tenant, or applicability result is exposed.
- Pending summaries and raw/graph visibility mismatches block publication
  convergence.
- Polluted-memory scenarios are resolved.
- At least one real correction and rollback operation is represented.
- Missing required evidence keeps the decision `blocked`.

## Correction and Rollback Requirements

Corrections are explicit, owner-scoped, versioned commands. They may change
membership, lifecycle, preferred representation, or corrected summary content
while retaining prior nodes, edges, and operation history.

Rollback requires persisted provenance. It restores graph visibility and raw
evidence before retiring representatives or supersession edges. Missing
restoration capability or partial failure must remain observable and retryable.

## Future Rollout Decision

Phase 4 may recommend `ready-for-limited-rollout` only when every functional,
quality, latency, storage, audit, and persistence gate passes. The project owner
must then explicitly approve or reject limited rollout. A report never enables
Phase 5 automatically.
