---
title: "OpenLoomi Memory System: Lifecycle, Vector Indexing, and Semantic Recall"
date: 2026-05-26
description: A source-level guide to OpenLoomi memory domains, lifecycle compaction, embedding maintenance, vector backends, and cross-source semantic recall.
---

# OpenLoomi Memory System

_Last verified against the current repository on June 10, 2026, including the
memory pipeline merged in
[PR #154](https://github.com/melandlabs/openloomi/pull/154)._

This document describes how OpenLoomi stores, compacts, embeds, and retrieves
memory. It is intended for maintainers working on the lifecycle engine, raw
message stores, insights, RAG, vector backends, APIs, or agent tools. For a
shorter product comparison, see
[Memory Capabilities Comparison](/blogs/memory-capabilities-comparison).

OpenLoomi does not have one physical "memory database". The product-level
context atlas is assembled from several isolated data sources:

- Raw memory stores original or near-original messages.
- Lifecycle summaries compact older raw memory.
- Insights store LLM-derived interpretations.
- Knowledge stores uploaded document chunks through RAG.
- Filesystem memory stores inspectable local Markdown and JSON files.
- Unified semantic search queries raw memory, insights, and knowledge, then
  returns one globally ranked result list.

There is no standalone `context_atlas` table or service. "Context atlas" is the
product concept formed by these sources and their retrieval paths.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Design Principles](#design-principles)
- [End-to-End Data Flows](#end-to-end-data-flows)
- [Core Memory Contracts](#core-memory-contracts)
- [Raw Message Ingestion](#raw-message-ingestion)
- [Memory Tiers](#memory-tiers)
- [Forgetting Engine](#forgetting-engine)
- [Retention Scoring](#retention-scoring)
- [Summarization](#summarization)
- [Persistence and Index Architecture](#persistence-and-index-architecture)
- [Embeddings and Vector Backends](#embeddings-and-vector-backends)
- [Query and Recall APIs](#query-and-recall-apis)
- [MCP and Agent Recall](#mcp-and-agent-recall)
- [Failure and Fallback Behavior](#failure-and-fallback-behavior)
- [Testing](#testing)
- [Maintenance Checklist](#maintenance-checklist)
- [Implementation References](#implementation-references)

## Architecture Overview

The lifecycle engine in `packages/ai/src/memory/` is storage-independent:

```text
connector/chat ingestion
  -> RawMessage
  -> raw_messages
       | memoryStage: short / mid / long
       | access and importance metadata
       | optional embedding
       v
  MemoryStorageAdapter
       v
  createMemoryForgettingEngine().runCycle()
       | select old candidates
       | calculate retention score
       | group by time and dimensions
       | create MemorySummary
       | promote records between tiers
       | optionally archive details
       v
  memory_summaries
```

The main read paths are separate:

```text
Lifecycle-aware query
  -> MemoryQueryApi.queryWithFallback()
  -> raw records first
  -> lifecycle summaries when raw results are insufficient
```

```text
Engine-level vector recall
  -> MemoryQueryApi.semanticRecall()
  -> MemoryStorageAdapter.semanticRecallRaw()
  -> native vector search or stored-embedding cosine fallback
```

```text
Application-level semantic search
  -> POST /api/memory/search
  -> searchUnifiedMemory()
       -> raw memory semantic search
       -> insight semantic search
       -> knowledge/RAG semantic search
  -> global similarity ranking
```

These paths share data, but they solve different problems. Summary fallback
preserves lifecycle continuity. Engine recall retrieves `MemoryRecord`s.
Unified search combines multiple corpora for applications and agent tools.

The application-level unified path is semantic-only. It does not run the
legacy raw-message keyword query, read lifecycle summaries, or scan filesystem
memory. Exact phrase lookup and source-specific pagination remain available
through their existing tools and APIs.

## Design Principles

The implementation follows four boundaries that are easy to miss when reading
one file at a time.

### 1. Memory Is a Set of Domains

Raw messages, lifecycle summaries, insights, RAG chunks, and local files are
not aliases for one record type. They have different owners, metadata, update
paths, and deletion semantics.

### 2. Canonical Data Owns Meaning

Database rows and local files are canonical records. Chroma collections and
sqlite-vec tables are searchable indexes. An index can be cleared or rebuilt
without redefining the source record.

### 3. Lifecycle and Retrieval Are Orthogonal

The forgetting engine decides how long raw details remain hot and when to
create compact summaries. Semantic search decides which indexed records are
similar to a query. Moving a record from `short` to `mid` does not automatically
reduce its vector-search score.

### 4. Unification Happens at Interfaces

OpenLoomi uses shared contracts at two levels:

- `UnifiedVectorSearchService` presents one API over one vector backend or
  collection.
- `searchUnifiedMemory()` presents one query/result contract over raw memory,
  insights, and knowledge.

Neither requires all source data to live in one physical table. One giant
memory bucket would be easy to draw and rather less charming to maintain.

## End-to-End Data Flows

### Raw Memory Write and Repair

```text
connector or chat payload
  -> normalize to RawMessage
  -> upsert canonical raw_messages row by messageId
  -> persist lifecycle and embedding metadata
  -> embedding dream scans missing/model-changed/content-changed records
  -> update stored embedding
  -> synchronize configured sqlite-vec or Chroma index
```

### Insight Write and Repair

```text
insight create or update
  -> persist structured insight fields
  -> build stable embedding content and hash
  -> persist insight_embeddings record
  -> synchronize configured sqlite-vec or Chroma index
  -> scheduled dream repairs omissions or stale vectors
```

Lifecycle summaries and insights are intentionally different. A lifecycle
summary is rule-based compaction of raw records. An insight is interpreted
application data produced by the insight pipeline.

### Knowledge Ingestion

```text
document upload
  -> parse text
  -> split into overlapping chunks
  -> generate chunk embeddings
  -> persist document and chunk rows
  -> add vector chunks to sqlite-vec or Chroma in Tauri
     or use pgvector-backed search in server deployments
```

### Cross-Source Recall

```text
authenticated semantic query
  -> selected raw-memory branch
  -> selected insight branch
  -> selected knowledge branch
  -> normalize source-specific hits
  -> global similarity sort
  -> stable source/ID tie break
  -> top N evidence returned to API or MCP caller
```

The source branches currently generate their query embeddings independently.
Deployments should therefore keep embedding models compatible when their scores
will be compared in one global list.

## Core Memory Contracts

Core contracts live in `packages/ai/src/memory/contracts.ts`.

### MemoryRecord

`MemoryRecord` is the lifecycle engine representation of one raw memory item.

| Field                         | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `id`, `userId`                | Identity and ownership scope.                         |
| `timestamp`                   | Unix timestamp in milliseconds inside the engine.     |
| `text`, `mediaRefs`           | Recallable detail and attachment references.          |
| `embedding`                   | Optional vector used by semantic recall.              |
| `embeddingModel`              | Model that generated the vector.                      |
| `embeddingContentHash`        | Detects content changes that require re-embedding.    |
| `embeddingDimensions`         | Prevents incompatible vectors from being mixed.       |
| `tier`                        | `short`, `mid`, or `long`.                            |
| `accessCount`, `lastAccessAt` | Retrieval feedback used by retention scoring.         |
| `importanceScore`, `isPinned` | Explicit retention signals.                           |
| `archivedAt`                  | Marks raw detail as cold/archived.                    |
| `dimensions`                  | Facets such as platform, channel, person, and bot ID. |
| `metadata`                    | Backend-specific extension data.                      |

`MemoryRecord` is not a second copy of `raw_messages`. Storage adapters map a
persisted `RawMessage` into this engine-level shape.

### MemorySummary

`MemorySummary` is a rule-based compaction artifact created during tier
transitions. It contains:

- the source time window,
- source and summary tiers,
- source record IDs,
- key points and keywords,
- summary text,
- grouping dimensions,
- an optional quality score.

A lifecycle summary is not an insight. Insights are LLM-derived records owned
by the insights subsystem and have their own embedding/search pipeline.

### MemoryStorageAdapter

`MemoryStorageAdapter` separates engine logic from persistence:

| Method                            | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `acquireLock()` / `releaseLock()` | Prevent overlapping lifecycle runs.               |
| `listCandidates()`                | Load old records eligible for scoring.            |
| `saveSummaries()`                 | Persist generated lifecycle summaries.            |
| `transitionRecords()`             | Move records to the next memory tier.             |
| `archiveRecordDetails()`          | Optionally archive long-tier source details.      |
| `queryRaw()`                      | Query lifecycle-aware raw memory.                 |
| `querySummaries()`                | Query lifecycle summaries.                        |
| `semanticRecallRaw()`             | Optional vector recall for raw `MemoryRecord`s.   |
| `markRecordsAccessed()`           | Feed retrieval activity back into retention data. |

The main adapter is `createIndexedDBMemoryStorageAdapter()` in
`packages/indexeddb/src/forgetting.ts`. Despite its historical name, it bridges
the shared manager shape used by browser IndexedDB and server-selected raw
message stores.

## Raw Message Ingestion

Connector and chat payloads are normalized into `RawMessage` records. The
shared storage shape is defined in `packages/indexeddb/src/storage.ts`.

New records normally begin with:

| Field             | Default |
| ----------------- | ------- |
| `memoryStage`     | `short` |
| `accessCount`     | `0`     |
| `importanceScore` | `0`     |
| `isPinned`        | `false` |

Raw messages are upserted by `messageId`. Stable IDs are important because
connector and insight refresh jobs can ingest the same history repeatedly.

`normalizeMemoryRecordForIngest()` in `packages/ai/src/memory/ingest.ts`
provides the equivalent engine-level normalization and defaults a missing tier
to `short`.

## Memory Tiers

Raw records use three lifecycle tiers:

| Tier    | Meaning                                | Default transition                                          |
| ------- | -------------------------------------- | ----------------------------------------------------------- |
| `short` | Recent detailed memory.                | Old, low-retention groups can move to `mid` after 7 days.   |
| `mid`   | Older memory with retained raw detail. | Old, low-retention groups can move to `long` after 90 days. |
| `long`  | Cold long-term memory.                 | Source details may be archived.                             |

Transitions create summary tiers:

| Transition     | Summary |
| -------------- | ------- |
| `short -> mid` | `L1`    |
| `mid -> long`  | `L2`    |

The `L3` type/helper exists, but the current engine loop does not run a normal
`long -> ...` phase.

Changing a tier does not currently apply an automatic semantic-search penalty.
Semantic ranking is based on vector similarity. Tiers can be supplied as
filters to engine-level recall.

## Forgetting Engine

`createMemoryForgettingEngine()` in `packages/ai/src/memory/engine.ts`
implements progressive compaction. "Forgetting" here means cooling and
summarizing before irreversible deletion.

The default policy in `packages/ai/src/memory/policy.ts` is:

| Setting                        | Default                           |
| ------------------------------ | --------------------------------- |
| Short age window               | 7 days                            |
| Mid age window                 | 90 days                           |
| `short -> mid` score threshold | `0.65`                            |
| `mid -> long` score threshold  | `0.45`                            |
| Short grouping window          | 1 day                             |
| Mid grouping window            | 7 days                            |
| Minimum records per group      | 3                                 |
| Maximum candidates per phase   | 500                               |
| Lock TTL                       | 60 seconds                        |
| Group dimensions               | platform, channel, person, bot ID |

For each user, `runCycle()`:

1. Acquires `memory_forgetting:<userId>`.
2. Runs the `short -> mid` phase.
3. Runs the `mid -> long` phase.
4. Releases the lock in a `finally` block.

Each phase:

1. Loads source-tier records older than the phase cutoff.
2. Calculates retention scores.
3. Excludes pinned, archived, and high-retention records.
4. Groups eligible records by time bucket and configured dimensions.
5. Skips groups smaller than three records by default.
6. Creates one rule-based summary per group.
7. Persists the summary and promotes its source records.
8. Archives source details when the target tier is `long` and the adapter
   supports archival.

`dryRun` executes selection, scoring, grouping, and counting without writes.
The bridge-level `runMemoryForgettingCycle()` can also perform an optional hard
delete when `hardDeleteArchivedOlderThan` is explicitly provided. Archive and
hard delete are intentionally separate operations.

## Retention Scoring

`DefaultMemoryRecordScorer` in `packages/ai/src/memory/scorer.ts` returns a
score in `[0, 1]`. A higher score means the record should remain hot longer.

```text
score = clamp01(
  0.35 * recency +
  0.30 * access +
  0.25 * importance +
  0.10 * media +
  pinnedBoost
)
```

Signals:

- Recency decays linearly over 180 days.
- Access uses a logarithmic score based on `accessCount`.
- Importance is the maximum of explicit importance and inferred keywords.
- Media receives `0.7` when present and `0.25` otherwise.
- Pinned records receive a `0.3` boost and are also excluded from transition
  eligibility.

Inferred importance recognizes terms such as `deadline`, `urgent`, `risk`,
`decision`, `blocker`, `action item`, `milestone`, `bug`, and `incident`.

## Summarization

`RuleBasedMemorySummarizer` in `packages/ai/src/memory/summarizer.ts` does not
call an LLM.

For each group it:

1. Sorts records chronologically.
2. Selects up to five unique text highlights.
3. Truncates highlights to 180 characters.
4. Extracts up to 12 keywords with token frequency and stop-word filtering.
5. Writes the source window, transition, record count, and highlights.
6. Assigns quality `0.75` when text highlights exist or `0.45` otherwise.

The `MemorySummarizer` interface is injectable, so a future summarizer can
replace this implementation without changing the engine.

## Persistence and Index Architecture

OpenLoomi keeps canonical records and vector indexes conceptually separate.
The database row remains the source record; Chroma or a dimension-specific
`sqlite-vec` table is a searchable index that can be repaired or rebuilt.

| Corpus      | Canonical persistence                                  | Semantic index/search path                                      |
| ----------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Raw memory  | IndexedDB, SQLite, or Postgres `raw_messages`          | Chroma, SQLite `vec0`, Postgres pgvector, or stored-vector scan |
| Insights    | Insight tables plus `insight_embeddings`               | Chroma, SQLite `vec0`, Postgres pgvector, or stored-vector scan |
| Knowledge   | RAG document and chunk tables                          | Chroma, SQLite `vec0`, or Postgres pgvector                     |
| Summaries   | IndexedDB, SQLite, or Postgres `memory_summaries`      | No cross-source semantic branch                                 |
| Local files | Markdown and JSON under the Tauri memory/file workflow | Not automatically included in `/api/memory/search`              |

### Browser IndexedDB

`packages/indexeddb/src/manager.ts` owns:

- `raw_messages`,
- `memory_summaries`,
- indexes including `userId_memoryStage`, `userId_timestamp`,
  `userId_summaryTier`, and `userId_endTimestamp`.

Browser IndexedDB also supports stored embeddings. When no native semantic
search method exists, the memory adapter scans bounded candidates and computes
cosine similarity in process.

### SQLite

Tauri uses `packages/sqlite/src/raw-message-manager.ts` and
`packages/sqlite/src/schema.ts`.

SQLite includes:

- `raw_messages`,
- `memory_summaries`,
- `raw_messages_fts` and synchronization triggers,
- dimension-specific sqlite-vec tables such as `raw_messages_vec_d1024`,
- delete triggers that remove vector rows when source messages are deleted.

Dimension-specific tables prevent vectors from different embedding models from
being compared accidentally.

### Postgres

Server deployments use
`apps/web/lib/memory/postgres-raw-message-store.ts` and the Postgres Drizzle
schema. The manager implements the same raw message, lifecycle summary,
embedding update, and semantic-search operations. Raw memory and insight search
use pgvector distance queries in server mode.

The server-side selector in `apps/web/lib/memory/raw-message-store.ts` chooses
between SQLite and Postgres:

```text
Tauri server runtime -> SQLite
web/server runtime   -> Postgres
```

Browser IndexedDB is a separate client/local manager path. It is adapted by the
same memory contracts, but the authenticated Next.js raw-message route does not
select IndexedDB as a server backend.

### Files and Session State

`packages/ai/src/store/conversation-store.ts` stores connector conversations in
per-day JSON files:

```text
{memoryDir}/{prefix}/YYYY-MM-DD.json
```

In Tauri, `apps/web/lib/ai/memory/chat-sync.ts` exports chat Markdown under:

```text
<appDataDir>/data/memory/chats/YYYY-MM-DD/<title>-<chatId>.md
```

The broader local directory also contains `people`, `projects`, `notes`, and
`strategy`. These files are not automatically inserted into raw memory or RAG;
they require an explicit indexing/import path and are not searched by
`searchUnifiedMemory()`.

`apps/web/lib/session/context.ts` manages temporary login and insight-processing
state. It uses Redis when configured and `ioredis-mock` in Tauri/development.
Its 30-minute session state is operational context, not durable memory.

## Embeddings and Vector Backends

The embedding provider is shared through `@openloomi/rag`. It can use a cloud
provider or local Transformers.js models.

Raw memory, insights, and knowledge remain isolated sources. Each source can
select its own backend:

```dotenv
VECTOR_STORE_BACKEND=sqlite-vec

RAW_MESSAGE_VECTOR_STORE_BACKEND=sqlite-vec
INSIGHT_VECTOR_STORE_BACKEND=sqlite-vec
RAG_VECTOR_STORE_BACKEND=sqlite-vec
```

Supported backends in the current local implementation are:

- `sqlite-vec`,
- ChromaDB client-server mode.

Server deployments can use the Postgres/pgvector paths already implemented by
raw memory, insights, and RAG. `sqlite-vec` is used by the Tauri runtime; the RAG
service does not open it in a normal web/server process.

See
[Local Embeddings and Vector Backends](https://github.com/melandlabs/openloomi/blob/main/docs/vector-backends.md)
for runtime configuration and table/collection details.

### Two Different "Unified" Layers

Two similarly named layers solve different problems:

| Layer                        | Responsibility                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `UnifiedVectorSearchService` | One backend-independent API over a single vector collection or custom store.   |
| `searchUnifiedMemory()`      | Fan-out search over three isolated corpora, followed by global result ranking. |

`UnifiedVectorSearchService` lives in
`packages/ai/rag/src/unified-vector-search-service.ts`. It can initialize a
Chroma, `sqlite-vec`, or custom `IVectorStore`; generate missing embeddings;
upsert records; search by text or vector; filter common metadata; delete old
records; and report backend statistics.

The application memory search does not put raw memory, insights, and knowledge
into one collection through that class. Each corpus keeps its own persistence,
metadata, retention rules, and search adapter. "Unified" at the application
layer means one request and one result contract, not one giant vector table
wearing three hats.

### Embedding Refresh

Raw message and insight embedding maintenance regenerates vectors when:

- the vector is missing,
- the embedding model changed,
- the embedding content hash changed.

Embedding metadata is persisted with the source record and synchronized to the
configured vector backend. Chroma receives explicit embeddings; OpenLoomi does
not rely on Chroma's default embedding function.

The desktop scheduler runs raw-message and insight embedding repair jobs on
24-hour windows. The raw-message timestamp is tracked in process; the insight
timestamp is also persisted in user insight settings. The raw-message job scans
up to 100 candidates, updates stale or missing vectors, then synchronizes
recent compatible vectors to Chroma when enabled. Insight write paths also
generate embeddings incrementally, while the scheduled dream repairs
omissions without blocking normal writes.

## Query and Recall APIs

### Raw Query with Summary Fallback

`MemoryQueryApi.queryWithFallback()`:

1. Queries raw records.
2. If raw results are below `minRawResultsWithoutFallback`, queries lifecycle
   summaries for the remaining capacity.
3. Merges raw and summary hits by descending timestamp.
4. Marks returned raw records as accessed.

The web route exposes this through `/api/memory/raw-messages` with action
`query` and `includeSummaryFallback: true`.

### Engine-Level Semantic Recall

`MemoryQueryApi.semanticRecall()` accepts:

- `queryEmbedding`,
- `limit` and `threshold`,
- optional tiers,
- optional time range,
- optional dimensions.

It calls `MemoryStorageAdapter.semanticRecallRaw()`, wraps hits with
`sourceType: "raw"`, and marks returned records as accessed.

The IndexedDB bridge:

1. Uses `manager.searchMessagesSemantically()` when the active manager provides
   native semantic search.
2. Over-fetches before applying engine-only tier and arbitrary dimension
   filters.
3. Otherwise scans bounded raw candidates and computes cosine similarity over
   stored `MemoryRecord.embedding` values.

This is an engine API, not a separate HTTP route.

### Unified Semantic Search

`POST /api/memory/search` is the cross-source application endpoint:

```json
{
  "query": "User's last project feedback",
  "sources": ["memory", "insights", "knowledge"],
  "limit": 10,
  "threshold": 0.7
}
```

`searchUnifiedMemory()` in `apps/web/lib/memory/unified-search.ts`:

1. Normalizes the query, source list, limit, and threshold.
2. Searches every selected source independently with the requested per-source
   limit.
3. Converts every hit into `UnifiedMemorySearchResult`.
4. Sorts the combined hits by descending similarity.
5. Uses type and ID as stable tie breakers.
6. Returns the global top N.

Source behavior:

| Source      | Search path                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `memory`    | Query embedding -> Chroma raw collection when enabled -> raw manager semantic search when Chroma is disabled or errors. |
| `insights`  | Chroma, sqlite-vec, stored-embedding fallback, or pgvector depending on runtime/configuration.                          |
| `knowledge` | RAG chunk search through the configured vector store.                                                                   |

Unified search is semantic-only. Existing source-specific MCP tools can still
perform exact or keyword lookup when literal matching is required.

The current implementation asks each selected source branch to generate its own
query embedding. It does not yet calculate one vector and share it across all
three branches. In practice, deployments should keep the corpora on compatible
embedding models when their similarity scores will be compared globally.
Cross-model similarity scores are not automatically calibrated.

Important Chroma behavior: if a Chroma query succeeds with zero results, raw
memory search does not also query the database backend. Database fallback is
used when Chroma is disabled or throws.

The endpoint returns:

```ts
interface UnifiedMemorySearchResult {
  type: "memory" | "insight" | "knowledge";
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}
```

The three source stores remain isolated. "Unified" describes the query and
result contract, not a requirement to put all vectors into one collection.

## MCP and Agent Recall

The business-tools MCP server exposes the cross-source search as
`searchUnifiedMemory`. Its localized UI label is "Searching Semantic Memory" /
"语义记忆搜索".

The tool description tells the agent to use it early for broad questions about
past conversations, projects, people, decisions, risks, owners, next actions,
uploaded documents, or extracted insights. It defaults to all three sources
unless the request clearly belongs to only one corpus.

The MCP defaults intentionally favor recall more than the HTTP endpoint:

| Surface                    | Default limit | Default threshold | Maximum limit |
| -------------------------- | ------------- | ----------------- | ------------- |
| `POST /api/memory/search`  | `10`          | `0.7`             | `50`          |
| `searchUnifiedMemory` tool | `8`           | `0.35`            | `20`          |

For model-facing output, each result includes its source type, similarity, ID,
selected metadata, and content. Individual content is capped at 1,200
characters to control tool-context growth. The tool also logs hit counts,
maximum/average scores by source, warnings, and previews of the top five
results.

Source-specific tools remain useful after semantic recall:

- raw-message tools provide keyword lookup and pagination,
- insight tools expose structured task/event fields,
- knowledge tools support document-specific workflows and full-document reads,
- filesystem-memory tools inspect local paths not covered by unified search.

This separation is deliberate: semantic recall is the broad first pass; exact
or structured tools are the microscope.

### HTTP and Raw Memory APIs

`POST /api/memory/raw-messages` supports:

| Action             | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `store`            | Persist authenticated-user raw messages.                   |
| `query`            | Query raw messages, optionally with summary fallback.      |
| `queryGrouped`     | Return grouped raw messages.                               |
| `stats`            | Return raw store statistics.                               |
| `clearOld`         | Delete old records for the current user.                   |
| `updateEmbeddings` | Persist vectors and synchronize Chroma.                    |
| `semanticSearch`   | Run manager-native semantic search with a supplied vector. |
| `upsertSummaries`  | Persist lifecycle summaries.                               |
| `forgettingCycle`  | Run lifecycle compaction and optional hard delete.         |

`POST /api/memory/search` is the authenticated cross-source semantic endpoint.
The semantic memory MCP tool calls the same unified search service. Legacy
source-specific tools remain available for narrower exact/keyword workflows.

All web routes replace caller-provided ownership with the authenticated
`session.user.id`.

## Failure and Fallback Behavior

| Condition                              | Behavior                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| Forgetting lock is held                | Returns `skipped_locked`.                                                             |
| Group has fewer than three records     | No transition or summary.                                                             |
| Record is pinned or archived           | Excluded from transition.                                                             |
| Embedding provider is missing          | Raw semantic search returns no hits; insight/knowledge paths can fail the request.    |
| Chroma raw query throws                | Falls back to the raw database semantic manager.                                      |
| Chroma raw query succeeds with no hits | Returns no raw hits; no duplicate DB query.                                           |
| sqlite-vec is unavailable              | Raw and insight paths can use stored-embedding fallback.                              |
| Tauri RAG vector store is unavailable  | Current fallback returns ordered database chunks with fixed similarity `1.0`.         |
| Raw storage is unavailable             | Unified search emits a memory warning and can still return insight/knowledge results. |
| Filesystem sync runs outside Tauri     | Helpers throw or return without writing.                                              |

Runtime logs identify the actual semantic backend:

```text
[UnifiedMemory] Raw message semantic search completed { backend: 'chroma', ... }
[SQLite Raw Messages] Semantic search completed { backend: 'sqlite-vec', ... }
[InsightSearch] Semantic search completed { backend: 'sqlite-vec', ... }
[RAG] Vector search completed { backend: 'sqlite-vec', ... }
[SemanticMemoryTool] search completed { hitSources, hitSourceCounts, ... }
```

Fallbacks use explicit `stored-embedding-fallback` logging instead of silently
changing behavior. The Tauri RAG database fallback is a compatibility path, not
true semantic ranking; maintainers should treat that log path as degraded mode.

## Testing

Focused lifecycle and retrieval tests:

```bash
pnpm --filter web exec vitest run \
  tests/unit/memory-forgetting.test.ts \
  tests/unit/indexeddb-forgetting.test.ts \
  tests/unit/memory-embedding.test.ts \
  tests/unit/indexeddb-memory-embedding.test.ts \
  tests/unit/insight-embedding.test.ts \
  tests/unit/insight-search.test.ts \
  tests/unit/unified-vector-search-service.test.ts \
  tests/unit/unified-memory-search.test.ts
```

Backend-specific tests:

```bash
pnpm --filter web exec vitest run \
  tests/unit/sqlite-raw-message-storage.test.ts \
  tests/unit/postgres-raw-message-store.test.ts \
  tests/unit/sqlite-vec-store.test.ts \
  tests/unit/chroma-vector-store.test.ts
```

## Maintenance Checklist

- When `MemoryRecord` changes, update adapter mapping and embedding text
  generation.
- When `RawMessage` changes, update IndexedDB, SQLite, Postgres, API
  serialization, and storage contract tests.
- When lifecycle policy or scoring changes, update forgetting tests and this
  document.
- When embedding text changes, bump the content-hash version so stale vectors
  regenerate.
- When a vector dimension changes, use dimension-specific sqlite-vec tables or
  a new/cleared Chroma collection.
- When unified search changes, update
  `apps/web/tests/unit/unified-memory-search.test.ts`.
- Audit every seconds/milliseconds conversion when changing timestamp handling.
- Keep lifecycle summaries, insights, and RAG chunks conceptually distinct.

## Implementation References

| File                                                   | Responsibility                                                |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/ai/src/memory/contracts.ts`                  | Core records, summaries, recall queries, and storage adapter. |
| `packages/ai/src/memory/engine.ts`                     | Lifecycle transition orchestration.                           |
| `packages/ai/src/memory/policy.ts`                     | Age windows, thresholds, groups, and lock defaults.           |
| `packages/ai/src/memory/scorer.ts`                     | Retention-priority scoring.                                   |
| `packages/ai/src/memory/summarizer.ts`                 | Rule-based lifecycle summaries.                               |
| `packages/ai/src/memory/api.ts`                        | Summary fallback and engine semantic recall.                  |
| `packages/ai/src/memory/embedding.ts`                  | Stable embedding text and content hashes.                     |
| `packages/indexeddb/src/storage.ts`                    | Raw message storage contract.                                 |
| `packages/indexeddb/src/manager.ts`                    | Browser IndexedDB manager.                                    |
| `packages/indexeddb/src/forgetting.ts`                 | Engine/storage bridge.                                        |
| `packages/indexeddb/src/embedding.ts`                  | Raw embedding refresh and cosine helpers.                     |
| `packages/sqlite/src/raw-message-manager.ts`           | SQLite raw, lifecycle, FTS, and vector operations.            |
| `packages/ai/rag/src/unified-vector-search-service.ts` | Backend-independent vector collection operations.             |
| `packages/ai/rag/src/embedding-provider.ts`            | Cloud/local embedding provider selection.                     |
| `apps/web/lib/memory/postgres-raw-message-store.ts`    | Postgres raw memory implementation.                           |
| `apps/web/lib/memory/unified-search.ts`                | Three-source semantic aggregation.                            |
| `apps/web/lib/memory/chroma-memory-index.ts`           | Raw-memory and insight Chroma synchronization/search.         |
| `apps/web/lib/insights/embedding-service.ts`           | Insight embedding generation and synchronization.             |
| `apps/web/lib/insights/search.ts`                      | Insight semantic retrieval and backend fallbacks.             |
| `apps/web/lib/cron/insight-maintenance.ts`             | Scheduled raw-message and insight embedding repair.           |
| `apps/web/lib/ai/rag/langchain-service.ts`             | Knowledge chunk indexing and search.                          |
| `apps/web/lib/ai/mcp/tools/unified-memory.ts`          | Model-facing semantic memory MCP tool.                        |
| `apps/web/app/api/memory/raw-messages/route.ts`        | Raw memory API actions.                                       |
| `apps/web/app/api/memory/search/route.ts`              | Unified semantic search API.                                  |
| `packages/ai/src/store/conversation-store.ts`          | Per-day conversation JSON storage.                            |
| `apps/web/lib/ai/memory/fs-sync.ts`                    | Tauri filesystem memory paths and writes.                     |
| `apps/web/lib/ai/memory/chat-sync.ts`                  | Chat-to-Markdown export.                                      |
| `apps/web/lib/session/context.ts`                      | Temporary login/insight session context.                      |
