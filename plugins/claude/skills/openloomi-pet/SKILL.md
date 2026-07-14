---
name: openloomi-pet
description: "OpenLoomi Pet sprite & state helper for Claude Code. Use when the user wants to change their Loomi Pet state, list the available states, or ask Claude to mirror its lifecycle onto the pet. Triggers: pet state, /openloomi:pet, set pet, loomi pet, pet to happy, pet to working, pet to thinking, fox sprite, capybara sprite."
metadata:
  version: 0.7.6
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# OpenLoomi Pet Sub-skill

The Loomi Pet has 9 universal state names. The plugin ships the fox
(`loomi-*`) sprite set for branding; the OpenLoomi runtime's
`map_state_to_pet` watcher renders the matching sprite for whichever
theme you have active (fox or capybara). State set:

| State | When to use |
|---|---|
| `happy` | A task just completed successfully |
| `idle` | Loomi is waiting for the next loop tick (watcher-only — do not set from Claude) |
| `juggling` | Multiple sub-agents are running |
| `needsinput` | Permission prompt / elicitation dialog visible |
| `presenting` | Fresh decision requires the user's review (watcher-only — do not set from Claude) |
| `sleeping` | Local hour outside 6–22 with no pending work (watcher-only — do not set from Claude) |
| `sweeping` | User dismissed a card just now (watcher-only) |
| `thinking` | Between steps, awaiting LLM response |
| `working` | A tool call is in progress (`PreToolUse` hook fires this) |

## Available commands

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs pet <state>` — synchronous, returns JSON; use only when the user explicitly asks.
- Hooks call `state <name>` automatically (fire-and-forget, 2s timeout).

Sprite set is hardcoded in the bridge — invalid state names are rejected
before any HTTP call. The endpoint `POST /api/pet/state` may not yet exist
in the target OpenLoomi runtime; the bridge falls back to "would have set
state to X — pending OpenLoomi endpoint" without raising an error.
