---
name: openloomi-hooks
description: "OpenLoomi × Claude Code hooks installer. Use when the user wants Claude Code's lifecycle (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop, Notification) to mirror onto the Loomi Pet, or wants to auto-archive every Stop into OpenLoomi memory. Triggers: install hooks, /openloomi:hooks, hooks install, hooks uninstall, hooks status, mirror claude on pet, auto-archive stop."
metadata:
  version: 0.1.0
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# OpenLoomi Hooks Sub-skill

The plugin ships a hook bundle in `hooks/hooks.json` but **never installs it
automatically**. Users must explicitly run one of:

- `/openloomi:hooks install` — merge the bundle into `~/.claude/settings.json`
- `/openloomi:hooks uninstall` — strip only the plugin's block (other
  plugins' hooks are preserved)
- `/openloomi:hooks status` — report whether the bundle is currently active

Under the hood this calls:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs install-hooks
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs uninstall-hooks
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs hooks-status
```

## Safety guarantees

- `install-hooks` is **merge-no-overwrite**: only adds the plugin's block
  under `hooks.__openloomi_claude_plugin_hooks__`. Existing hooks for
  other plugins are not touched.
- `uninstall-hooks` removes only the plugin-marked block; rerunning it
  after the first time reports `removed: false`, never deletes anything
  else's hooks.
- The merge is atomic (`writeFile` to a temp file, then `rename`).
- The Stop hook **always exits 0** — archive failures are reported as
  JSON `{continue: true, _openloomi: {archive: "skipped", reason: ...}}`
  so they can never block Claude Code's response stream.

## Suggested user prompt

> This plugin can mirror Claude Code's lifecycle onto your Loomi Pet. To
> enable this, run `/openloomi:hooks install`. To disable, run
> `/openloomi:hooks uninstall`. The plugin never modifies your
> `~/.claude/settings.json` without explicit consent.
