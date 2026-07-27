# ADR-0004: Evidence-preserving Soft Forgetting

Status: Accepted

Requirements: MR-5, MR-6, MR-7, MR-8, MR-10

## Context

Stable summaries and artifacts reduce retrieval noise, but deleting their source
records would remove auditability and make incorrect consolidation difficult to
correct. Keeping all raw evidence in default retrieval would preserve history at
the cost of duplicate and obsolete context.

## Decision

Forgetting changes lifecycle and default visibility before considering deletion.

A summary or artifact may become the active representative only after successful
persistence with provenance. Covered raw records may then be soft-deprecated and
hidden from default retrieval while remaining available to audit and correction.

Superseding a represented cluster also moves its previous representative out of
default retrieval while retaining a provenance edge to the new representative.
A rollback or membership correction restores the required raw evidence and any
valid predecessor representative before retiring the invalid representative.

Hard deletion is outside Memory Graph Evolution.

The staged publication and cross-store recovery protocol is defined by
[ADR-0006](./0006-staged-publication-and-recovery.md). It must not turn an
unfinished representative publication into source-evidence loss.

## Consequences

- Default retrieval can stay concise without losing evidence.
- Representative persistence and source visibility changes are ordered.
- Audit retrieval must support deprecated evidence.
- Storage cost is not solved by graph consolidation alone.

## Rejected Alternatives

- Delete raw records immediately after summary generation.
- Keep superseded raw records in normal retrieval indefinitely.
- Treat a summary as sufficient provenance for itself.
