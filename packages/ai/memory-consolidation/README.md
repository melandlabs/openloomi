# @openloomi/memory-consolidation

Experimental memory consolidation utilities for evaluating repeated evidence,
cluster-level signals, and diagnostics before changing runtime memory behavior.

This package currently provides pure helpers only. It does not modify forgetting,
storage, retrieval, or summarization behavior.

## Scope

- Build evidence clusters from `MemoryEvidenceRecord[]` or structurally compatible memory records.
- Assign graph clusters and competition groups from explicit trace relation edges.
- Score clusters with evidence, record score, activation, and recency signals.
- Produce per-record diagnostics for low individual scores inside high-scoring clusters.
- Build an explainable consolidation plan with `preserve`, `observe`, and `decay`
  recommendations.

## Non-goals

- No runtime integration with the forgetting engine.
- No storage schema changes.
- No retrieval behavior changes.
- No automatic relation generation with embeddings or LLMs.

## Consolidation plan

`buildMemoryConsolidationPlan` turns cluster signals into a decision plan without
changing runtime behavior. It groups related clusters by an optional competition
key, ranks competing clusters, and emits explainable recommendations.

- `preserve`: repeated evidence is strong enough to become a consolidation candidate.
- `observe`: evidence is ambiguous, outscored, or not strong enough yet.
- `decay`: isolated or weak competing evidence should not be promoted into long-term consolidation.

## Relation graph prototype

`assignMemoryRelationGraph` is a small pure helper for the upstream side of
consolidation. Given trace nodes, records, and explicit `support` / `compete` /
`related` edges, it applies edge reinforcement and decay, forms graph clusters
from strong support edges, keeps related edges as observation signals, forms
competition groups from strong compete edges, and returns `getClusterKey` /
`getCompetitionKey` resolvers that can be passed into
`buildMemoryConsolidationPlan`.

`deriveMemoryRelationGraphLifecycle` can then mark preserved graph clusters as
`consolidated` after a consolidation plan is produced. The relation graph itself
only assigns `tentative`, `stable`, and `contested` graph states.
