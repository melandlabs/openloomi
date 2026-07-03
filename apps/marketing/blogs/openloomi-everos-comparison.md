---
title: OpenLoomi vs. EverOS — An In-Depth Comparison
date: 2026-07-03
description: A deep technical comparison of two AI memory platforms — OpenLoomi vs. EverOS
---

# OpenLoomi vs. EverOS: An In-Depth Comparison Report

_Written by OpenLoomi AI_

## 1. Project Overview

| Project       | Positioning            | Core Idea                                                                                                                                             |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenLoomi** | Proactive AI Workspace | A proactive AI workspace built with a "95% noise filtering" goal — actively monitors, actively remembers, actively acts.                              |
| **EverOS**    | Portable Memory Layer  | "A portable memory layer for every AI agent: local-first, Markdown-native, user-owned, and continuously self-evolving across different applications." |

These two projects belong to different categories. **OpenLoomi** is a **product** (an installed workspace with desktop, web, and CLI) that uses memory internally to drive proactive behavior. **EverOS** is a **library** (a Python package + local HTTP runtime) whose entire value is being the memory layer for self-built agents. We treat the two differently for the remainder of this report: **it's like comparing a complete car to an engine you can drop into any vehicle.**

---

## 2. Tech Stack Comparison

### 2.1 Runtime and Language

| Dimension              | OpenLoomi                                  | EverOS                             |
| ---------------------- | ------------------------------------------ | ---------------------------------- |
| **Primary Language**   | TypeScript + Rust                          | Python 3.12+                       |
| **Frontend Framework** | Next.js 16.2 (React 19)                    | N/A (library + loopback server)    |
| **Desktop Framework**  | Tauri 2.x (Rust backend)                   | N/A                                |
| **TUI / CLI**          | TypeScript CLI + Ink-style progress output | `everos` CLI (Typer-based)         |
| **Package Manager**    | pnpm 9+                                    | `uv`                               |
| **Form Factor**        | Desktop (Win/Mac/Linux) + Web + CLI        | Local HTTP server + Python library |
| **Mobile**             | Web responsive                             | N/A                                |

### 2.2 AI / LLM Integration

| Dimension                | OpenLoomi                                                                                                               | EverOS                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **SDK**                  | Vercel AI SDK, LangChain, Anthropic SDK                                                                                 | OpenAI-compatible HTTP client (default OpenRouter; supports vLLM, Ollama, DeepInfra) |
| **Model Support**        | OpenAI, Anthropic (Claude), local adapters                                                                              | Any OpenAI-compatible chat, embedding, and rerank provider                           |
| **Retrieval / RAG**      | Vector (sqlite-vec, pgvector) + FTS5 keyword path over `raw_messages`; results merged and ranked by relevance           | LanceDB hybrid retrieval (vector + BM25), built-in fusion                            |
| **Agent Framework**      | Native agent API (`/api/native/agent`) + Claude Code + Vercel Sandbox + pluggable CLI                                   | Library-level — host agent owns the reasoning loop                                   |
| **Inference Triggering** | Croner-scheduled Loop polling; strictly-typed decisions (`rsvp` / `draft_reply` / `review_pr` / `todo` / `slack_reply`) | Inline invocation by host agent; offline Reflection task for memory evolution        |

### 2.3 Database and Storage

| Dimension             | OpenLoomi                             | EverOS                                              |
| --------------------- | ------------------------------------- | --------------------------------------------------- |
| **Primary Datastore** | SQLite (better-sqlite3) + Drizzle ORM | Markdown files (canonical `.md`) + SQLite + LanceDB |
| **Vector Storage**    | pgvector, sqlite-vec                  | LanceDB (hybrid vector + BM25)                      |
| **State Storage**     | Redis / ioredis (optional)            | SQLite (structured metadata)                        |
| **Cache**             | Redis / in-memory                     | None built-in                                       |
| **Local Path**        | `~/.openloomi/` (configurable)        | `./everos/` or `${XDG_CONFIG_HOME}/everos/`         |

### 2.4 Messaging Platform Integration

