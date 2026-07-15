# ADR-0005: Competition Before Supersession

Status: Proposed

Requirements: MR-3, MR-4, MR-5, MR-7, MR-8

## Context

User behavior changes over time and may also contain temporary exceptions. If
the newest contradictory trace immediately replaces stable memory, a one-off
instruction can corrupt long-term preferences. If contradictions are simply
merged, retrieval cannot explain which alternative is active.

## Decision

Contradictory evidence creates or reinforces competition between distinct memory
structures before any supersession decision.

Competition membership is derived from connected active `compete` edges within
the same exact applicability identity. Pairwise metadata must not split a
multi-alternative competition or cause lifecycle policy to ignore one of the
connected alternatives.

Supersession requires sustained evidence, policy evaluation, and preserved
provenance. Temporary or context-specific evidence remains scoped or contested
unless it accumulates enough support to become the preferred alternative.

Applicability context is preserved independently of owner scope. Evidence from a
task, conversation, channel, project, or validity interval competes within
overlapping applicability. It may challenge a broader stable memory only after
explicit evidence or repeated support across independent contexts justifies
broader applicability.

## Consequences

- Conflicting alternatives remain inspectable.
- Retrieval may expose competition when context requires it.
- Lifecycle policy, not recency alone, decides supersession.
- Some queries may need contextual selection between active alternatives.

## Rejected Alternatives

- Newest evidence always wins.
- Merge contradictory evidence into one cluster.
- Preserve every contradiction without allowing eventual supersession.
