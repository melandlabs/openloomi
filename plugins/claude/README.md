# Claude Code OpenLoomi Plugin

Talk to a local OpenLoomi runtime from inside Claude Code.

[OpenLoomi](https://github.com/melandlabs/openloomi) is a local-first desktop
app that holds your memory, runs background tasks, and talks to your connected
apps (Gmail, Slack, GitHub, Calendar, Linear, …). This plugin turns Claude
Code into a front-end for that local runtime — Claude Code stays your coding
surface, OpenLoomi does the long-running and cross-app work in the background.

You keep using Claude Code the way you already do. OpenLoomi runs next to it,
on your machine.

The plugin installs as an `/openloomi:*` slash-command namespace. It never
duplicates OpenLoomi's business logic — every side effect hits your local
OpenLoomi runtime (the desktop app's HTTP API on `127.0.0.1:3414`, fallback
`127.0.0.1:3515`, or its bundled helper CLI).

---

## What you can do with it

- **Run first-use setup in one command.** `/openloomi:setup` discovers your
  OpenLoomi install, downloads it if missing, launches the desktop app, waits
  for the local API, and mints a guest session token. Nothing GUI is required
  from you.
- **Drive the Loomi Pet.** `/openloomi:pet happy` flips the pet sprite from
  your terminal — useful as a heartbeat signal while Claude Code is grinding
  on a long task.
- **See today's LLM cost.** `/openloomi:usage` summarizes token usage and
  spend without leaving the session.
- **Mirror Claude Code's lifecycle onto OpenLoomi (opt-in).** With hooks
  installed, every Claude Code turn gets archived into OpenLoomi's memory,
  and every lifecycle event flips the pet sprite accordingly. You keep full
  control — install/uninstall with one command, no `~/.claude/settings.json`
  is ever modified unless you ask.

OpenLoomi still owns the heavy lifting: local memory storage, connector
credentials, scheduled tasks, the desktop UI, secrets. Claude Code just
gets a doorway into all of it.

---

## Install

Pick the channel that matches your situation.

### Install from GitHub

```text
/plugin marketplace add melandlabs/plugins
/plugin install openloomi
```

Run each line separately in a Claude Code session — slash commands can't be
chained with `&&`. The first line adds the slim OpenLoomi marketplace
([`melandlabs/plugins`](https://github.com/melandlabs/plugins), which only
contains the plugin payloads); the second installs the `openloomi` plugin
from it. Then **restart Claude Code** and run `/openloomi:setup` in a fresh
session so the plugin cache is refreshed and the wizard can wire up the
desktop app.

### Install from a local checkout (plugin contributors)

```text
git clone https://github.com/melandlabs/plugins.git
cd plugins
claude --plugin-dir openloomi/claude
```

The `--plugin-dir` flag points Claude Code at the source checkout so your
edits are picked up live — useful when hacking on the plugin itself.

### Requirements

- Claude Code with slash-command and plugin marketplace support.
- For the GitHub install: network access to `github.com`.
- For the local install: a writable clone of the OpenLoomi repo.
- **OpenLoomi Desktop installed** — the wizard will install it for you if
  it's missing, but you'll need a working browser session to download the
  official release if it can't be reached automatically.
- Claude Code's host `claude` CLI authenticated (`claude auth login`) — the
  OpenLoomi runtime auto-detects this and uses it as its default provider,
  with no API key sharing between Claude Code and OpenLoomi.

Inside any session, `/openloomi:help` lists all 8 commands.

---

## First-run setup

```text
/openloomi:setup
```

A fully automated wizard: **install → launch → wait API → guest login →
ready**. Nothing GUI is required. The bridge:

- downloads & installs OpenLoomi Desktop if missing,
- launches the desktop app via `open -a`,
- polls the local HTTP API until it answers,
- calls `POST /api/remote-auth/guest` to register a guest user in the
  runtime's local DB and mint a bearer token (saved to
  `~/.openloomi/token`).

Before the launch step the bridge also writes
`OPENLOOMI_LAUNCH_MODE=plugin` into the environment the desktop
process will inherit. On macOS that's `launchctl setenv` so the value
survives the `open -a` hand-off through LaunchServices; on Linux the
spawn site injects the value into the `env` block as a belt-and-braces
guard against a hook scrubbing the parent env. The desktop reads this
to route pet left-clicks to the compact status card instead of the
main dashboard — surfacing two windows for the same chat would be
confusing because the plugin already owns the conversation in your
terminal. The pet right-click menu and the card's "Open in
dashboard" CTA remain as explicit escape hatches to the main window
if you want to land on `/loop` directly. The flag is unset if you
double-click the desktop icon, so standalone sessions keep their
long-standing one-click-to-dashboard behaviour.

The env write is recorded in `steps[]` as `launch_mode_env` immediately
before the corresponding `launch` / `launch_gui` entry. Operators can
read the audit trail to confirm whether the wizard actually tagged the
desktop process — failures here are non-fatal (the spawn still succeeds;
pet left-click falls back to standalone behaviour) so the step carries
`{ ok, platform, method, error? }` rather than blocking `ready`.

The only thing it ever prompts for is the install y/N — and only if the
shell has a TTY. From Claude Code's Bash tool you pass `--yes`.

This plugin does **not** touch AI provider configuration. The OpenLoomi
runtime self-closes that loop itself — it detects your local `claude` CLI
auth and uses it as the default provider, with no key-sharing between
Claude Code and OpenLoomi.

A successful run prints `{setup: "ready", steps: [...]}` — you're done.

---

## End-to-end user flow

> **Want to see what this looks like in motion?** Read the dedicated
> [Tour guide →](https://openloomi.ai/docs/plugins/claude) — from "ask Claude Code to install
> the plugin" through "custom Loop type fires on the next decision".

The TL;DR of the full path: **install the plugin → land in a ready Claude
Code session → see the Loomi Pet pop on the desktop (fox theme) → flip the
theme to capybara via the right-click menu → call `/openloomi:status` for
the canonical JSON → opt into the Pet-mirror + Stop-archive hooks via
`/openloomi:hooks` → connect external apps via `/openloomi:connect` → and
finally watch OpenLoomi's Loop surface decision cards in the desktop app**,
all driven by slash commands you typed in Claude Code.

The screenshots in the Tour guide are the canonical reference for the
visual state of the system at every step. The remainder of this README is
for command behavior, configuration, and contributor reference.

---

## Daily use

| Command                 | What it does                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `/openloomi:pet happy`  | Set Pet state — also `idle juggling needsinput presenting sleeping sweeping thinking working`      |
| `/openloomi:usage`      | Today's LLM tokens / cost                                                                          |
| `/openloomi:connect`    | Guided install of composio skill + screen memory (3 independent y/N)                               |
| `/openloomi:status`     | Stable JSON: `mode / installed / ready / nextAction / reason`                                      |
| `/openloomi:loop`       | Loop dashboard snapshot (pending decisions, connectors, last tick) — doorway into `openloomi-loop` |
| `/openloomi:memory <q>` | Search memory + knowledge base + insights — doorway into `openloomi-memory`                        |

Failure modes surface as structured JSON — never stack traces. See the
[Troubleshooting](#troubleshooting) section for the full `reason` table.

---

## Optional: Pet mirror + Stop archive

The plugin **never** modifies `~/.claude/settings.json` unless you opt in:

```text
/openloomi:hooks install     # append a marked block; other plugins untouched
/openloomi:hooks status      # see what's installed
/openloomi:hooks uninstall   # strip only our block
```

After install, 8 lifecycle events map to Pet states:

| When Claude Code…                                 | Pet state         |
| ------------------------------------------------- | ----------------- |
| starts a session                                  | `greet`           |
| receives your prompt                              | `thinking`        |
| starts a Bash / Edit / Write / Read / Grep / Glob | `working`         |
| finishes a tool call                              | `thinking`        |
| starts a subagent                                 | `juggling`        |
| shows a permission prompt                         | `needsinput`      |
| completes the turn                                | archive → `happy` |

The bridge is theme-agnostic — it sends state names; the OpenLoomi
`map_state_to_pet` watcher picks the matching sprite from whichever set is
active (the plugin ships fox; capybara is also supported and falls back
`greet → presenting`).

### Custom pet themes & sprite overrides

The pet's look is **file-driven**, not bridge-driven. The plugin ships the
9-state vocabulary for the watcher, but the actual sprite Loomi paints
comes from a small theme system on disk:

| Layer               | Lives at                                           | What it does                                                      |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Built-in themes     | `apps/web/public/loomi-pet/assets/{fox,capybara}/` | Bundled fox (`loomi-*` prefix) and capybara sprites               |
| Custom themes       | `~/.openloomi/pet-custom/<name>/`                  | Any folder with ≥1 recognized-state PNG becomes a theme           |
| Per-state overrides | `~/.openloomi/pet-config.json`                     | `(theme, state) → absolute path` map; wins over both layers above |

End-user guide: see [Customize your Loomi Pet](/docs/pet) — covers
filename conventions (`idle.png`, `loomi-idle.png`, `my-pack-sweeping.png`
all normalize correctly), the camelCase `pet-config.json` schema, and the
~250 ms file-watcher live-reload.

**The bridge never writes these files.** If the user asks "change my
pet's look", direct them to the menu (right-click → Theme → Capybara) or
to the file system. The runtime's file watcher does the work; the bridge
only drives state transitions.

**Do not** POST `sleeping` or `sweeping` from `/openloomi:pet` — the API
rejects them with `400 invalid_state`. The Loop baseline watcher owns
those two states. See the [`openloomi-pet` sub-skill](./skills/openloomi-pet/SKILL.md)
for the full decision tree when the user asks about pet customization.

The Stop hook reads your session transcript, takes the last 6 turns, caps at
6 KB, and POSTs `{type: "note", groups: ["claude-code"]}` to
`/api/insights`. It **always exits 0** — no archive is not an error.

Avoid manually setting `idle`, `sleeping`, `sweeping`, or `presenting`; the
loop watcher owns those.

---

## Troubleshooting

### Decoding `reason` codes

When `/openloomi:status` says `ready: false`, look at `reason`:

| `reason`                     | What it means                                                                                                             | Fix                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENLOOMI_NOT_INSTALLED`    | OpenLoomi Desktop isn't detected anywhere on this machine.                                                                | `/openloomi:install` — the desktop bundle will land and finalize on first launch.                                                                                    |
| `OPENLOOMI_NOT_FINALIZED`    | OpenLoomi Desktop is installed, but the local helper binary isn't on disk yet (the first launch of the app lays it down). | `/openloomi:setup` auto-launches the app and waits for the API — no manual launch needed. **Don't re-run the installer** — it will just fail again at the same step. |
| `SOURCE_FOUND_CLI_NOT_BUILT` | `OPENLOOMI_REPO_DIR` is set but the Rust crate isn't built yet.                                                           | `cd $OPENLOOMI_REPO_DIR/apps/web/src-tauri && cargo build --release`                                                                                                 |
| `LOGIN_REQUIRED`             | OpenLoomi is installed but you haven't signed in.                                                                         | `/openloomi:setup` auto-mints a guest bearer. For a real account, sign in via the desktop app and re-run setup.                                                      |
| `AI_PROVIDER_REQUIRED`       | Signed in, but no provider set.                                                                                           | Run `claude auth login` on the host (or configure a custom Anthropic-compatible endpoint in OpenLoomi Desktop → API Settings).                                       |
| `READY`                      | All good.                                                                                                                 | Use any other command                                                                                                                                                |

### Pet not switching?

1. `/openloomi:hooks status` — must say `installed: true`.
2. If false, run `/openloomi:hooks install`.
3. If true but no sprite change, make sure the desktop pet is visible
   (clicking the tray icon unhides it).

### Status says `unconfigured`

The plugin needs the OpenLoomi helper CLI only for `:ask`. Pet / usage /
hooks still work without it. If discovery is failing, point `OPENLOOMI_BIN`
at the helper binary directly (advanced override).

### Stop-hook archives

In OpenLoomi Desktop → **Memory → Insights**, in the `claude-code` group.
One note per session, ~6 KB tail-of-conversation summary, deduplicated by
`sessionId`.

---

## Quick reference

```text
/openloomi:setup                 discover → install → ready
/openloomi:status                stable JSON status
/openloomi:pet <state>           set Loomi Pet sprite (9 universal states)
/openloomi:usage                 today's LLM cost summary
/openloomi:connect               guided install of composio + screen memory
/openloomi:hooks install         merge lifecycle hooks into settings.json
/openloomi:hooks uninstall       strip them back out
/openloomi:hooks status          show hook merge state
/openloomi:loop                  loop dashboard snapshot (doorway into openloomi-loop)
/openloomi:memory <query>       search memory + KB + insights (doorway into openloomi-memory)
/openloomi:help                  list these commands
```

If a command misbehaves, open an issue referencing `/openloomi:status`
JSON — the `reason` field makes bugs easy to triage.

---

## For contributors

The rest of this document is for plugin contributors — the architecture,
file layout, and conventions for adding new commands or hooks.

### Architecture

```text
Claude Code
  └── /openloomi:* slash commands          (commands/*.md)
       └── skills/openloomi/SKILL.md        (auto-loaded entrypoint)
            └── scripts/loomi-bridge.mjs    (zero-dep Node 18+ ESM)
                 ├── discovery (8-step chain)
                 ├── ask (one-shot task, prompt via stdin)
                 ├── pet / hook state (fire-and-forget, 2s timeout)
                 ├── archive (Stop hook; always exit 0)
                 └── install-hooks (merge-no-overwrite into settings.json)
                       ↓
            OpenLoomi Desktop runtime (helper CLI + 127.0.0.1:3414 / fallback 3515)
```

### Plugin layout

```text
plugins/claude/
  .claude-plugin/plugin.json      manifest, slash namespace "openloomi:*"
  skills/openloomi*/SKILL.md      auto-loaded entry + sub-skills
  commands/*.md                   the slash commands
  hooks/hooks.json                lifecycle events → Pet states
  scripts/loomi-bridge.mjs        single zero-dep Node 18+ ESM entrypoint
  scripts/hooks-merge.cjs         CJS companion for install/uninstall hooks
  scripts/install-assets/setup.{macos,linux,windows}.*
  tests/bridge.test.mjs           node:test cases
  tests/e2e/setup.md              human-run checklist (A–K)
  assets/logo.png                 plugin icon
```

### Sub-skills

The plugin ships one main entry skill (`openloomi`) plus eight sub-skills under
`skills/`. Each sub-skill is auto-loaded by Claude Code on demand based on its
frontmatter `description` — they share the same `loomi-bridge.mjs` runtime, no
business logic is duplicated.

| Skill                     | Path                                      | Trigger words                                                              | What it does                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openloomi`               | `skills/openloomi/SKILL.md`               | `/openloomi:*`, `openloomi`, `loomi`                                       | Main entrypoint. Dispatches to the right sub-skill or slash command.                                                                                                                                                                                       |
| `openloomi-api`           | `skills/openloomi-api/SKILL.md`           | API endpoints, backend routes, auth, local API, integrations               | Reference for the 131 OpenLoomi HTTP routes (auth, AI, RAG, Loop, Pet, workspace, integrations). Triggered on API/backend questions.                                                                                                                       |
| `openloomi-connectors`    | `skills/openloomi-connectors/SKILL.md`    | connect platform, integration status, list accounts, disconnect            | Manage the 7 native OpenLoomi integrations (Telegram, WhatsApp, iMessage, Feishu, DingTalk, QQ, WeChat) — OAuth, list accounts, status, disconnect, send messages. Pair with `composio` for non-native accounts.                                           |
| `openloomi-feature-guide` | `skills/openloomi-feature-guide/SKILL.md` | "what can openloomi do", "怎么用", "how does openloomi work"               | Product overview, capability tour, and how-tos for non-developer questions.                                                                                                                                                                                |
| `openloomi-hooks`         | `skills/openloomi-hooks/SKILL.md`         | install hooks, `/openloomi:hooks`, mirror claude on pet, auto-archive stop | Lifecycle hooks installer — merges `hooks/hooks.json` into `~/.claude/settings.json` (merge-no-overwrite, atomic). Owns the opt-in Pet mirror and Stop-archive flow.                                                                                       |
| `openloomi-install`       | `skills/openloomi-install/SKILL.md`       | install openloomi, 配置 openloomi, OPENLOOMI_NOT_INSTALLED                 | First-use install helper. Translates `setup-status` `reason` codes into concrete next actions; never downloads anything outside the plugin's own scripts.                                                                                                  |
| `openloomi-loop`          | `skills/openloomi-loop/SKILL.md`          | loop tick, loop schedule, loop inbox, register loop type, add loop rule    | The proactive execution brain — pull signals, classify into decisions, schedule actions, register custom decision types / signal channels / classifier rules. Thin wrapper around `/api/loop/*`. Also reachable as `/openloomi:loop` (dashboard snapshot). |
| `openloomi-memory`        | `skills/openloomi-memory/SKILL.md`        | memory search, knowledge base, documents, insights                         | Search local memory files (`~/.openloomi/data/memory/`), RAG documents, and structured insights; supports living connections, temporal queries, entity registry. Also reachable as `/openloomi:memory <query>` (search-all + recent insights).             |
| `openloomi-pet`           | `skills/openloomi-pet/SKILL.md`           | pet state, `/openloomi:pet`, set pet, fox sprite, capybara sprite          | The 9-state Loomi Pet vocabulary (`happy`/`idle`/`juggling`/`needsinput`/`presenting`/`sleeping`/`sweeping`/`thinking`/`working`). Validates before any HTTP call; falls back gracefully if `/api/pet/state` doesn't exist yet.                            |
| `composio`                | `skills/composio/SKILL.md`                | composio, 1000+ apps, external integrations                                | Third-party router for 1000+ apps via the Composio CLI (Gmail, Slack, GitHub, Linear, Jira, Notion, etc.). Pairs with `openloomi-connectors` for the native 7.                                                                                             |

**Pairing notes:**

- `openloomi-connectors` covers OpenLoomi's **native 7** platforms. For
  accounts connected through **Composio** (Slack, Discord, X, LinkedIn,
  Notion, HubSpot, Gmail via OAuth, etc.), invoke the `composio` skill in
  parallel and present the union when the user asks "what am I connected
  to?".
- `openloomi-loop` reads/decides only — execution happens on user request
  via `/api/loop/action/schedule`. It is read/derive, never destructive.
- `openloomi-memory` is the canonical store. `openloomi-loop` deliberately
  delegates persistence to memory instead of duplicating it.

### Discovery chain (`loomi-bridge.mjs` → `discovery()`)

1. `OPENLOOMI_BIN` env var
2. `OPENLOOMI_HOME` / `OPENLOOMI_INSTALL_DIR`
3. `OPENLOOMI_REPO_DIR` (with hint if CLI not built)
4. `PATH` lookup
5. Platform defaults (macOS bundle, Linux `/opt/openloomi`, Windows
   `%LOCALAPPDATA%`)
6. Saved `~/.claude/plugins/openloomi/config.json`
7. `--bin-path` flag
8. → `nextAction: install_openloomi`

### Readiness JSON

`setup-status` returns stable JSON: `mode`, `installed`, `version`,
`tokenPresent`, `aiProviderConfigured`, `defaultAgent`, `nativeRuntime`,
`apiReachable`, `hooksInstalled`, `ready`, `nextAction`, `reason`, `source`.
See `loomi-bridge.mjs → buildStatus()` for the exact shape.

AI provider readiness comes entirely from the runtime's
`/api/preferences/ai` response — the plugin never inspects AI provider env
vars.

### Change-map (edit X, also touch Y)

| You changed…                     | …also update                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New bridge subcommand            | `commands/<x>.md` + subcommand table in `skills/openloomi/SKILL.md`                                                                                                                                                                 |
| New Pet state                    | `CAPYBARA_STATES` constant in `loomi-bridge.mjs`; confirm sprite exists in both `apps/web/public/loomi-pet/assets/fox/` and `…/capybara/`                                                                                           |
| Built-in theme sprite set        | `BUILTIN_THEMES` map in `apps/web/public/loomi-widget.html` **and** `BUILTIN_THEMES` const in `apps/web/src-tauri/src/pet/theme.rs` (kept in lock-step; the unit test at `apps/web/tests/unit/pet-theme.test.ts` pins the contract) |
| Default theme name               | `DEFAULT_THEME` in `apps/web/src-tauri/src/pet/theme.rs`                                                                                                                                                                            |
| Custom themes dir                | `DEFAULT_CUSTOM_THEMES_DIR` in `apps/web/src-tauri/src/pet/theme.rs`                                                                                                                                                                |
| `pet-config.json` schema         | `PetConfig` struct in `theme.rs`; `PetConfigView` is the wire shape sent to the widget — keep `rename_all = "camelCase"` to avoid the silent `activeTheme → active_theme` no-op                                                     |
| New lifecycle hook               | `hooks/hooks.json` + the hook→state table above                                                                                                                                                                                     |
| `nextAction` enum value          | `NEXT_ACTIONS` set in `loomi-bridge.mjs` + reason table                                                                                                                                                                             |
| Default base URL / model / port  | Top-of-file constants in `loomi-bridge.mjs` only                                                                                                                                                                                    |
| Slash command auto-discover text | `description:` frontmatter line (matched char-by-char)                                                                                                                                                                              |

### Where each concern lives in code

- **AI provider readiness**: `loomi-bridge.mjs → probeAiProvider()` calls
  `/api/preferences/ai` and reads its `nativeRuntime` + per-user
  `settings` arrays. The plugin never reads API key env vars; the
  runtime is the sole owner of that signal.
- **Pet state validation**: `loomi-bridge.mjs → CAPYBARA_STATES`; both
  `cmdPet()` and `cmdState()` gate on it before any HTTP call.
- **Hooks settings.json merge**: `loomi-bridge.mjs → installHooks() /
uninstallHooks()` (atomic write, marker `_openloomi_plugin`, block key
  `__openloomi_claude_plugin_hooks__`).
- **Stop archive**: `loomi-bridge.mjs → cmdArchive()` — caps at 5 MB
  transcript / 6 turns / 6 KB content, always `process.exit(0)`.
- **Install scripts**: `scripts/install-assets/setup.{macos,linux,windows}.*`
  (executable); y/N prompt before run unless `--yes`.

### PR checklist

1. `node --test plugins/claude/tests/bridge.test.mjs` — all tests pass.
2. `claude --plugin-dir plugins/claude` launches clean; `/openloomi:help`
   lists all commands.
3. If you touched any HTTP path, grep `loomi-bridge.mjs` (`apiGET` /
   `apiPOST` callsites) and update this doc.
4. If you touched the secrets contract, run the leak-test grep (above).
5. If you added a hook, run `tests/e2e/setup.md` §E + §F.