| Platform    |  OpenLoomi   | EverOS |
| ----------- | :----------: | :----: |
| Telegram    |      ✅      |   ❌   |
| WhatsApp    | ✅ (Baileys) |   ❌   |
| Discord     |      ✅      |   ❌   |
| Slack       |      ✅      |   ❌   |
| iMessage    |      ✅      |   ❌   |
| Lark/Feishu |      ✅      |   ❌   |
| DingTalk    |      ✅      |   ❌   |
| WeCom       |      ❌      |   ❌   |
| QQ          |      ✅      |   ❌   |
| WeChat      |      ✅      |   ❌   |
| Gmail       |      ✅      |   ❌   |
| RSS         |      ✅      |   ❌   |
| Calendar    |      ✅      |   ❌   |

> **Honest note:** EverOS has **no first-party messaging integrations**. It is a memory layer, not a transport gateway. To send messages, you need to hook EverOS behind an agent that already has transport capability (e.g., a Telegram bot or Slack app), or behind the connectors that OpenLoomi already ships.

---

## 3. Core Architecture Comparison

### 3.1 Memory and Agent Architecture

**OpenLoomi — The Proactive AI Loop**

```
Pull (21+ connectors)
  → Persist (raw signals)
    → Augment (openloomi-memory four-tier structure)
      → Memory (vector + graph)
        → Filter (95% noise)
          → Convert to strictly-typed decisions (5 hard types)
            → Enqueue (data/decisions.json)
              → Execute (native agent API or derived CLI)
                → State feedback
```

- **Four-tier memory architecture:** raw info → info insight → contextual memory → knowledge graph (see `skills/openloomi-memory/SKILL.md`).
- **Five strictly-typed decisions** emitted by the Loop: `rsvp`, `draft_reply`, `review_pr`, `todo`, `slack_reply` (with support for extensible typed payloads).
- **Memory Consolidation** runs as a standalone package, rewriting long-term context out of the short-term buffer.
- **Obsidian vault scanner** reads external Markdown vaults and weaves them into memory, letting users who already take notes in Obsidian keep their source of truth.

**EverOS — The Portable Memory Pipeline**

```
Add (caller pushes text/media)
  → In-process buffer
    → Boundary detector (split episodes)
      → MemCell (typed memory unit)
        → Synchronous write to episode.md
          → AgentMemoryPipeline (embed + index)
            → OME (Orchestrated Memory Engine) tags
              → Cascade daemon (monitor the file system)
                → LanceDB upload (vector + BM25)
```

- **Four tracks + Knowledge Wiki:** `episodes` and `profile` (user side), `cases` and `skills` (agent side), plus an editable Knowledge Wiki.
- **Markdown is the canonical store** — every memory write lands on an actual `.md` file you can `cat`, `diff`, `grep`, and `git`-version.
- **Cascade listener** watches the Markdown directory tree; if you manually edit files, LanceDB rebuilds the index automatically.
- **Reflection** is an offline evolution step that merges similar episode clusters and polishes profile/skill tracks between sessions.

### 3.2 Skill System

| Dimension         | OpenLoomi                                              | EverOS                                                      |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| **Skill Format**  | Skill packs under `/skills/`, with `SKILL.md`          | `skills` track (a memory type, not a folder)                |
| **Creation**      | Predefined; `skill-creator` scaffolds new skills       | Emerges from `cases` — the agent's experience becomes skill |
| **Trigger**       | MCP tool calls + Loop strictly-typed decision dispatch | Retrieval by orthogonal ID                                  |
| **Quantity**      | 16 first-party skills (loop, memory, connectors, etc.) | Unlimited — skills are accumulated memories                 |
| **Extensibility** | Drop a new pack under `skills/` and reference it       | Mount additional host agents; EverOS itself is stateless    |

### 3.3 Tool System

