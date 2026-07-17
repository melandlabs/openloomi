---
name: openloomi-install
description: "OpenLoomi install & first-use setup helper for Claude Code. Use when the user wants to install OpenLoomi, configure it, or troubleshoot `OPENLOOMI_NOT_INSTALLED` / `OPENLOOMI_NOT_FINALIZED` errors after running `/openloomi:setup` or `/openloomi:status`. Triggers: install openloomi, 配置 openloomi, setup openloomi, openloomi not installed, openloomi not finalized, install_required, install missing."
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# OpenLoomi Install Sub-skill

This sub-skill is auto-loaded when the user wants to install or fix OpenLoomi
on their machine. It composes `loomi-bridge` operations and never downloads
or executes anything outside the plugin's own scripts.

## Quick workflow

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup-status --json`
2. Based on `nextAction` / `reason`:

| Reason / nextAction | Action |
|---|---|
| `OPENLOOMI_NOT_INSTALLED` | Run `loomi-bridge install [--yes]` after explicit y/N — OpenLoomi Desktop is not on this machine. |
| `OPENLOOMI_NOT_FINALIZED` / `launch_openloomi_to_finalize` | OpenLoomi.app is installed (`desktopMarker` set) but the helper binary isn't on disk yet. Tell the user to launch OpenLoomi once (macOS: `open -a "<desktopMarker>"`) so it lays down the helper, then re-run `/openloomi:setup`. **Do NOT install.** |
| `LOGIN_REQUIRED` | Ask user to open OpenLoomi Desktop to sign in. Run `setup-status` again afterwards. |
| `AI_PROVIDER_REQUIRED` | OpenLoomi has no authenticated Claude runtime and no per-user provider row. Point the user at running `claude auth login` (then re-run `/openloomi:setup`), or at OpenLoomi Desktop → API Settings for a custom endpoint. |
| `SOURCE_FOUND_CLI_NOT_BUILT` | Show the build instructions from the OpenLoomi repo's `apps/web/src-tauri/README.md` or recommend running the bundled installer instead. |
| `READY` | Nothing to do. |

## Reminder: secrets contract

- This plugin never handles AI provider API keys. AI provider
  configuration lives in the OpenLoomi runtime itself; the runtime
  detects the user's local `claude` CLI auth on its own.
- If the user pastes a key into chat, redact it: do NOT echo it back,
  and tell them to remove it from chat history.
- Never pass `--api-key` as an argv flag — there's no such flag in the
  plugin, by design.
