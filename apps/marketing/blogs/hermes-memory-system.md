---
title: "Hermes Agent Memory System: Curated Memory, Session Search, and Self-Improvement"
date: 2026-05-28
description: A technical deep dive into Hermes Agent memory, including curated memory files, session search, and self-improving skills.
image: /img/blogs/19.png
---

# Hermes Memory System

This document describes the Hermes Agent memory implementation as it exists in
code. It focuses on the built-in curated memory files, session search, external
memory provider plugins, provider lifecycle hooks, runtime injection, background
review, compression boundaries, and failure modes.

- Hermes has a small built-in curated memory store backed by Markdown files:
  `MEMORY.md` and `USER.md`.
- Built-in memory files live under the active profile's
  `$HERMES_HOME/memories/` directory.
- Built-in memory is injected into the system prompt as a frozen snapshot at
  session start.
- Mid-session memory writes are durable immediately but do not alter the active
  system prompt until the next session or prompt rebuild.
- The `memory` tool only supports `add`, `replace`, and `remove`; there is no
  read action because memory is already prompt-injected.
- `session_search` is separate from curated memory. It searches the SQLite
  session database (`state.db`) using FTS5 and returns real messages.
- External memory providers implement `agent/memory_provider.py` and are
  orchestrated by `MemoryManager`.
- Built-in memory is always separate from external providers. At most one
  external provider can be active at a time.
- External provider recall is injected into the current user message inside a
  fenced `<memory-context>` block, not into the system prompt.
- Background review can periodically fork an agent to save memories and skills
  after a turn, without blocking the user-facing response.

