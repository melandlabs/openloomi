---
title: "OpenClaw Memory System: File-First Agent Memory and Search"
date: 2026-05-28
description: A technical deep dive into OpenClaw memory, from Markdown source-of-truth files to plugin-backed search and recall.
image: /img/blogs/19.png
---

# OpenClaw Memory System

This document describes OpenClaw's memory implementation as it exists in code.
It focuses on durable Markdown memory, plugin registration, indexing, recall,
safe reads, compaction flushes, dreaming, and optional backend/plugin branches.

The short version:

- OpenClaw memory is file-first. Durable memory is ordinary Markdown in the
  agent workspace.
- `MEMORY.md` is canonical long-term memory.
- `memory/YYYY-MM-DD.md` and `memory/YYYY-MM-DD-<slug>.md` are working daily or
  topical memory.
- `DREAMS.md` and `memory/dreaming/**` are review artifacts, not the durable
  fact database.
- The default memory-slot plugin is `memory-core`.
- `memory-core` registers `memory_search`, `memory_get`, prompt guidance,
  pre-compaction flush behavior, runtime access, public artifacts, CLI commands,
  and optional dreaming.
- The builtin backend indexes files into SQLite tables for files, chunks, FTS,
  vector rows, and embedding cache.
- QMD can replace the builtin search backend, with builtin fallback.
- Companion plugins such as `memory-wiki` can add corpora without replacing the
  active memory slot.
- Active memory is a separate optional proactive recall plugin. It does not
  replace `memory_search`.

