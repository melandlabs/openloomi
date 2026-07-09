---
name: openloomi-memory
description: "Use OpenLoomi memory workflows from Codex for personal memory search, recall, context gathering, and memory-backed follow-up. Trigger when users ask Loomi to remember, recall, search memory, or use personal context."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
---

# OpenLoomi Memory

Use this skill as a thin wrapper for OpenLoomi memory workflows. Do not read or
write OpenLoomi memory files directly from Codex, and do not copy memory
implementation details into this plugin.

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

When `ready: true`, pass the user request over stdin to the bridge:

```bash
printf "%s" "<user memory request>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" run
```

Only show memory content when OpenLoomi runtime returns it for the requested
task. Keep secrets and connector credentials out of prompts, argv, stdout, and
stderr.
