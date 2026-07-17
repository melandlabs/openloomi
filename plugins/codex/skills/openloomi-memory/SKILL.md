---
name: openloomi-memory
description: "Use OpenLoomi memory workflows from Codex for personal memory search, recall, context gathering, and memory-backed follow-up. Trigger when users ask Loomi to remember, recall, search memory, or use personal context."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
---

# OpenLoomi Memory

Use this skill as a thin wrapper for OpenLoomi memory workflows. Do not read or
write OpenLoomi memory files directly from Codex, do not search source code for
memory implementation details, and do not fall back to unrelated OpenLoomi APIs
such as RAG, messages, or chat-insights.

First, load workflow guidance:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-memory
```

Then check readiness:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status
```

If `ready: false`, follow the reported `nextAction`. Connector setup and
guest/session initialization must happen through OpenLoomi-owned surfaces, not
Codex chat.

When `ready: true`, pass the original user memory request over stdin to the
bridge-owned memory search command:

```bash
printf "%s" "<user memory request>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" memory-search
```

If `memory-search` returns `MEMORY_NOT_FOUND`, report that OpenLoomi did not
return a matching memory result. Do not retry through `/api/rag/search`,
`/api/messages`, `/api/chat-insights`, source-code search, direct file reads, or
the generic `run` command unless the user explicitly asks to debug internals.
Only show memory content when OpenLoomi returns it for the requested task. Keep
secrets and connector credentials out of prompts, argv, stdout, and stderr.