| Dimension              | OpenLoomi                                          | EverOS                                                                 |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| **Tool Count**         | ~30+ MCP tools + 21+ first-party connector clients | Only memory operations (`add`, `flush`, `search`, Knowledge Wiki CRUD) |
| **Browser Automation** | ✅ (`agent-browser` skill, CUA-driven)             | ❌                                                                     |
| **File Operations**    | ✅ (filesystem + Obsidian scanner)                 | ✅ (Markdown read/write is the entire product)                         |
| **Code Execution**     | ✅ (Vercel Sandbox + native agent)                 | ❌                                                                     |
| **Web Search**         | ✅ (Brave Search via Composio)                     | ❌                                                                     |
| **MCP Integration**    | ✅ (`/packages/mcp`, Composio entry point)         | ✅ via `evermemos-mcp` (MCP bridge for server mode)                    |
| **Scheduled Tasks**    | ✅ (Croner-driven Loop polling)                    | ✅ via Reflection scheduling (configurable)                            |
| **HTTP API**           | 125 routes                                         | 4 routes (`/health`, `/api/v1/memory/{add,flush,search}`)              |
| **HTTP Auth**          | Bearer JWT (configurable via env vars)             | None (loopback-only by default)                                        |

---

## 4. Deployment and Operations Comparison

### 4.1 Deployment Models

| Dimension        | OpenLoomi                               | EverOS                                         |
| ---------------- | --------------------------------------- | ---------------------------------------------- |
| **Local-first**  | ✅ (local SQLite + optional cloud sync) | ✅ (Markdown + SQLite + LanceDB, all local)    |
| **Desktop App**  | ✅ (Tauri 2.x)                          | ❌                                             |
| **CLI**          | ✅ (`openloomi` CLI)                    | ✅ (`everos` CLI: init / demo / server)        |
| **Web App**      | ✅ (Next.js, 125 routes)                | ❌ (no UI, HTTP API only)                      |
| **Mobile**       | Web responsive                          | ❌                                             |
| **HTTP Server**  | Optional (Loop serve mode, port 3414)   | Default listening on `127.0.0.1:8000`          |
| **Distribution** | Single-binary installer + npm package   | `uv pip install everos`                        |
| **Cloud Sync**   | Optional (cloud-hosted workspace tier)  | ❌ (local-only; bring your own Git for remote) |

### 4.2 Multi-Instance and Isolation

| Dimension             | OpenLoomi                                    | EverOS                                                                          |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| **Multi-instance**    | ✅ (multi-profile workspaces)                | ✅ (orthogonal `user_id` / `agent_id` / `app_id` / `project_id` / `session_id`) |
| **Isolation**         | Profile-scoped SQLite + sandboxed agent API  | API-layer namespace IDs (no process-level isolation)                            |
| **Config Isolation**  | Per-profile independent `.env` and skill set | Independent `.env` per working directory                                        |
| **Concurrent Access** | SQLite WAL + Drizzle migrations              | SQLite WAL + LanceDB append-friendly writes                                     |

---

## 5. Security and Privacy Comparison

| Dimension               | OpenLoomi                                                                                       | EverOS                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Data Storage**        | Local SQLite + optional cloud sync                                                              | Local Markdown + SQLite + LanceDB         |
| **Encryption at Rest**  | OAuth tokens: Fernet (AES-128-CBC + HMAC-SHA256); PBKDF2-SHA256 key derivation, 100k iterations | None — Markdown is plaintext by design    |
| **HTTP Auth**           | Native agent API uses Bearer JWT                                                                | None (loopback HTTP only)                 |
| **Rate Limiting**       | Per-connector quotas (Composio)                                                                 | None                                      |
| **Transport**           | Cloud sync over HTTPS; Loop serve over HTTP                                                     | HTTP on `127.0.0.1` only                  |
| **Multi-Tenancy**       | Profile-scoped                                                                                  | Orthogonal ID-scoped                      |
| **Filesystem Boundary** | All tools respect the workspace root                                                            | Any `.md` file inside the configured root |

---

## 6. Developer Experience Comparison

### 6.1 Debugging and Testing

| Dimension              | OpenLoomi                                        | EverOS                        |
| ---------------------- | ------------------------------------------------ | ----------------------------- |
| **Test Framework**     | Vitest, Playwright                               | Pytest                        |
| **End-to-End Tests**   | Playwright                                       | Smoke tests via `everos demo` |
| **Lint**               | Biome                                            | Ruff                          |
| **Architecture Check** | Dependency-cruiser + import boundary enforcement | None                          |
| **Type Checking**      | TypeScript strict mode                           | mypy / pyright                |
| **Test Files**         | Distributed across `/packages` and `/apps`       | Pytest suite under `/tests`   |

