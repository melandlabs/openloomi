# ADR-0004: Evidence-preserving Soft Forgetting

Status: Proposed

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

Hard deletion is outside Memory Graph Evolution.

## Consequences

- Default retrieval can stay concise without losing evidence.
- Representative persistence and source visibility changes are ordered.
- Audit retrieval must support deprecated evidence.
- Storage cost is not solved by graph consolidation alone.

## Rejected Alternatives

- Delete raw records immediately after summary generation.
- Keep superseded raw records in normal retrieval indefinitely.
- Treat a summary as sufficient provenance for itself.
