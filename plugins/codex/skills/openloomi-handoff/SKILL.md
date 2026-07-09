---
name: openloomi-handoff
description: "Use OpenLoomi handoff workflows from Codex to send current tasks to Loomi for follow-up, reminders, delegation, or later attention. Trigger when users ask to hand off, delegate, queue, remind, or follow up through Loomi."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
---

# OpenLoomi Handoff

Use this skill as a thin wrapper for OpenLoomi handoff workflows. Do not build a
separate task queue, reminder store, or persistence layer inside the Codex
plugin.

First, load workflow guidance:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-handoff
```

Then check readiness:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status
```

If `ready: false`, follow the reported `nextAction` before attempting handoff.
When `ready: true`, pass the handoff request over stdin:

```bash
printf "%s" "<handoff request>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" run
```

Include enough task context for OpenLoomi to create a follow-up, but do not
include secrets. OpenLoomi runtime owns handoff persistence and notification
routing.