There is no hidden durable model state. The index is derived state and can be
rebuilt. If memory looks wrong, reindex before assuming the source files are
wrong.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Layer Map](#layer-map)
- [Data Flow](#data-flow)
- [Durable File Layout](#durable-file-layout)
- [Plugin Capability Registry](#plugin-capability-registry)
- [Prompt Bootstrap and Recall Guidance](#prompt-bootstrap-and-recall-guidance)
- [Memory Tools](#memory-tools)
- [Builtin Index Manager](#builtin-index-manager)
- [File Discovery and Chunking](#file-discovery-and-chunking)
- [SQLite Schema](#sqlite-schema)
- [Sync and Reindexing](#sync-and-reindexing)
- [Watcher Settling and Dirty State](#watcher-settling-and-dirty-state)
- [Embeddings](#embeddings)
- [Vector Search](#vector-search)
- [Keyword Search](#keyword-search)
- [Hybrid Ranking](#hybrid-ranking)
- [Session Memory Search](#session-memory-search)
- [Safe Reads](#safe-reads)
- [QMD Backend](#qmd-backend)
- [Companion and Alternative Memory Plugins](#companion-and-alternative-memory-plugins)
- [Pre-Compaction Memory Flush](#pre-compaction-memory-flush)
- [Dreaming and Promotion](#dreaming-and-promotion)
- [Public Artifacts](#public-artifacts)
- [Memory Host Event Journal](#memory-host-event-journal)
- [CLI, Status, and Doctor Surfaces](#cli-status-and-doctor-surfaces)
- [Configuration Map](#configuration-map)
- [Failure Modes](#failure-modes)
- [Maintenance Checklist](#maintenance-checklist)
- [Implementation References](#implementation-references)
- [One-Screen Architecture](#one-screen-architecture)
- [Practical Gotchas](#practical-gotchas)

## Core Concepts

OpenClaw has two different memory layers that should not be confused:

| Layer          | Durable? | Purpose                                                          |
| -------------- | -------- | ---------------------------------------------------------------- |
| Markdown files | Yes      | Human-readable source of truth for long-term and working memory. |
| Search index   | No       | SQLite/QMD derived state used for recall. Rebuildable.           |

Main memory files:

| File or directory             | Purpose                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `MEMORY.md`                   | Canonical long-term memory: durable preferences, facts, standing decisions, and behavior guidance. |
| `memory/YYYY-MM-DD.md`        | Daily working notes and session summaries.                                                         |
| `memory/YYYY-MM-DD-<slug>.md` | Topic/session-specific daily notes.                                                                |
| `DREAMS.md`                   | Human-readable dreaming diary and review output.                                                   |
| `memory/dreaming/**`          | Separate dreaming phase reports.                                                                   |
| `memory/.dreams/**`           | Machine-facing short-term recall and promotion state.                                              |

Important boundaries:

- `MEMORY.md` is the durable long-term database, even though it is stored as a
  plain Markdown file.
- `DREAMS.md` is review output. It should not become a source for promotion.
- `memory_search` searches indexed chunks; it does not read arbitrary files.
- `memory_get` reads bounded excerpts from allowed memory paths or configured
  extra Markdown paths.
- Companion corpora such as wiki are supplements, not replacements for the
  active memory backend.

## Layer Map

| Layer               | Main files                                                                                                        | Responsibility                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| User docs           | `docs/concepts/memory.md`, `docs/concepts/memory-search.md`, `docs/reference/memory-config.md`                    | User-facing model, providers, backends, search tuning, dreaming, and CLI.                          |
| Plugin entry        | `extensions/memory-core/index.ts`                                                                                 | Registers memory capability, lazy tools, CLI, command, embedding providers, and dreaming hooks.    |
| Tool entry points   | `extensions/memory-core/src/tools.ts`                                                                             | Implements `memory_search` and `memory_get`.                                                       |
| Shared tool helpers | `extensions/memory-core/src/tools.shared.ts`, `tools.citations.ts`                                                | Manager lookup, unavailable results, corpus supplements, citations, and injected character limits. |
| Prompt section      | `extensions/memory-core/src/prompt-section.ts`                                                                    | Adds "Memory Recall" guidance to the system prompt when tools exist.                               |
| Flush plan          | `extensions/memory-core/src/flush-plan.ts`                                                                        | Builds the pre-compaction memory flush turn.                                                       |
| Runtime bridge      | `extensions/memory-core/src/runtime-provider.ts`                                                                  | Exposes memory manager access to the host runtime.                                                 |
| Backend selector    | `extensions/memory-core/src/memory/search-manager.ts`                                                             | Chooses builtin vs QMD, caches managers, and applies fallback behavior.                            |
| Builtin manager     | `extensions/memory-core/src/memory/manager.ts`                                                                    | Public search, sync, status, read, probe, and close behavior.                                      |
| Sync layer          | `extensions/memory-core/src/memory/manager-sync-ops.ts`                                                           | Watchers, interval sync, session sync, vector readiness, safe reindex, dirty state.                |
| Watch settle        | `extensions/memory-core/src/memory/watch-settle.ts`                                                               | Debounces file watcher events until paths stop changing.                                           |
| Status state        | `extensions/memory-core/src/memory/manager-status-state.ts`, `manager-source-state.ts`                            | Aggregates source/file/chunk counts and resolves provider/search-mode status.                      |
| Embedding layer     | `extensions/memory-core/src/memory/manager-embedding-ops.ts`                                                      | Chunk embedding, cache use, batch fallback, vector/FTS writes.                                     |
| Search helpers      | `extensions/memory-core/src/memory/manager-search.ts`                                                             | sqlite-vec KNN, fallback cosine scan, FTS, LIKE fallback, lexical boosts.                          |
| Search preflight    | `extensions/memory-core/src/memory/manager-search-preflight.ts`                                                   | Trims empty queries and avoids provider initialization when no indexed content exists.             |
| Ranking             | `extensions/memory-core/src/memory/hybrid.ts`, `mmr.ts`, `temporal-decay.ts`                                      | BM25/vector merge, temporal decay, diversity rerank.                                               |
| Host SDK            | `packages/memory-host-sdk/src/host/*`                                                                             | File discovery, safe reads, schema, config resolution, session export, multimodal helpers.         |
| Host registry       | `src/plugins/memory-state.ts`, `memory-runtime.ts`, `registry.ts`                                                 | Active memory capability registry and slot enforcement.                                            |
| Agent prompt        | `src/agents/bootstrap-files.ts`, `src/agents/system-prompt.ts`                                                    | Loads bootstrap files and appends memory prompt sections.                                          |
| Dreaming            | `extensions/memory-core/src/dreaming*.ts`, `short-term-promotion.ts`                                              | Managed cron, phase sweeps, recall tracking, scoring, and promotion.                               |
| Promotion budget    | `extensions/memory-core/src/memory-budget.ts`                                                                     | Keeps auto-promoted `MEMORY.md` sections inside the bootstrap budget.                              |
| CLI/status          | `extensions/memory-core/src/cli.ts`, `cli.runtime.ts`, `src/gateway/server-methods/doctor.memory-core-runtime.ts` | Human and doctor surfaces for status, reindex, search, promote, REM harness, and repairs.          |
| Public artifacts    | `extensions/memory-core/src/public-artifacts.ts`, `src/plugin-sdk/memory-host-core.ts`                            | Exposes memory files and event logs to companion systems.                                          |

## Data Flow

### Startup and Registration

```text
plugin loader
  -> selected memory-slot plugin
  -> memory-core/register()
  -> register memory capability
  -> register lazy memory_search and memory_get
  -> register CLI and dreaming command
  -> prompt builder can add Memory Recall guidance
```

### Search

```text
model calls memory_search
  -> tools.ts parses query/maxResults/minScore/corpus
  -> get active memory manager
  -> builtin or QMD search
  -> filter session transcript visibility
  -> decorate citations if enabled
  -> optionally search corpus supplements such as wiki
  -> merge and balance results
  -> optionally record short-term recall signals
  -> JSON result
```

### Exact Read

```text
model calls memory_get
  -> tools.ts parses path/from/lines/corpus
  -> wiki supplement read, or active backend read
  -> readMemoryFile safety checks
  -> bounded excerpt with continuation metadata
```

### Builtin Indexing

```text
workspace memory files
  -> listMemoryFiles()
  -> buildFileEntry()
  -> chunkMarkdown() or buildMultimodalChunkForIndexing()
  -> embedding provider, if available
  -> files/chunks/chunks_fts/chunks_vec/embedding_cache
```

### Compaction Flush

```text
conversation approaches compaction
  -> resolveMemoryFlushPlan()
  -> embedded memory flush agent turn
  -> write tool restricted to memory/YYYY-MM-DD.md
  -> append durable notes or silent reply token
```

### Dreaming Promotion

```text
memory_search recall results
  -> short-term recall store
  -> managed dreaming cron/heartbeat trigger
  -> light/REM/deep phase sweep
  -> rank promotion candidates
  -> append qualified entries to MEMORY.md
  -> write review output to DREAMS.md or memory/dreaming
```

## Durable File Layout

The workspace is resolved through config helpers such as
`resolveAgentWorkspaceDir()`. Public docs describe the default as:

```text
~/.openclaw/workspace
```

Code should not hardcode that path.

Typical layout:

```text
<workspace>/
  MEMORY.md
  DREAMS.md
  memory/
    2026-05-25.md
    2026-05-25-project-slug.md
    dreaming/
      deep/
        2026-05-25.md
    .dreams/
      short-term-recall.json
      phase-signals.json
      short-term-promotion.lock
```

### `MEMORY.md`

`MEMORY.md` is the canonical long-term memory file. Uppercase is intentional.
Lowercase `memory.md` is treated as legacy or auxiliary in several root-memory
paths.

Relevant files:

- `src/memory/root-memory-files.ts`
- `packages/memory-host-sdk/src/host/openclaw-runtime-memory.ts`
- `packages/memory-host-sdk/src/host/internal.ts`

### `memory/*.md`

Daily and topical notes are indexed for recall but are not always injected into
the prompt. The pre-compaction memory flush writes the date-only form
`memory/YYYY-MM-DD.md` and explicitly avoids timestamped variants.

### `DREAMS.md`

`DREAMS.md` is a review diary. Dreaming output can also go under
`memory/dreaming/<phase>/YYYY-MM-DD.md`. The code has filters that prevent
dreaming narrative and promotion metadata from promoting themselves back into
`MEMORY.md`; otherwise memory may recursively include its own bookkeeping
output.

## Plugin Capability Registry

The active memory slot is managed through `src/plugins/memory-state.ts`,
`src/plugins/memory-runtime.ts`, and `src/plugins/registry.ts`.

`memory-core` registers one primary memory capability:

| Capability field                | Registered value                |
| ------------------------------- | ------------------------------- |
| `promptBuilder`                 | `buildPromptSection`            |
| `flushPlanResolver`             | `buildMemoryFlushPlan`          |
| `runtime`                       | `memoryRuntime`                 |
| `publicArtifacts.listArtifacts` | `listMemoryCorePublicArtifacts` |

It also registers:

- builtin embedding providers through `registerBuiltInMemoryEmbeddingProviders`
- dreaming hooks through `registerShortTermPromotionDreaming`
- lazy `memory_search`
- lazy `memory_get`
- `/dreaming` command
- `openclaw memory` CLI group

`memory-state.ts` stores:

| Registry item             | Meaning                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| primary memory capability | The selected memory plugin's prompt, flush, runtime, and artifacts.    |
| corpus supplements        | Extra corpora searched by `memory_search corpus=wiki` or `corpus=all`. |
| prompt supplements        | Extra prompt guidance appended after the primary memory section.       |

`registerMemoryCapability()` has a subtle merge rule: if an existing primary
capability exists and a new registration only contributes `publicArtifacts`, the
existing runtime/prompt/flush fields are preserved. This lets companion plugins
publish artifacts without overriding the active memory runtime.

`registry.ts` enforces that only memory-kind plugins can register primary memory
features. Dual-kind plugins must actually be selected for the memory slot before
their primary capability is accepted.

## Prompt Bootstrap and Recall Guidance

Memory reaches the model through two routes:

| Route             | Source                                                         | Behavior                                                                                 |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Bootstrap context | `src/agents/bootstrap-files.ts`, `src/agents/system-prompt.ts` | Selected workspace files such as `MEMORY.md` can be loaded directly into prompt context. |
| Tool recall       | `memory_search`, `memory_get`                                  | The model searches and reads indexed memory during a turn.                               |

When `MEMORY.md` is loaded as project context, `system-prompt.ts` labels it as:

```text
MEMORY.md: durable user preferences and behavior guidance.
```

`extensions/memory-core/src/prompt-section.ts` adds guidance telling the agent to
search memory before answering questions about prior work, decisions, dates,
people, preferences, or todos, and to use `memory_get` when exact lines matter.

## Memory Tools

### `memory_search`

Schema is registered in `extensions/memory-core/index.ts` and implemented in
`extensions/memory-core/src/tools.ts`.

Parameters:

| Parameter    | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `query`      | Required search text.                                         |
| `maxResults` | Optional result cap. Defaults come from memory search config. |
| `minScore`   | Optional score floor.                                         |
| `corpus`     | Optional `memory`, `sessions`, `wiki`, or `all`.              |

Corpus behavior:

| Corpus        | Search scope                                                                        |
| ------------- | ----------------------------------------------------------------------------------- |
| unset/default | Active backend sources. Usually memory files; can include sessions when configured. |
| `memory`      | Durable memory file chunks only.                                                    |
| `sessions`    | Indexed session transcript chunks only, with visibility filtering.                  |
| `wiki`        | Registered wiki/corpus supplements only.                                            |
| `all`         | Memory plus supplements, with balancing because scores are not comparable.          |

Returned JSON can include:

- `results`
- `provider`
- `model`
- `fallback`
- `citations`
- `mode`
- `debug`

If memory is unavailable, the tool returns a disabled/unavailable JSON shape
instead of exposing raw runtime failures directly to the model.

### `memory_get`

Parameters:

| Parameter | Meaning                                    |
| --------- | ------------------------------------------ |
| `path`    | Required memory path or supplement lookup. |
| `from`    | Optional 1-indexed start line.             |
| `lines`   | Optional line count.                       |
| `corpus`  | Optional `memory`, `wiki`, or `all`.       |

For builtin backend reads, `memory_get` calls `readAgentMemoryFile()`, which
uses `readMemoryFile()` in the host SDK. Non-builtin backends can implement
their own `manager.readFile()`.

## Builtin Index Manager

The builtin backend is implemented by `MemoryIndexManager` in:

```text
extensions/memory-core/src/memory/manager.ts
```

It extends:

```text
MemoryManagerEmbeddingOps
  -> MemoryManagerSyncOps
```

Responsibilities:

| Class/file                 | Responsibility                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `manager.ts`               | Search, sync orchestration, status, read, probes, lifecycle close, manager cache.                |
| `manager-sync-ops.ts`      | Database open/schema, watchers, dirty flags, vector table readiness, safe reindex, session sync. |
| `manager-embedding-ops.ts` | Chunk embedding, embedding cache, batch fallback, FTS/vector/chunk writes.                       |

The manager cache key includes agent id, workspace path, resolved settings, and
purpose (`default`, `status`, or `cli`). Status and CLI managers are transient
so health checks do not accidentally shut down the live manager.

## File Discovery and Chunking

File discovery lives in:

```text
packages/memory-host-sdk/src/host/internal.ts
```

`listMemoryFiles()` collects:

- canonical `MEMORY.md`
- files under `memory/`
- configured `extraPaths`

It skips:

- symlinks
- root-memory repair artifacts
- legacy lowercase root memory in workspace paths
- non-Markdown files unless multimodal indexing is enabled and the file matches
  allowed modality settings

`buildFileEntry()` records:

| Field                              | Meaning                                |
| ---------------------------------- | -------------------------------------- |
| `path`                             | Workspace-relative normalized path.    |
| `absPath`                          | Absolute file path.                    |
| `mtimeMs`, `size`                  | Change detection signals.              |
| `hash`                             | Content or structured multimodal hash. |
| `kind`                             | `markdown` or `multimodal`.            |
| `dataHash`, `mimeType`, `modality` | Multimodal metadata when applicable.   |

`chunkMarkdown()` splits content using token-budget estimates and overlap.
Defaults are documented around:

| Setting    | Default          |
| ---------- | ---------------- |
| chunk size | about 400 tokens |
| overlap    | about 80 tokens  |

Long lines are split. There is a second pass for CJK-heavy text so token
estimates remain reliable.

Session transcript chunks use `remapChunkLines()` because session JSONL is
flattened into text before chunking; search results should still point back to
original JSONL lines.

## SQLite Schema

`ensureMemoryIndexSchema()` in
`packages/memory-host-sdk/src/host/memory-schema.ts` creates:

| Table             | Purpose                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `meta`            | Key/value metadata for index state.                                                 |
| `files`           | One row per indexed source file.                                                    |
| `chunks`          | Chunk text, line spans, source, model, JSON embedding fallback, hash, updated time. |
| `embedding_cache` | Provider/model/provider key/hash to embedding cache, when cache is enabled.         |
| `chunks_fts`      | FTS5 virtual table when hybrid/FTS is enabled.                                      |
| `chunks_vec`      | sqlite-vec virtual table created lazily when vector search is available.            |

Important columns:

| Column      | Tables                          | Meaning                        |
| ----------- | ------------------------------- | ------------------------------ |
| `source`    | `files`, `chunks`, `chunks_fts` | `memory` or `sessions`.        |
| `model`     | `chunks`, `chunks_fts`          | Embedding model or `fts-only`. |
| `embedding` | `chunks`                        | JSON fallback vector storage.  |

Indexes:

- `idx_chunks_path`
- `idx_chunks_source`
- `idx_embedding_cache_updated_at`

`meta` stores `memory_index_meta_v1`, including provider/model/provider key,
configured sources, scope hash, chunking, FTS tokenizer, and vector dimensions.
Provider, chunking, tokenizer, scope, or source changes can trigger a full
reindex.

## Sync and Reindexing

Sync can run because of:

- initial search bootstrap when no indexed content exists
- `sync.onSearch`
- `sync.onSessionStart`
- file watcher events
- interval sync
- targeted session transcript updates
- CLI reindex
- provider/model/chunking/scope changes

`manager-sync-ops.ts` uses chokidar and ignores noisy directories such as:

- `.git`
- `node_modules`
- `.pnpm-store`
- `.venv`
- `venv`
- `.tox`
- `__pycache__`

Full reindex is normally safe/atomic:

```text
current index
  -> temporary sqlite database
  -> seed embedding cache
  -> rebuild files/chunks/FTS/vector rows
  -> write meta
  -> atomic replacement
```

Test-only unsafe reindex can be enabled through environment flags, but normal
runtime uses the safe path. Read-only database errors have recovery paths that
reopen/rebuild state before retrying.

## Watcher Settling and Dirty State

File watcher changes are not applied immediately. `manager-sync-ops.ts` records
paths into a settle queue through `recordMemoryWatchEventPath()`, then
`settleMemoryWatchEventPaths()` rechecks size and mtime before sync proceeds.

Why this exists:

- editors often write Markdown through temporary files or multi-step saves
- session JSONL files can still be growing when a watcher event fires
- indexing a half-written file creates invalid chunks that can appear as
  memory corruption later

Settle behavior:

| Case                              | Behavior                            |
| --------------------------------- | ----------------------------------- |
| Empty path                        | Ignored.                            |
| Directory event                   | Stored as a null snapshot.          |
| File event with stats             | Stores size and `mtimeMs`.          |
| Missing baseline but file appears | Rechecks after 100 ms.              |
| Snapshot changes on recheck       | Path remains queued and sync waits. |
| Queue drains                      | Sync can proceed.                   |

Dirty state is then consumed by normal sync triggers: on-search sync,
interval sync, watcher sync, session-start sync, targeted session updates, and
CLI reindex. Status-only managers start dirty only when memory files exist but
indexed metadata is missing, while normal managers are willing to sync more
eagerly.

`manager-source-state.ts` loads existing file hashes by source so unchanged
files can be skipped. That source separation is important because `memory` and
`sessions` share physical tables but have different discovery and visibility
rules.

## Embeddings

Embedding provider creation lives under:

```text
extensions/memory-core/src/memory/embeddings.ts
extensions/memory-core/src/memory/provider-adapters.ts
```

Supported provider IDs in public docs include:

| Provider       | ID               |
| -------------- | ---------------- |
| Bedrock        | `bedrock`        |
| DeepInfra      | `deepinfra`      |
| Gemini         | `gemini`         |
| GitHub Copilot | `github-copilot` |
| Local GGUF     | `local`          |
| Mistral        | `mistral`        |
| Ollama         | `ollama`         |
| OpenAI         | `openai`         |
| Voyage         | `voyage`         |

Auto-detection order:

1. `local`, only when `memorySearch.local.modelPath` is configured and exists.
2. `github-copilot`
3. `openai`
4. `gemini`
5. `voyage`
6. `mistral`
7. `deepinfra`
8. `bedrock`

`ollama` is supported but must be configured explicitly.

Important behavior:

- No provider means FTS-only mode, not a total memory failure.
- Provider key data participates in embedding cache identity.
- Batch embedding is supported when provider runtime exposes `batchEmbed`.
- Batch failures fall back to inline embedding and can disable batch after
  repeated failures.
- Retry policy handles retryable embedding errors.
- Local/self-hosted providers get longer inline timeouts.
- Ollama defaults to lower non-batch concurrency.
- Multimodal chunks require a provider with structured input support.

Embedding cache table identity:

```text
provider + model + provider_key + chunk_hash
```

## Vector Search

Vector search helper:

```text
extensions/memory-core/src/memory/manager-search.ts
```

If sqlite-vec is available, OpenClaw uses native KNN:

```text
embedding MATCH ? AND k = ?
```

It still computes cosine distance in the select path so downstream scores remain
cosine-like.

If sqlite-vec is unavailable, it falls back to scanning JSON embeddings from
`chunks` in bounded batches and computing cosine similarity in process. The
bounded batch size prevents large indexes from blocking the event loop for long
periods.

## Keyword Search

Keyword search uses `chunks_fts` when FTS is available.

`buildFtsQuery()` tokenizes by letters, numbers, and `_`, quotes each token, and
joins them with `AND`.

Scoring:

| Path                     | Scoring                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| FTS MATCH                | BM25 mapped with `bm25RankToScore()`.                                   |
| MATCH failure            | Falls back to LIKE-based substring conditions.                          |
| FTS-only boosted ranking | Adds path match, token overlap, density, and useful text length boosts. |

When the tokenizer is `trigram`, short CJK tokens are handled with substring
fallback because trigram FTS is unreliable for very short tokens.

## Hybrid Ranking

Hybrid merge logic lives in:

```text
extensions/memory-core/src/memory/hybrid.ts
```

Search flow:

```text
if no provider:
  FTS keyword search only
else:
  keyword search if FTS is available
  embed query
  vector search
  if hybrid enabled:
    merge vector and keyword results
  else:
    vector results only
```

Default public config:

| Setting                                   | Default |
| ----------------------------------------- | ------- |
| `query.hybrid.enabled`                    | `true`  |
| `query.hybrid.vectorWeight`               | `0.7`   |
| `query.hybrid.textWeight`                 | `0.3`   |
| `query.hybrid.candidateMultiplier`        | `4`     |
| `query.hybrid.mmr.enabled`                | `false` |
| `query.hybrid.mmr.lambda`                 | `0.7`   |
| `query.hybrid.temporalDecay.enabled`      | `false` |
| `query.hybrid.temporalDecay.halfLifeDays` | `30`    |

Combined score:

```text
vectorWeight * vectorScore + textWeight * textScore
```

Optional reranking:

- temporal decay in `temporal-decay.ts`
- MMR diversity in `mmr.ts`

If strict hybrid scoring drops everything but keyword results exist, the manager
relaxes the score floor for keyword-backed matches. This keeps exact lexical
recall alive when vector weighting gets too fancy for its own good.

## Session Memory Search

Session memory is experimental and opt-in.

Relevant files:

- `packages/memory-host-sdk/src/host/session-files.ts`
- `extensions/memory-core/src/memory/manager-session-sync-state.ts`
- `extensions/memory-core/src/memory/manager-targeted-sync.ts`
- `extensions/memory-core/src/session-search-visibility.ts`

Config surfaces:

| Setting                       | Meaning                                            |
| ----------------------------- | -------------------------------------------------- |
| `experimental.sessionMemory`  | Enables transcript indexing.                       |
| `sources`                     | Add `"sessions"` to include session source.        |
| `sync.sessions.deltaBytes`    | Byte threshold for incremental session reindex.    |
| `sync.sessions.deltaMessages` | Message threshold for incremental session reindex. |

Session transcript export:

- converts JSONL transcripts into sanitized plain text
- strips internal runtime context and metadata
- skips compaction checkpoints and non-usage-counted archive artifacts
- preserves usage-counted reset/deleted archives
- wraps very long messages
- maps flattened content lines back to original JSONL lines
- classifies dreaming narrative and cron-run transcripts

Search visibility filtering is applied after retrieval. The index may contain
session chunks, but `filterMemorySearchHitsBySessionVisibility()` decides what
the current requester may see.

## Safe Reads

Safe read implementation:

```text
packages/memory-host-sdk/src/host/read-file.ts
```

`readMemoryFile()` allows:

| Path class                 | Rule                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| workspace memory paths     | Must satisfy `isMemoryPath()`: `MEMORY.md`, `DREAMS.md`, or `memory/**`. |
| configured extra file      | Must be the exact configured Markdown file.                              |
| configured extra directory | Target must be inside the directory, with symlink containment checks.    |

Other rules:

- path is required
- result must be Markdown
- workspace reads are resolved through root safety helpers
- missing files return empty text instead of crashing
- output is bounded by line and character limits

`memory_get` is therefore not an arbitrary filesystem read with a memory sticker
on the laptop.

## QMD Backend

QMD is selected with:

```text
memory.backend = "qmd"
```

Relevant files:

- `packages/memory-host-sdk/src/host/backend-config.ts`
- `extensions/memory-core/src/memory/search-manager.ts`
- `extensions/memory-core/src/memory/qmd-manager.ts`
- `packages/memory-host-sdk/src/host/qmd-*`

QMD is a sidecar search engine. OpenClaw manages collections and invokes QMD
subprocesses for updates, embeddings, and search.

Selector behavior in `search-manager.ts`:

1. Resolve backend config.
2. Check workspace availability.
3. Check QMD binary availability.
4. Create or reuse a cached QMD manager.
5. Wrap full QMD managers in `FallbackMemoryManager`.
6. Use transient QMD managers for CLI/status.
7. Use `BorrowedMemoryManager` for status against cached live managers so a
   health probe does not close active search.
8. Fall back to builtin if QMD is unavailable.

Failure behavior:

| Failure                   | Behavior                                                        |
| ------------------------- | --------------------------------------------------------------- |
| QMD binary missing        | Use builtin backend.                                            |
| QMD workspace unavailable | Use builtin backend.                                            |
| QMD open fails            | Record a 60 second cooldown to avoid retry storms.              |
| QMD search fails later    | Close primary, evict cache, switch wrapper to builtin fallback. |

QMD adds local-first BM25/vector search, query expansion, reranking, extra
configured paths, and optional session transcript collections.

## Companion and Alternative Memory Plugins

Only one plugin owns the active memory slot at a time, but companion plugins can
add corpora, prompt supplements, artifacts, or separate tools.

| Plugin           | Role                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-core`    | Default file-backed memory slot plugin.                                                                                               |
| `memory-lancedb` | Alternative memory slot plugin backed by LanceDB; supports embeddings, auto-recall, auto-capture, and `memory_recall` style behavior. |
| `memory-wiki`    | Companion plugin that compiles durable memory into a wiki vault with claims, provenance, pages, dashboards, and wiki tools.           |
| `active-memory`  | Optional proactive recall plugin using a blocking sub-agent before prompt build.                                                      |
| Honcho memory    | Plugin install path documented in `docs/concepts/memory-honcho.md`; AI-native cross-session memory, not the builtin file index.       |

### Memory Wiki

`memory-wiki` does not replace the memory slot. It registers supplement corpora
so `memory_search corpus=wiki` or `corpus=all` can search wiki output alongside
active memory results.

### Active Memory

`extensions/active-memory/` registers a `/active-memory` command and a
`before_prompt_build` hook. It checks session toggles, target agent, interactive
session eligibility, chat type, and allow/deny rules. Then it starts an embedded
agent with lightweight bootstrap context and memory-only tools.

Defaults:

| Active memory slot | Tools                             |
| ------------------ | --------------------------------- |
| `memory-core`      | `memory_search` plus `memory_get` |
| `memory-lancedb`   | `memory_recall`                   |

The summary is injected as untrusted hidden `<active_memory_plugin>` context.
It is proactive recall, not a new durable store.

## Pre-Compaction Memory Flush

Relevant files:

- `extensions/memory-core/src/flush-plan.ts`
- `src/auto-reply/reply/agent-runner-memory.ts`
- `src/agents/pi-embedded-runner/run/attempt.tool-run-context.ts`

`memory-core` registers `buildMemoryFlushPlan()` as the memory flush plan
resolver.

Defaults:

| Setting                    | Default                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| enabled                    | enabled unless `agents.defaults.compaction.memoryFlush.enabled === false` |
| soft threshold             | `4000` tokens                                                             |
| force transcript threshold | `2 MiB`                                                                   |
| reserve tokens floor       | `DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR`                              |
| target file                | `memory/YYYY-MM-DD.md`                                                    |
| date timezone              | resolved user timezone                                                    |

Safety hints are enforced even when prompts are customized:

- store durable memories only in `memory/YYYY-MM-DD.md`
- append only
- do not overwrite bootstrap/reference files such as `MEMORY.md`, `DREAMS.md`,
  `SOUL.md`, `TOOLS.md`, and `AGENTS.md`
- do not create timestamped variants
- reply with the silent token when nothing durable should be stored

The model can be overridden with:

```text
agents.defaults.compaction.memoryFlush.model
```

When the flush runs, the embedded agent receives `memoryFlushWritePath`; the
write wrapper restricts writes to that one target and append behavior.

## Dreaming and Promotion

Dreaming is opt-in and disabled by default.

Relevant files:

- `extensions/memory-core/src/dreaming.ts`
- `extensions/memory-core/src/dreaming-phases.ts`
- `extensions/memory-core/src/dreaming-narrative.ts`
- `extensions/memory-core/src/short-term-promotion.ts`
- `extensions/memory-core/src/dreaming-markdown.ts`
- `docs/concepts/dreaming.md`

Dreaming has two related systems:

| System                  | Purpose                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Short-term recall store | Records which daily-note snippets are repeatedly recalled.                                  |
| Managed dreaming sweep  | Runs phase review, ranks candidates, promotes durable snippets, writes diary/report output. |

### Short-Term Recall Store

Files:

```text
memory/.dreams/short-term-recall.json
memory/.dreams/phase-signals.json
memory/.dreams/short-term-promotion.lock
```

Recall entries track:

- path and line span
- source
- snippet
- recall count
- daily count
- grounded count
- total and max score
- first and last recall timestamps
- query hashes
- recall days
- concept tags
- optional claim hash
- promotion timestamp

`memory_search` records recall signals when dreaming is enabled. Only memory
source hits from short-term memory paths participate. Dreaming artifacts are
filtered to avoid self-promotion loops.

### Promotion Scoring

Default gates:

| Gate                                     | Default   |
| ---------------------------------------- | --------- |
| minimum score                            | `0.75`    |
| minimum signal count                     | `3`       |
| minimum unique queries/context diversity | `2`       |
| recency half-life                        | `14` days |

Default weights:

| Component           | Weight |
| ------------------- | ------ |
| frequency           | `0.24` |
| relevance           | `0.30` |
| diversity           | `0.15` |
| recency             | `0.15` |
| consolidation       | `0.10` |
| conceptual richness | `0.06` |

Score:

```text
weighted components + phase signal boost
```

Phase signal boosts:

- light phase max boost: `0.06`
- REM phase max boost: `0.09`
- phase signal half-life: `14` days

Promotion applies only after candidates are rehydrated from source files. If the
line range moved, the code tries to relocate the snippet. If it lands inside a
dreaming fence or looks contaminated by dreaming narrative, promotion is refused.

Deep promotion appends a "Promoted From Short-Term Memory" section to
`MEMORY.md` with source and score metadata. If the file would exceed its budget,
older auto-promotion sections can be compacted out before writing.

### `MEMORY.md` Promotion Budget

`extensions/memory-core/src/memory-budget.ts` keeps automatic promotion from
silently pushing `MEMORY.md` past the bootstrap injection cap.

Default budget:

```text
DEFAULT_MEMORY_FILE_MAX_CHARS = 10000
```

The compactor only drops sections matching
`## Promoted From Short-Term Memory (DATE)`.

Guarantees:

- user-authored memory content is preserved
- non-matching headings are preserved
- auto-promotion sections are dropped oldest first
- the freshest new section is still written even if the final file cannot be
  made perfect
- a small writer-overhead reserve is subtracted so the final on-disk file stays
  within the caller's intended budget

This is intentionally narrow. It trims the machine-owned growth ring, not the
user's hand-written long-term memory. Tiny scalpel, not chainsaw.

### Managed Cron

`registerShortTermPromotionDreaming()` reconciles a managed cron job:

- creates or updates the unified dreaming job when enabled
- removes duplicate managed jobs
- migrates legacy light/REM jobs
- retries cron resolution after startup if the cron service is not ready yet
- handles heartbeat or cron triggers that include the managed dreaming token

The sweep can write phase reports and generate dream diary narrative through a
subagent. Cron-triggered narratives may run detached so maintenance does not
block the whole house. Sensible. Very adult.

## Public Artifacts

`memory-core` exposes public artifacts through:

```text
extensions/memory-core/src/public-artifacts.ts
src/plugin-sdk/memory-host-core.ts
```

`listMemoryHostPublicArtifacts()` walks resolved memory workspaces and emits:

| Kind           | Path                              |
| -------------- | --------------------------------- |
| `memory-root`  | `MEMORY.md`                       |
| `daily-note`   | Markdown under `memory/`          |
| `dream-report` | Markdown under `memory/dreaming/` |
| `event-log`    | Memory host event log JSON        |

`listActiveMemoryPublicArtifacts()` clones and sorts artifacts by workspace,
relative path, kind, content type, agent ids, and absolute path. Companion
systems such as `memory-wiki` depend on this boundary, so artifact shape changes
should be treated as API changes, not as small internal cleanups.

## Memory Host Event Journal

Memory host events are stored as JSONL under:

```text
memory/.dreams/events.jsonl
```

Implementation:

- `src/memory-host-sdk/events.ts`
- `extensions/memory-core/src/short-term-promotion.ts`
- `extensions/memory-core/src/dreaming-markdown.ts`

Event types:

| Event                      | Written by                      | Meaning                                                      |
| -------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `memory.recall.recorded`   | Short-term recall tracking      | A `memory_search` result was recorded for promotion scoring. |
| `memory.promotion.applied` | Short-term promotion apply path | One or more candidates were processed into `MEMORY.md`.      |
| `memory.dream.completed`   | Dreaming markdown writer        | A light/REM/deep phase wrote inline and/or report output.    |

`appendMemoryHostEvent()` writes through a regular-file append helper with
symlink-parent rejection. `readMemoryHostEvents()` tolerates missing logs and
skips malformed lines. The event log is also exposed as a public artifact of
kind `event-log`, so companion systems can consume it without poking private
runtime state.

The event journal is diagnostic and integration-facing. It is not searched as
durable memory and should not become a promotion source.

## CLI, Status, and Doctor Surfaces

The memory CLI is registered by `extensions/memory-core/src/cli.ts` and executed
by `cli.runtime.ts`.

Commands:

| Command                                      | Purpose                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `openclaw memory status`                     | Show backend, provider, source, dirty, vector, and dreaming status.                               |
| `openclaw memory status --deep`              | Probe embedding provider and vector readiness.                                                    |
| `openclaw memory status --index`             | Reindex if dirty while collecting deep status.                                                    |
| `openclaw memory status --fix`               | Repair stale recall locks and normalize/repair dreaming artifacts.                                |
| `openclaw memory index --force`              | Force a full reindex.                                                                             |
| `openclaw memory search "query"`             | Search from the CLI, optionally JSON-formatted.                                                   |
| `openclaw memory promote`                    | Rank short-term recall candidates; `--apply` appends qualified entries.                           |
| `openclaw memory promote-explain <selector>` | Explain one candidate's score and threshold pass/fail state.                                      |
| `openclaw memory rem-harness`                | Preview REM reflections, candidate truths, and deep promotion output without writing.             |
| `openclaw memory rem-backfill`               | Write grounded historical REM summaries into `DREAMS.md`; optionally stage short-term candidates. |

Status aggregation uses:

- `manager.status()`
- `collectMemoryStatusAggregate()`
- `resolveStatusProviderInfo()`
- vector readiness from manager status and optional probes
- dreaming audit and repair helpers

Deep status can show whether the embedding provider is ready, whether semantic
vectors are available, whether the sqlite-vec store loaded, per-source file and
chunk counts, dreaming configuration, and repairable artifact issues.

Doctor integration in `src/gateway/server-methods/doctor.memory-core-runtime.ts`
reuses bundled memory-core runtime helpers rather than reimplementing repairs.
That means CLI and doctor repairs should stay behaviorally aligned; if one
reports a healthy memory pipeline and the other reports errors, the issue may
be outside the shared repair logic.

## Configuration Map

Most builtin search settings live under:

```text
agents.defaults.memorySearch
```

Agent-specific overrides can live under:

```text
agents.list[].memorySearch
```

Backend selection:

```text
memory.backend
memory.qmd
```

Dreaming:

```text
plugins.entries.memory-core.config.dreaming
```

Active memory:

```text
plugins.entries.active-memory.config
```

Important config areas:

| Area                    | Examples                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| provider selection      | `provider`, `model`, `fallback`, `enabled`                                |
| provider auth/endpoints | `remote.baseUrl`, `remote.apiKey`, `remote.headers`                       |
| provider-specific input | `inputType`, `queryInputType`, `documentInputType`, output dimensionality |
| query ranking           | `query.minScore`, `query.maxResults`, `query.hybrid.*`                    |
| chunking                | `chunking.tokens`, `chunking.overlap`                                     |
| extra files             | `extraPaths`                                                              |
| multimodal              | `multimodal.enabled`, `modalities`, `maxFileBytes`                        |
| embedding cache         | `cache.enabled`, `cache.maxEntries`                                       |
| batch indexing          | `remote.batch.*`, `remote.nonBatchConcurrency`                            |
| session memory          | `experimental.sessionMemory`, `sources`, `sync.sessions.*`                |
| SQLite                  | `store.path`, `store.vector.*`, `store.fts.tokenizer`                     |
| QMD                     | `memory.qmd.command`, `searchMode`, paths, sessions, update behavior      |

The full key list is in:

```text
docs/reference/memory-config.md
```

## Failure Modes

| Area                                       | Failure mode                                                                                           | Expected behavior |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------- |
| No memory config                           | Memory tools are not registered or manager is null.                                                    |
| Memory manager unavailable                 | Tool returns disabled/unavailable JSON.                                                                |
| First search after restart                 | Builtin manager forces synchronous bootstrap sync if index is empty.                                   |
| Empty search query                         | Search preflight refuses provider initialization and returns no hits.                                  |
| Watch event during active write            | Settle queue waits until size/mtime stops changing before sync.                                        |
| No embedding provider                      | Builtin search degrades to FTS-only mode.                                                              |
| FTS unavailable                            | Hybrid loses keyword path; vector-only can still work if provider exists.                              |
| sqlite-vec unavailable                     | Vector search falls back to bounded in-process cosine scan.                                            |
| Embedding batch failure                    | Batch falls back to inline embeddings and may disable batch after repeated failures.                   |
| Provider/model/chunking/scope changes      | Full reindex is triggered.                                                                             |
| Read-only database                         | Manager runs readonly recovery and can reopen/rebuild.                                                 |
| QMD binary/workspace unavailable           | Backend falls back to builtin.                                                                         |
| QMD open failure                           | Short cooldown avoids retry storms.                                                                    |
| QMD runtime failure                        | Wrapper closes QMD, evicts cache, and switches to builtin fallback.                                    |
| Session visibility mismatch                | Session hits are filtered after retrieval.                                                             |
| Unsafe read path                           | `memory_get` returns an error instead of reading arbitrary files.                                      |
| Missing memory file                        | Safe read returns empty text for the allowed path.                                                     |
| Dreaming contaminated snippet              | Candidate is skipped or refused during rehydration.                                                    |
| Stale short-term lock                      | Audit/repair can remove it when safe.                                                                  |
| Auto-promotion grows `MEMORY.md` too large | Oldest machine-owned promotion sections are dropped within budget; user-authored content is preserved. |
| Malformed event journal line               | Event reader skips the bad line and continues.                                                         |

Useful investigation commands:

```bash
openclaw memory status --deep --agent main
openclaw memory status --fix --agent main
openclaw memory index --force --agent main
openclaw memory search "query"
openclaw memory promote
openclaw memory promote --apply
openclaw memory promote-explain "query"
openclaw memory rem-harness --json
openclaw memory rem-backfill --path ./memory --stage-short-term
```

## Maintenance Checklist

When changing this system:

- If durable memory layout changes, update file discovery, safe reads, public
  artifacts, docs, and companion plugin assumptions.
- If `MEMORY.md` canonical handling changes, audit root memory bootstrap,
  `listMemoryFiles()`, and `isMemoryPath()`.
- If `memory_search` result shape changes, update tool docs, active memory,
  wiki supplements, citation decoration, and recall tracking.
- If `memory_get` safety changes, audit symlink and containment tests.
- If chunking changes, update reindex meta logic and tests that assert line
  spans.
- If watcher behavior changes, update settle-queue logic and dirty-state tests
  so half-written files are not indexed.
- If schema changes, update `ensureMemoryIndexSchema()`, status aggregation,
  migration/compat paths, and reindex behavior.
- If provider identity changes, update embedding cache key logic and force
  reindex rules.
- If hybrid weights or scoring change, update `hybrid.ts`, `manager.ts`, and
  search quality tests.
- If session memory changes, update transcript export, visibility filtering,
  targeted sync, and source filtering.
- If QMD integration changes, check fallback behavior, status/CLI transient
  managers, cooldown logic, and active-memory search mode overrides.
- If dreaming promotion changes, update recall store normalization, scoring
  docs, contamination filters, audit/repair, and `MEMORY.md` budget behavior.
- If promotion section headings change, update `memory-budget.ts` so compaction
  still trims only machine-owned sections.
- If CLI/status output changes, update `cli.runtime.ts`, doctor surfaces, and
  public CLI docs.
- If memory host event types change, update event readers, public artifacts,
  and companion consumers.
- If public artifact kinds change, treat it as a plugin-facing API change.

Useful tests:

- `extensions/memory-core/src/memory/manager*.test.ts`
- `extensions/memory-core/src/tools*.test.ts`
- `extensions/memory-core/src/memory-events.test.ts`
- `extensions/memory-core/src/memory-budget.test.ts`
- `extensions/memory-core/src/memory/watch-settle.test.ts`
- `extensions/memory-core/src/memory/manager-status-state.test.ts`
- `extensions/memory-core/src/memory/manager-source-state.test.ts`
- `extensions/memory-core/src/memory/manager-search-preflight.test.ts`
- `extensions/memory-core/src/dreaming*.test.ts`
- `extensions/memory-core/src/short-term-promotion*.test.ts`
- `src/plugins/memory-state.test.ts`
- `src/plugins/memory-runtime.test.ts`
- `src/plugins/registry.dual-kind-memory-gate.test.ts`
- `src/agents/system-prompt.memory.test.ts`
- `src/agents/bootstrap-files.test.ts`
- `src/auto-reply/reply/agent-runner-memory.test.ts`
- `src/plugin-sdk/memory-host-*.test.ts`
- `src/commands/doctor-memory-search.test.ts`
- `src/commands/status.scan-memory.test.ts`

## Implementation References

| File                                                            | Purpose                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `docs/concepts/memory.md`                                       | Public memory overview.                                   |
| `docs/concepts/memory-search.md`                                | Public search behavior and tuning.                        |
| `docs/reference/memory-config.md`                               | Full config reference.                                    |
| `extensions/memory-core/index.ts`                               | Default memory plugin registration.                       |
| `extensions/memory-core/src/tools.ts`                           | `memory_search` and `memory_get`.                         |
| `extensions/memory-core/src/tools.shared.ts`                    | Tool runtime helpers and corpus supplements.              |
| `extensions/memory-core/src/tools.citations.ts`                 | Citation decoration and injected-character clamping.      |
| `extensions/memory-core/src/prompt-section.ts`                  | Memory Recall prompt section.                             |
| `extensions/memory-core/src/flush-plan.ts`                      | Pre-compaction memory flush plan.                         |
| `extensions/memory-core/src/runtime-provider.ts`                | Runtime manager bridge.                                   |
| `extensions/memory-core/src/public-artifacts.ts`                | Memory-core artifact provider.                            |
| `src/memory-host-sdk/events.ts`                                 | Memory event journal read/write helpers.                  |
| `extensions/memory-core/src/memory/search-manager.ts`           | Builtin/QMD selection and fallback.                       |
| `extensions/memory-core/src/memory/manager.ts`                  | Builtin manager public behavior.                          |
| `extensions/memory-core/src/memory/manager-sync-ops.ts`         | Sync, watcher, reindex, vector readiness, sessions.       |
| `extensions/memory-core/src/memory/watch-settle.ts`             | File watcher settle queue.                                |
| `extensions/memory-core/src/memory/manager-status-state.ts`     | Status provider/search-mode and source aggregate helpers. |
| `extensions/memory-core/src/memory/manager-source-state.ts`     | Existing source file hash loading.                        |
| `extensions/memory-core/src/memory/manager-embedding-ops.ts`    | Chunk embedding and index writes.                         |
| `extensions/memory-core/src/memory/manager-search.ts`           | Vector and keyword query helpers.                         |
| `extensions/memory-core/src/memory/manager-search-preflight.ts` | Empty-query and empty-index preflight behavior.           |
| `extensions/memory-core/src/memory/hybrid.ts`                   | BM25/vector merge.                                        |
| `extensions/memory-core/src/memory/mmr.ts`                      | Diversity rerank.                                         |
| `extensions/memory-core/src/memory/temporal-decay.ts`           | Recency scoring.                                          |
| `extensions/memory-core/src/memory/qmd-manager.ts`              | QMD backend integration.                                  |
| `packages/memory-host-sdk/src/host/internal.ts`                 | File discovery, chunking, hashing, multimodal chunks.     |
| `packages/memory-host-sdk/src/host/memory-schema.ts`            | Builtin SQLite schema.                                    |
| `packages/memory-host-sdk/src/host/read-file.ts`                | Safe memory reads.                                        |
| `packages/memory-host-sdk/src/host/session-files.ts`            | Session transcript export.                                |
| `packages/memory-host-sdk/src/host/backend-config.ts`           | Builtin/QMD backend resolution.                           |
| `src/plugins/memory-state.ts`                                   | Memory capability and supplement registry.                |
| `src/plugins/memory-runtime.ts`                                 | Lazy runtime loading for the selected memory plugin.      |
| `src/plugins/registry.ts`                                       | Memory plugin slot enforcement.                           |
| `src/agents/bootstrap-files.ts`                                 | Bootstrap file loading.                                   |
| `src/agents/system-prompt.ts`                                   | Prompt assembly and memory context labels.                |
| `src/memory/root-memory-files.ts`                               | Canonical root memory path logic.                         |
| `extensions/memory-core/src/dreaming.ts`                        | Managed dreaming cron and trigger handling.               |
| `extensions/memory-core/src/dreaming-phases.ts`                 | Light/REM/deep sweep work.                                |
| `extensions/memory-core/src/dreaming-narrative.ts`              | Dream diary generation.                                   |
| `extensions/memory-core/src/dreaming-markdown.ts`               | Dream report writes.                                      |
| `extensions/memory-core/src/short-term-promotion.ts`            | Recall tracking, ranking, promotion, audit, repair.       |
| `extensions/memory-core/src/memory-budget.ts`                   | Bounded `MEMORY.md` auto-promotion compaction.            |
| `extensions/memory-core/src/cli.ts`                             | Memory CLI command registration.                          |
| `extensions/memory-core/src/cli.runtime.ts`                     | Memory CLI command implementation.                        |
| `src/gateway/server-methods/doctor.memory-core-runtime.ts`      | Doctor runtime bridge for memory-core repair helpers.     |
| `src/plugin-sdk/memory-host-core.ts`                            | Public artifact listing.                                  |
| `extensions/memory-wiki/`                                       | Wiki companion plugin.                                    |
| `extensions/memory-lancedb/`                                    | LanceDB memory slot plugin.                               |
| `extensions/active-memory/`                                     | Proactive memory recall plugin.                           |

## One-Screen Architecture

```text
Runtime startup
  -> plugin loader selects memory slot
  -> memory-core registers capability, tools, CLI, and dreaming hooks
  -> prompt builder adds Memory Recall guidance

User asks about prior context
  -> model calls memory_search
  -> tools.ts resolves active manager
  -> builtin SQLite or QMD returns ranked chunks
  -> session hits are visibility-filtered
  -> wiki supplements may be merged
  -> dreaming may record recall signals

Memory files change
  -> watcher/interval/session update marks dirty
  -> sync scans files/transcripts
  -> chunks are embedded or FTS-indexed
  -> stale rows are pruned

Context approaches compaction
  -> flush plan starts embedded memory turn
  -> durable notes append to memory/YYYY-MM-DD.md

Dreaming runs
  -> phase sweep records signals and review output
  -> candidates are ranked and rehydrated
  -> qualified snippets append to MEMORY.md
```

## Practical Gotchas

- `MEMORY.md` uppercase is canonical.
- The search index is derived; rebuild it before assuming the source files are
  wrong.
- `memory_get` is intentionally narrow and safe.
- Session memory is a separate `sessions` source and is filtered after search.
- `DREAMS.md` is a review surface, not the durable fact store.
- QMD is a backend sidecar; builtin search is the fallback.
- Wiki is a companion corpus, not the active memory backend.
- Active memory is proactive recall, not a replacement for durable Markdown.
- Multimodal indexing applies to configured `extraPaths`, not the default
  memory roots.
