---
description: Walk the user through installing the optional composio skill and turning on screen memory
argument-hint: ""
allowed-tools: Bash(composio *), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs status *)
---

# /openloomi:connect

Walk the user through three independent opt-in steps. Each step is gated by
an explicit y/N from the user. NOTHING happens silently.

## Step 1 — Install the `composio` skill

```bash
composio --help   # surface availability
```

If `composio` is on PATH, ask:

> The composio skill lets you connect Slack, Gmail, GitHub, and 26 other
> connectors from inside Claude Code. Install it now? [y/N]

If the user agrees, follow the composio skill's own installation
instructions. Do NOT run `npm install -g` without consent.

## Step 2 — Enable screen memory

Tell the user:

> OpenLoomi Desktop has a "Screen Memory" toggle under Preferences → Brain.
> Turn it on to let Loomi summarize what you're looking at. Open the
> Preferences page now? (y/N — I'll print the deeplink once you confirm.)

Only on explicit y/N: print `openloomi://preferences/brain` as a clickable
hint, then continue.

## Step 3 — Connect at least one messaging connector

Suggest `openloomi-connectors` (which is the default skill set shipped with
OpenLoomi Desktop, not with this plugin). Defer to that skill for the
exact onboarding flow; do not duplicate OAuth logic here.

## Reminder

Never print or echo any tokens. Never pass `--api-key` flags. Never
download additional binaries. The plugin is intentionally read-mostly.