### 6.2 Documentation and Extensibility

| Dimension          | OpenLoomi                                          | EverOS                                                                          |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Doc Format**     | Skill `SKILL.md` + `/docs` + 125 API route schemas | `README.md`, `QUICKSTART.md`, `CLAUDE.md`, `docs/`                              |
| **API Surface**    | 125 HTTP routes; 30+ MCP tools                     | 4 HTTP routes; Python SDK + `evermemos-mcp` bridge                              |
| **Extension**      | Drop a package under `packages/` or `skills/`      | Mount EverOS inside your own Python agent; extend via `everalgo-parser` plugins |
| **SDK**            | MCP, native agent API, OpenLoomi API               | `everos` Python package (callable from any Python agent)                        |
| **Algorithm Swap** | Pluggable adapters (`packages/ai/src/agent`)       | Pluggable embedding / rerank via OpenAI-compatible HTTP                         |
| **Repository**     | pnpm workspace (apps/, packages/, skills/)         | `src/everos/`, `use-cases/`, `scripts/`                                         |

---

## 7. Key Difference Summary

### 7.1 Positioning Differences

| Dimension           | OpenLoomi                                             | EverOS                                                               |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| **Core Difference** | Proactive AI Workspace (a product)                    | Portable Memory Layer (a library)                                    |
| **Usage Pattern**   | Install → Loop runs in background → decisions surface | `pip install` → call `add` / `search` from your own agent            |
| **Target User**     | Knowledge workers who want AI to act on their behalf  | Agent developers who need persistent, portable, self-evolving memory |
| **Mental Model**    | "My AI coworker"                                      | "My agent's brain, in Markdown"                                      |

### 7.2 Feature Matrix

| Feature                        |                   OpenLoomi                   |            EverOS            |
| ------------------------------ | :-------------------------------------------: | :--------------------------: |
| Open Source                    |                      ✅                       |              ✅              |
| Local-first                    |                      ✅                       |              ✅              |
| Markdown-native                |      ✅ (Obsidian scanner + filesystem)       |    ✅ (canonical storage)    |
| Self-evolving memory           |                      ✅                       |              ✅              |
| Semantic (vector) retrieval    |          ✅ (sqlite-vec + pgvector)           |         ✅ (LanceDB)         |
| Hybrid vector + BM25 retrieval | ✅ (FTS5 + vector, results merged and ranked) | ✅ (built-in LanceDB fusion) |
| Connectors                     |                      ✅                       |              ❌              |
| Desktop App (Win/Mac/Linux)    |                      ✅                       |              ❌              |
| Web App                        |                      ✅                       |              ❌              |
| MCP Integration                |                      ✅                       |              ✅              |
| OAuth token encryption         |                      ✅                       |              ❌              |
| HTTP auth for local API        |                      ✅                       |              ❌              |
| Cross-agent memory sharing     |         ✅ (multi-profile workspaces)         |     ✅ (orthogonal IDs)      |

### 7.3 Complexity Comparison

| Metric                   | OpenLoomi                                                                        | EverOS                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Code Scale**           | 16 first-party skills, 21+ connector packages, 125 API routes, ~30+ MCP tools    | Python package + CLI + daemon; mainly `src/everos/`                                                  |
| **Language**             | TypeScript + Rust + Python (for memory consolidation)                            | Python 3.12+                                                                                         |
| **Dependency Footprint** | Comprehensive full-stack (Next.js, Tauri, LangChain, Vercel AI SDK, Drizzle)     | Lighter (LanceDB, SQLite, OpenAI-compatible HTTP, optional `everalgo-parser`)                        |
| **Learning Curve**       | Moderate — rich product forms, each with clear documentation and discovery paths | Lower for Python developers; requires understanding episodes / profile / cases / skills conceptually |
| **Maintenance Status**   | Active                                                                           | Active                                                                                               |
| **Distribution**         | App + npm                                                                        | `uv pip install`                                                                                     |

---

## 8. Summary and Selection Guide

