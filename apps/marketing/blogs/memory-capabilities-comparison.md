---
title: "Memory Capabilities Comparison: OpenClaw vs. Hermes Agent vs. Claude Code vs. OpenLoomi"
date: 2026-05-27
description: A comparison of durable memory, retrieval, and model-facing recall, with a source-level look at OpenLoomi's multi-corpus memory pipeline.
---

# Memory Capabilities Comparison

_Last verified on June 10, 2026. OpenLoomi behavior reflects the current
repository after
[PR #154](https://github.com/melandlabs/openloomi/pull/154). External-system
summaries use the official documentation and repositories linked below._

This article compares how OpenClaw, Hermes Agent, Claude Code, and OpenLoomi
store durable context and bring it back into an active model session. The
comparison is intentionally OpenLoomi-centered: the other systems establish
useful architectural baselines, while the OpenLoomi section follows the current
implementation down to its storage, lifecycle, vector, API, and MCP boundaries.

The short version:

- OpenClaw is file-first memory with plugin-backed search.
- Hermes Agent combines curated memory, session search, and self-improving
  skills.
- Claude Code uses hierarchical instruction files and project-scoped auto
  memory.
- OpenLoomi separates raw memory, lifecycle summaries, insights, and knowledge,
  then performs cross-source semantic recall at the application layer.

Four products, four definitions of "I remember that." At least nobody named a
database table `misc_final_really_final`.

## Table of Contents

- [Comparison Matrix](#comparison-matrix)
- [The OpenLoomi Memory Model](#the-openloomi-memory-model)
- [OpenLoomi Write and Maintenance Flows](#openloomi-write-and-maintenance-flows)
- [OpenLoomi Recall Paths](#openloomi-recall-paths)
- [Why OpenLoomi Keeps Sources Isolated](#why-openloomi-keeps-sources-isolated)
- [Other Systems in Brief](#other-systems-in-brief)
- [Final Recall Comparison](#final-recall-comparison)
- [Persistence Across Restarts](#persistence-across-restarts)
- [Tradeoffs](#tradeoffs)
- [Claims and Caveats](#claims-and-caveats)
- [Sources](#sources)

## Comparison Matrix

| Capability            | OpenClaw                                                              | Hermes Agent                                                                 | Claude Code                                                                        | OpenLoomi                                                                                                       |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Core memory model     | Durable Markdown plus a rebuildable search index.                     | Curated memory files, searchable session history, and optional providers.    | Hierarchical instruction files plus project-scoped auto-memory Markdown.           | Separate raw memory, lifecycle summaries, insights, and RAG knowledge.                                          |
| Canonical persistence | Workspace files such as `MEMORY.md` and `memory/*.md`.                | `MEMORY.md`, `USER.md`, SQLite session history, and generated skills.        | `CLAUDE.md`, `.claude/rules/*.md`, and project auto-memory files.                  | IndexedDB, SQLite, or Postgres records, plus optional local Markdown/JSON exports.                              |
| Exact/text retrieval  | Built-in FTS/BM25 paths through the memory plugin.                    | SQLite FTS5 through `session_search`.                                        | Normal file discovery and file search.                                             | Source-specific raw-message keyword/FTS queries; not part of the unified semantic endpoint.                     |
| Semantic retrieval    | Embedding search over indexed memory chunks.                          | Provider-dependent; built-in session search is lexical.                      | No native vector memory database in the documented memory model.                   | Raw memory, insights, and knowledge each have a semantic branch.                                                |
| Knowledge RAG         | Memory-file search can be RAG-like, but files remain the core model.  | Not native to built-in memory; external providers may add it.                | Not native to the documented memory system.                                        | Native document parsing, chunking, embedding, vector indexing, and retrieval.                                   |
| Lifecycle management  | File maintenance, optional dreaming, promotion, and compaction hooks. | Curated updates, session retention, and background skill/memory improvement. | User-managed instruction files and agent-maintained auto memory.                   | `short -> mid -> long` raw-memory transitions with scoring, grouping, summaries, and archival.                  |
| Cross-source recall   | Plugin and companion-corpus dependent.                                | Curated memory, sessions, and providers remain separate recall surfaces.     | Instruction scope and topic-file reads provide context, not a merged ranked query. | `/api/memory/search` merges semantic results from raw memory, insights, and knowledge into one result contract. |
| Local-first option    | Yes; canonical memory and indexes can remain local.                   | Yes for built-in memory and session storage.                                 | Memory files are local, although loaded content enters the model context.          | Yes in Tauri through SQLite, local embeddings, and sqlite-vec; Chroma can also run as a separate local service. |
| Main strength         | Transparent and inspectable memory files.                             | Agent learning and self-improvement.                                         | Repository-aware persistent instructions and learned project context.              | Structured multi-corpus memory with lifecycle management and application-level semantic recall.                 |
| Main cost             | Capability varies with plugins and index configuration.               | Memory behavior spans several mechanisms and optional providers.             | Recall depends on file scope and agent file reads rather than ranked retrieval.    | More stores, embedding maintenance, backend compatibility, and failure modes must be operated coherently.       |

## The OpenLoomi Memory Model

OpenLoomi does not treat every durable artifact as one interchangeable blob.
The current architecture has five related but distinct domains:

| Domain              | Canonical data                                                        | Purpose                                                                |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Raw memory          | `raw_messages`                                                        | Original or near-original connector and chat messages.                 |
| Lifecycle summaries | `memory_summaries`                                                    | Rule-based compaction created during raw-memory tier transitions.      |
| Insights            | Insight records plus `insight_embeddings`                             | LLM-derived tasks, events, risks, decisions, and interpretations.      |
| Knowledge           | RAG documents and chunks                                              | Uploaded or generated document knowledge.                              |
| Filesystem memory   | Tauri Markdown/JSON under chats, people, projects, notes, or strategy | Inspectable local artifacts outside the default cross-source endpoint. |

This separation is important. A raw message, an insight, and a document chunk
may describe the same project, but they have different owners, deletion rules,
metadata, retention behavior, and update lifecycles. They are related evidence,
not duplicate rows waiting to be squeezed into one heroic table.

There is also no standalone `context_atlas` table. The product-level context
atlas is assembled from these data sources and the paths that retrieve them.

### Raw Memory Lifecycle

The lifecycle engine in `packages/ai/src/memory/` maps persisted raw messages to
`MemoryRecord` and applies progressive compaction:

```text
recent raw message
  -> short
  -> score by recency, access, importance, media, and pinning
  -> group by time plus platform/channel/person/bot
  -> create L1 summary
  -> mid
  -> repeat with a longer age and grouping window
  -> create L2 summary
  -> long
  -> optionally archive source detail
```

Default policy:

| Setting                        | Value                             |
| ------------------------------ | --------------------------------- |
| `short -> mid` age window      | 7 days                            |
| `mid -> long` age window       | 90 days                           |
| `short -> mid` score threshold | `0.65`                            |
| `mid -> long` score threshold  | `0.45`                            |
| Short grouping window          | 1 day                             |
| Mid grouping window            | 7 days                            |
| Minimum records per group      | 3                                 |
| Group dimensions               | platform, channel, person, bot ID |

The tier is a lifecycle property, not an automatic semantic-ranking penalty.
Current vector search ranks by similarity unless the caller explicitly filters
by tier through the engine-level recall API.

### Canonical Records and Vector Indexes

OpenLoomi keeps source records and semantic indexes conceptually separate:

```text
canonical row
  -> owns content, metadata, lifecycle state, and embedding metadata

vector index
  -> accelerates similarity search
  -> can be synchronized, repaired, cleared, or rebuilt
```

Depending on the runtime and corpus, the semantic path can use:

- sqlite-vec,
- ChromaDB,
- Postgres pgvector,
- a bounded stored-embedding cosine fallback for raw memory and insights.

`UnifiedVectorSearchService` in
`packages/ai/rag/src/unified-vector-search-service.ts` standardizes operations
over one Chroma, sqlite-vec, or custom vector store. It handles embedding
generation, upsert, search, metadata filters, deletion, and statistics.

It is not the cross-source application search. That second "unified" layer is
`searchUnifiedMemory()`, which coordinates three isolated corpora. Same
adjective, different job. Naming is free; explaining it later is apparently
where the invoice arrives.

## OpenLoomi Write and Maintenance Flows

### Raw Messages

```text
connector or chat message
  -> normalize to RawMessage
  -> upsert by stable messageId
  -> persist lifecycle and embedding metadata
  -> scheduled embedding dream repairs missing, changed, or stale vectors
  -> synchronize the configured sqlite-vec or Chroma index
```

New raw messages default to `short` memory with zero access and importance
scores unless the caller supplies stronger signals.

### Insights

```text
insight create/update
  -> persist structured insight
  -> build stable embedding content
  -> generate and persist embedding metadata
  -> synchronize sqlite-vec or Chroma when configured

scheduled insight embedding dream
  -> repair missing or stale vectors
```

Insights are not lifecycle summaries. Lifecycle summaries are deterministic
compaction artifacts; insights are interpreted records produced by the insight
pipeline.

### Knowledge

```text
document upload
  -> parse text
  -> split into chunks
  -> generate embeddings
  -> persist document and chunk rows
  -> add chunks to sqlite-vec or Chroma in Tauri
     or search through pgvector in server deployments
```

Raw and insight embedding maintenance runs on a 24-hour due window in the
desktop scheduler. It regenerates vectors when an embedding is missing, the
model changes, or the embedding-content hash changes.

## OpenLoomi Recall Paths

OpenLoomi has three different read paths because they answer different
questions.

### 1. Raw Query with Summary Fallback

`MemoryQueryApi.queryWithFallback()` and
`POST /api/memory/raw-messages` support lifecycle-aware retrieval:

```text
query raw messages
  -> if too few raw hits remain
  -> query memory_summaries for remaining capacity
  -> merge by timestamp
  -> mark returned raw records as accessed
```

This path is useful for exact terms, filters, pagination, and continuity after
raw details have cooled. It is not the cross-source semantic endpoint.

### 2. Engine-Level Raw Semantic Recall

`MemoryQueryApi.semanticRecall()` retrieves `MemoryRecord` values using a
supplied query vector and optional:

- tier filters,
- time range,
- platform/channel/person/bot dimensions,
- similarity threshold.

The storage adapter uses a native semantic manager when available and otherwise
can calculate cosine similarity over bounded stored embeddings. Returned raw
records are marked as accessed so retrieval activity feeds future retention
scoring.

This is a shared engine API, not a public HTTP route.

### 3. Application-Level Unified Semantic Search

`POST /api/memory/search` calls `searchUnifiedMemory()`:

```text
authenticated query
  -> normalize sources, limit, threshold, and filters
  -> raw memory semantic search
  -> insight semantic search
  -> knowledge chunk semantic search
  -> normalize every hit to one result contract
  -> sort globally by similarity
  -> stable tie-break by source type and ID
  -> return top N
```

Result shape:

```ts
interface UnifiedMemorySearchResult {
  type: "memory" | "insight" | "knowledge";
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}
```

Every selected branch receives the requested limit, then the combined list is
trimmed to the global limit. The endpoint is semantic-only: it does not run the
legacy keyword query, lifecycle-summary fallback, or filesystem scans.

The model-facing MCP tool uses the same service under the name
`searchUnifiedMemory`, displayed as "Searching Semantic Memory" / "语义记忆搜索".
It defaults to all three sources and returns bounded content plus source,
similarity, ID, and selected metadata.

### Important Score Boundary

Each source currently creates its own query embedding inside its search branch.
Global sorting is meaningful when the three corpora use compatible embedding
models and similarity scales. The service does not yet generate one shared
query vector or calibrate scores produced by different models.

That is an operational contract, not decorative fine print. Comparing a
1024-dimensional Chinese embedding score with an unrelated model's score and
calling the larger number "more relevant" would be mathematics wearing a fake
ID badge.

## Why OpenLoomi Keeps Sources Isolated

Putting every vector into one physical collection would make the first demo
simple and the next six maintenance tasks exciting in all the wrong ways.

Isolation preserves:

- raw-message lifecycle transitions and archival,
- insight-specific structured fields and archive state,
- document/chunk deletion and document ownership,
- source-specific backend selection,
- source-specific re-embedding and repair,
- independent metadata schemas,
- clearer privacy and user-scope enforcement.

Unification happens at the request and result-contract layer instead:

```text
separate stores and indexes
  + shared authenticated query
  + normalized result shape
  + global ranking
  = unified recall without collapsing source ownership
```

All web routes derive `userId` from the authenticated session rather than
trusting caller-provided ownership.

## Other Systems in Brief

### OpenClaw

OpenClaw is file-first. Markdown memory is canonical, while SQLite FTS/vector
indexes are rebuildable search state. The model normally calls
`memory_search`, receives ranked snippets, and can use `memory_get` for bounded
reads. This is transparent and inspectable, but broader knowledge behavior
depends on the installed memory plugin and companion corpora.

### Hermes Agent

Hermes combines small curated files such as `MEMORY.md` and `USER.md`, SQLite
FTS5 session search, and optional external memory providers. Curated memory is
injected at session start; `session_search` returns real historical messages;
external providers can inject a fenced `<memory-context>` block. Its distinctive
strength is self-improvement through saved memories and generated/refined
skills.

### Claude Code

Claude Code uses hierarchical instruction files such as `CLAUDE.md`,
`.claude/rules/*.md`, and project-scoped auto-memory Markdown. Applicable
instructions and the auto-memory index enter context, while topic files are read
on demand. It is an inspectable file-and-context design rather than a native
vector/FTS memory database.

## Final Recall Comparison

| System       | Recall entry point                                                   | What reaches the model or caller                                                  | Selection model                                                       |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| OpenClaw     | `memory_search`, then optional `memory_get`.                         | Ranked snippets and bounded source-file excerpts.                                 | Hybrid vector/keyword ranking with optional recency and diversity.    |
| Hermes Agent | Prompt-injected curated memory, `session_search`, provider prefetch. | Curated facts, real transcript messages, or provider-managed context.             | Prompt inclusion, FTS5, or provider-defined ranking.                  |
| Claude Code  | Instruction loading and normal file reads.                           | Scoped instructions, auto-memory index content, and selected topic files.         | File hierarchy, path scope, and agent navigation.                     |
| OpenLoomi    | `/api/memory/search` or semantic-memory MCP tool.                    | Globally ranked raw-memory, insight, and knowledge evidence with source metadata. | Per-source semantic retrieval followed by one global similarity sort. |

## Persistence Across Restarts

| System       | Durable state                                                                                   | Rebuildable or session state                                                |
| ------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| OpenClaw     | Workspace Markdown and configured transcript sources.                                           | Search indexes and active prompt context.                                   |
| Hermes Agent | Curated memory files, session SQLite database, and generated skills.                            | Prompt snapshots and provider-prefetched turn context.                      |
| Claude Code  | Instruction and auto-memory Markdown files.                                                     | Loaded context and ordinary file-read state.                                |
| OpenLoomi    | Raw messages, summaries, insights, RAG rows, embedding metadata, and optional filesystem files. | Vector indexes can be repaired; login/insight session context is temporary. |

Persistence is not the same as recall. A fact can survive perfectly on disk and
still require a tool call, index, path match, or semantic query before the model
sees it. Storage is memory's passport; retrieval is the boarding pass.

## Tradeoffs

### OpenLoomi Strengths

- Native semantic retrieval across raw interactions, interpreted insights, and
  document knowledge.
- Explicit lifecycle management for raw memory instead of indefinite flat
  accumulation.
- Local Tauri path with local embeddings and sqlite-vec.
- Chroma and pgvector paths for alternative deployment shapes.
- Source metadata remains visible after cross-source ranking.
- Exact/structured tools remain available instead of forcing every query
  through vector search.

### OpenLoomi Costs

- Each corpus has its own indexing and repair path.
- Cross-source score comparison assumes compatible embedding models.
- Chroma, sqlite-vec, stored-vector, and pgvector behavior must remain
  observable and tested.
- Lifecycle summaries are not yet a branch of unified semantic search.
- Filesystem memory is not automatically indexed into the three-source
  endpoint.
- A missing embedding provider can prevent semantic branches from completing.

The architecture is more capable than a single notebook file, but it also has
more places to put the wrench. This is not a criticism; it is the maintenance
budget arriving on time.

## Claims and Caveats

- The product phrase "95% noise filtering" is not represented by one hard-coded
  memory constant. Current code implements filtering through insight
  processing, thresholds, lifecycle scoring, source filters, and ranking.
- "RAG support" here means a native document/chunk embedding and retrieval
  pipeline, not merely searching text files with embeddings.
- OpenLoomi does not claim that one backend is always active. Runtime,
  environment variables, extension availability, and fallback behavior decide
  the actual path.
- The comparison does not claim a latency or answer-accuracy winner. A fair
  benchmark needs the same corpus, queries, hardware, embedding model, context
  budget, and scoring method.
- External systems are summarized at architecture level. Their dedicated
  plugins, providers, experiments, and future releases may add behavior beyond
  the baseline described here.

## Sources

- [OpenClaw memory documentation](https://docs.openclaw.ai/concepts/memory)
- [Hermes Agent official repository](https://github.com/NousResearch/hermes-agent)
- [Claude Code memory documentation](https://code.claude.com/docs/en/memory)
- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [OpenLoomi memory-system architecture](/blogs/openloomi-memory-system)
- [OpenLoomi vector backend guide](https://github.com/melandlabs/openloomi/blob/main/docs/vector-backends.md)
- [OpenLoomi PR #154](https://github.com/melandlabs/openloomi/pull/154)
