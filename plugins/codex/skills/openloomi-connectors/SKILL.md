---
name: openloomi-connectors
description: "Use OpenLoomi connector readiness guidance from Codex for Slack, Gmail, Calendar, GitHub, and other integrations. Trigger when users ask whether connectors are configured, need setup, or block a Loomi workflow."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
metadata:
  version: 0.7.6
---

# OpenLoomi Connectors

Use this skill as a thin wrapper for connector readiness guidance. Do not
implement connector protocols in Codex and do not ask users to paste OAuth
tokens, API keys, bot tokens, cookies, or connector secrets into Codex chat.

First, load workflow guidance:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-connectors
```

Then check readiness:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status
```

Report connector state as status and next action only. If a connector is
missing or unavailable, guide the user to OpenLoomi-owned setup surfaces. If the
runtime is ready and the user asks for a connector-backed task, pass the request
over stdin:

```bash
printf "%s" "<user connector request>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" run
```

Keep connector authentication, sync, message access, and platform-specific
actions inside OpenLoomi runtime.