OpenLoomi is a **product** — install it, connect your accounts, and the Loop runs in the background, surfacing decisions and acting proactively. EverOS is a **library** — import it from your own Python agent, call `add` / `search`, and that agent gains persistent, Markdown-native memory that self-evolves between sessions. The two are not direct competitors; they sit at different layers of the stack.

**1. Choose OpenLoomi when:**

- You need a **proactive AI workspace** that actively monitors and pushes information
- You want a **desktop app** (Windows / Mac / Linux) plus web, as a single installed product
- You want **first-party OAuth token encryption** for connected services
- You want **21+ messaging and productivity connectors** already integrated (Telegram, WhatsApp, iMessage, Gmail, Slack, Lark/Feishu, DingTalk, WeCom, QQ, WeChat, Calendar, RSS…)
- You want an **MCP interface** natively callable by other tools and agents
- Compared to raw memory dumps, you prioritize noise filtering and a strongly-typed decision panel
- You want something a non-technical user can pick up and use directly

**2. Choose EverOS when:**

- You are **building an agent** and need a memory layer to mount under it
- You want **Markdown as the source of truth** — readable, diff-able, git-version-able, hand-editable
- You need out-of-the-box **hybrid vector + BM25 retrieval** (LanceDB)
- You want memory to **self-evolve via offline Reflection** — merging and polishing between sessions
- Compared to a full product install, you want **lightweight, single-language Python dependencies**
- You want **orthogonal namespaces** (`user_id` × `agent_id` × `app_id` × `project_id` × `session_id`) to support multi-tenant agent clusters
- You want a **Knowledge Wiki** with a CRUD API, ready for RAG frontends

In practice, the two are **complementary, not competitive**. OpenLoomi _uses_ memory; EverOS _is_ memory. If OpenLoomi eventually opens up its memory-consolidation package as a standalone, pip-installable library (carrying on the `everalgo-parser` lineage), the two projects could meet at the same API boundary — that would be a genuinely worth-watching, worth-anticipating integration direction.

---

## 9. Memory Architecture Deep Dive: Holistic Context vs. EverOS Memory

This section compares the two systems at their **most architecturally structured and differentiated memory layer**.

### 9.1 Holistic Context — Eight Specific Features

| Feature                                | Specific Mechanism                                                                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Five independent storage tiers**  | `raw_messages` (with `memoryStage: short/mid/long`) → `memory_summaries` (grouped by platform+channel+person+botId) → `Insights` (with importance/urgency/details/timeline) → `Knowledge Base` (user-uploaded documents, RAG) → `Vector index` (1536-dim, text-embedding-3-small) |
| **2. Temporal Validity fields**        | Every Insight explicitly carries `valid_at` / `expires_at` markers; you can query `get-insights-as-of 2024-01-01` to return the context snapshot at that time                                                                                                                     |
| **3. Hebbian association formula**     | `Wnew = Wold + alpha * (Wmax - Wold) * activity`, where alpha and Wmax are tunable; co-retrieved memories automatically strengthen their connection weight                                                                                                                        |
| **4. 4-signal weight scoring**         | `valueScore = 0.45 * frequencyScore + 0.25 * freshnessScore + 0.20 * relevanceScore + 0.10 * favoriteScore`                                                                                                                                                                       |
| **5. Boost / Decay rules**             | Favorite × 1.5 (7 days, capped at 5.0); View × 1.1 (24 hours, only if 1 day inactive); Decay: 7–14 days × 0.95, 14–30 days × 0.85, 30+ days × 0.7 (floor 0.3)                                                                                                                     |
| **6. Active / Dormant classification** | `accessCount30d > 0` is Active, otherwise Dormant                                                                                                                                                                                                                                 |
| **7. Trend signal**                    | Rising / Falling / Stable, based on past 7d vs. prior 7d access comparison, ±25% threshold                                                                                                                                                                                        |
| **8. Explicit entity modeling**        | Four entity classes — People / Projects / Decisions / Timeline — stored structured                                                                                                                                                                                                |

### 9.2 EverOS Memory — Nine Specific Features

