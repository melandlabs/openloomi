# Dynamic Memory Cluster Evolution Execution Plan

Status: `PHASE_0_3_DRAFT_PR_STACK`

## Objective

Prepare the accepted foundation and controlled write loop, controlled retrieval
loop, and authorized correction loop as three serial, reviewable experimental
Draft PR candidates. The stack remains disabled by default and does not
authorize a runtime cohort or rollout.

## Delivery Rules

- Requirements define product outcomes; architecture defines boundaries and
  invariants; ADRs hold durable decisions; this plan defines authorization and
  gates.
- Keep graph mutation, retrieval, correction, and rollback server-gated.
- Preserve source evidence, owner isolation, applicability, baseline fallback,
  operation identity, and retryable recovery.
- Do not add UI, scheduling, migration, shared memory, real-time LLM
  dependencies, or default-on behavior.
- A Draft PR stack may be published only after each candidate passes its own
  focused gate and the integrated Phase 0-3 gate passes.

## Review Order

| Candidate | Scope                                           | Dependency    |
| --------- | ----------------------------------------------- | ------------- |
| 1         | Phase 0-1 foundation and controlled write loop  | `origin/main` |
| 2         | Phase 2 trusted retrieval loop                  | Candidate 1   |
| 3         | Phase 3 authorized correction and rollback loop | Candidate 2   |

Later-phase imports, exports, route actions, tests, and status claims must not
appear in an earlier candidate.

## Candidate Scope

### Phase 0: control-plane foundation

**Outcome.** Provide owner-scoped graph contracts, staged publication, and
audit helpers.

**Gate.**

- Plans are deterministic, versioned, explainable, and safe to replay.
- Publication preserves visible evidence across partial failures.
- Audit can recover source nodes, edges, and operation identities.

### Phase 1: controlled real write loop

**Outcome.** New saved-chat evidence can evolve durable long-term memory for a
server-selected cohort.

**Included.**

- Persistent owner-scoped graph snapshots and applied-operation history.
- Evidence accumulation, reinforcement, competition, cluster lifecycle, staged
  summary publication, and source soft deprecation.
- Server-resolved owner scope, write allowlist, kill switch, revision
  protection, idempotent replay, and baseline fallback.
- Postgres, SQLite, and IndexedDB-compatible storage boundaries used by the
  existing raw-message runtime.

**Gate.**

- Repetition, temporary override, scope isolation, failure, retry, disablement,
  and kill-switch behavior pass focused runtime tests.
- Untrusted raw writes cannot select graph scope or internal graph metadata.

### Phase 2: controlled real retrieval loop

**Outcome.** Graph judgments can change one authenticated native-agent memory
context without weakening baseline safety.

**Included.**

- `default` retrieval suppresses superseded evidence when a usable
  representative exists.
- `audit` retrieval restores retained sources and provenance.
- `conflict` retrieval exposes only active, applicable alternatives with usable
  provenance.
- Persisted raw and summary materialization, partial graph coverage, trusted
  applicability, owner/workspace/tenant isolation, and prompt framing.
- Artifact-only rollout evaluation reports retrieval and audit scenarios but
  cannot enable a cohort.

**Gate.**

- Default suppression, audit recovery, conflict explanation, representative
  materialization, applicability, owner isolation, and baseline fallback pass.
- Missing, stale, mismatched, or unmaterializable graph state produces an
  explicit no-op or baseline result.

### Phase 3: authorized correction and rollback loop

**Outcome.** An explicitly authorized operator can repair graph outcomes and
recover evidence without direct storage surgery.

**Included.**

- Deterministic correction and rollback planning with reason codes and
  preserved operation ordering.
- Correction of summary content, cluster membership, lifecycle, and
  representative choice.
- Evidence-first rollback with status, reason codes, restored source IDs,
  provenance, idempotence, version checks, and retry convergence.
- Server-derived owner/requester identity, correction enablement, operator
  allowlist, kill switch, and bounded command validation.

**Gate.**

- Wrong merge, wrong representative, lifecycle repair, rollback ordering,
  partial failure, retry, history preservation, authorization, malformed input,
  and scope isolation pass.
- No unresolved high-severity finding remains after integrated review.

## Draft PR Gate

The Phase 0-3 stack is ready only when:

1. Phase 4 persisted comparison evidence and its route policy, metadata, tests,
   and current-state documentation are absent.
2. All feature policies remain default-off and fail closed.
3. Focused write, retrieval, correction, rollback, route, and backend suites
   pass.
4. `apps/web` and memory-consolidation TypeScript checks pass.
5. Formatting, targeted lint, `git diff --check`, and final diff review pass.
6. The PR description references requirements, architecture, and applicable
   ADRs without copying them.

## Deferred Phases

### Phase 4: real evaluation

Not authorized in this candidate. A later phase must define an authorized
cohort, persistent runtime backend, observation protocol, recall/error labels,
latency and storage budgets, audit completeness, and persisted comparison
evidence. Tests and synthetic fixtures cannot substitute for that evidence.

### Phase 5: gradual rollout

May begin only after Phase 4 evidence passes its governance gate and the project
owner explicitly approves a limited rollout. It must retain scope-based
expansion, monitoring, kill-switch containment, and rollback.

### Phase 6: maturation

Product UX, scheduling, storage optimization, optional artifact generation, and
shared-memory design require separate authorization after validated rollout.

## Stop Line

Stop at `PHASE_0_3_DRAFT_PR_STACK` or
`PHASE_0_3_DRAFT_PR_SPLIT_BLOCKED`. Do not collect cohort observations,
implement Phase 4 persistence, expand runtime exposure, merge a pull request,
or enter the next phase without explicit approval.
