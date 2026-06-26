# Memory Consolidation Storage Schema Notes

This note sketches storage boundaries for future semantic memory work. It does
not define a migration and does not require runtime writes.

The schema goal is to make semantic memory artifacts durable and auditable
without replacing raw traces or changing retrieval behavior by default.

## Layers

```text
raw traces
semantic drafts
consolidated memories
deprecated memories
```

- Raw traces remain the source of evidence and should not be deleted by
  consolidation.
- Semantic drafts are auditable artifacts produced from preserved clusters.
- Consolidated memories are future active memory records derived from reviewed
  drafts.
- Deprecated memories preserve old beliefs or preferences after they are
  superseded.

## Artifact Shape

A durable semantic artifact should be shaped around provenance first:

```ts
{
  artifactId: string;
  userId: string;
  type: "preference" | "project_state" | "decision" | "constraint" | "unknown" | string;
  content: string;
  status: "draft" | "consolidated" | "deprecated" | "conflicted" | string;
  confidence: number;
  sourceRecordIds: string[];
  sourceClusterKey: string;
  competitionKey: string;
  reasonCodes: string[];
  createdAt: number;
  updatedAt: number;
  rollback: {
    sourceArtifactId?: string;
    operationId?: string;
    createdBy?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}
```

This mirrors the package-local storage adapter contract, but it is still a
schema note rather than a migration.

## Field Semantics

- `artifactId` identifies the semantic artifact, not the raw trace.
- `userId` scopes the artifact to one memory owner.
- `type` keeps semantic category separate from storage status.
- `content` stores the compact semantic memory text.
- `status` records lifecycle state without deleting older artifacts.
- `confidence` should be clamped to `0..1` before storage.
- `sourceRecordIds` preserve trace fallback and auditability.
- `sourceClusterKey` and `competitionKey` preserve consolidation context.
- `reasonCodes` explain why the artifact was produced or retained.
- `createdAt` and `updatedAt` support temporal revision later.
- `rollback` records how to reverse or inspect the operation.
- `metadata` is reserved for non-schema extension data.

## Status Semantics

- `draft`: produced from semantic draft consolidation but not active memory.
- `consolidated`: reviewed or promoted semantic memory artifact.
- `deprecated`: superseded by newer evidence but still auditable.
- `conflicted`: competing evidence exists and should remain observable.

Status transitions should be additive and explainable. A newer artifact can
supersede an older one, but the older artifact should remain inspectable until a
separate retention policy says otherwise.

## Invariants

- A semantic artifact must keep at least one `sourceRecordId`.
- Raw source traces remain the fallback evidence.
- Semantic artifacts should be removable without deleting source traces.
- Persisted drafts must not become retrieval results by default.
- Deprecated or conflicted artifacts should not be silently overwritten.
- Rollback metadata should identify the operation or artifact that introduced
  the current state whenever possible.

## Retention and Rollback

Source traces should remain available until a separate retention policy exists.
Semantic drafts and consolidated memories should be removable without deleting
their supporting traces. Rollback should be able to identify which artifact was
created from which source records, cluster, and consolidation decision.

## Migration Proposal

A future migration should be staged and reversible:

1. Add a separate semantic artifact storage area for the shape above.
2. Keep raw traces in their existing storage area and reference them through
   `sourceRecordIds`.
3. Backfill no artifacts by default; use dry-run reports first to inspect what
   would be written.
4. Gate writes behind an explicit opt-in flag after dry-run output is reviewed.
5. Keep retrieval disabled for stored artifacts until a later retrieval opt-in
   task enables it.

The migration should prefer separate semantic artifact storage over mutating raw
trace records. This keeps raw evidence available, makes rollback simpler, and
lets semantic memory remain an auditable derived layer.

Suggested indexes:

- `userId` for owner-scoped inspection.
- `status` for draft, consolidated, deprecated, and conflicted views.
- `competitionKey` for conflict and replacement workflows.
- `sourceRecordIds` or a join table for trace-level audit and rollback.

## Rollback Plan

Rollback should not delete raw traces. It should be able to disable or remove
derived artifacts while keeping their evidence available:

1. Disable semantic artifact writes through the opt-in flag.
2. Mark affected artifacts as `deprecated` or remove them from the semantic
   artifact storage area.
3. Use `rollback.operationId` or `rollback.sourceArtifactId` to find artifacts
   created by the same operation.
4. Keep `sourceRecordIds`, `sourceClusterKey`, `competitionKey`, and
   `reasonCodes` available for audit after rollback.
5. Leave retrieval behavior unchanged unless a later opt-in retrieval task has
   explicitly enabled semantic artifacts.

Rollback should be treated as metadata-driven state correction first, and as
physical deletion only after a separate retention policy exists.

## Deferred Questions

The next storage task should decide:

- how package-local serialization should validate this shape
- how dry-run write reports should expose planned artifact changes
- when a separate retention policy may physically delete old artifacts

## Non-Goals

- No database migration in this package.
- No default-on persistence.
- No deletion or archival of source traces.
- No retrieval activation from persisted drafts by default.