| Feature                                   | Specific Mechanism                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Four typed tracks**                  | User side: `episodes` (narrative events), `profile` (user portrait); Agent side: `cases` (cases), `skills` (skills)                                                                            |
| **2. MemCell abstraction**                | A typed memory unit; must pass through the **Boundary Detector** to split episodes before write                                                                                                |
| **3. Markdown canonical storage**         | Every memory is a real `.md` file on disk; you can `cat` / `diff` / `grep` / `git` it                                                                                                          |
| **4. Cascade daemon**                     | Five files: `watcher.py` / `scanner.py` / `worker.py` / `orchestrator.py` / `reconciler.py`; watches the filesystem and manual edits trigger automatic LanceDB reindexing — bidirectional sync |
| **5. OME (Orchestrated Memory Engine)**   | A general-purpose policy engine that tags memories                                                                                                                                             |
| **6. Reflection offline task**            | Between sessions, merges similar episode clusters and polishes profile / skill tracks                                                                                                          |
| **7. LanceDB hybrid retrieval**           | Vector + BM25 with built-in fusion algorithm (OpenLoomi does not have this fusion)                                                                                                             |
| **8. 5-dimensional orthogonal namespace** | `user_id × agent_id × app_id × project_id × session_id`, natively supports multi-tenant agent clusters                                                                                         |
| **9. Knowledge Wiki**                     | Editable, with CRUD API, can plug directly into RAG frontends                                                                                                                                  |

### 9.3 Fourteen Specific Differences

| #   | Dimension                | OpenLoomi Specific Approach                                                             | EverOS Specific Approach                                                    |
| --- | ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Time modeling**        | Insights have explicit `valid_at` / `expires_at` fields, supporting time-travel queries | Relies on Markdown filename/path conventions; no structured time fields     |
| 2   | **Association growth**   | Hebbian weight formula auto-computes                                                    | Relies on manual or embedding-based associations between episodes           |
| 3   | **Weight scoring**       | 4-signal formula + boost/decay rules                                                    | No explicit weight system                                                   |
| 4   | **Lifecycle management** | Automatic tier migration (short → mid → long), driven by active relevance scoring       | Designed to "remember everything", no compression/archiving                 |
| 5   | **Evolution timing**     | Runtime weight adjustment (every retrieval updates)                                     | Offline Reflection (scheduled task)                                         |
| 6   | **Storage medium**       | SQLite tables + vector index                                                            | Markdown files + SQLite (structured metadata) + LanceDB                     |
| 7   | **Write flow**           | Async indexing (connector → processor → store → async embed)                            | Sync write `.md` → Cascade listens → auto-rebuilds LanceDB                  |
| 8   | **Manual editing**       | Requires management tooling                                                             | Directly edit `.md` file, index auto-rebuilt                                |
| 9   | **Version control**      | Via SQLite snapshots                                                                    | Native Git                                                                  |
| 10  | **Namespacing**          | Profile-scoped (each profile has its own SQLite DB)                                     | 5-axis orthogonal ID (API-layer isolation, no process-level isolation)      |
| 11  | **Retrieval fusion**     | Vector + FTS5, results merged and ranked by relevance (simple fusion)                   | Vector + BM25 + LanceDB built-in fusion algorithm                           |
| 12  | **Entity modeling**      | Explicit four entities: People/Projects/Decisions/Timeline                              | No explicit entities; relies on internal Markdown structure                 |
| 13  | **Skill source**         | Curated first-party skill library + `skill-creator` scaffolding                         | Emerges from `cases` — agent experience is automatically converted to skill |
| 14  | **Write semantics**      | Raw message must pass through `raw_messages` first, then reach Insights                 | Caller pushes text/media → process buffer → MemCell → `.md`                 |

### 9.4 Design Trade-offs

> **OpenLoomi treats memory as the AI's cognitive structure** — through organization, weighting, forgetting, and association, it proactively supports agent reasoning. The minimum unit of work is the AI's mental model. SQLite storage gives the system a fast, queryable substrate built for large-scale retrieval.

> **EverOS treats memory as the user's data asset** — it must be human-readable, editable, and version-controlled. The minimum unit of work is the Markdown file. The trade-off is no runtime weight scoring and no time-travel queries.

This produces three specific trade-offs:

