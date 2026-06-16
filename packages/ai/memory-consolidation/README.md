# @openloomi/memory-consolidation

Experimental memory consolidation utilities for evaluating repeated evidence,
cluster-level signals, and diagnostics before changing runtime memory behavior.

This package currently provides pure helpers only. It does not modify forgetting,
storage, retrieval, or summarization behavior.

## Scope

- Build evidence clusters from `MemoryEvidenceRecord[]` or structurally compatible memory records.
- Score clusters with evidence, record score, activation, and recency signals.
- Produce per-record diagnostics for low individual scores inside high-scoring clusters.

## Non-goals

- No runtime integration with the forgetting engine.
- No storage schema changes.
- No retrieval behavior changes.
