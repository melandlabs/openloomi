# Memory Graph Evolution ADR Index

This index lists the active architecture decisions for Memory Graph Evolution.
PRs should reference only the ADRs that constrain their behavior.

| ADR                                                        | Decision                                                                             | Status   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| [ADR-0001](./0001-graph-is-the-durable-evolution-model.md) | The graph is the durable evolution model; similarity is candidate discovery.         | Proposed |
| [ADR-0002](./0002-owner-scoped-graph-isolation.md)         | Graph identity and operations are owner-scoped and cross-scope is denied by default. | Proposed |
| [ADR-0003](./0003-plan-before-persist.md)                  | Evolution changes are planned and reportable before persistence.                     | Proposed |
| [ADR-0004](./0004-evidence-preserving-soft-forgetting.md)  | Forgetting changes visibility while preserving source evidence.                      | Proposed |
| [ADR-0005](./0005-competition-before-supersession.md)      | Contradictions create competition before any supersession.                           | Proposed |

## Status Definitions

- `Proposed`: under review and not yet binding.
- `Accepted`: active and binding for new work.
- `Superseded`: replaced by another ADR; the replacement must be linked.
- `Rejected`: considered but not adopted.

## PR Usage

A PR must list the ADRs that apply to its behavior. It should not reproduce ADR
content in the PR description. If a PR needs to violate an accepted ADR, it must
first add a replacement ADR and mark the prior decision as superseded.