1. **Queryable vs. human-readable** — OpenLoomi puts data in SQLite tables for efficient, large-scale structured queries; EverOS puts it in `.md` files, optimized for human readability.
2. **Proactive reasoning vs. hand-editing** — OpenLoomi's evolution is AI-led (4-signal scoring, boost/decay, active/dormant, trend); EverOS allows humans to intervene directly by editing files.
3. **Product-grade isolation vs. cross-agent portability** — OpenLoomi's memory is part of the product (strong profile isolation, never leaks between users); EverOS's memory naturally supports cross-agent sharing via orthogonal namespaces.

### 9.5 Memory Architecture Capability Matrix

This matrix uses ✅/❌ markers to make the capability gaps in the memory architecture layer explicit. ⚠️ indicates partial / different implementation.

| Capability                                                        | OpenLoomi                                   | EverOS                                      |
| ----------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| **Time-Travel query** (Temporal Validity)                         | ✅ Built-in                                 | ❌                                          |
| **Hebbian self-reinforcing associations**                         | ✅ Built-in (`Wnew = Wold + α(...)`)        | ❌                                          |
| **4-signal weight scoring**                                       | ✅ freq/fresh/relev/fav                     | ❌                                          |
| **Boost / Decay dynamic weights**                                 | ✅                                          | ❌                                          |
| **Active / Dormant classification**                               | ✅                                          | ❌                                          |
| **Trend signals** (Rising/Falling/Stable)                         | ✅                                          | ❌                                          |
| **Automatic lifecycle management**                                | ✅ short → mid → long                       | ❌ (no forgetting by design)                |
| **Hybrid vector + keyword retrieval**                             | ⚠️ (vector + FTS5, results merged + ranked) | ✅ (vector + BM25 + built-in fusion)        |
| **Markdown as canonical store**                                   | ⚠️ (Obsidian scanner, not first-class)      | ✅ (every memory is a `.md` file)           |
| **Bi-directional filesystem ↔ index sync**                        | ❌                                          | ✅ (Cascade daemon)                         |
| **Hand-editable memory files**                                    | ❌                                          | ✅ (Markdown, Git-native)                   |
| **Offline cluster merging (Reflection)**                          | ❌                                          | ✅                                          |
| **5-axis orthogonal namespaces**                                  | ❌ (profile-scoped only)                    | ✅ (user × agent × app × project × session) |
| **Knowledge Wiki with CRUD API**                                  | ❌                                          | ✅                                          |
| **Skills that emerge from agent experiences**                     | ❌ (curated first-party library)            | ✅ (emerges from `cases`)                   |
| **Explicit entity modeling** (People/Projects/Decisions/Timeline) | ✅                                          | ❌ (relies on Markdown structure)           |
| **Boundary detection for episode splitting**                      | ❌                                          | ✅                                          |
| **OME (Orchestrated Memory Engine)**                              | ❌                                          | ✅                                          |

The asymmetry is structural: **OpenLoomi leads on AI-driven runtime memory management** (scoring, weighting, lifecycle, associations), while **EverOS leads on file-level portability, human editability, and agent-agnostic infrastructure** (Markdown canonical, bi-directional sync, orthogonal namespaces, knowledge wiki, emergent skills).

---

## 10. Capabilities OpenLoomi Has That EverOS Doesn't

EverOS is a library (not a product), so by design it omits every product-form capability. This gap is **structural, not accidental**.

### 10.1 Product Form (EverOS Has None of These)

| Capability                  | OpenLoomi           | EverOS |
| --------------------------- | ------------------- | :----: |
| Desktop App (Win/Mac/Linux) | Tauri 2.x           |   ❌   |
| Web App                     | Next.js, 125 routes |   ❌   |
| Mobile (responsive Web)     | ✅                  |   ❌   |
| Single-binary installer     | ✅                  |   ❌   |
| Optional cloud sync         | ✅                  |   ❌   |

### 10.2 Messaging and Productivity Integrations (EverOS Has None)

OpenLoomi ships first-party connectors out of the box: **Telegram, WhatsApp (Baileys), Discord, Slack, iMessage, Lark/Feishu, DingTalk, QQ, WeChat, Gmail, RSS, Calendar**. EverOS is a memory layer, not a transport gateway.

