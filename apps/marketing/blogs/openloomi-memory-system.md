---
title: "OpenLoomi Memory System: Raw Messages, Insights, and RAG Recall"
date: 2026-05-28
description: A technical deep dive into OpenLoomi Memory, including raw message lifecycle, insight tracking, and unified RAG recall.
image: /img/blogs/19.png
---

# Internal Memory Implementation Mechanism

This document explains how OpenLoomi's internal memory system works in code. It
is written for maintainers who need to change ingestion, lifecycle compaction,
retrieval, storage backends, or the final unified search stage.

The important mental model is that OpenLoomi does not have one magic "memory"
box. It has several memory-like surfaces, each with a different job:

- Raw message memory stores original or near-original messages in
  `raw_messages`.
- Lifecycle summaries store rule-based compaction artifacts in
  `memory_summaries`.
- Insights store LLM-generated interpretations in the insights layer.
- Knowledge stores uploaded/generated document chunks in the RAG layer.
- Filesystem memory stores human-readable local Markdown and JSON files.
- Unified search is the application-level front door that queries raw memory,
  insights, and knowledge, then returns one ranked result list.

If the names feel slightly overloaded, that is because they are. Welcome to
software, where "memory" can mean five things before coffee.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Memory Types](#core-memory-types)
- [Raw Message Ingestion](#raw-message-ingestion)
- [Memory Tiers](#memory-tiers)
- [Forgetting Engine](#forgetting-engine)
- [Retention Scoring](#retention-scoring)
- [Summarization](#summarization)
- [Storage Architecture](#storage-architecture)
- [Query API and Summary Fallback](#query-api-and-summary-fallback)
- [Embeddings and Semantic Search](#embeddings-and-semantic-search)
- [Unified Search Stage](#unified-search-stage)
- [Filesystem Sync](#filesystem-sync)
- [Session Context](#session-context)
- [Operational Boundaries](#operational-boundaries)
- [Failure Modes](#failure-modes)
- [Maintenance Checklist](#maintenance-checklist)
- [Implementation References](#implementation-references)

## Architecture Overview

The shared lifecycle engine lives in `packages/ai/src/memory/`. It is deliberately
storage-agnostic. The engine knows how to score old records, decide which records
can move to colder tiers, group them, create summaries, and call adapter methods
to persist transitions. It does not know whether the records are stored in
IndexedDB, SQLite, Postgres, or a test map.

At a high level:

```text
Connector and insight refresh pipelines
  -> raw message extractor
  -> raw_messages
       | memoryStage: short / mid / long
       | accessCount, importanceScore, pinned/archive flags
       | optional embeddings
       v
  MemoryStorageAdapter
       v
  createMemoryForgettingEngine().runCycle()
       | scan old records
       | score retention priority
       | group eligible records by time and dimensions
       | create rule-based MemorySummary records
       | promote raw records between tiers
       | optionally archive details
       v
  memory_summaries
```

The read side has two major paths:

```text
Lifecycle-aware raw query
  -> createMemoryQueryApi().queryWithFallback()
  -> query raw records first
  -> append summaries when raw hits are insufficient
```

```text
Application-level global search
  -> /api/memory/search
  -> searchUnifiedMemory()
  -> raw memory hybrid search
  -> insight semantic search
  -> knowledge/RAG chunk search
  -> ranked unified results
```

These paths are related but not identical. Summary fallback is part of the raw
memory query API. Unified search is a broader search aggregator across multiple
corpora.

## Core Memory Types

The core contracts are defined in `packages/ai/src/memory/contracts.ts`.

### `MemoryRecord`

`MemoryRecord` is the engine-native representation of one memory item. For raw
messages, it is usually derived from `RawMessage`.

Important fields:

| Field                              | Meaning                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                               | Engine-level ID. For raw messages this is normally `messageId`.                                               |
| `userId`                           | Owner scope. All lifecycle and query calls must preserve this.                                                |
| `timestamp`                        | Unix timestamp in milliseconds inside the engine.                                                             |
| `text`                             | Raw text content. It may be omitted after detail archival.                                                    |
| `mediaRefs`                        | Attachment URLs used as a weak retention signal.                                                              |
| `embedding` and embedding metadata | Optional vector data for semantic retrieval.                                                                  |
| `tier`                             | `short`, `mid`, or `long`.                                                                                    |
| `accessCount`, `lastAccessAt`      | Retrieval feedback used by scoring.                                                                           |
| `importanceScore`                  | Explicit caller/storage importance signal.                                                                    |
| `isPinned`                         | Pinned records are protected from transitions.                                                                |
| `archivedAt`                       | Detail archival marker.                                                                                       |
| `dimensions`                       | Facets such as `platform`, `channel`, `person`, and `botId`.                                                  |
| `metadata`                         | Backend-specific extension data. The IndexedDB bridge preserves the original raw record under `__rawMessage`. |

### `MemorySummary`

`MemorySummary` represents a compact summary of a group of older records.

Important fields:

| Field                                  | Meaning                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `summaryId`                            | Deterministic `ms_<hash>` ID generated by the engine.           |
| `summaryTier`                          | `L1`, `L2`, or `L3`. Current normal runs produce `L1` and `L2`. |
| `sourceTier`                           | Tier before transition, such as `short` or `mid`.               |
| `startTimestamp`, `endTimestamp`       | Source record time window in milliseconds.                      |
| `messageCount`                         | Number of source records included.                              |
| `sourceRecordIds`                      | Raw record IDs represented by the summary.                      |
| `keyPoints`, `keywords`, `summaryText` | Rule-based summary payload.                                     |
| `dimensions`                           | Group dimensions copied from the first record in the group.     |
| `qualityScore`                         | Simple summary quality hint from the summarizer.                |

`MemorySummary` should not be confused with an insight. A memory summary is a
lifecycle compaction artifact. An insight is an LLM-generated interpretation
stored and queried by the insights subsystem.

### `MemoryStorageAdapter`

`MemoryStorageAdapter` is the boundary between generic memory logic and concrete
storage:

| Method                            | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `acquireLock()` / `releaseLock()` | Prevent concurrent lifecycle runs for the same user.               |
| `listCandidates()`                | Return old raw records that may be eligible for transition.        |
| `saveSummaries()`                 | Persist generated summaries.                                       |
| `transitionRecords()`             | Promote records to the target tier and attach a summary reference. |
| `archiveRecordDetails()`          | Optionally mark long-tier source details as archived.              |
| `queryRaw()`                      | Retrieve raw records for lifecycle-aware reads.                    |
| `querySummaries()`                | Retrieve summary fallback records.                                 |
| `markRecordsAccessed()`           | Increment access metadata after raw records are read.              |

The default production bridge is
`createIndexedDBMemoryStorageAdapter()` in
`packages/indexeddb/src/forgetting.ts`. Despite the name, it adapts the shared
raw-message manager shape, so the same lifecycle adapter can be used over
browser IndexedDB-style managers and server-selected SQLite/Postgres managers.

## Raw Message Ingestion

Raw memory starts as connector or chat payloads. The extractor in
`packages/indexeddb/src/extractor.ts` converts platform-specific payloads into
raw message records. It supports chat and content sources such as Slack,
Discord, Telegram, WhatsApp, iMessage, email providers, Teams, LinkedIn,
Instagram, Twitter/X, RSS, and generic message-like inputs.

The active production path is commonly insight refresh:

```text
apps/web/lib/insights/processor.ts
  -> extractRawMessages(...)
  -> returns rawMessages with the insight refresh result
  -> apps/web/hooks/use-insight-refresh.ts
  -> storeRawMessagesFromInsight()
  -> IndexedDB or /api/memory/raw-messages
```

Raw messages are upserted by `messageId`. When platform-native IDs are missing,
the extractor builds deterministic IDs from stable fields such as platform,
bot, timestamp, channel, sender, and content hash. This matters because insight
refresh can run repeatedly; repeated imports should update existing history,
not spray duplicate memories everywhere like confetti.

New raw records normally start with:

| Field             | Default |
| ----------------- | ------- |
| `memoryStage`     | `short` |
| `accessCount`     | `0`     |
| `importanceScore` | `0`     |
| `isPinned`        | `false` |

At the engine level, `packages/ai/src/memory/ingest.ts` provides
`normalizeMemoryRecordForIngest()`, which defaults missing `tier` values to
`short`.

## Memory Tiers

The memory lifecycle uses three raw record tiers:

| Tier    | Meaning                                                        | Default transition rule                                    |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `short` | Recent, detailed memory.                                       | After 7 days, low-retention records can move to `mid`.     |
| `mid`   | Older memory that still keeps raw shape unless archived later. | After 90 days, lower-retention records can move to `long`. |
| `long`  | Cold long-term memory.                                         | Details may be archived after transition.                  |

Summary tiers describe the compaction artifact produced during transitions:

| Source tier | Target tier                | Summary tier                                         |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `short`     | `mid`                      | `L1`                                                 |
| `mid`       | `long`                     | `L2`                                                 |
| `long`      | N/A in current engine loop | `L3` helper exists but is not used by normal phases. |

The default policy lives in `packages/ai/src/memory/policy.ts`:

| Setting                            | Default                                  |
| ---------------------------------- | ---------------------------------------- |
| `shortMaxAgeMs`                    | `7 * DAY_MS`                             |
| `midMaxAgeMs`                      | `90 * DAY_MS`                            |
| `scoreThresholds.shortToMid`       | `0.65`                                   |
| `scoreThresholds.midToLong`        | `0.45`                                   |
| `groupWindowMs.short`              | `1 * DAY_MS`                             |
| `groupWindowMs.mid`                | `7 * DAY_MS`                             |
| `minRecordsPerGroup`               | `3`                                      |
| `maxCandidatesPerTierPerRun.short` | `500`                                    |
| `maxCandidatesPerTierPerRun.mid`   | `500`                                    |
| `lock.keyPrefix`                   | `memory_forgetting`                      |
| `lock.ttlMs`                       | `60_000`                                 |
| `groupByDimensionKeys`             | `platform`, `channel`, `person`, `botId` |

The thresholds are retention thresholds, not deletion thresholds. A record with
a lower score is considered less important to keep in the current hot tier.

## Forgetting Engine

`createMemoryForgettingEngine()` lives in `packages/ai/src/memory/engine.ts`.
The name "forgetting" is slightly dramatic: the engine does not immediately
erase memory. It progressively compacts and cools records.

For each `runCycle({ userId })`, the engine:

1. Builds a lock key: `memory_forgetting:<userId>`.
2. Acquires the storage lock.
3. Processes the `short -> mid` phase.
4. Processes the `mid -> long` phase.
5. Releases the lock in a `finally` block.

Each phase follows the same shape:

1. Compute the cutoff timestamp from the tier age window.
2. Ask storage for candidates in the source tier older than that cutoff.
3. Score every candidate with `DefaultMemoryRecordScorer` unless a custom scorer
   was injected.
4. Keep only records that are:
   - not pinned,
   - not already archived,
   - scored at or below the phase threshold.
5. Group eligible records by:
   - source tier,
   - bucketed timestamp,
   - `platform`,
   - `channel`,
   - `person`,
   - `botId`.
6. Skip groups smaller than `minRecordsPerGroup`.
7. Summarize each group.
8. Save one `MemorySummary`.
9. Promote the source records to the target tier.
10. When the target tier is `long`, call `archiveRecordDetails()` if the adapter
    implements it.

The group ID includes the source tier, bucket start, and dimension key. Summary
IDs are deterministic hashes of user, summary tier, group ID, and group end
timestamp. This makes summary upserts retry-friendly if a run fails after a
partial write.

`dryRun` runs the same scan, scoring, grouping, and counting logic, but skips
the writes. It returns counters such as:

- `scannedRecords`
- `eligibleRecords`
- `createdSummaries`
- `transitionedRecords`
- `archivedDetailRecords`

The IndexedDB/server bridge adds an optional hard-delete phase in
`runMemoryForgettingCycle()`. Hard delete only happens when the caller provides
`hardDeleteArchivedOlderThan`. Archival and hard deletion are intentionally
separate: archival is part of lifecycle cooling, hard delete is the irreversible
"no take-backsies" button.

## Retention Scoring

`DefaultMemoryRecordScorer` lives in `packages/ai/src/memory/scorer.ts`.

The score range is `[0, 1]`. Higher means "keep this record hot longer".

Formula:

```text
score = clamp01(
  0.35 * recencyScore +
  0.30 * accessScore +
  0.25 * importanceScore +
  0.10 * mediaScore +
  pinnedBoost
)
```

Signals:

| Signal              | Behavior                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recencyScore`      | Decays linearly over 180 days: `clamp01(1 - ageMs / 180 days)`.                                                                                                            |
| `accessScore`       | Uses `clamp01(log1p(accessCount) / log(10))`, so repeated retrieval helps but saturates.                                                                                   |
| `importanceScore`   | Max of explicit `importanceScore` and inferred keyword importance.                                                                                                         |
| inferred importance | Counts terms such as `deadline`, `todo`, `urgent`, `risk`, `decision`, `blocker`, `meeting`, `action item`, `milestone`, `bug`, `incident`, and `follow up`; caps quickly. |
| `mediaScore`        | `0.7` when attachments exist, otherwise `0.25`.                                                                                                                            |
| `pinnedBoost`       | `+0.3` for pinned records before final clamping.                                                                                                                           |

Pinned records also fail the eligibility filter before transition, so they are
protected twice. It is a little redundant, but redundancy is cheaper than
accidentally compacting the one thing a user explicitly pinned.

## Summarization

`RuleBasedMemorySummarizer` lives in
`packages/ai/src/memory/summarizer.ts`. It does not call an LLM.

For each group, it:

1. Sorts records by timestamp ascending.
2. Reads non-empty `text`.
3. Uses up to the first five text records as `keyPoints`.
4. Truncates each key point to 180 characters.
5. Extracts up to 12 keywords with simple token counting and stop-word removal.
6. Builds `summaryText` containing:
   - source time window,
   - tier transition,
   - summary tier,
   - record count,
   - highlights.
7. Sets `qualityScore` to `0.75` when highlights exist, otherwise `0.45`.

Example shape:

```text
Window: 2026-01-01 -> 2026-01-07
Tier transition: short -> mid (L1)
Records: 18
Highlights: First useful message... | Second useful message...
```

Attachment-only groups use a fallback highlight:

```text
Highlights: (no text content, likely attachment-driven records)
```

The summarizer is injectable through `MemorySummarizer`. A future LLM-backed
summarizer could be plugged in, but current lifecycle compaction is rule-based.
That boundary is important when debugging output quality: if a lifecycle summary
looks plain, it is not because the model had a bad day. No model was invited.

## Storage Architecture

There are two related storage contracts:

- `MemoryStorageAdapter` in `packages/ai/src/memory/contracts.ts` is the
  lifecycle/query boundary used by the shared engine.
- `RawMessageStorage` in `packages/indexeddb/src/storage.ts` is the broader raw
  message manager shape implemented by browser, SQLite, and Postgres storage.

### Raw Message Stores

`RawMessage` contains:

- identity: `messageId`, optional numeric `id`,
- ownership: `userId`,
- source dimensions: `platform`, `botId`, `channel`, `person`,
- time: `timestamp`, `createdAt`,
- content: `content`, `attachments`,
- embedding fields,
- lifecycle fields: `memoryStage`, `accessCount`, `lastAccessAt`,
  `importanceScore`, `archivedAt`, `isPinned`, `summaryRefId`,
- arbitrary `metadata`.

`MemorySummaryRecord` mirrors `MemorySummary` for concrete storage and adds
`keywordsText` for simple keyword filtering.

### IndexedDB

`packages/indexeddb/src/manager.ts` owns the browser IndexedDB stores:

| Store              | Key                                               | Purpose              |
| ------------------ | ------------------------------------------------- | -------------------- |
| `raw_messages`     | auto-increment `id` plus unique `messageId` index | Raw message records. |
| `memory_summaries` | `summaryId`                                       | Lifecycle summaries. |

Important raw indexes:

- `messageId`
- `platform`
- `botId`
- `userId`
- `channel`
- `person`
- `timestamp`
- `createdAt`
- `memoryStage`
- `archivedAt`
- `isPinned`
- `summaryRefId`
- `userId_memoryStage`
- `userId_timestamp`

Important summary indexes:

- `summaryId`
- `userId`
- `summaryTier`
- `userId_summaryTier`
- `userId_endTimestamp`
- `keywords`
- `keywordsText`

The lifecycle adapter uses `userId_memoryStage` and `userId_timestamp` for
candidate scans and bounded queries. Summary queries use user, tier, time, and
keyword fields.

### SQLite

Tauri/local server-side raw storage uses
`packages/sqlite/src/raw-message-manager.ts` and schema from
`packages/sqlite/src/schema.ts`.

SQLite storage includes:

- `raw_messages`,
- `memory_summaries`,
- `raw_messages_fts` FTS5 virtual table,
- triggers that keep FTS rows synchronized,
- optional `raw_messages_vec` virtual table when sqlite-vector support is
  initialized.

Important SQLite indexes include:

- `idx_raw_messages_user_timestamp`,
- `idx_raw_messages_user_memory_stage`,
- `idx_raw_messages_platform`,
- `idx_raw_messages_bot_id`,
- `idx_raw_messages_archived_at`,
- `idx_raw_messages_created_at`,
- `idx_memory_summaries_user_time`,
- `idx_memory_summaries_user_tier`.

SQLite is selected in Tauri mode by
`apps/web/lib/memory/sqlite-raw-message-store.ts`.

### Postgres

Server/cloud raw storage uses
`apps/web/lib/memory/postgres-raw-message-store.ts` and Drizzle schema in
`apps/web/lib/db/schema.pg.ts`.

Postgres implements the same manager operations:

- raw message upsert/query,
- summary upsert/query,
- access marking,
- stage promotion,
- archive and hard delete,
- embedding updates,
- optional semantic search.

`apps/web/lib/memory/raw-message-store.ts` chooses the backend:

```text
if Tauri mode:
  SQLiteRawMessageManager
else:
  PostgresRawMessageManager
```

### Client API Bridge

Browser-facing code imports `@openloomi/indexeddb/client`. That client can use
the raw-message API first and fall back to browser IndexedDB when the API path
is unavailable.

The main lifecycle-aware API route is
`apps/web/app/api/memory/raw-messages/route.ts`. It supports actions including:

| Action             | Behavior                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| `store`            | Scope incoming raw messages to the authenticated user and persist them. |
| `query`            | Query raw messages; optionally use summary fallback.                    |
| `queryGrouped`     | Return grouped raw messages.                                            |
| `stats`            | Return backend stats.                                                   |
| `clearOld`         | Delete old raw messages for the authenticated user.                     |
| `updateEmbeddings` | Persist embedding updates.                                              |
| `semanticSearch`   | Call native manager semantic search when available.                     |
| `upsertSummaries`  | Store lifecycle summary records.                                        |
| `forgettingCycle`  | Run the lifecycle engine and optional archived hard delete.             |

The route always scopes operations to `session.user.id`, which is the line
between "memory feature" and "oops, cross-user data leak". Keep that line
bright.

## Query API and Summary Fallback

`createMemoryQueryApi()` in `packages/ai/src/memory/api.ts` provides the
lifecycle-aware read path.

`queryWithFallback()`:

1. Resolves page size from `pageSize`, `limit`, or default `50`.
2. Calls `storage.queryRaw()`.
3. Converts raw records to `MemorySearchHit` with `sourceType: "raw"`.
4. If raw hits are fewer than `minRawResultsWithoutFallback`, queries summaries
   for the remaining page capacity.
5. Converts summaries to `MemorySearchHit` with `sourceType: "summary"`.
6. Sorts all hits by timestamp descending.
7. Slices to page size.
8. Calls `markRecordsAccessed()` for returned raw records when available.

This read path is for callers that want raw memory plus lifecycle summary
fallback. In web API terms, it is exposed through `/api/memory/raw-messages`
when `includeSummaryFallback` is enabled.

It is intentionally not the same as unified search. Query fallback answers:
"Show me memory records for this query, and use summaries when raw detail is
thin." Unified search answers: "Search all memory-like knowledge sources and
rank them together."

## Embeddings and Semantic Search

Memory embeddings have two layers.

### Embedding Text Builder

`packages/ai/src/memory/embedding.ts` builds deterministic text from a memory
record. It can include:

- text,
- timestamp,
- tier,
- media references,
- dimensions,
- metadata.

Metadata keys beginning with `__` are excluded, so adapter internals such as
`__rawMessage` do not pollute embedding input.

The content hash is versioned. If the embedding text format changes, the version
must change too so stale embeddings can be detected and regenerated.

### Raw Message Embedding Dream

`packages/indexeddb/src/embedding.ts` contains the raw message embedding refresh
flow. It scans candidate raw messages and embeds records when:

- no embedding exists,
- the embedding model changed,
- the embedding content hash changed.

Semantic search can happen in two ways:

- client/helper-level cosine similarity over stored embeddings,
- manager-native search, such as SQLite vector search or Postgres vector
  distance.

Unified search uses the manager-native semantic branch when available.

## Unified Search Stage

The final application-level search stage lives in
`apps/web/lib/memory/unified-search.ts` and is exposed by
`apps/web/app/api/memory/search/route.ts`.

This stage is where OpenLoomi merges the three big searchable corpora:

| Source      | Implementation                                                        | Returned `type` |
| ----------- | --------------------------------------------------------------------- | --------------- |
| `memory`    | Raw message keyword search plus optional raw message semantic search. | `memory`        |
| `insights`  | `searchInsightsSemantically()` over LLM-generated insight records.    | `insight`       |
| `knowledge` | `searchSimilarChunks()` over RAG document chunks.                     | `knowledge`     |

Defaults:

| Option      | Default / clamp                   |
| ----------- | --------------------------------- |
| `sources`   | `memory`, `insights`, `knowledge` |
| `limit`     | default `10`, clamped to `1..50`  |
| `threshold` | default `0.7`, clamped to `-1..1` |

The route validates the request, authenticates the user, scopes `userId` to the
session, forwards optional filters, and passes the cloud auth token to embedding
providers:

```text
POST /api/memory/search
  -> auth()
  -> parse query, sources, limit, threshold, botIds, documentIds
  -> extractCloudAuthToken()
  -> searchUnifiedMemory()
```

Unified search output is source-neutral:

```ts
{
  query: string;
  sources: Array<"memory" | "insights" | "knowledge">;
  results: Array<{
    type: "memory" | "insight" | "knowledge";
    id: string;
    content: string;
    similarity: number;
    metadata: Record<string, unknown>;
  }>;
  count: number;
  warnings: Array<{
    source: "memory" | "insights" | "knowledge";
    code: string;
    message: string;
  }>;
}
```

### Raw Memory Branch

The raw memory branch is hybrid:

1. Normalize the query.
2. Extract up to eight keyword strings. The list includes the full normalized
   query plus tokenized words.
3. Query raw messages through `manager.queryMessages()` with:
   - `userId`,
   - extracted `keywords`,
   - `includeArchived: false`,
   - `reverse: true`,
   - `pageSize: limit * 3`,
   - optional `botId` filters.
4. Convert matching raw messages into `UnifiedMemorySearchResult`.
5. Assign keyword scores from `0.78` upward:
   - base score: `0.78`,
   - `+0.04` per keyword match,
   - capped at `0.95`.
6. If an embedding provider is configured and
   `manager.searchMessagesSemantically()` exists, embed the query and run native
   semantic search.
7. Merge semantic and keyword results by ID.
8. Mark semantic-only hits as `matchType: "semantic"`, keyword-only hits as
   `matchType: "keyword"`, and overlapping hits as `matchType: "hybrid"`.
9. Hybrid hits receive a `+0.08` bonus, capped at `1`.

Embedding provider config is considered available when any of these exists:

- request auth token,
- `OPENAI_EMBEDDINGS_API_KEY`,
- `OPENROUTER_API_KEY`,
- `LLM_API_KEY`.

If raw message storage is unavailable, unified search adds a warning:

```text
source: memory
code: raw_message_storage_unavailable
```

It does not fail the entire request. This is important because insight or
knowledge search can still produce useful results.

### Insights Branch

When `sources` includes `insights`, unified search calls
`searchInsightsSemantically()` with:

- `userId`,
- `query`,
- `limit`,
- `threshold`,
- optional `botIds`,
- optional `includeArchivedInsights`,
- optional `authToken`.

Insights are LLM-derived records. They are not the same as memory lifecycle
summaries.

### Knowledge Branch

When `sources` includes `knowledge`, unified search calls `searchSimilarChunks()`
with:

- `userId`,
- `query`,
- `limit`,
- `threshold`,
- optional `documentIds`,
- optional `authToken`.

Knowledge results are converted from RAG chunks into unified results with
metadata such as `documentId`, `documentName`, and `chunkIndex`.

### Final Merge

All source results are merged by `mergeUnifiedMemorySearchResults()`:

1. Sort by descending `similarity`.
2. Break ties by `type`.
3. Break remaining ties by `id`.
4. Slice to the requested limit.

This final stage does not query `memory_summaries` directly. Summary fallback
belongs to the raw-message query API and `createMemoryQueryApi()`. Unified
search is optimized for multi-corpus search, not lifecycle browsing.

Put another way:

- Use `/api/memory/raw-messages` with summary fallback when you need faithful
  raw memory retrieval with lifecycle summaries.
- Use `/api/memory/search` when you need a global search box across memory,
  insights, and knowledge.

## Filesystem Sync

Filesystem memory is adjacent to structured raw memory, but it is not the same
pipeline.

### File-Backed Conversation Store

`packages/ai/src/store/conversation-store.ts` stores conversation messages in
per-day JSON files:

```text
{memoryDir}/{prefix}/YYYY-MM-DD.json
```

The day file shape is:

```ts
Record<userKey, Record<accountId, ConversationMessage[]>>;
```

The store supports:

- lazy migration from legacy `{prefix}-conversations.json`,
- appending messages,
- loading one day,
- loading a date range,
- listing available days,
- clearing conversations,
- writing `compact_summary` messages across a compacted date range.

### Tauri Memory Directory

`apps/web/lib/ai/memory/fs-sync.ts` resolves the local memory root in Tauri:

```text
<appDataDir>/data/memory
```

The expected local structure includes:

```text
data/memory/
  people/
  projects/
  notes/
  strategy/
  chats/
```

`apps/web/lib/ai/memory/chat-sync.ts` exports chat history to Markdown:

```text
<appDataDir>/data/memory/chats/YYYY-MM-DD/{safe-title}-{chatIdPrefix}.md
```

This is useful for local inspection and agent-readable files. It does not
automatically insert those files into `raw_messages`, `memory_summaries`, or RAG
unless a separate import/indexing flow does so.

## Session Context

`apps/web/lib/session/context.ts` manages temporary login and insight processing
state. It is not the memory database, but it affects which integrations can
fetch data and therefore which raw messages can be produced.

Important key prefixes:

| Prefix              | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `login_session:`    | Login flow state.                                |
| `insights_session:` | Insight processing state.                        |
| `insights_lock:`    | Best-effort single-flight lock for insight work. |

Default TTL:

```text
SESSION_EXPIRE_MS = 1,800,000 = 30 minutes
```

Runtime behavior:

| Environment                     | Session backend                                                  |
| ------------------------------- | ---------------------------------------------------------------- |
| Tauri                           | `ioredis-mock` plus local JSON files for login/insight payloads. |
| Server with `REDIS_URL`         | Real Redis.                                                      |
| Development without `REDIS_URL` | `ioredis-mock`.                                                  |

`tryAcquireInsightLock(botId)` allows processing when Redis is unavailable so
local development does not grind to a halt. Very considerate, very "let the dev
ship the thing".

## Operational Boundaries

These boundaries prevent confusion during maintenance:

| Boundary                             | What it means                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Memory lifecycle vs insights         | Lifecycle summaries are rule-based; insights may be LLM-generated.                                           |
| Raw query fallback vs unified search | Raw query fallback can append `memory_summaries`; unified search merges raw memory, insights, and knowledge. |
| Raw messages vs filesystem memory    | Raw messages are structured database records; filesystem memory is local files.                              |
| IndexedDB vs SQLite/Postgres         | Browser IndexedDB is a local/fallback store; server/Tauri routes select SQLite or Postgres.                  |
| Archive vs hard delete               | Archive marks details cold; hard delete irreversibly removes old archived rows.                              |
| Seconds vs milliseconds              | Engine APIs use milliseconds; some raw edges store seconds and adapters normalize.                           |

The most common debugging mistake is treating every "summary" as the same
thing. There are lifecycle summaries, insight summaries, compaction summaries,
and document chunks that might summarize something. Same English word, different
tables, different rules, different drama.

## Failure Modes

| Area                            | Failure mode                                            | Expected behavior                                                                            |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Forgetting lock                 | Another run owns the lock.                              | Engine returns `skipped_locked`.                                                             |
| Summary saved, transition fails | Partial lifecycle progress.                             | Retry is intended to be safe because summaries upsert by deterministic ID.                   |
| Group too small                 | Fewer than `minRecordsPerGroup`.                        | No summary is created; records remain in place.                                              |
| Pinned record                   | Candidate is old but pinned.                            | It is excluded from transition eligibility.                                                  |
| Archived record                 | Candidate already has `archivedAt`.                     | It is excluded from transition eligibility.                                                  |
| IndexedDB closed                | Connection closes during an operation.                  | Manager retry/reopen paths handle common closed-state errors.                                |
| Raw storage unavailable         | No SQLite/Postgres/IndexedDB path.                      | Raw API reports unavailable; unified search can return warnings and still use other sources. |
| Missing embedding config        | No token or embedding API key.                          | Semantic branch is skipped or returns an embedding-provider error at the route boundary.     |
| Semantic manager unavailable    | Manager lacks native vector search.                     | Keyword raw memory search still runs.                                                        |
| Filesystem sync in web mode     | Tauri-only filesystem helpers are called outside Tauri. | Path helpers throw or write helpers return early.                                            |
| Redis unavailable in dev        | No real Redis configured.                               | `ioredis-mock` is used; insight lock is best-effort.                                         |

## Maintenance Checklist

When changing memory code:

- If `MemoryRecord` changes, update adapter mapping in
  `packages/indexeddb/src/forgetting.ts` and embedding text generation in
  `packages/ai/src/memory/embedding.ts`.
- If `RawMessage` changes, update `packages/indexeddb/src/storage.ts`,
  IndexedDB manager mapping, SQLite mapping, Postgres mapping, and API route
  serialization.
- If lifecycle thresholds change, update `packages/ai/src/memory/policy.ts` and
  the tests that assert transition behavior.
- If scoring changes, update `DefaultMemoryRecordScorer` tests.
- If grouping dimensions change, review summary quality and query filter
  compatibility.
- If summary shape changes, update `MemorySummary`, `MemorySummaryRecord`,
  summary query code, and migration logic.
- If timestamp handling changes, audit every second/millisecond normalization
  point. This is where bugs wear fake mustaches.
- If embedding text changes, bump the embedding text version/hash scheme so old
  vectors regenerate.
- If `/api/memory/raw-messages` action shapes change, update
  `packages/indexeddb/src/sqlite-client.ts` and client tests.
- If unified search changes, update
  `apps/web/tests/unit/unified-memory-search.test.ts`.
- If Tauri SQLite migration changes, update migration version/state handling and
  migration tests.
- If filesystem memory is imported into structured memory later, document that
  new bridge explicitly. It does not happen automatically today.

Useful tests:

- `apps/web/tests/unit/memory-forgetting.test.ts`
- `apps/web/tests/unit/indexeddb-forgetting.test.ts`
- `apps/web/tests/unit/memory-embedding.test.ts`
- `apps/web/tests/unit/indexeddb-memory-embedding.test.ts`
- `apps/web/tests/unit/unified-memory-search.test.ts`
- `apps/web/tests/unit/raw-message-storage-contract.test.ts`
- `apps/web/tests/unit/sqlite-raw-message-storage.test.ts`
- `apps/web/tests/unit/sqlite-raw-message-migration.test.ts`
- `apps/web/tests/unit/postgres-raw-message-store.test.ts`
- `apps/web/tests/unit/rag-embeddings.test.ts`

## Implementation References

| File                                                | Purpose                                                         |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `packages/ai/src/memory/contracts.ts`               | Core memory types and adapter interfaces.                       |
| `packages/ai/src/memory/engine.ts`                  | Forgetting lifecycle orchestration.                             |
| `packages/ai/src/memory/policy.ts`                  | Default tier windows, thresholds, grouping, and lock config.    |
| `packages/ai/src/memory/scorer.ts`                  | Retention priority scoring.                                     |
| `packages/ai/src/memory/summarizer.ts`              | Rule-based lifecycle summary generation.                        |
| `packages/ai/src/memory/api.ts`                     | Raw-first query with summary fallback.                          |
| `packages/ai/src/memory/ingest.ts`                  | Engine-level ingest normalization.                              |
| `packages/ai/src/memory/embedding.ts`               | Stable embedding text and content hash builder.                 |
| `packages/indexeddb/src/storage.ts`                 | Raw message and summary storage contract.                       |
| `packages/indexeddb/src/extractor.ts`               | Connector payload to raw-message conversion.                    |
| `packages/indexeddb/src/manager.ts`                 | Browser IndexedDB raw message and summary manager.              |
| `packages/indexeddb/src/forgetting.ts`              | `MemoryStorageAdapter` bridge and lifecycle/query entry points. |
| `packages/indexeddb/src/embedding.ts`               | Raw message embedding refresh and semantic search helpers.      |
| `packages/indexeddb/src/client.ts`                  | Browser-facing raw memory client and fallback facade.           |
| `packages/indexeddb/src/sqlite-client.ts`           | API-backed raw message facade and SQLite migration helpers.     |
| `packages/sqlite/src/schema.ts`                     | SQLite raw message, summary, FTS, and index schema.             |
| `packages/sqlite/src/raw-message-manager.ts`        | SQLite raw message manager.                                     |
| `apps/web/lib/memory/raw-message-store.ts`          | SQLite/Postgres backend selector.                               |
| `apps/web/lib/memory/sqlite-raw-message-store.ts`   | Tauri SQLite manager factory.                                   |
| `apps/web/lib/memory/postgres-raw-message-store.ts` | Postgres raw message manager.                                   |
| `apps/web/app/api/memory/raw-messages/route.ts`     | Raw memory API actions.                                         |
| `apps/web/app/api/memory/search/route.ts`           | Unified memory search route.                                    |
| `apps/web/lib/memory/unified-search.ts`             | Raw memory + insights + knowledge search merger.                |
| `apps/web/lib/insights/search.ts`                   | Insight semantic search.                                        |
| `apps/web/lib/ai/rag/langchain-service.ts`          | Knowledge-base RAG search.                                      |
| `packages/ai/src/store/conversation-store.ts`       | File-backed per-day conversation store.                         |
| `apps/web/lib/ai/memory/fs-sync.ts`                 | Tauri filesystem memory root helpers.                           |
| `apps/web/lib/ai/memory/chat-sync.ts`               | Chat history Markdown export.                                   |
| `apps/web/lib/session/context.ts`                   | Login/insight session state and locks.                          |
