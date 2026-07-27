# ADR-0006: Staged Publication and Evidence-first Recovery

Status: Accepted

Requirements: MR-6, MR-8, MR-10

## Context

Consolidation touches a summary store, the memory-graph ledger, and raw-memory
visibility. Those stores do not provide one shared transaction. Publishing a
summary before its graph representative exists can create unexplained default
context; hiding raw records before recovery is possible can make an interrupted
operation look like memory loss.

## Decision

The runtime stages a new summary as pending, persists the graph representative
and provenance, and only then publishes the summary to normal summary retrieval.
It applies raw source deprecation and graph visibility as later observable
steps. A pending summary is excluded from normal summary retrieval.
Runtime evaluation blocks rollout evidence when a scoped summary is still
pending or graph raw visibility disagrees with raw-store deprecation. Retrying
the same command must converge those ordered states or report a visible conflict.

A correction stages a replacement only after its source summary is proven to be
a summary node in the target owner-scoped cluster.

The protocol does not claim cross-store atomicity. A failure after publication
returns a partial, retryable result and preserves the audit chain. Temporary
duplicate evidence is acceptable; source evidence must not become hidden merely
because a representative was staged or graph provenance failed.

Rollback restores graph-side source visibility, then restores raw-memory
deprecation state, and only then retires the invalid representative and its
supersession edges. Operations remain versioned and idempotent so a repeated
command converges or reports an observable conflict.

## Consequences

- Default retrieval does not expose an unproven pending representative.
- The system can recover without a distributed transaction or storage migration.
- A narrow duplicate-evidence window is preferable to a hidden-evidence window.
- Partial failures need persisted operation history, diagnostics, and retry.

## Rejected Alternatives

- Publish a summary before it has graph provenance.
- Hide source raw records before representative publication is established.
- Require a global transaction across all memory stores before shipping.