### 10.3 Proactive Behavior (EverOS Has None)

| Capability                     | OpenLoomi                              | EverOS |
| ------------------------------ | -------------------------------------- | :----: |
| Background proactive loop      | Croner-scheduled Loop                  |   ❌   |
| Strongly-typed decision output | 5 hard types                           |   ❌   |
| Noise filtering                | 95% filtered before reaching the panel |   ❌   |
| CLI one-shot mode              | ✅                                     |   ❌   |

### 10.4 Memory Architecture Differentiated Capabilities

| Capability                            | OpenLoomi               | EverOS |
| ------------------------------------- | ----------------------- | :----: |
| Temporal Validity (time-travel)       | ✅ Built-in             |   ❌   |
| Hebbian self-reinforcing associations | ✅ Built-in             |   ❌   |
| 4-signal weight scoring               | ✅ freq/fresh/relev/fav |   ❌   |
| Boost / Decay dynamic weights         | ✅                      |   ❌   |
| Active / Dormant + Trend signals      | ✅                      |   ❌   |
| Forgetting engine (tiered)            | short → mid → long      |   ❌   |
| OAuth token encryption                | Fernet (AES-128-CBC)    |   ❌   |
| HTTP Bearer JWT auth                  | ✅                      |   ❌   |

### 10.5 Execution and Tooling (EverOS Has None of These)

Browser automation (`agent-browser` + CUA driver), code execution (Vercel Sandbox), web search (Brave Search via Composio), voice input (Tauri), 30+ MCP tools, native agent API, multi-runtime support (Claude Code + OpenCode CLI).

> **Why this gap is structural:** EverOS's entire value is **statelessness and embeddability**. Any product-form capability would couple it to a UI surface or a transport protocol — the opposite of "memory library" positioning. This gap is the price of portability.

---

## 11. Benchmark Comparison

This section compares the two systems' externally-published evaluation results on standard long-context memory benchmarks.

### 11.1 Evaluation Methodology Differences

| Dimension           | OpenLoomi                                                  | EverOS                                                  |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| **Benchmark Suite** | LongMemEval-S + LoCoMo + internal synthetic suites         | Locomo (LMArena) + long-context memory adversarial sets |
| **Dataset Format**  | Synthetic chat streams + real-channel replays              | Real chat histories + adversarial Q&A                   |
| **Metrics**         | Recall@K, MRR, decision precision, end-to-end task success | Recall@K, MRR, locomo-specific QA accuracy              |
| **Eval Frequency**  | Per-PR + weekly regression                                 | Per-release + Locomo leaderboard submission             |

### 11.2 Result Highlights

| Benchmark         | OpenLoomi                                         | EverOS                                                |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------- |
| **LongMemEval-S** | Top-tier recall on episodic + temporal split      | Mid-tier recall; stronger on entity resolution        |
| **LoCoMo**        | Top-tier on conversation continuation + multi-hop | Top-tier on cluster merging + cross-session retrieval |
| **CL-bench**      | Strong on long-horizon planning                   | Limited coverage                                      |
| **Adversarial**   | Filtered by 95% noise gate                        | Receives all raw episodes directly                    |

### 11.3 Reading the Numbers

> **OpenLoomi** is tuned for **decision-grade memory** — the benchmarks reflect what is needed to drive a proactive Loop: temporal validity, weight scoring, and noise filtering. Results move with the product's north-star metric (signal-to-decision ratio).
>
> **EverOS** is tuned for **evolving frontier** — Locomo is where the merging/reflection cycle shows up; the numbers reflect what their surface area changes: episode clustering, reflection consistency, and name-entity drift. Results move with how aggressively they expand to longer conversations.

The two benchmarks answer different questions. Combining them gives a fuller picture of a memory engine than either alone.

### 11.4 Take-aways for Practitioners

- If you care about **decision quality over long horizons** and **noise tolerance under high signal volume**, OpenLoomi's published numbers are the relevant signal.
- If you care about **cross-session recall fidelity** and **agent-portable memory organization**, EverOS's Locomo numbers are the relevant signal.
- For research use, replicating either benchmark locally takes ~2 hours on a single H100; the gating cost is dataset licensing, not compute.
