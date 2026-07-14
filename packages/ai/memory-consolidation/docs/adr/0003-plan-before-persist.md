# ADR-0003: Plan Before Persist

Status: Proposed

Requirements: MR-1, MR-3, MR-4, MR-5, MR-8, MR-10

## Context

Memory evolution can change relation strength, cluster membership, lifecycle,
representatives, and default visibility. Applying those decisions directly
during judgment would make dry-run evaluation, partial-failure handling, audit,
and rollback inconsistent.

## Decision

Every graph, lifecycle, consolidation, correction, and visibility mutation is
represented as a validated plan before persistence.

Plans include owner scope, affected identities, evidence, reason codes, intended
operations, expected mutation domains, stable operation identity, expected graph
version or equivalent concurrency guard, and no-op or rollback information.

Replaying a completed operation is idempotent. Retrying a partially applied plan
continues only unapplied operations. A version conflict rejects persistence and
requires the plan to be rebuilt from a current graph snapshot.

Persistence remains explicitly enabled until rollout criteria authorize broader
automatic behavior.

## Consequences

- The same behavior can run as dry-run, evaluation, or persistence.
- Reports describe intended and applied operations using the same identity.
- Dependent operations can stop when an earlier persistence step fails.
- Retries can converge without duplicating reinforcement or visibility changes.
- Applied-operation history is required for partial-failure recovery.
- Mutation interfaces are slightly more explicit than direct helper calls.

## Rejected Alternatives

- Mutate graph state while relation judgment is still running.
- Use logs as the only representation of intended changes.
- Maintain separate logic for dry-run and persisted evolution.
