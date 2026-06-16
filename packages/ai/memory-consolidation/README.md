# @openloomi/memory-consolidation

Experimental memory consolidation utilities for evaluating repeated evidence,
cluster-level signals, and diagnostics before changing runtime memory behavior.

This package currently provides pure helpers only. It does not modify forgetting,
storage, retrieval, or summarization behavior.

## Scope

- Build evidence clusters from `MemoryEvidenceRecord[]` or structurally compatible memory records.
- Score clusters with evidence, record score, activation, and recency signals.
- Produce per-record diagnostics for low individual scores inside high-scoring clusters.
- Build an explainable consolidation plan with `preserve`, `observe`, and `decay`
  recommendations.

## Non-goals

- No runtime integration with the forgetting engine.
- No storage schema changes.
- No retrieval behavior changes.

## Consolidation plan

`buildMemoryConsolidationPlan` turns cluster signals into a decision plan without
changing runtime behavior. It groups related clusters by an optional competition
key, ranks competing clusters, and emits explainable recommendations.

- `preserve`: repeated evidence is strong enough to become a consolidation candidate.
- `observe`: evidence is ambiguous, outscored, or not strong enough yet.
- `decay`: isolated or weak competing evidence should not be promoted into long-term consolidation.
