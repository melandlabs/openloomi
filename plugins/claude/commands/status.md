---
description: Print stable JSON status for the OpenLoomi ↔ Claude Code integration
argument-hint: ""
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:status

Run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup-status --json
```

Print the JSON to the user verbatim. Highlight:

- `mode`
- `ready`
- `nextAction` (when `ready` is false)
- `reason` (debug-friendly code)
- `claudeEnvSyncable` (whether Claude's env can already be pushed to OpenLoomi)
- `hooksInstalled` (whether `/openloomi:hooks install` has been run)

Do not change anything; this command is read-only.
