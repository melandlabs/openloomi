# ADR-0002: Owner-scoped Graph Isolation

Status: Proposed

Requirements: MR-1, MR-9, MR-10

## Context

Memory graph operations connect evidence and influence retrieval. An accidental
cross-user or cross-workspace edge is more damaging than an isolated search hit
because it can affect future reinforcement, lifecycle, consolidation, and
visibility decisions.

## Decision

Owner scope is a composite identity required for every node, edge, cluster,
snapshot, operation, report, and retrieval result. `userId` is required;
`workspaceId` and `tenantId` are optional narrowing isolation dimensions.
Workspace or tenant identity does not replace user identity in the current
product model.

Default candidate discovery, graph mutation, lifecycle evaluation, and retrieval
must reject cross-scope data. Shared memory requires a separate product decision
and explicit authorization.

## Consequences

- Scope validation is required at every boundary, not only at storage access.
- Cross-scope candidates are treated as invalid, not merely low-ranked.
- Tests and rollout gates must include contamination scenarios.
- Future shared memory cannot be introduced as an implicit edge type.

## Rejected Alternatives

- Rely only on storage queries to enforce isolation.
- Allow cross-scope edges and filter them during retrieval.
- Treat owner scope as optional graph metadata.
