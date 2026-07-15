---
name: openloomi-loop
description: "Use OpenLoomi loop workflows from Codex for attention loops, prioritization, wrap-up, follow-up, and work-state routing. Trigger when users ask Loomi to plan, prioritize, monitor, loop, summarize, follow up on work, register a loop type / decision type, add a custom Composio-backed signal channel, register a deterministic classifier rule, or dry-run a loop rule."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
metadata:
  version: 0.7.7
---

# OpenLoomi Loop

Use this skill as a thin wrapper for OpenLoomi loop workflows. Do not implement
loop scheduling, decision storage, connector checks, or memory logic in Codex.
OpenLoomi runtime owns those behaviors.

First, load workflow guidance:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-loop
```

Then check readiness:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status
```

If `ready: false`, follow the reported `nextAction` and do not continue the
loop task yet. Guest/session initialization must happen through OpenLoomi-owned
surfaces. Never ask for API keys, OAuth tokens, connector secrets, or
OpenLoomi auth tokens in Codex chat.

When `ready: true`, wrap the user request with the `taskPromptPrefix` returned
by `workflow-guidance`, then pass that runtime-safe prompt over stdin to the
bridge:

```bash
printf "%s" "<taskPromptPrefix>\n\nOriginal user request: <user loop request>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" run
```

Do not send wording that asks the inner runtime to invoke Codex plugins,
OpenLoomi plugins, skills, shell commands, or `loomi-bridge`. Keep all
persistence, connector state, memory access, and follow-up scheduling inside
OpenLoomi runtime.
