# Memory Consolidation Execution Plan

This file turns the roadmap into one-round implementation tasks. Each task should
produce one small helper, report shape, or design note with focused tests or a
format check. Runtime behavior must stay unchanged unless a task explicitly says
otherwise.

## Rules

- Package-local first; runtime integration later.
- One task, one primary artifact.
- Prefer caller-provided signals over embeddings or LLMs.
- Keep raw trace fallback and provenance visible.
- Do not change production retrieval ranking by default.
- Do not write storage unless the task is explicitly about a storage boundary.

## Task Queue

| Task                                | Deliverable                                                                                                  | Verification                                              | Out of scope                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| D1 Retrieval Candidate Types        | Export minimal semantic-draft retrieval candidate and planning result types.                                 | TypeScript check and focused type/unit coverage.          | Scoring, filtering, runtime retrieval.         |
| D2 Retrieval Candidate Planner      | Pure helper that maps query + semantic drafts + caller-provided relevance into deterministic candidates.     | Relevant high-confidence drafts rank above weaker drafts. | Embeddings, tokenizer, LLM relevance judge.    |
| D3 Retrieval Candidate Filters      | Conservative filters for confidence, contested status, max candidates, and suppression reason codes.         | Tests for low confidence, contested, and cap behavior.    | Production ranking, feature flag wiring.       |
| D4 Retrieval Eval Scenarios         | Focused scenarios for selected, suppressed, contested, and fallback candidates.                              | Eval tests describe expected retrieval behavior.          | Full benchmark suite, real user data.          |
| E1 Retrieval Dry-Run Report Shape   | Export report types for existing ids, draft ids, added drafts, suppressed drafts, fallback ids, and reasons. | TypeScript check and README/roadmap note.                 | Diff algorithm, runtime integration.           |
| E2 Existing-vs-Draft Diff Helper    | Pure helper that compares existing retrieval results with planned draft candidates.                          | Tests show inspection without changing results.           | Context injection, ranking changes.            |
| F1 Summarizer Readiness Diagnostics | Pure diagnostics for missing content, source coverage, provenance, and confidence.                           | Tests explain why a candidate is or is not ready.         | Real LLM provider, prompt design.              |
| F2 Fake Provider Failure Cases      | Fake-provider tests for empty output, missing sources, low confidence, and contested metadata.               | Focused async summarizer tests.                           | Network calls, concrete model integration.     |
| G1 Storage Schema Design Note       | Short design note for raw traces, semantic drafts, consolidated memories, deprecated memories, rollback.     | Markdown format check.                                    | Migration, database writes.                    |
| G2 Persistence Adapter Contract     | Interface-only adapter contract for future storage, preserving source ids and rollback metadata.             | TypeScript check and focused interface tests.             | Concrete DB implementation, default-on writes. |

## Recommended Order

```text
D1 -> D2 -> D3 -> D4 -> E1 -> E2 -> F1 -> F2 -> G1 -> G2
```

Stop after each task to review the diff. If a task starts requiring runtime,
storage, retrieval, LLM, or migration details, split it again before coding.