Hermes memory is deliberately layered: compact always-on facts in built-in
memory, full transcripts in session search, and optional external providers for
deeper semantic or graph-backed memory.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Layer Map](#layer-map)
- [Data Flow](#data-flow)
- [Built-In Memory Files](#built-in-memory-files)
- [Memory Store](#memory-store)
- [Memory Tool](#memory-tool)
- [System Prompt Injection](#system-prompt-injection)
- [Memory Nudge and Background Review](#memory-nudge-and-background-review)
- [Session Search](#session-search)
- [External Provider Architecture](#external-provider-architecture)
- [Memory Manager](#memory-manager)
- [Runtime Integration](#runtime-integration)
- [Memory Context Fencing](#memory-context-fencing)
- [Provider Discovery and Setup](#provider-discovery-and-setup)
- [Bundled Providers](#bundled-providers)
- [Provider Modes and Budgets](#provider-modes-and-budgets)
- [Session Lifecycle and Compression](#session-lifecycle-and-compression)
- [OpenClaw Migration](#openclaw-migration)
- [Security and Safety](#security-and-safety)
- [Configuration Map](#configuration-map)
- [Failure Modes](#failure-modes)
- [Maintenance Checklist](#maintenance-checklist)
- [Implementation References](#implementation-references)
- [One-Screen Architecture](#one-screen-architecture)
- [Practical Gotchas](#practical-gotchas)

## Core Concepts

Hermes has three memory surfaces that solve different problems:

| Surface                 | Storage                                                            | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Built-in curated memory | `$HERMES_HOME/memories/MEMORY.md`, `$HERMES_HOME/memories/USER.md` | Compact durable facts injected into every session.                  |
| Session search          | `$HERMES_HOME/state.db`                                            | On-demand recall over full past conversations.                      |
| External provider       | Provider-specific local or cloud backend                           | Optional semantic, graph, user-modeling, or knowledge-store memory. |

Important boundaries:

- Built-in memory is manually curated by the agent through the `memory` tool.
- Session search is automatic transcript recall and should carry task progress,
  old decisions, and "what did we do last week?" questions.
- Skills carry durable procedures and techniques. Memory should not become an
  overly broad procedural reference.
- External providers are additive. They do not replace `MEMORY.md` and
  `USER.md`.
- Only one external provider is allowed at a time to avoid tool schema bloat and
  conflicting backends.

## Layer Map

| Layer                  | Main files                                                                                                       | Responsibility                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Built-in memory tool   | `tools/memory_tool.py`                                                                                           | `MemoryStore`, `memory` tool schema, file persistence, limits, injection scan, drift guard.               |
| Built-in prompt wiring | `agent/system_prompt.py`, `agent/prompt_builder.py`                                                              | Injects frozen memory snapshots and gives model guidance on what to save.                                 |
| Agent initialization   | `agent/agent_init.py`                                                                                            | Loads memory config, creates `MemoryStore`, loads external provider, injects provider tools.              |
| Conversation loop      | `agent/conversation_loop.py`                                                                                     | Handles memory nudges, external prefetch, ephemeral context injection, post-turn sync, background review. |
| Tool dispatch          | `agent/tool_executor.py`, `agent/agent_runtime_helpers.py`                                                       | Executes `memory` and bridges built-in writes to external providers.                                      |
| Provider contract      | `agent/memory_provider.py`                                                                                       | Abstract lifecycle for external memory plugins.                                                           |
| Provider manager       | `agent/memory_manager.py`                                                                                        | Registers providers, routes tools, manages hooks, fences recalled context, scrubs streams.                |
| Provider discovery     | `plugins/memory/__init__.py`                                                                                     | Discovers bundled and user-installed providers, loads active provider, exposes active provider CLI.       |
| Provider setup CLI     | `hermes_cli/memory_setup.py`                                                                                     | Interactive provider picker, dependency install, config schema prompts, status output.                    |
| Session DB             | `hermes_state.py`                                                                                                | SQLite session/message store, FTS5 indexes, WAL fallback, search primitives.                              |
| Session search tool    | `tools/session_search_tool.py`                                                                                   | Browse, discover, and scroll over past sessions.                                                          |
| Background review      | `agent/background_review.py`                                                                                     | Forks a quiet review agent to save memory/skills after turns.                                             |
| Gateway monitor        | `gateway/memory_monitor.py`                                                                                      | Process RSS/GC/thread logging; operational memory usage, not semantic memory.                             |
| Public docs            | `website/docs/user-guide/features/memory.md`, `memory-providers.md`, `developer-guide/memory-provider-plugin.md` | User-facing memory and provider documentation.                                                            |

## Data Flow

### Built-In Memory Startup

```text
AIAgent init
  -> load config memory block
  -> if memory/user profile enabled:
       create MemoryStore(memory_char_limit, user_char_limit)
       load_from_disk()
       capture frozen prompt snapshot
  -> system prompt builder injects snapshot
```

### Built-In Memory Write

```text
model calls memory(action=add|replace|remove)
  -> tool executor passes agent._memory_store
  -> MemoryStore scans content
  -> acquire per-file lock
  -> reload target from disk
  -> detect external drift
  -> mutate entries
  -> atomic temp-file write + replace
  -> return live entries and usage
  -> add/replace is mirrored to external provider, if active
```

### External Provider Recall

```text
turn starts
  -> MemoryManager.on_turn_start()
  -> MemoryManager.prefetch_all(original_user_message)
  -> provider.prefetch()
  -> conversation loop wraps recalled text in <memory-context>
  -> injects block into current API user message only
```

### External Provider Sync

```text
turn completes successfully
  -> AIAgent._sync_external_memory_for_turn()
  -> MemoryManager.sync_all(user, assistant)
  -> MemoryManager.queue_prefetch_all(user)
```

Interrupted turns are skipped so partial or unseen assistant output does not
pollute external memory.

### Session Search

```text
session messages
  -> SessionDB messages table
  -> FTS5 messages_fts and messages_fts_trigram
  -> session_search(query)
  -> FTS hit + anchored window + bookends
  -> optional scroll with session_id + around_message_id
```

## Built-In Memory Files

Built-in memory lives under:

```text
$HERMES_HOME/memories/
  MEMORY.md
  USER.md
```

`$HERMES_HOME` comes from `hermes_constants.get_hermes_home()`, so profile
switches and tests can isolate memory. Code should not hardcode `~/.hermes`.

| File        | Purpose                                                                           | Default limit |
| ----------- | --------------------------------------------------------------------------------- | ------------- |
| `MEMORY.md` | Agent notes: environment facts, project conventions, tool quirks, stable lessons. | `2200` chars  |
| `USER.md`   | User profile: preferences, communication style, role, workflow habits.            | `1375` chars  |

Entries are separated by:

```text
\n§\n
```

Entries may be multiline. The delimiter is intentionally more specific than a
bare `§` split, so entries containing the symbol are not split incorrectly.

## Memory Store

`MemoryStore` lives in `tools/memory_tool.py`.

Important state:

| Field                     | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `memory_entries`          | Live parsed entries from `MEMORY.md`.                         |
| `user_entries`            | Live parsed entries from `USER.md`.                           |
| `memory_char_limit`       | Whole-store character budget for `MEMORY.md`.                 |
| `user_char_limit`         | Whole-store character budget for `USER.md`.                   |
| `_system_prompt_snapshot` | Frozen rendered memory blocks captured by `load_from_disk()`. |

The frozen snapshot pattern is critical:

- `load_from_disk()` reads files and captures rendered prompt blocks.
- Tool calls mutate live entries and disk immediately.
- `format_for_system_prompt()` returns the frozen snapshot, not live state.
- Tool responses show live state.

This preserves prefix caching because the system prompt stays stable across a
session. Memory writes are durable, but the model sees them in the system prompt
on the next session or prompt rebuild. Although this behavior can be
unintuitive, it is intentional.

### File Locking and Atomic Writes

Writes use:

- a separate `.lock` file
- `fcntl` on Unix
- `msvcrt` on Windows when available
- no-op locking fallback when neither is available
- temp file write in the same directory
- `fsync`
- `atomic_replace()`

Readers do not lock the memory file because atomic rename means they see either
the old complete file or the new complete file.

### Drift Detection

Before mutation, `_reload_target()` calls `_detect_external_drift()`.

Drift is detected when:

| Signal                              | Meaning                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| round-trip mismatch                 | Parsed entries would not serialize back to the same bytes.                                         |
| entry larger than whole-store limit | Likely external append/manual edit/patch tool write created content the memory tool would clobber. |

On drift, the file is backed up to:

```text
MEMORY.md.bak.<timestamp>
USER.md.bak.<timestamp>
```

The mutation is refused with remediation instructions. This prevents silent data
loss when a different writer edited the file outside the memory tool.

## Memory Tool

The built-in `memory` tool is registered in `tools/memory_tool.py`.

Actions:

| Action    | Required fields                 | Behavior                                                |
| --------- | ------------------------------- | ------------------------------------------------------- |
| `add`     | `target`, `content`             | Appends a new entry if not duplicate and within budget. |
| `replace` | `target`, `old_text`, `content` | Replaces one entry matched by substring.                |
| `remove`  | `target`, `old_text`            | Removes one entry matched by substring.                 |

Targets:

| Target   | File        | Intended content                                 |
| -------- | ----------- | ------------------------------------------------ |
| `memory` | `MEMORY.md` | Agent/environment/project/tool facts.            |
| `user`   | `USER.md`   | User identity, preferences, communication style. |

There is no `read` action. The model receives memory through the system prompt
snapshot, and tool responses show live entries after writes.

### Matching Semantics

`replace` and `remove` use substring matching:

- no match: error
- one match: mutate it
- multiple distinct matches: error with previews
- multiple identical matches: operate on the first

This keeps calls small while avoiding accidental multi-entry edits. Substring
matching is powerful, so callers should use the most specific substring they
can.

### Capacity Behavior

If a write would exceed the target's character limit:

- the mutation is refused
- the response includes current entries and usage
- the agent is expected to consolidate, replace, or remove first

Exact duplicates are rejected as a success response with "Entry already exists
(no duplicate added)."

## System Prompt Injection

System prompt assembly lives in:

```text
agent/system_prompt.py
agent/prompt_builder.py
```

Memory appears in the volatile prompt tier:

```text
MEMORY (your personal notes) [pct - current/limit chars]
...
USER PROFILE (who the user is) [pct - current/limit chars]
...
```

Even though the tier is called volatile, the memory text used there is the
frozen snapshot from `MemoryStore.load_from_disk()`.

`agent/prompt_builder.py` also adds guidance:

- save durable facts with `memory`
- prioritize user preferences and recurring corrections
- do not save task progress, PR numbers, issue numbers, commit SHAs, completed
  work logs, temporary TODO state, or facts stale in seven days
- use `session_search` for old transcript recall
- use skills for durable procedures and workflows
- write declarative facts, not imperatives

Example of the intended distinction:

| Good memory                       | Bad memory                    |
| --------------------------------- | ----------------------------- |
| `User prefers concise responses.` | `Always respond concisely.`   |
| `Project uses pytest with xdist.` | `Run tests with pytest -n 4.` |

Declarative memory reduces accidental self-instructions later.

## Memory Nudge and Background Review

Hermes can nudge itself to review memory periodically.

Config:

```yaml
memory:
  nudge_interval: 10
```

Runtime behavior in `agent/conversation_loop.py`:

1. User turns are counted.
2. If the `memory` tool is available and a `MemoryStore` exists, the counter
   increments.
3. When `turns_since_memory >= nudge_interval`, a background review is requested
   and the counter resets.
4. Gateway-resumed agents hydrate counters from conversation history so the
   cadence survives fresh agent instances.

Background review lives in `agent/background_review.py`.

It forks a quiet review agent after the user-facing response is delivered. The
fork:

- inherits the parent's provider/model/auth/runtime
- uses `skip_memory=True` so external providers are not touched
- reuses the parent's built-in `MemoryStore`
- can write built-in memory and skills
- has memory/skill tool dispatch whitelisted
- auto-denies dangerous command approvals
- suppresses status output
- reuses the cached system prompt for prefix-cache parity

This is why built-in memory can improve after a turn without blocking the user
or leaking review prompts into Honcho/Mem0/Supermemory/etc. The review agent
performs post-turn cleanup rather than interrupting the active user-facing
response.

## Session Search

`session_search` is not curated memory. It is recall over the full conversation
database.

Main files:

- `hermes_state.py`
- `tools/session_search_tool.py`

Database:

```text
$HERMES_HOME/state.db
```

Schema highlights:

| Table                  | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `sessions`             | Session metadata, source, model, parent lineage, title, token/cost fields.   |
| `messages`             | Full message history with roles, content, tool calls, reasoning, timestamps. |
| `state_meta`           | Key/value metadata.                                                          |
| `messages_fts`         | FTS5 index over content, tool name, and tool calls.                          |
| `messages_fts_trigram` | Trigram FTS5 index for CJK/substring search.                                 |

Session DB design:

- WAL mode for concurrency
- fallback to `journal_mode=DELETE` on WAL-incompatible filesystems
- `parent_session_id` chains for compression, branch, and lineage
- source tagging for CLI, Telegram, Discord, cron, tool sessions, etc.
- hidden source filtering for third-party `tool` sessions by default

### Search Modes

The tool has one schema and infers mode from arguments:

| Mode     | Arguments                          | Behavior                                                                                                |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| browse   | no args                            | Lists recent sessions with title, source, timestamps, message count, preview.                           |
| discover | `query`                            | FTS5 search, deduped by session lineage, returns top sessions with snippet, match window, and bookends. |
| scroll   | `session_id` + `around_message_id` | Returns a window around a known message id.                                                             |

Discovery returns:

- `session_id`
- `title`
- `when`
- `source`
- `model`
- `matched_role`
- `match_message_id`
- FTS snippet
- `bookend_start`
- anchored `messages`
- `bookend_end`
- `messages_before`
- `messages_after`

Scroll:

- clamps `window` to `[1, 20]`
- rejects scrolling inside the current session lineage because that context is
  already active
- can transparently rebind to a child session in the same lineage when the
  anchor lives there

FTS behavior:

- default FTS5 search supports keywords, phrases, boolean syntax, and prefix
  queries
- `sort` can be `newest` or `oldest`
- CJK queries use trigram FTS when long enough
- short CJK tokens fall back to LIKE

`session_search` has no LLM summarization path. It returns actual database
messages, which can be direct and occasionally verbose but are useful for
traceable recall.

## External Provider Architecture

External providers implement `MemoryProvider` in:

```text
agent/memory_provider.py
```

Required members:

| Method                                        | Purpose                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| `name`                                        | Provider id such as `honcho`, `mem0`, or `supermemory`.    |
| `is_available()`                              | Fast config/dependency check. Must not make network calls. |
| `initialize(session_id, **kwargs)`            | Connect, create resources, warm caches.                    |
| `get_tool_schemas()`                          | Return OpenAI-style function schemas.                      |
| `handle_tool_call(tool_name, args, **kwargs)` | Execute provider-owned tools.                              |

Core optional hooks:

| Hook                                                      | Called by                           | Purpose                                       |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `system_prompt_block()`                                   | system prompt build                 | Static provider info or base context.         |
| `prefetch(query, session_id=...)`                         | before each turn                    | Return recalled context for injection.        |
| `queue_prefetch(query, session_id=...)`                   | after each turn                     | Warm recall for next turn.                    |
| `sync_turn(user, assistant, session_id=...)`              | after completed turn                | Persist the exchange. Should be non-blocking. |
| `on_turn_start(turn, message, **kwargs)`                  | beginning of turn                   | Cadence and scope tracking.                   |
| `on_session_end(messages)`                                | real session boundary or commit     | Final extraction/flush.                       |
| `on_session_switch(new_session_id, ...)`                  | resume/branch/reset/new/compression | Refresh cached per-session state.             |
| `on_pre_compress(messages)`                               | before context compression          | Extract insights before messages are dropped. |
| `on_memory_write(action, target, content, metadata=None)` | built-in memory writes              | Mirror curated memory into provider backend.  |
| `on_delegation(task, result, ...)`                        | parent after subagent completes     | Observe delegated work.                       |
| `shutdown()`                                              | process/session teardown            | Flush queues and close connections.           |

Setup-related hooks:

| Method                             | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `get_config_schema()`              | Declares fields for `hermes memory setup`. |
| `save_config(values, hermes_home)` | Writes non-secret provider config.         |
| `post_setup(hermes_home, config)`  | Provider-owned custom setup flow.          |

Provider `initialize()` receives contextual kwargs such as:

- `hermes_home`
- `platform`
- `agent_context`
- `agent_identity`
- `agent_workspace`
- `parent_session_id`
- `user_id`
- `user_name`
- `chat_id`
- `chat_name`
- `chat_type`
- `thread_id`
- `gateway_session_key`
- `session_title`

Providers should use `hermes_home` for profile-scoped storage and skip writes
for non-primary contexts where appropriate.

## Memory Manager

`MemoryManager` lives in:

```text
agent/memory_manager.py
```

Responsibilities:

| Method                   | Behavior                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `add_provider()`         | Registers provider; accepts built-in-named provider but allows only one external provider. |
| `build_system_prompt()`  | Concatenates provider prompt blocks.                                                       |
| `prefetch_all()`         | Merges provider prefetch context.                                                          |
| `queue_prefetch_all()`   | Queues provider background prefetch.                                                       |
| `sync_all()`             | Sends completed turns to providers.                                                        |
| `get_all_tool_schemas()` | Collects provider tools with dedupe.                                                       |
| `handle_tool_call()`     | Routes provider tool calls.                                                                |
| `on_turn_start()`        | Broadcasts turn start.                                                                     |
| `on_session_end()`       | Broadcasts session end/extraction.                                                         |
| `on_session_switch()`    | Broadcasts session id rotation.                                                            |
| `on_pre_compress()`      | Collects provider compression contributions.                                               |
| `on_memory_write()`      | Mirrors built-in memory writes to external providers.                                      |
| `on_delegation()`        | Broadcasts subagent results.                                                               |
| `shutdown_all()`         | Shuts providers down in reverse order.                                                     |
| `initialize_all()`       | Initializes all providers and injects `hermes_home` if missing.                            |

Failure handling is intentionally forgiving. Most provider failures are logged
at debug/warning level and do not block other providers or the user-facing turn.
External memory is treated as a supporting component, not as a single point of
failure.

### One External Provider Rule

The manager allows:

- built-in provider name `builtin`, if such a provider is registered
- one non-builtin provider

A second external provider registration is rejected with a warning. This avoids:

- huge tool schemas
- conflicting auto-recall
- duplicate writes
- multiple providers trying to become the "real" memory

## Runtime Integration

### Initialization

In `agent/agent_init.py`:

1. Config is loaded.
2. Built-in memory flags and limits are read.
3. `MemoryStore` is created and loaded if either built-in memory surface is
   enabled.
4. `memory.provider` selects an external provider.
5. `plugins.memory.load_memory_provider()` loads it.
6. `is_available()` gates activation.
7. `MemoryManager.initialize_all()` receives session/platform/profile/gateway
   context.
8. Provider tool schemas are appended to the model tool list only when the
   memory toolset is enabled for the platform.

Provider tool injection skips duplicate names because plugins may also register
tools through the normal plugin path.

### Per-Turn Recall

In `agent/conversation_loop.py`:

1. `on_turn_start()` fires before prefetch.
2. `prefetch_all()` runs once per user turn, not once per tool loop iteration.
3. The query uses the clean `original_user_message`, not a version bloated with
   injected skill/plugin context.
4. The result is cached for the whole tool loop.
5. Recalled context is injected only into the current API user message.
6. The persisted messages list is not mutated.

This preserves session DB cleanliness and avoids multiplying provider latency by
the number of tool-call iterations.

### Post-Turn Sync

At the end of `run_conversation()`:

```text
AIAgent._sync_external_memory_for_turn()
  -> MemoryManager.sync_all(original_user_message, final_response)
  -> MemoryManager.queue_prefetch_all(original_user_message)
```

Skipped when:

- the turn was interrupted
- there is no memory manager
- no final response exists
- no original user message exists

### Tool Routing

Built-in agent-loop tools are handled directly:

- `memory`
- `session_search`
- `todo`
- `delegate_task`

Provider tools are routed through:

```text
MemoryManager.handle_tool_call()
```

This happens in both `agent/tool_executor.py` and
`agent/agent_runtime_helpers.py`, so regular and helper dispatch paths stay in
sync.

## Memory Context Fencing

External provider recall is wrapped by:

```text
build_memory_context_block()
```

Shape:

```text
<memory-context>
[System note: The following is recalled memory context, NOT new user input. ...]

...
</memory-context>
```

Why this matters:

- distinguishes recalled memory from user instructions
- keeps injected context out of the system prompt
- protects prompt cache stability
- gives downstream scrubbing a clear boundary

`sanitize_context()` strips:

- existing `<memory-context>` blocks
- memory fence tags
- internal system note text

If a provider returns pre-wrapped context, Hermes strips it and logs a warning.

`StreamingContextScrubber` handles streamed model output that may contain split
`<memory-context>` tags across chunks. It discards fenced spans and holds
partial tag tails until it can prove whether they are real tags. Unterminated
spans are discarded on flush because leaking memory context is worse than
truncating visible output.

## Provider Discovery and Setup

Provider discovery lives in:

```text
plugins/memory/__init__.py
```

Search order:

1. bundled providers under `plugins/memory/<name>/`
2. user-installed providers under `$HERMES_HOME/plugins/<name>/`

Bundled providers take precedence on name collisions.

A provider directory must have `__init__.py`. For user-installed plugins, Hermes
uses a cheap source scan for `register_memory_provider` or `MemoryProvider`.

Provider loading supports two patterns:

| Pattern         | Behavior                                                          |
| --------------- | ----------------------------------------------------------------- |
| `register(ctx)` | A fake context captures `ctx.register_memory_provider(provider)`. |
| subclass        | Loader finds and instantiates a `MemoryProvider` subclass.        |

Active provider is selected by:

```yaml
memory:
  provider: honcho
```

Only the active provider's extra CLI command tree is discovered via
`discover_plugin_cli_commands()`. This prevents `hermes --help` from exposing
unnecessary commands for providers that are not currently active.

### `hermes memory setup`

Implemented in:

```text
hermes_cli/memory_setup.py
```

Setup flow:

1. Discover providers.
2. Show a curses picker plus "Built-in only".
3. Install pip dependencies declared in `plugin.yaml` using `uv pip install`.
4. Show external dependency hints if needed.
5. If provider has `post_setup()`, delegate setup to it.
6. Otherwise prompt fields from `get_config_schema()`.
7. Write activation to `config.yaml`.
8. Write non-secret provider config through `save_config()`.
9. Write secrets to `$HERMES_HOME/.env` with restrictive permissions where
   supported.

`hermes memory status` reports:

- built-in always active
- selected provider
- provider config
- plugin installed/missing
- provider availability
- missing env vars for schema-backed providers
- installed provider list

## Bundled Providers

Hermes ships eight external memory providers.

| Provider    | Storage                         | Tools                                                                                             | Notable behavior                                                                             |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Honcho      | Honcho Cloud or self-hosted     | `honcho_profile`, `honcho_search`, `honcho_context`, `honcho_reasoning`, `honcho_conclude`        | Cross-session user modeling, peer cards, dialectic reasoning, session context.               |
| OpenViking  | Self-hosted OpenViking server   | `viking_search`, `viking_read`, `viking_browse`, `viking_remember`, `viking_add_resource`         | Hierarchical knowledge, tiered reads, session-end extraction.                                |
| Mem0        | Mem0 Cloud                      | `mem0_profile`, `mem0_search`, `mem0_conclude`                                                    | Server-side fact extraction and semantic search.                                             |
| Hindsight   | Cloud or local embedded backend | `hindsight_retain`, `hindsight_recall`, `hindsight_reflect`                                       | Knowledge graph, entity resolution, reflect synthesis, auto-retain.                          |
| Holographic | Local SQLite                    | `fact_store`, `fact_feedback`                                                                     | FTS5, trust scoring, HRR algebraic queries, contradiction detection.                         |
| RetainDB    | RetainDB Cloud                  | `retaindb_profile`, `retaindb_search`, `retaindb_context`, `retaindb_remember`, `retaindb_forget` | Hybrid search, memory types, delta compression.                                              |
| ByteRover   | Local/Cloud via `brv` CLI       | `brv_query`, `brv_curate`, `brv_status`                                                           | Local-first knowledge tree, pre-compression extraction.                                      |
| Supermemory | Supermemory Cloud               | `supermemory_store`, `supermemory_search`, `supermemory_forget`, `supermemory_profile`            | Semantic recall, profile facts, context fencing, session graph ingest, multi-container mode. |

Provider hooks vary. For example:

- Honcho uses cadence-controlled base context and dialectic reasoning.
- ByteRover implements `on_pre_compress()` to save insights before compression.
- Supermemory strips recalled memory from captured turns to prevent recursive
  memory pollution.
- Holographic can auto-extract facts at session end when configured.

Do not assume all providers implement all hooks. The manager treats hooks as
optional and best-effort.

## Provider Modes and Budgets

Several providers expose their own mode switches. These are provider-level
controls, not global `MemoryManager` concepts, but they affect how memory enters
the model.

Common mode pattern:

| Mode      | Auto context injection | Provider tools  |
| --------- | ---------------------- | --------------- |
| `hybrid`  | Yes                    | Yes             |
| `context` | Yes                    | Hidden or empty |
| `tools`   | No                     | Yes             |

Examples:

- Honcho uses `recallMode` with `hybrid`, `context`, and `tools`.
- Hindsight uses `memory_mode` with `hybrid`, `context`, and `tools`.
- Supermemory uses `auto_recall`, `auto_capture`, `capture_mode`, and
  `search_mode` rather than the exact same tri-mode key.

Provider budgets are also provider-specific:

| Provider    | Budget examples                                                               |
| ----------- | ----------------------------------------------------------------------------- |
| Honcho      | `contextTokens`, `dialecticMaxChars`, `contextCadence`, `injectionFrequency`. |
| Hindsight   | recall token/input limits, budget, prefetch method.                           |
| Supermemory | max recall results, entity context, capture mode, custom containers.          |

The shared manager does not normalize these knobs. It only fences whatever text
`prefetch()` returns and routes whatever schemas `get_tool_schemas()` exposes.
So when debugging "why did memory not show up?", check both Hermes-level
activation and provider-level mode. It is the classic two-switches-for-one-lamp
problem.

### Prefetch Freshness

Providers are encouraged to make `prefetch()` fast. Many do this by returning a
cached result from a background thread that was queued by
`queue_prefetch()` after the previous turn.

Implications:

- the first turn may have little or no external context
- context can be one turn behind by design
- stale prefetch results should be discarded or scoped by `session_id`
- providers serving gateway/multi-session traffic should key caches by
  `session_id`

Honcho explicitly caches context by session key and supports cadence controls.
Mem0 and Supermemory use background threads. Providers should clear or refresh
cached state in `on_session_switch()` when compression, resume, branch, reset,
or new-session paths rotate the session id.

## Session Lifecycle and Compression

### Session End

At real session boundaries, `AIAgent.shutdown_memory_provider(messages)`:

1. calls `MemoryManager.on_session_end(messages)`
2. calls `MemoryManager.shutdown_all()`
3. calls context compressor `on_session_end()`

Used for CLI exit, gateway session expiry, reset paths, and similar actual
teardown boundaries.

### Session Commit Without Shutdown

`AIAgent.commit_memory_session(messages)` calls:

- `MemoryManager.on_session_end(messages)`
- context compressor `on_session_end()`

It does not call `shutdown_all()`. This is used when a session id rotates but
the provider should keep running, such as context compression or `/new` style
boundaries.

### Compression

In `agent/conversation_compression.py`:

1. `MemoryManager.on_pre_compress(messages)` fires before messages are
   summarized/dropped.
2. `agent.commit_memory_session(messages)` flushes extraction for the old
   session before rotation.
3. A new session id is created and linked with `parent_session_id`.
4. The system prompt is rebuilt.
5. `MemoryManager.on_session_switch(new_session_id, parent_session_id=old,
reset=False, reason="compression")` refreshes provider-cached session state.

This prevents providers from writing new turns into stale document or session
ids after compression. Although small, this issue can cause future memories to
be associated with the wrong session scope.

### Resume, Branch, New, Reset

`MemoryProvider.on_session_switch()` documents expected behavior for:

- `/resume`
- `/branch`
- `/reset`
- `/new`
- context compression

Providers with cached session ids, document ids, buffers, or counters should
update or reset them based on the `reset` flag and lineage kwargs.

## OpenClaw Migration

Hermes includes a migration path for OpenClaw and legacy Clawdbot/Moldbot
memory.

Public guide:

```text
website/docs/guides/migrate-from-openclaw.md
```

Command:

```bash
hermes claw migrate
```

The command is implemented as a two-phase flow: build a preview first, then
apply only after confirmation or `--yes`. It looks for the bundled
`optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py`
script first, then falls back to the user-installed copy under
`$HERMES_HOME/skills/migration/openclaw-migration/`.

Common options:

| Option                      | Meaning                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- | ------- | ------------------------------------------ |
| `--dry-run`                 | Preview without writing. This is the safest first command.                   |
| `--source <path>`           | Use a non-default OpenClaw directory.                                        |
| `--preset full`             | Select the full migration plan. Secrets are still excluded unless requested. |
| `--preset user-data`        | Migrate user data without secret material.                                   |
| `--overwrite`               | Replace conflicting Hermes targets instead of skipping them.                 |
| `--migrate-secrets`         | Explicitly allow migration of allowlisted secrets.                           |
| `--workspace-target <path>` | Copy workspace instructions to a chosen Hermes workspace.                    |
| `--skill-conflict skip      | overwrite                                                                    | rename` | Control imported OpenClaw skill conflicts. |
| `--no-backup`               | Skip the pre-migration Hermes backup.                                        |

Memory mapping:

| OpenClaw source         | Hermes destination                | Behavior                                                |
| ----------------------- | --------------------------------- | ------------------------------------------------------- |
| `workspace/MEMORY.md`   | `$HERMES_HOME/memories/MEMORY.md` | Parsed into entries, merged, deduped.                   |
| `workspace/USER.md`     | `$HERMES_HOME/memories/USER.md`   | Same entry-merge behavior.                              |
| `workspace/memory/*.md` | `$HERMES_HOME/memories/MEMORY.md` | Daily memory files are merged into main curated memory. |

Fallback OpenClaw workspace roots include `workspace.default/`,
`workspace-main/`, and `workspace-<agentId>/` patterns.

Source directory discovery checks `~/.openclaw`, then legacy `~/.clawdbot` and
`~/.moltbot` when `--source` is not provided.

Safety checks before apply:

- warns when OpenClaw still appears to be running, because messaging platforms
  can reject duplicate bot-token sessions
- warns when the Hermes gateway is running with active platform connections
- creates `config.yaml` if the migration script needs a target config file
- can create a pre-migration Hermes backup unless `--no-backup` is passed
- always prints a migration report so skipped/conflicting items are visible

Migration notes:

- imported memory takes effect in new sessions, because built-in memory uses a
  frozen system-prompt snapshot
- conflicting or unsupported material can be archived under
  `$HERMES_HOME/migration/openclaw/<timestamp>/archive/`
- OpenClaw memory backend config is archived for manual review rather than
  automatically becoming a Hermes provider
- API keys and tokens are not migrated by `--preset full` alone; the caller must
  also pass `--migrate-secrets`
- Honcho has its own migration helpers for uploading prior `MEMORY.md` and
  `USER.md` files into Honcho user memory
- after validating Hermes, `hermes claw cleanup` can archive leftover OpenClaw
  directories to `.pre-migration` names and reduce state confusion

This is a bridge between file-first OpenClaw memory and Hermes's smaller curated
memory store. It is not a 1:1 port of OpenClaw's indexing/dreaming machinery.

## Security and Safety

### Built-In Memory Content Scan

`_scan_memory_content()` blocks entries containing:

- invisible Unicode characters commonly used for injection
- prompt injection phrases such as ignoring previous instructions
- role hijack patterns
- deception/hiding instructions
- system prompt override phrases
- credential exfiltration via `curl`, `wget`, or secret file reads
- SSH backdoor markers
- references to `$HOME/.hermes/.env` or similar secret-bearing paths

This matters because built-in memory is injected into the system prompt.

### Toolset Gating

External provider tools are injected only when:

- a provider is active
- `agent.tools` exists
- platform `enabled_toolsets` is `None` or contains `"memory"`

This prevents disabled platform toolsets from accidentally inheriting provider
tools and latency.

### Context Scrubbing

Hermes fences external memory recall and scrubs it from streamed output. This
reduces the chance that recalled context leaks back to the user or gets captured
as new memory by a provider.

### Background Review Isolation

Background review uses `skip_memory=True` for external providers. Built-in
memory writes still happen through the parent's `MemoryStore`, but Honcho/Mem0
and friends do not ingest the review harness prompt.

### Interrupted Turns

External memory sync skips interrupted turns. Partial tool chains and unseen
assistant text are not durable conversational truth.

## Configuration Map

Built-in memory defaults live in `hermes_cli/config.py`:

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  user_char_limit: 1375
  provider: ""
```

`nudge_interval` is also read by `agent_init.py`, defaulting to `10` when absent.

Important paths:

| Path                              | Meaning                                        |
| --------------------------------- | ---------------------------------------------- |
| `$HERMES_HOME/memories/MEMORY.md` | Built-in agent notes.                          |
| `$HERMES_HOME/memories/USER.md`   | Built-in user profile.                         |
| `$HERMES_HOME/state.db`           | Session/message database for `session_search`. |
| `$HERMES_HOME/.env`               | Provider secrets written by setup.             |
| `$HERMES_HOME/plugins/<name>/`    | User-installed memory providers.               |
| `$HERMES_HOME/<provider>.json`    | Common provider-native config location.        |

Provider setup is split:

| Surface               | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `memory.provider`     | Active provider selector. Empty means built-in only. |
| provider config file  | Non-secret provider settings.                        |
| `.env`                | Provider secrets/API keys.                           |
| provider-specific CLI | Extra commands only for active provider.             |

## Failure Modes

| Area                                           | Failure mode                                                                 | Expected behavior |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| Built-in memory disabled                       | No `MemoryStore`; `memory` tool returns unavailable error.                   |
| Memory file missing                            | Read returns empty entries; directory is created on load/write.              |
| Duplicate add                                  | Success response says no duplicate added.                                    |
| Over capacity                                  | Mutation refused with current entries and usage.                             |
| Multiple substring matches                     | Replace/remove refused unless matches are identical.                         |
| Injection/exfil pattern                        | Mutation refused before persistence.                                         |
| External drift                                 | Backup written and mutation refused.                                         |
| File lock unavailable                          | Locking becomes no-op; atomic replace still protects readers.                |
| Atomic write fails                             | Runtime error from `_write_file()`.                                          |
| External provider not configured               | No provider manager or no provider tools.                                    |
| Provider `is_available()` false                | Provider is not activated.                                                   |
| Provider init fails                            | Warning logged; agent continues.                                             |
| Provider prefetch fails                        | Debug logged; other memory continues.                                        |
| Provider sync fails                            | Warning/debug logged; user response not blocked.                             |
| Provider tool throws                           | Manager returns a tool error JSON string.                                    |
| Second external provider                       | Registration rejected with warning.                                          |
| Provider mode is `tools`                       | No automatic provider context; only provider tools are exposed.              |
| Provider mode is `context`                     | Automatic context is available; provider tools may be hidden.                |
| Provider budget too small                      | Recall works but returns thin/truncated context.                             |
| First external-memory turn                     | Background-prefetched providers may have no cached recall yet.               |
| Session switch during prefetch                 | Providers should drop old cached recall in `on_session_switch()`.            |
| Interrupted turn                               | External sync and queue-prefetch skipped.                                    |
| Session DB unavailable                         | `session_search` returns formatted unavailable error.                        |
| WAL incompatible filesystem                    | `state.db` falls back to DELETE journal mode with one warning.               |
| FTS query fails                                | `session_search` returns search failure JSON.                                |
| CJK short query                                | Uses LIKE fallback when trigram cannot match.                                |
| Background review setup issue                  | Best-effort; failures are swallowed/logged.                                  |
| Streaming memory fence unterminated            | Scrubber discards remaining hidden span.                                     |
| OpenClaw source missing                        | `hermes claw migrate` prints source guidance and exits without writing.      |
| OpenClaw migration script missing              | Migration command reports both expected script locations.                    |
| OpenClaw/Hermes gateway still running          | Migration warns before applying because bot-token sessions can conflict.     |
| Migration conflicts                            | Preview/report lists conflicts; default behavior skips unless `--overwrite`. |
| Secret migration expected from `--preset full` | Secrets remain excluded unless `--migrate-secrets` is passed.                |

## Maintenance Checklist

When changing this system:

- If memory file format changes, update `ENTRY_DELIMITER`, parsing, rendering,
  drift detection, docs, and migration behavior.
- If memory limits change, update defaults in `hermes_cli/config.py`, docs, and
  tests around capacity errors.
- If prompt injection scanning changes, update `tools/memory_tool.py` tests and
  consider false positives on legitimate user content.
- If the frozen snapshot model changes, audit prefix-cache assumptions in
  `agent/system_prompt.py`, `conversation_loop.py`, gateway resume behavior, and
  background review parity.
- If `memory` tool schema changes, update `agent/tool_executor.py`,
  `agent_runtime_helpers.py`, ACP/TUI adapters, docs, and provider mirroring.
- If provider tool injection changes, preserve duplicate-name handling and
  platform toolset gating.
- If `MemoryProvider` gains hooks, update `MemoryManager`, provider developer
  docs, tests, and all bundled providers that should implement them.
- If `on_memory_write()` metadata changes, keep legacy positional providers
  compatible through `_provider_memory_write_metadata_mode()`.
- If session id rotation changes, audit `on_session_switch()` paths for resume,
  branch, reset, new, and compression.
- If compression lifecycle changes, preserve `on_pre_compress()`,
  `commit_memory_session()`, and provider session switch ordering.
- If `session_search` result shape changes, update tool schema, ACP/TUI
  formatting, docs, and tests.
- If `state.db` schema changes, update `SCHEMA_VERSION`, migrations, FTS
  triggers/backfill, and search tests.
- If background review changes, ensure external providers remain skipped and
  built-in memory writes still land through the parent store.
- If provider discovery changes, preserve bundled precedence and active-provider
  CLI gating.
- If provider mode/budget knobs change, update the provider README, setup/status
  CLI, `Provider Modes and Budgets`, and any provider-specific tests.
- If prefetch caching changes, audit session-id scoping, turn ordering, and
  `on_session_switch()` stale-result clearing.
- If OpenClaw migration mapping changes, update `hermes_cli/claw.py`, the
  openclaw-migration skill, the public migration guide, migration tests, and
  this document.
- If migration safety posture changes, keep preview-first behavior, gateway
  warnings, backup behavior, conflict reporting, and explicit secret migration
  aligned across CLI help and docs.

Useful tests:

- `tests/tools/test_memory_tool.py`
- `tests/tools/test_memory_tool_schema.py`
- `tests/tools/test_memory_tool_import_fallback.py`
- `tests/tools/test_session_search.py`
- `tests/agent/test_memory_provider.py`
- `tests/agent/test_memory_user_id.py`
- `tests/agent/test_memory_session_switch.py`
- `tests/agent/test_streaming_context_scrubber.py`
- `tests/cli/test_branch_command.py`
- `tests/run_agent/test_memory_provider_init.py`
- `tests/run_agent/test_memory_nudge_counter_hydration.py`
- `tests/run_agent/test_memory_sync_interrupted.py`
- `tests/run_agent/test_commit_memory_session_context_engine.py`
- `tests/run_agent/test_background_review.py`
- `tests/hermes_cli/test_memory_reset.py`
- `tests/hermes_cli/test_claw.py`
- `tests/hermes_cli/test_setup_openclaw_migration.py`
- `tests/gateway/test_memory_monitor.py`
- `tests/gateway/test_shutdown_memory_provider_messages.py`
- `tests/skills/test_openclaw_migration.py`
- `tests/skills/test_openclaw_migration_hardening.py`
- `tests/test_honcho_client_config.py`
- `tests/plugins/memory/test_hindsight_provider.py`
- `tests/plugins/memory/test_supermemory_provider.py`
- `tests/plugins/memory/test_mem0_v2.py`
- `tests/plugins/test_retaindb_plugin.py`
- provider-specific tests under `tests/plugins/memory/` and
  `tests/honcho_plugin/`

## Implementation References

| File                                                                         | Purpose                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tools/memory_tool.py`                                                       | Built-in `MemoryStore`, memory tool, limits, scan, drift guard, atomic persistence.    |
| `agent/prompt_builder.py`                                                    | Memory and session-search behavioral guidance.                                         |
| `agent/system_prompt.py`                                                     | Built-in and external memory prompt injection.                                         |
| `agent/agent_init.py`                                                        | Memory store/provider initialization and provider tool injection.                      |
| `agent/conversation_loop.py`                                                 | Memory nudge, provider prefetch, context injection, post-turn sync, background review. |
| `agent/tool_executor.py`                                                     | Runtime execution of `memory` and provider mirroring.                                  |
| `agent/agent_runtime_helpers.py`                                             | Helper dispatch path for `memory`, `session_search`, and provider tools.               |
| `agent/memory_provider.py`                                                   | External provider ABC and hook contract.                                               |
| `agent/memory_manager.py`                                                    | Provider orchestration, fencing, scrubbing, routing, lifecycle hooks.                  |
| `plugins/memory/__init__.py`                                                 | Provider discovery, loading, active provider CLI discovery.                            |
| `hermes_cli/memory_setup.py`                                                 | Provider setup/status command implementation.                                          |
| `hermes_cli/claw.py`                                                         | `hermes claw migrate` and cleanup command wrapper around the OpenClaw migration skill. |
| `optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py` | OpenClaw-to-Hermes migration engine and memory import mapping.                         |
| `hermes_state.py`                                                            | Session DB schema, WAL fallback, FTS indexes, search primitives.                       |
| `tools/session_search_tool.py`                                               | Browse/discover/scroll conversation recall tool.                                       |
| `agent/background_review.py`                                                 | Memory/skill review fork and metadata helpers.                                         |
| `agent/conversation_compression.py`                                          | Pre-compression hook, session commit, session rotation, provider switch notification.  |
| `gateway/memory_monitor.py`                                                  | Gateway process memory usage monitor.                                                  |
| `website/docs/user-guide/features/memory.md`                                 | Public built-in memory docs.                                                           |
| `website/docs/user-guide/features/memory-providers.md`                       | Public provider docs and comparison.                                                   |
| `website/docs/developer-guide/memory-provider-plugin.md`                     | Provider authoring guide.                                                              |
| `website/docs/guides/migrate-from-openclaw.md`                               | Public migration guide and post-migration checklist.                                   |
| `plugins/memory/honcho/`                                                     | Honcho provider implementation and CLI.                                                |
| `plugins/memory/openviking/`                                                 | OpenViking provider.                                                                   |
| `plugins/memory/mem0/`                                                       | Mem0 provider.                                                                         |
| `plugins/memory/hindsight/`                                                  | Hindsight provider.                                                                    |
| `plugins/memory/holographic/`                                                | Local SQLite/holographic provider.                                                     |
| `plugins/memory/retaindb/`                                                   | RetainDB provider.                                                                     |
| `plugins/memory/byterover/`                                                  | ByteRover provider.                                                                    |
| `plugins/memory/supermemory/`                                                | Supermemory provider.                                                                  |

## One-Screen Architecture

```text
Startup
  -> load built-in MemoryStore from $HERMES_HOME/memories
  -> capture frozen prompt snapshot
  -> load optional memory.provider
  -> initialize MemoryManager and provider
  -> inject provider tools if memory toolset is enabled

Prompt build
  -> stable/context prompt layers
  -> built-in MEMORY.md / USER.md snapshot
  -> provider system_prompt_block()
  -> date/session/model metadata

User turn
  -> memory nudge counter updates
  -> provider on_turn_start()
  -> provider prefetch_all(clean user message)
  -> fenced recall injected into current user message
  -> model may call memory/session_search/provider tools

Tool writes
  -> built-in memory validates, locks, reloads, detects drift
  -> atomic write to MEMORY.md or USER.md
  -> add/replace mirrored to external provider

Turn end
  -> provider sync_all(user, assistant)
  -> provider queue_prefetch_all(user)
  -> optional background review saves memory/skills

Compression/session boundary
  -> provider on_pre_compress()
  -> provider on_session_end()
  -> session id rotates
  -> provider on_session_switch()
```

## Practical Gotchas

- Built-in memory is compact by design. Put transcripts and old task details in
  `session_search`, not `MEMORY.md`.
- Mid-session `memory` writes do not alter the active system prompt snapshot.
- `memory` has no read action. Use tool responses or wait for the next session
  snapshot.
- `replace` and `remove` need a unique substring, not an ID.
- External providers are best-effort and additive.
- Background review intentionally skips external providers.
- `session_search` returns raw messages, not summaries.
- `state.db` may fall back from WAL to DELETE on network filesystems.
- Provider storage must use `hermes_home` for profile isolation.
- If recalled context appears in output, look at `StreamingContextScrubber`
  before blaming the provider; the context fence may be leaking.
