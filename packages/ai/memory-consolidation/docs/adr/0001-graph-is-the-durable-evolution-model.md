# ADR-0001: Graph Is the Durable Evolution Model

Status: Proposed

Requirements: MR-1, MR-2, MR-3, MR-4, MR-5, MR-7

## Context

Semantic similarity can find potentially related memories, but it cannot explain
why evidence supports, competes with, or supersedes other evidence. Recomputing
all relationships at retrieval time would also make memory stability dependent
on the current search strategy.

## Decision

The memory graph is the durable model of memory evolution.

Semantic, keyword, metadata, and recency search are candidate-discovery inputs.
They do not define cluster membership, relation strength, competition, or
lifecycle by themselves.

Graph relations and cluster changes must remain evidence-backed and auditable.

## Consequences

- Retrieval can change candidate-search implementations without erasing memory
  evolution history.
- Graph mutation needs explicit persistence and provenance.
- Similarity results may remain unrelated observations when evidence is weak.
- The graph can be unavailable while baseline retrieval continues to work.

## Rejected Alternatives

- Treat semantic nearest neighbors as durable clusters.
- Rebuild all memory relationships during every query.
- Store only summaries and discard the graph that produced them.
