---
name: openloomi-install
description: "OpenLoomi install & first-use setup helper for Codex. Use when the user wants to install OpenLoomi, configure it, or troubleshoot `INSTALL_REQUIRED` / `SOURCE_FOUND_APP_NOT_BUILT` / `SESSION_INITIALIZATION_REQUIRED` after running setup-status. Triggers: install openloomi, configure openloomi, setup openloomi, openloomi not installed, openloomi not finalized, install_required, install missing, guest session."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
---

# OpenLoomi Install Sub-skill

This sub-skill is auto-loaded when the user wants to install or fix OpenLoomi
on their machine. It composes `loomi-bridge` operations and never downloads
or executes anything outside the plugin's own scripts.

## Quick workflow

1. `node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status`
2. Based on `nextAction` / `reason`:

| Reason / nextAction | Action |
|---|---|
| `install_openloomi` / `INSTALL_REQUIRED` | OpenLoomi Desktop is not on this machine. Call `install-instructions` to show the platform plan. Only call `install-openloomi --confirm` after the user explicitly approves installation. |
| `SOURCE_FOUND_APP_NOT_BUILT` | A source checkout is present but the OpenLoomi Desktop GUI app has not been built yet. Recommend either building the source per the OpenLoomi repo's `apps/web/src-tauri/README.md` or installing the packaged Desktop release. |
| `open_openloomi` / `OPENLOOMI_API_UNREACHABLE` / `SESSION_INITIALIZATION_REQUIRED` | OpenLoomi is installed but the local API or guest/session token is not ready. Ask the user to open OpenLoomi Desktop once, or run `setup` so the bridge can launch/init through OpenLoomi-owned surfaces. |
| `run` / `READY_SESSION_BOOTSTRAP_PENDING` | Nothing to install. OpenLoomi is ready; the local API will mint a guest session on the next Codex handoff or runtime call. |

## Codex runtime setup

If the user is setting up OpenLoomi from Codex, explicitly asks to switch the
desktop runtime executor to Codex, or diagnostics show a native-agent provider
mismatch, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" codex-runtime-info
```

## Reminder: secrets contract

- The bridge never reads AI provider env vars and never reports provider readiness from `/api/preferences/ai` — it only checks whether the native Codex runtime is active via `/api/native/providers`. Provider configuration is the OpenLoomi runtime's job, surfaced through the desktop app's own settings UI.
- If the user pastes a key into chat, redact it: do NOT echo it back, and tell them to remove it from chat history.
- Never pass `--api-key` as an argv flag. The bridge has no such flag, by design.
- The bridge does not auto-install. Always require an explicit user confirmation before calling `install-openloomi --confirm`.
