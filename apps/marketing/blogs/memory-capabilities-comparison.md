---
title: "Memory Capabilities Comparison: OpenClaw vs. Hermes Agent vs. Claude Code vs. OpenLoomi"
date: 2026-05-28
description: A focused comparison of memory and knowledge retrieval across OpenClaw, Hermes Agent, Claude Code, and OpenLoomi Memory.
image: /img/blogs/19.png
---

# Memory Capabilities Comparison

This document compares memory and knowledge-management behavior across
OpenClaw, Hermes Agent, Claude Code, and OpenLoomi Memory. It focuses on
what each system stores, how recall happens, and what the final recall stage
looks like when context is brought back into a running agent or search request.

OpenClaw is file-first and search-index backed, Hermes is
curated-memory plus session search plus optional providers, Claude Code is
hierarchical instruction files plus file-based auto memory and optional
LLM-selected memory prefetch, and OpenLoomi is a multi-corpus workspace
retrieval system with raw memory lifecycle, insights, and RAG. Four systems,
four answers to "where did I put that context?" Very normal software family
dinner.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Comparison Matrix](#comparison-matrix)
- [OpenClaw](#openclaw)
- [Hermes Agent](#hermes-agent)
- [Claude Code](#claude-code)
- [OpenLoomi Memory](#openloomi-memory)
- [Final Recall Stage Comparison](#final-recall-stage-comparison)
- [Key Differences](#key-differences)
- [Claims and Caveats](#claims-and-caveats)
- [Implementation References](#implementation-references)

## Executive Summary

OpenClaw treats memory as durable workspace files plus a rebuildable search
index. The canonical durable state is Markdown, especially `MEMORY.md` and
`memory/*.md`. The `memory-core` plugin exposes `memory_search` and
`memory_get`, builds a SQLite-backed index with FTS/vector rows, and can use a
QMD backend or companion corpora. Recall is usually tool-driven: the model calls
`memory_search`, receives ranked snippets, and can use `memory_get` for safe
bounded reads.

Hermes Agent uses a smaller curated memory store, session transcript search, and
optional external memory providers. Built-in `MEMORY.md` and `USER.md` are
loaded from `$HERMES_HOME/memories/` and injected into the system prompt as a
frozen snapshot at session start. The `session_search` tool searches the SQLite
session database through FTS5 and returns real messages. External providers can
prefetch recall and inject it into the current turn inside a fenced
`<memory-context>` block.

Claude Code uses two related memory layers in the inspected code. The first is
instruction memory: managed, user, project, local, and `.claude/rules/*.md`
files are discovered by `getMemoryFiles()` and injected through `getClaudeMds()`.
The second is auto memory: a project-scoped Markdown directory under
`~/.claude/projects/<sanitized-project>/memory/` by default. Its `MEMORY.md`
entrypoint can be injected as context, and when the relevant-memory feature flag
is active, Claude Code can scan memory headers and use a side LLM call to choose
up to five topic files for hidden attachment injection. This is still file-based
memory rather than a native vector/FTS/RAG database.

OpenLoomi Memory is a workspace-oriented retrieval stack. Raw messages
are stored in `raw_messages`, lifecycle summaries in `memory_summaries`, insight
records in the insights layer, and knowledge chunks in the RAG layer. The final
application recall endpoint, `/api/memory/search`, calls `searchUnifiedMemory()`
and merges raw memory, insights, and knowledge into one ranked result list.

## Comparison Matrix

| Capability            | OpenClaw                                                                                                  | Hermes Agent                                                                      | Claude Code                                                                                                                                                    | OpenLoomi Memory                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Primary architecture  | File-first agent memory with plugin-backed search.                                                        | Self-improving agent with curated memory, session search, and optional providers. | Terminal coding agent with hierarchical instruction files, rule files, and file-based auto memory.                                                             | Proactive knowledge workspace with raw memory lifecycle, insights, and RAG.                                                  |
| Durable memory source | Markdown files in the workspace.                                                                          | `$HERMES_HOME/memories/MEMORY.md` and `USER.md`; session DB for transcripts.      | Managed/user/project/local `CLAUDE.md` files, `.claude/rules/*.md`, and auto-memory Markdown under `~/.claude/projects/<project>/memory/` unless overridden.   | Databases for raw messages, summaries, insights, and RAG documents; optional local files.                                    |
| Search/index storage  | Builtin SQLite index; optional QMD backend; memory files remain source of truth.                          | SQLite `state.db` with FTS5 for session search; curated memory is file-backed.    | Markdown files plus frontmatter/header scanning; no native FTS/vector memory index found in inspected memory code.                                             | IndexedDB, SQLite, or Postgres for raw memory; RAG vector/full-text stores for knowledge.                                    |
| Retrieval mode        | `memory_search` hybrid vector/BM25 plus `memory_get` safe reads.                                          | System-prompt injection, `session_search`, and external provider prefetch.        | Startup context injection, nested instruction attachments, auto-memory `MEMORY.md`, optional LLM-selected relevant memory attachments, and normal file reads.  | `/api/memory/search` unified search plus raw-message query fallback.                                                         |
| RAG support           | Not the core memory model; vector search over memory chunks exists, and companion corpora can supplement. | Not native in built-in memory; external providers may add semantic/graph memory.  | Not native in inspected code; relevant auto-memory selection uses an LLM over a manifest, not vector RAG.                                                      | Yes: RAG document chunks via `searchSimilarChunks()`.                                                                        |
| Full-text search      | Yes, through memory index / FTS path.                                                                     | Yes, SQLite FTS5 for session messages.                                            | No native FTS memory path found for memory; prompt guidance can tell the model to grep memory/transcript files.                                                | Yes for raw/query paths and RAG/DB implementations; also semantic search.                                                    |
| Vector search         | Yes, via embeddings and sqlite-vec/fallback scan in memory-core.                                          | Provider-dependent; built-in session search is FTS5, not vector.                  | No vector memory path found in inspected memory code.                                                                                                          | Yes for raw semantic search when embeddings exist and for RAG knowledge chunks.                                              |
| Context retention     | Long-term files plus optional session transcript indexing.                                                | Curated long-term memory, full transcript recall, and agent-created skills.       | Cross-session instruction and auto-memory files; optional team/agent memory features behind gates.                                                             | Persistent cross-session raw memory, insight history, summaries, and knowledge documents.                                    |
| Learning/adaptation   | Optional dreaming and promotion; memory still file-first.                                                 | Strongest self-improvement story: background review can save memories and skills. | Auto-memory prompt, background extraction, auto-dream, and `/remember` can create/review/promote Markdown memories when enabled.                               | Insight refresh and lifecycle scoring; limited autonomous skill-style learning in inspected memory code.                     |
| Noise filtering       | Search ranking, corpus filters, optional active memory; no single native "95%" filter in code inspected.  | Search modes and provider filters; no native global noise filter.                 | Strong save rules, type taxonomy, duplicate checks, LLM selection of up to five relevant memory files, and session byte limits; no native global noise filter. | Proactive insight/RAG pipeline and source filtering; the issue's "95%" claim is not a hard-coded constant in inspected code. |
| Privacy posture       | Local Markdown and local index by default; plugins/backends can change this.                              | Built-in memory and session DB are local; external providers can send data out.   | Memory source files are local by default, but injected instruction/auto-memory content and relevant-memory attachments enter Claude Code model context.        | Tauri can use local SQLite; server mode uses Postgres/API routes. E2EE claim not verified in inspected memory files.         |

## OpenClaw

OpenClaw memory is file-first. Durable memory is ordinary Markdown in the agent
workspace, and the search index is derived state. If the index is stale, it can
be rebuilt without changing the canonical memory files.

Main durable files:

| File or directory             | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `MEMORY.md`                   | Canonical long-term memory.             |
| `memory/YYYY-MM-DD.md`        | Daily working memory and notes.         |
| `memory/YYYY-MM-DD-<slug>.md` | Topic or session-specific daily memory. |
| `DREAMS.md`                   | Human-readable dreaming/review output.  |
| `memory/dreaming/**`          | Dreaming phase reports.                 |

The default memory-slot plugin is `memory-core`. It registers:

- `memory_search`,
- `memory_get`,
- prompt guidance,
- pre-compaction memory flush behavior,
- runtime access for host systems,
- CLI/status/doctor surfaces,
- optional dreaming and promotion hooks.

### Retrieval Pipeline

OpenClaw's main recall path is `memory_search`:

```text
model calls memory_search(query)
  -> extensions/memory-core/src/tools.ts
  -> get memory manager context
  -> select builtin or QMD backend
  -> run vector search when embeddings/vector table are ready
  -> run BM25/FTS keyword search when text index is available
  -> merge hybrid results
  -> apply temporal decay and optional MMR
  -> clamp injected characters and decorate citations
  -> return ranked snippets
```

The builtin search implementation uses:

- `extensions/memory-core/src/memory/manager-search.ts` for vector, FTS, LIKE,
  and fallback lexical scoring.
- `extensions/memory-core/src/memory/hybrid.ts` for vector/BM25 merge.
- `temporal-decay.ts` and `mmr.ts` for optional recency and diversity reranking.

The final surfaced result is a ranked snippet list. The model can then call
`memory_get` to safely read bounded excerpts from allowed memory paths or
configured supplementary corpora.

### Practical Character

OpenClaw is strongest when the user wants transparent, local, inspectable
memory. You can open the files. You can diff them. You can rebuild the index.
The tradeoff is that native "knowledge management" is not one monolithic
product layer; it is plugin-backed and file/index oriented.

## Hermes Agent

Hermes Agent has three memory surfaces:

| Surface                 | Storage                                                            | Purpose                                                        |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Built-in curated memory | `$HERMES_HOME/memories/MEMORY.md`, `$HERMES_HOME/memories/USER.md` | Compact durable facts injected into every session.             |
| Session search          | `$HERMES_HOME/state.db`                                            | On-demand recall over full past conversations.                 |
| External provider       | Provider-specific local/cloud backend                              | Optional semantic, graph, profile, or provider-managed memory. |

Built-in memory is intentionally small. `MemoryStore` in `tools/memory_tool.py`
loads files at startup, stores a frozen prompt snapshot, and persists mid-session
writes without changing the active system prompt. That keeps prompt caching
stable while still saving durable updates.

The built-in `memory` tool is mostly a write/update interface. Its comments
describe `add`, `replace`, `remove`, and `read`, but the internal documentation
and runtime behavior emphasize that memory is already injected and not normally
queried like a database. The real transcript recall tool is `session_search`.

### Session Search Pipeline

`tools/session_search_tool.py` exposes one tool with three inferred modes:

```text
query present
  -> discovery mode
  -> SQLite FTS5 search
  -> dedupe by session lineage
  -> return top sessions with snippets, local message windows, and bookends

session_id + around_message_id present
  -> scroll mode
  -> return a window around the anchor message

no args
  -> browse mode
  -> return recent sessions
```

The SQLite session database in `hermes_state.py` creates FTS5 tables such as
`messages_fts` and `messages_fts_trigram`, plus triggers that keep message
content synchronized. The returned payload contains actual messages, not
LLM-generated summaries.

### External Provider Recall

External providers implement `agent/memory_provider.py` and are orchestrated by
`agent/memory_manager.py`. At most one external provider is active at a time.
The turn-level recall path is:

```text
turn starts
  -> MemoryManager.prefetch_all(user_message)
  -> provider.prefetch()
  -> build_memory_context_block()
  -> inject recalled text into current user message as <memory-context>
```

Hermes fences external memory recall with a system note and scrubs it from
streamed output. This prevents provider context from accidentally becoming new
user input or leaking into visible assistant text.

### Practical Character

Hermes is strongest when memory is part of agent self-improvement. It can save
curated memories, search full past sessions, and create/refine skills through
background review. It is less a RAG knowledge workspace and more an agent that
learns how to operate over time.

## Claude Code

Claude Code's memory implementation in `D:\claude-code-rev-main` is a
file-and-prompt system with two distinct layers:

- Instruction memory: files that directly tell Claude how to behave in a repo,
  user environment, or managed installation.
- Auto memory: Markdown files that persist facts, preferences, feedback, and
  project/reference context across sessions.

These layers share the word "memory", but the code treats them differently.
Instruction files are loaded as `CLAUDE.md`/rules context. Auto memory has a
separate prompt, storage directory, extraction flow, optional recall prefetch,
and review skill. In other words, `CLAUDE.md` is the house rules; auto memory is
the notebook. Mixing them up is how architecture docs start wearing fake
moustaches.

### Instruction Memory

`src/utils/claudemd.ts` is the center of instruction-memory discovery. Its header
documents the load order:

| Type    | Files                                                                                | Purpose                                      |
| ------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| Managed | managed install path such as `/etc/claude-code/CLAUDE.md`, plus managed rules        | Global instructions for all users.           |
| User    | `~/.claude/CLAUDE.md`, plus user rules                                               | Private global instructions across projects. |
| Project | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md` while walking from CWD upward | Checked-in project/team instructions.        |
| Local   | `CLAUDE.local.md`                                                                    | Private project-specific instructions.       |

Files are loaded in reverse priority order so later entries carry higher
priority. Project discovery walks from the current directory toward the root;
closer files load later. Rules under `.claude/rules/` can contain frontmatter
`paths` globs, which means some rules are loaded eagerly and others are loaded
only when a target file path matches.

Instruction memory also supports `@` includes. `processMemoryFile()` parses text
nodes, resolves `@path`, `@./relative/path`, `@~/home/path`, and absolute paths,
and prevents cycles with a processed-path set. The included file is represented
as its own `MemoryFileInfo` with a `parent` reference, so the UI and hooks can
explain where it came from.

At runtime, `src/context.ts` calls:

```text
getMemoryFiles()
  -> filterInjectedMemoryFiles()
  -> getClaudeMds()
  -> user context field: claudeMd
```

`getClaudeMds()` wraps the loaded file content with the
`MEMORY_INSTRUCTION_PROMPT` and labels each source. `src/screens/REPL.tsx` also
preloads the same memory files into `readFileState` at startup so change
detection and duplicate nested loads behave predictably.

### Nested Instruction Recall

Claude Code does not only load instruction files at process start. It also
performs nested memory discovery when files are opened, read, or referenced.
`src/utils/attachments.ts` walks from the original CWD toward the target file and
creates `nested_memory` attachments.

The nested path has four important phases:

```text
file path becomes relevant
  -> load managed/user conditional rules that match the file
  -> walk CWD -> target directory
  -> for each nested directory: load CLAUDE.md, unconditional rules, and matching conditional rules
  -> for root -> CWD directories: load matching conditional rules only
  -> convert new files to nested_memory attachments
  -> wrap them as hidden system-reminder messages
```

Deduplication is deliberately stronger than a normal LRU file cache.
`loadedNestedMemoryPaths` remembers injected paths even if `readFileState` evicts
older entries, so the same nested `CLAUDE.md` is not re-injected repeatedly in a
long session.

### Auto Memory

Auto memory lives under `src/memdir/`. By default, `getAutoMemPath()` resolves to:

```text
<claude-config-home>/projects/<sanitized canonical project root>/memory/
```

The path can be overridden by `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`,
`CLAUDE_CODE_REMOTE_MEMORY_DIR`, or trusted `autoMemoryDirectory` settings.
`isAutoMemoryEnabled()` enables it by default, but disables it for
`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `--bare`/`CLAUDE_CODE_SIMPLE`, and remote
sessions without persistent memory storage.

Auto memory uses `MEMORY.md` as an entrypoint index and keeps detailed memories
in topic files. `src/memdir/memdir.ts` sets:

- `MAX_ENTRYPOINT_LINES = 200`,
- `MAX_ENTRYPOINT_BYTES = 25_000`,
- a typed-memory taxonomy of `user`, `feedback`, `project`, and `reference`,
- explicit rules for what not to save, including code patterns, repo structure,
  git history, and ephemeral task state.

The prompt built by `loadMemoryPrompt()` tells Claude how to write memories and
when to read them. The `MEMORY.md` entrypoint is also read through
`getMemoryFiles()` as type `AutoMem` when auto memory is enabled. If the
`tengu_moth_copse` feature flag is enabled, `filterInjectedMemoryFiles()` removes
`AutoMem` and `TeamMem` from direct prompt injection because query-time memory
prefetch will surface relevant topic files instead.

### Auto-Memory Write and Review Paths

There are several write/review mechanisms:

- The main model can write directly to the auto-memory directory because the
  memory prompt tells it to use normal file tools.
- `src/services/extractMemories/extractMemories.ts` can run a background forked
  extraction agent after a turn. It skips extraction when the main agent already
  wrote memory files, scans existing memory headers to avoid duplicates, and
  restricts tools to read/search plus writes inside the memory directory.
- `src/services/autoDream/autoDream.ts` can consolidate memory in long-running
  modes.
- `/memory` opens a selector that can edit user/project instruction files,
  toggle auto-memory/auto-dream, and open auto/team/agent memory folders.
- The bundled `remember` skill reviews auto-memory entries and proposes
  promotions into `CLAUDE.md`, `CLAUDE.local.md`, or team memory, while also
  detecting duplicates, conflicts, and stale entries.

### Final Recall Pipeline

Claude Code's final recall stage is not one database query. It is a combination
of eager prompt injection, hidden attachments, and optional asynchronous
selection:

```text
session starts
  -> load instruction files through getMemoryFiles()
  -> inject instruction context through getClaudeMds()
  -> optionally include auto-memory MEMORY.md as AutoMem
  -> preload memory files into readFileState

user turn starts
  -> startRelevantMemoryPrefetch()
  -> scan auto-memory or mentioned agent-memory directory
  -> sideQuery asks Sonnet to select up to 5 useful memory files from headers
  -> read selected files with line/byte limits
  -> inject them as relevant_memories system-reminder attachments if ready

file path becomes relevant
  -> discover nested CLAUDE.md/rules for that path
  -> inject unseen files as nested_memory system-reminder attachments
```

The relevant-memory selector is ranking-like, but it is not FTS, vector search,
or RAG. `findRelevantMemories()` scans Markdown headers/frontmatter, formats a
manifest, and asks a side model call to pick filenames. The resulting files are
read and surfaced as hidden system reminders. If the prefetch is not settled at
the collection point, Claude Code skips it for that loop iteration rather than
blocking the turn.

### Practical Character

Claude Code is strongest when memory should remain local, inspectable, and close
to the coding workflow. It handles persistent instructions, contextual rules,
nested repo guidance, and user/project facts without requiring a database.

The tradeoff is that recall quality depends on file layout, prompt guidance,
feature flags, and LLM selection over memory manifests. There is no native
SQLite FTS/vector memory index in the inspected implementation, so it should not
be described as RAG in the same sense as OpenLoomi.

## OpenLoomi Memory

OpenLoomi has several memory-like stores:

| Store                     | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `raw_messages`            | Original or near-original messages.           |
| `memory_summaries`        | Rule-based lifecycle compaction summaries.    |
| insights tables           | LLM-derived insight records.                  |
| RAG document/chunk tables | Uploaded/generated knowledge documents.       |
| filesystem memory         | Local Markdown/JSON files in Tauri workflows. |

The raw memory lifecycle is implemented in `packages/ai/src/memory/`:

- `contracts.ts` defines `MemoryRecord`, `MemorySummary`, and
  `MemoryStorageAdapter`.
- `policy.ts` defines `short -> mid -> long` age windows and thresholds.
- `scorer.ts` computes retention priority from recency, access count,
  importance, media, and pinned boost.
- `summarizer.ts` creates rule-based summaries.
- `engine.ts` scans, scores, groups, summarizes, transitions, and archives.
- `api.ts` provides raw-first query with summary fallback.

Storage is selected by environment:

- Browser/local fallback: IndexedDB manager.
- Tauri/server local: SQLite raw message manager.
- Server/cloud: Postgres raw message manager.

### Unified Search Pipeline

The final application recall/search stage is
`apps/web/lib/memory/unified-search.ts`, exposed by
`apps/web/app/api/memory/search/route.ts`.

```text
POST /api/memory/search
  -> authenticate session
  -> normalize sources, limit, threshold
  -> searchUnifiedMemory()
       -> memory: raw keyword search + optional semantic raw search
       -> insights: semantic insight search
       -> knowledge: RAG chunk search
       -> merge by descending similarity
       -> stable tie-break by type and id
```

Supported sources:

| Source      | Implementation                                                                    | Result type |
| ----------- | --------------------------------------------------------------------------------- | ----------- |
| `memory`    | Raw messages through keyword search plus optional `searchMessagesSemantically()`. | `memory`    |
| `insights`  | `searchInsightsSemantically()`.                                                   | `insight`   |
| `knowledge` | `searchSimilarChunks()` over RAG chunks.                                          | `knowledge` |

The raw memory branch uses hybrid scoring:

- keyword base score: `0.78`,
- keyword match bonus: `0.04`,
- keyword score cap: `0.95`,
- semantic search when embedding provider config exists,
- hybrid overlap bonus: `0.08`, capped at `1`.

Important boundary: unified search does not directly query `memory_summaries`.
Summary fallback belongs to `/api/memory/raw-messages` with
`includeSummaryFallback` and the shared `createMemoryQueryApi()` path.

### Practical Character

OpenLoomi is strongest when the user wants a proactive workspace that
combines raw interaction history, extracted insights, and document knowledge. It
has the broadest native RAG-shaped retrieval among the four systems compared
here. Its tradeoff is operational complexity: there are more stores, more
adapters, and more ways to ask "which memory are we talking about?"

## Final Recall Stage Comparison

| System       | Final recall entry point                                                                                                          | What is returned to the model/user                                                                                                           | Ranking/selection                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenClaw     | `memory_search` tool, followed by optional `memory_get`.                                                                          | Ranked snippets from indexed memory files, optional session transcript chunks and companion corpora.                                         | Hybrid vector/BM25 merge, optional temporal decay and MMR, then injected-character clamping.                                                                                               |
| Hermes Agent | Prompt-injected curated memory, `session_search`, and optional provider prefetch.                                                 | Frozen `MEMORY.md`/`USER.md` prompt snapshot; real session messages; external recall inside `<memory-context>`.                              | FTS5 for session discovery; provider-defined ranking for external memory; curated memory is not ranked because it is prompt-injected.                                                      |
| Claude Code  | `getMemoryFiles()`/`getClaudeMds()` startup context, nested `CLAUDE.md`/rules attachments, and optional relevant-memory prefetch. | Instruction file content, auto-memory entrypoint or selected topic files, and hidden `nested_memory` / `relevant_memories` system reminders. | File priority and `@include` order for instructions; glob matching for rules; side LLM selection over memory manifests for up to five auto-memory files; no native FTS/vector index found. |
| OpenLoomi    | `/api/memory/search` through `searchUnifiedMemory()`.                                                                             | Unified `memory`, `insight`, and `knowledge` results with source metadata.                                                                   | Similarity sort across sources; raw memory branch merges keyword and semantic hits with hybrid bonus.                                                                                      |

## Key Differences

### Native Knowledge Retrieval

OpenLoomi has the clearest native RAG pipeline: documents are chunked,
embedded, searched, and merged with raw memory/insights at the unified search
stage.

OpenClaw has strong memory search over files, including vector and FTS search,
but its durable memory model is still file-first. It can feel RAG-like in search
quality, but the core mental model is "indexed memory files", not "knowledge
workspace database."

Hermes built-in retrieval is FTS5 session search plus prompt-injected curated
memory. Semantic retrieval comes from external providers rather than the
built-in session search path.

Claude Code memory is not a retrieval database in the inspected implementation.
It is a hierarchical instruction system plus file-based auto memory. Its most
retrieval-like path is relevant-memory prefetch, where a side LLM selects a few
topic files from scanned Markdown headers.

### Learning and Adaptation

Hermes has the strongest self-improvement story. Background review can save
memories and create/refine skills, which means behavior can improve through
agent-authored procedures over time.

OpenClaw has dreaming and promotion machinery, but durable state remains
transparent files and plugin-managed search.

OpenLoomi learns mainly through captured raw messages, generated
insights, lifecycle summaries, and refreshed RAG/personalization documents. In
the inspected memory code, it is not primarily a self-created-skills system.

Claude Code memory can evolve through direct memory writes, background
`extractMemories`, auto-dream consolidation, `/memory`, `/init`, and the
`remember` skill. It can learn project-local notes automatically, but recall is
still file/context/attachment based rather than ranked database retrieval.

### Privacy and Control

OpenClaw is the most inspectable by default: memory source files are local
Markdown, and the index is rebuildable.

Hermes built-in memory and session DB are local, but external providers can
change the privacy boundary.

Claude Code memory source files are local by default. Their contents are loaded
into Claude Code context as prompt text or hidden attachments when used, so the
practical privacy boundary is the Claude Code execution/model environment.

OpenLoomi has local Tauri SQLite and browser IndexedDB paths, plus
server/Postgres paths. The inspected memory routes enforce authenticated
`userId` scoping. The issue mentions end-to-end encryption, but this comparison
does not treat it as verified because the inspected memory files do not show a
single end-to-end encryption implementation for all memory stores.

## Claims and Caveats

- The issue's "95% noise filtering" phrasing is useful product positioning, but
  no hard-coded `95%` memory filter was found in the inspected OpenLoomi memory
  code. The code does show source filtering, insight processing, thresholds,
  ranking, and lifecycle compaction.
- "RAG support" means native document/chunk embedding retrieval. OpenClaw has
  vector search over memory chunks, but OpenLoomi has the more explicit
  RAG document pipeline.
- "Full-text search" means built-in searchable index behavior, not just a
  generic grep over files.
- Claude Code details are based on `D:\claude-code-rev-main` source code.
  Feature flags such as `TEAMMEM`, `EXTRACT_MEMORIES`, and `tengu_moth_copse`
  can change which memory paths are active.
- All comparisons describe the code/documentation inspected here, not every
  possible plugin/provider users might add later. Plugins can make any tidy
  comparison table start sweating.

## Implementation References

| System      | File / doc                                                                                                                       | Purpose                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw    | `D:\openclaw-main\extensions\memory-core\src\tools.ts`                                                                           | `memory_search` and `memory_get` tool entry points.                                                                                |
| OpenClaw    | `D:\openclaw-main\extensions\memory-core\src\memory\manager-search.ts`                                                           | Vector, FTS, LIKE, and fallback memory search.                                                                                     |
| OpenClaw    | `D:\openclaw-main\extensions\memory-core\src\memory\hybrid.ts`                                                                   | Hybrid vector/text score merge.                                                                                                    |
| OpenClaw    | `D:\openclaw-main\docs\concepts\memory-search.md`                                                                                | Public explanation of memory search, embeddings, hybrid retrieval, temporal decay, and MMR.                                        |
| Hermes      | `D:\hermes-agent-main\tools\memory_tool.py`                                                                                      | Built-in curated memory store and tool.                                                                                            |
| Hermes      | `D:\hermes-agent-main\tools\session_search_tool.py`                                                                              | Session browse/search/scroll recall tool.                                                                                          |
| Hermes      | `D:\hermes-agent-main\hermes_state.py`                                                                                           | SQLite session DB and FTS5 tables.                                                                                                 |
| Hermes      | `D:\hermes-agent-main\agent\memory_manager.py`                                                                                   | External provider orchestration and `<memory-context>` fencing.                                                                    |
| Claude Code | `D:\claude-code-rev-main\src\utils\claudemd.ts`                                                                                  | Instruction memory discovery, `@include`, rules, auto-memory entrypoint loading, and `getClaudeMds()`.                             |
| Claude Code | `D:\claude-code-rev-main\src\memdir\*.ts`                                                                                        | Auto-memory path resolution, prompt construction, entrypoint truncation, memory taxonomy, and LLM-based relevant-memory selection. |
| Claude Code | `D:\claude-code-rev-main\src\utils\attachments.ts`                                                                               | Nested memory attachments and relevant-memory prefetch/injection.                                                                  |
| Claude Code | `D:\claude-code-rev-main\src\services\extractMemories\*.ts`                                                                      | Background memory extraction agent and write constraints.                                                                          |
| Claude Code | `D:\claude-code-rev-main\src\commands\memory\memory.tsx`, `D:\claude-code-rev-main\src\components\memory\MemoryFileSelector.tsx` | `/memory` command, editor flow, toggles, and memory folder access.                                                                 |
| OpenLoomi   | `docs/internal/memory-system.md`                                                                                                 | Internal memory implementation mechanism.                                                                                          |
| OpenLoomi   | `apps/web/lib/memory/unified-search.ts`                                                                                          | Final unified search merger.                                                                                                       |
| OpenLoomi   | `packages/ai/src/memory/*`                                                                                                       | Raw memory lifecycle contracts, policy, scoring, summarization, engine, and query API.                                             |
