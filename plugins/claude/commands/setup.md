---
description: Run OpenLoomi one-time setup (discover → install → login → sync Claude env → status)
argument-hint: ""
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:setup

Run the OpenLoomi setup wizard via `loomi-bridge setup`. The bridge decides
whether to install, sync env, or report a friendly message — your job is
just to call it, read the JSON, and surface the right `nextAction` to the
user. Do NOT preemptively call `install` based on ctl presence; the bridge
is the single source of truth for what to do next.

## Steps

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup --bin-path <if user provided>`
2. Read the JSON result. Report to the user:
   - Current `mode` (`packaged` | `source` | `unconfigured`)
   - Whether `ready` is true
   - Which `nextAction` they should follow if not ready (see table below)
   - Whether the env sync succeeded (and never echo key contents)

## nextAction decision tree

| `nextAction`                   | What to tell the user / do                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none)_ / `READY`             | "OpenLoomi is ready." Show `mode` and `version`.                                                                                                                                                                                                                                                                                                       |
| `launch_openloomi_to_finalize` | OpenLoomi.app is installed at `desktopMarker` but the helper binary isn't on disk yet. Show the platform command (e.g. `open -a "<desktopMarker>"`) and tell them to launch OpenLoomi once, then re-run `/openloomi:setup`. **Do NOT install.**                                                                                                        |
| `install_openloomi`            | Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup --yes` after explicit y/N. (The `--yes` flag tells the bridge the consent is already collected — the bridge runs non-interactively from Claude Code's Bash tool, so without `--yes` it would silently cancel.)                                                                          |
| `login_required`               | Two options for the user: (1) open OpenLoomi Desktop and sign in, then re-run setup, OR (2) re-run `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup` and the bridge will mint a one-tap guest bearer automatically when `canGuestLogin: true`. Guest accounts live locally; the existing account flow is required for cloud-backed features. |
| `set_ai_provider`              | Run `loomi-bridge sync-claude-env` if `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set; otherwise walk the user through OpenLoomi Desktop Preferences → API Settings.                                                                                                                                                                            |
| `build_cli_from_source`        | Show the build command from the OpenLoomi repo's `apps/web/src-tauri/README.md`.                                                                                                                                                                                                                                                                       |

The bridge's stdout output is authoritative. Never invoke the platform
install script (`setup.{macos,linux,windows}.*`) directly — only the
bridge may run it, and only after explicit y/N consent.
