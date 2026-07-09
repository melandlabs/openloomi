# Memory Graph Rollout Governance

This note defines the review gate for enabling Memory Graph Evolution beyond
dry-run comparison. It is not a scheduler, UI, storage migration, or automatic
mutation path.

## Inputs

The rollout gate consumes already-built dry-run artifacts:

- consolidation evaluation metrics
- graph-aware retrieval scenario results
- semantic retrieval eval scenario reports
- governance correction and rollback command dry-runs
- polluted-memory audit scenario reports

## Required Gates

- Consolidation must preserve expected stable clusters.
- Duplicate or noisy clusters must not be promoted.
- Temporary overrides must not leak into stable memory.
- Contested clusters must remain visible for review.
- Decay decisions must match expected stale clusters.
- Default graph retrieval must hide superseded raw records.
- Audit retrieval must recover the source chain.
- No cross-scope node may appear in ranked, hidden, or audit results.
- Polluted memory scenarios must be resolved by a valid dry-run command.
- At least one correction command and one rollback command must be available
  before limited rollout.

## Correction Model

Corrections are represented as dry-run governance commands. A correction command
must target an explained artifact and include non-empty corrected content. The
command report records the current revision status, affected source records, and
reason codes without changing stored memory.

## Rollback Rules

Rollback is available only when rollback provenance exists on the target memory
or the command provides explicit rollback metadata. Rollback commands are dry-run
only at this phase. They prove that a polluted, stale, or wrongly consolidated
memory can be reversed without deleting the raw audit chain.

## Rollout Decision

`buildMemoryGraphRolloutGovernanceReport` returns:

- `ready-for-limited-rollout` when every gate passes
- `blocked` when any gate fails

The report is intentionally conservative. Failing gates should lead to more
evaluation, corrected graph policy, or rollback/correction dry-runs before any
broader runtime enablement.
