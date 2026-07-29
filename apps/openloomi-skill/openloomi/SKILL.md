---
name: openloomi
description: Use local OpenLoomi from skill-based agent runtimes such as WorkBuddy to search memory, search/list/read/upload knowledge base documents, inspect connected accounts, and trigger OpenLoomi agent workflows through the local desktop API. Use for OpenLoomi, Loomi, memory search, knowledge base search or upload, connector status, Slack or email drafts, Notion or document summarization, and local-first personal assistant workflows.
---

# OpenLoomi

## Overview

Use this skill when the user wants a skill-hosted agent runtime to work through their local OpenLoomi Desktop app. Treat OpenLoomi as the source of truth for memory, connectors, credentials, and agent execution; this skill only routes requests to the local OpenLoomi API.

## First Checks

Start with a status check when the user asks to use OpenLoomi for the first time in a session, when the local runtime may be stopped, or when a command fails with a network or authentication error.

The wrapper command contract is documented in [references/tool-surface.md](references/tool-surface.md). The implementation lives at `scripts/openloomi.cjs`.

## Reuse Notes

When you implement the wrapper, reuse the existing OpenLoomi plugin scripts and route docs instead of inventing a new wire protocol:

- `plugins/codex/skills/openloomi-memory/scripts/openloomi-memory.cjs`
- `plugins/codex/skills/openloomi-connectors/scripts/openloomi-connectors.cjs`
- `apps/web/src-tauri/src/cli.rs`
- `benchmark/beam/src/memory-adapter.ts`
- `plugins/codex/scripts/loomi-bridge.mjs`
- `plugins/codex/skills/openloomi-api/SKILL.md`

## Workflow

1. Identify the requested OpenLoomi surface:
   - Memory or previous context: use `memory-search`.
   - Uploaded documents or knowledge base search: use `knowledge-search`.
   - Knowledge base inventory or document content: use `knowledge-list` or `knowledge-get`.
   - Knowledge base upload: confirm the exact file and intent first, then use `knowledge-upload`.
   - Connector status: use `connectors-list`.
   - Complex action, draft, summary, or cross-app task: use `agent-run`.

2. Keep secrets inside OpenLoomi-owned surfaces. Do not ask the user to paste API keys, OAuth tokens, app passwords, OpenLoomi bearer tokens, or local secure-storage values into chat.

3. Confirm before sending messages, scheduling actions, deleting data, disconnecting accounts, or making any external side effect. Drafting, summarizing, searching, and listing status are read-only unless the user explicitly asks to act.

4. Return the OpenLoomi result in plain language and preserve the structured JSON result when it contains useful ids such as `botId`, `accountId`, `documentId`, `decisionId`, or `actionId`.

## Common Flows

Read [references/examples.md](references/examples.md) for worked patterns:

- Search OpenLoomi memory for prior context.
- Search, list, read, or upload OpenLoomi knowledge base documents.
- Check whether Slack, Gmail, Notion, or other accounts are connected.
- Draft an email without sending it.
- Summarize a Notion page or another connected document.

## Failure Handling

If the local API is unreachable, tell the user to open OpenLoomi Desktop and retry the status check. If authentication is missing, tell the user to complete OpenLoomi Desktop setup so the home directory's `.openloomi/token` file is created. Do not invent memory or connector data when OpenLoomi is unavailable.

If the wrapper command is unavailable, report that the skill bundle is installed incorrectly or incompletely and ask the user to reinstall the uploaded bundle.
