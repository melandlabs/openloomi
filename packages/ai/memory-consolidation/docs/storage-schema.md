# Memory Consolidation Storage Schema Notes

This note sketches storage boundaries for future semantic memory work. It does
not define a migration and does not require runtime writes.

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

## Required Fields

Every stored semantic artifact should preserve:

- artifact id
- user id
- content
- type
- status
- confidence
- source record ids
- source cluster key
- competition key
- reason codes
- created / updated timestamps
- rollback metadata

## Retention and Rollback

Source traces should remain available until a separate retention policy exists.
Semantic drafts and consolidated memories should be removable without deleting
their supporting traces. Rollback should be able to identify which artifact was
created from which source records, cluster, and consolidation decision.

## Non-Goals

- No database migration in this package.
- No default-on persistence.
- No deletion or archival of source traces.
- No retrieval activation from persisted drafts by default.
