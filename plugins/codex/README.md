# Codex OpenLoomi Plugin

Run OpenLoomi from inside OpenAI Codex CLI.

[OpenLoomi](https://github.com/melandlabs/openloomi) is a local-first desktop app that holds your memory, runs tasks in the
background, and talks to your connected apps (Gmail, Slack, GitHub, Calendar,
Linear, …). This plugin turns Codex into a front-end for that local runtime —
you chat with Codex, and Codex hands work off to OpenLoomi instead of doing
everything itself.

You keep using Codex the way you already do. OpenLoomi runs next to it, on
your machine.

---

## What you can do with it

- **Ask Codex about your work.** "What did I work on last Tuesday?" — Codex
  pulls the answer from OpenLoomi's local memory instead of guessing.
- **Hand tasks off for follow-up.** "Send this to Loomi so it reminds me about
  it tomorrow" — the task goes into OpenLoomi's loop and pings you when it's
  ready.
- **Route Codex through OpenLoomi.** When OpenLoomi answers, it can use your
  Codex CLI runtime under the hood, so you only configure one AI provider.
- **Trigger OpenLoomi workflows from chat.** Memory, loop, connectors, and
  handoff are all exposed as Codex skills — type `@OpenLoomi …` and go.

OpenLoomi still owns the heavy lifting: local memory storage, connector
credentials, scheduled tasks, the desktop UI, secrets. Codex just gets a
doorway into all of it.

---

## Install the plugin

You need a Codex build that supports `codex plugin marketplace` (Codex CLI
0.144 or newer). Pick the install path that matches your workflow.

### Install from GitHub

```bash
codex plugin marketplace add melandlabs/openloomi
codex plugin add openloomi@openloomi
```

Codex fetches the repo, reads the marketplace manifest at the root, and
installs the `openloomi` plugin into
`~/.codex/plugins/cache/openloomi/openloomi/<version>`.

### Install from a local checkout (contributors)

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi
codex plugin marketplace add .
codex plugin add openloomi@openloomi
```

The `.` argument tells Codex to use the repo root as a local marketplace;
plugin resolution lands on `./plugins/codex`.

When you change files under `plugins/codex/` and want to pick up your edits,
force a re-snapshot:

```bash
codex plugin marketplace remove openloomi
codex plugin marketplace add .
codex plugin add openloomi@openloomi
```

Either way, **restart Codex and start a new thread** after installing — Codex
only picks up the new plugin when a fresh process loads the cache.

### Requirements

- Codex CLI 0.144+ with `codex plugin marketplace` support.
- Network access to `github.com` (for the GitHub install path), or a writable
  checkout of the OpenLoomi repo (for the local path).
- **OpenLoomi Desktop installed** — or a source build that produces the
  OpenLoomi Desktop app — for anything beyond setup guidance and workflow
  discovery. Without it, the plugin can still report readiness and walk you
  through installation, but handoff, loop, memory, and connector tasks can't
  actually run.
- Codex CLI on your `PATH` (e.g. `brew install --cask codex` or
  `npm i -g @openai/codex`) if you want OpenLoomi to route through your
  Codex runtime instead of through a separate AI provider.

---

## Set up OpenLoomi Desktop

If you already have OpenLoomi Desktop running, you can skip to the next
section. Otherwise the plugin can do the whole first-use setup for you.

From any new Codex thread, ask:

```text
@OpenLoomi Run first-use setup.
```

The setup wizard walks a small state machine in one call:

1. **Check readiness** — is OpenLoomi installed? Is the desktop app reachable?
2. **Install** (if needed) — downloads the official GitHub release. _Requires
   `--yes` or `--confirm`; it never installs silently._
3. **Wire the Codex runtime** — sets `OPENLOOMI_AGENT_PROVIDER=codex` so
   OpenLoomi reuses your Codex CLI instead of needing a separate AI key.
4. **Launch OpenLoomi Desktop** — opens the app and waits for the local API.
5. **Mint a guest/session token** — writes `~/.openloomi/token`.
6. **Re-check readiness** — confirms every step stuck.

If the install step needs permission, type:

```text
@OpenLoomi Run first-use setup with --yes so the install step can proceed.
```

The wizard never auto-installs from unofficial artifacts, never builds from
source on your behalf, and never asks for API keys in chat — secrets are
always entered inside OpenLoomi-owned UI.

You can run the same wizard from a terminal:

```bash
node plugins/codex/scripts/loomi-bridge.mjs setup --yes
```

`setup` is **idempotent** — run it again any time to recover from a dropped
session, re-apply the runtime env after a Codex upgrade, or confirm everything
still resolves to `READY`.

---

## Verify it's working

Open a fresh Codex thread and try one of these prompts:

```text
@OpenLoomi Check whether OpenLoomi is ready.
```

```text
@OpenLoomi Show the OpenLoomi workflows available from Codex.
```

```text
@OpenLoomi Use Loomi to summarize the current task in one sentence.
```

A fully prepared environment answers with something like:

```text
installed: true
appPath: /Applications/OpenLoomi.app
tokenPresent: true
aiProviderConfigured: true
ready: true
nextAction: run
```

If anything in that block is `false`, jump to the troubleshooting section
below.

---

## End-to-end user flow

> **Want to see what this looks like in motion?** Read the dedicated
> [Tour guide →](./WALKTHROUGH.md) — from "ask Codex to install
> the plugin" through "custom Loop type fires on the next decision".

The TL;DR of the full path: **install the plugin → launch Codex with
`--plugin-dir plugins/codex` → see the Loomi Pet pop on the desktop
(fox theme) → flip the theme to capybara via the right-click menu →
call `@OpenLoomi status` for the canonical JSON → the bundled Codex
hooks drive the pet through every event automatically → connect
external apps via `@OpenLoomi handoff` → and finally watch OpenLoomi's
Loop surface decision cards in the desktop app** — all driven by
prompts you typed in Codex.

The screenshots in the Tour guide are the canonical reference for the
visual state of the system at every step. The remainder of this README is
for command behavior, configuration, and contributor reference.

---

## What you can ask Codex

Once the plugin is enabled and OpenLoomi is ready, treat `@OpenLoomi` as a
front door into the local runtime. A few patterns that usually work:

```text
@OpenLoomi Use the memory workflow to recall relevant context.
@OpenLoomi Use the loop workflow to plan the next step.
@OpenLoomi Check connector readiness for this task.
@OpenLoomi Hand this task to Loomi for follow-up.
```

The workflow skills are intentionally thin — they route your request into the
right OpenLoomi surface. Anything OpenLoomi's local runtime doesn't support
yet comes back as a polite "not yet supported here" rather than a silent
fallback inside Codex.

---

## If something goes wrong

### "OpenLoomi is not installed"

Install the packaged OpenLoomi Desktop release, or point the plugin at an
existing install:

```bash
export OPENLOOMI_INSTALL_DIR=/path/to/openloomi
export OPENLOOMI_APP=/path/to/openloomi/desktop/binary
```

### "SOURCE_FOUND_APP_NOT_BUILT"

You have a source checkout but the desktop app hasn't been built yet. The
plugin does not build from source automatically. Either build the desktop
binary per `apps/web/src-tauri/README.md` or install the packaged release.

### "SESSION_INITIALIZATION_REQUIRED"

OpenLoomi is installed but the local guest/session token is missing. Open
OpenLoomi Desktop once so it can mint a guest session, then re-run:

```bash
node plugins/codex/scripts/loomi-bridge.mjs setup
```

The token lives at `~/.openloomi/token`. Delete it to force a re-mint.

### "AI_PROVIDER_REQUIRED" / "AI_PROVIDER_STATUS_UNAVAILABLE"

Two ways forward, in order of preference:

1. **Route OpenLoomi through your Codex runtime.** The `setup` wizard does
   this by default; once `OPENLOOMI_AGENT_PROVIDER=codex` is set and you've
   restarted OpenLoomi Desktop, no separate AI key is needed for Codex-driven
   workflows.
2. **Configure a separate AI provider fallback inside OpenLoomi Desktop.**
   Do not paste API keys into Codex chat — enter them in OpenLoomi's own
   settings.

### Codex still shows an old plugin version

Remove and re-add the marketplace, restart Codex, and start a new thread. The
cached copy lives at
`~/.codex/plugins/cache/openloomi/openloomi/<version>`.

### Default agent still says `claude`

After switching to the Codex runtime you may need to **quit and reopen
OpenLoomi Desktop** so the new env reaches the freshly forked web process. To
confirm the env actually landed:

```bash
launchctl getenv OPENLOOMI_AGENT_PROVIDER
```

---

## (Optional) Route OpenLoomi through your Codex CLI

By default the packaged OpenLoomi desktop app routes chat and agent requests
through Claude. If you'd rather have it use your existing Codex CLI runtime —
so you don't need a second AI key for Codex-driven workflows — set
`OPENLOOMI_AGENT_PROVIDER=codex` in the environment the desktop app actually
inherits.

This is the recommended path for first-time Codex-plugin users.

> **You usually don't need to do this by hand.** Whenever the bridge
> launches the OpenLoomi Desktop app (during `setup`, `initialize-session`,
> or a handoff), it already wires `OPENLOOMI_AGENT_PROVIDER=codex` into the
> launchd environment _before_ the app starts, so a clean install picks up
> the Codex runtime on first open. The manual tiers below are for when you
> want to change or persist the value independently of a launch, or on
> Windows where auto-wiring isn't supported.

### How to make the env switch stick

The desktop app's web server runs inside the GUI launchd session on macOS (a
separate systemd user session on Linux), **not** in your terminal — so a
shell `export` won't reach it. Three tiers, each more durable than the last:

1. **In-process only** — `export OPENLOOMI_AGENT_PROVIDER=codex` in a
   terminal. Reaches that shell and its children only; the OpenLoomi web
   server does **not** see it.
2. **This session only (transient)** —

   ```bash
   node plugins/codex/scripts/loomi-bridge.mjs set-codex-runtime-env codex
   ```

   Writes `launchctl setenv OPENLOOMI_AGENT_PROVIDER codex` in the GUI
   launchd domain on macOS, or `~/.config/environment.d/openloomi-codex.conf`
   on Linux. The currently running OpenLoomi app does **not** see the change
   until you quit and reopen it; the value is lost on next logout/reboot.

3. **Persistent (recommended)** —

   ```bash
   node plugins/codex/scripts/loomi-bridge.mjs set-codex-runtime-env codex --persist
   ```

   Does everything tier 2 does, **plus** installs
   `~/Library/LaunchAgents/com.openloomi.codex-runtime-env.plist` on macOS
   (a `RunAtLoad` LaunchAgent that re-applies the value on every login), so
   the switch survives logout/reboot. The `setup` wizard installs this tier
   by default. On Linux the environment.d file already persists, so no extra
   flag is needed. On Windows the bridge prints manual steps instead of
   touching the registry.

> **macOS caveat:** the GUI launchd session is separate from your terminal.
> After tier 2 or 3, **quit and reopen `OpenLoomi.app`** so the new env is
> inherited by the freshly forked web process. On Linux a per-user env file
> applies on next login; on Windows you edit the user environment via
> System Settings.

Flags accepted by `set-codex-runtime-env`:

- `<value>` — defaults to `codex`. Other supported values: `claude`,
  `opencode`, `hermes`, `openclaw`.
- `--unset` — clear `OPENLOOMI_AGENT_PROVIDER` from the host environment.
- `--dry-run` — describe what would happen without writing anything.
- `--persist` — install a `RunAtLoad` LaunchAgent on macOS so the value
  survives logout/reboot. Combine with `--unset` to also remove the plist.

For a permanent shell-side switch on macOS or Linux, additionally append the
export to your shell rc so future shells remember it:

```bash
echo 'export OPENLOOMI_AGENT_PROVIDER=codex' >> ~/.zshrc
```

The shell export helps the bridge itself; the `set-codex-runtime-env` step
is what makes the GUI launchd domain and the desktop session pick the
variable up.

### Fine-tuning the Codex runtime

Optional companion variables (all read by `apps/web`'s native-agent env
resolver at startup). Defaults are shown:

```bash
export OPENLOOMI_AGENT_CODEX_COMMAND=codex            # `codex` on PATH
export OPENLOOMI_AGENT_CODEX_MODEL=gpt-5.4            # optional override
export OPENLOOMI_AGENT_CODEX_PROFILE=work             # optional `-p <name>`
export OPENLOOMI_AGENT_CODEX_SANDBOX=workspace-write  # read-only | workspace-write | danger-full-access
export OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL=on-request  # untrusted | on-failure | on-request | never
export OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK=true
export OPENLOOMI_AGENT_CODEX_FULL_AUTO=false          # true allows --full-auto under bypassPermissions
export OPENLOOMI_AGENT_CODEX_TIMEOUT_MS=120000        # CLI runtime budget in ms
```

Before this will actually work, make sure:

- `which codex` resolves to a working Codex CLI binary.
- `~/.codex/config.toml` is configured, and `OPENAI_API_KEY` (or the Codex
  CLI's other auth) is available to the spawned process.

### Confirming the switch

After restarting OpenLoomi Desktop, hit `GET /api/native/providers`. It
should report `codex` inside `agents` and `defaultAgent: "codex"`. If you
still see `defaultAgent: "claude"`, the env change didn't stick — re-run
`launchctl getenv OPENLOOMI_AGENT_PROVIDER` to confirm the GUI session
actually has it.

To pull the same switch plan as structured JSON (handy for surfacing inside
Codex without retyping the shell snippets):

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" codex-runtime-info
```

---

## For developers / reference

The rest of this document is for plugin contributors and people integrating
the bridge from elsewhere. End users can stop at "Confirming the switch"
above.

### Plugin package layout

```text
plugins/codex/
  README.md
  .codex-plugin/plugin.json
  scripts/loomi-bridge.mjs
  assets/logo.png
  hooks/hooks.json
  skills/
    openloomi/SKILL.md
    openloomi-install/SKILL.md
    openloomi-loop/SKILL.md
    openloomi-memory/SKILL.md
    openloomi-connectors/SKILL.md
    openloomi-handoff/SKILL.md
    openloomi-pet/SKILL.md
    openloomi-api/SKILL.md
    openloomi-feature-guide/SKILL.md
    composio/SKILL.md
    composio/rules/...
  tests/bridge.test.mjs
```

Responsibilities:

- `.codex-plugin/plugin.json`: Codex plugin metadata, display info, and
  skill discovery.
- `skills/openloomi/SKILL.md`: thin Codex entrypoint that decides when to
  call the bridge.
- `scripts/loomi-bridge.mjs`: local adapter for discovery, install
  guidance, readiness checks, AI provider setup handoff, one-shot execution,
  and hook integration.
- `assets/`: plugin icons and visual assets.
- `hooks/hooks.json`: Codex lifecycle hooks (mirrored onto the OpenLoomi
  Pet).

The Claude Code plugin lives next to it under `plugins/claude/` and ships
its own README, hooks, and slash-command layout; that surface is
intentionally not mirrored here.

### Architecture

```text
Codex
  -> OpenLoomi Codex plugin
      -> OpenLoomi skill entrypoint
          -> loomi-bridge
              -> discovery and install layer
              -> first-use AI provider setup layer
              -> readiness layer
              -> OpenLoomi skill guidance layer
              -> optional Codex hook layer
              -> OpenLoomi runtime launcher
                  -> OpenLoomi local runtime
                      -> memory
                      -> connectors
                      -> loop
                      -> model provider
                      -> OpenLoomi Pet
```

The plugin stays thin. Connector, memory, and loop implementations live
inside OpenLoomi-owned runtime surfaces; the bridge only routes to them.

### Supported environments

**Packaged Desktop install.** The user installed OpenLoomi through an
official desktop installer or release artifact. The plugin discovers the
bundled OpenLoomi Desktop GUI app (`OpenLoomi.app` on macOS,
`openloomi.exe` on Windows, `openloomi.AppImage` on Linux) and uses it to
launch the local runtime.

**Source checkout.** The user cloned the OpenLoomi repository locally and
wants Codex to work against that checkout. The plugin detects source
checkouts when explicitly configured or when known project markers are
present. If the source checkout exists but the desktop app has not been
built yet, the plugin returns actionable instructions rather than building
automatically without user confirmation.

**Launching the desktop app with the Codex runtime.** When OpenLoomi is
used from Codex, this is the recommended first-use path: it lets OpenLoomi
reuse the user's existing Codex runtime and avoids requiring a separate
OpenLoomi AI provider key just to complete the first Codex plugin workflow.

Whenever the bridge launches the OpenLoomi Desktop app (during `setup`,
`initialize-session`, or any handoff that has to start OpenLoomi), it first
wires `OPENLOOMI_AGENT_PROVIDER=codex` into the environment the GUI launchd
session will hand to the new process — `launchctl setenv` plus a persisted
LaunchAgent on macOS, `~/.config/environment.d/openloomi-codex.conf` on
Linux. Because the value lands _before_ the app is handed to launchd, the
freshly spawned OpenLoomi web server inherits it and auto-selects Codex on
first open, with no manual `export` or app restart. The wiring is
non-destructive:

- If the user has already set `OPENLOOMI_AGENT_PROVIDER` to a non-`codex`
  value, the bridge leaves it alone (`reason: "user_override"`) — an
  explicit choice always wins.
- If it is already `codex`, the launch is a no-op (`reason: "already_codex"`).
- Windows has no safe auto-write surface, so the bridge reports
  `reason: "unsupported"` and leaves configuration to the user.

The env-wiring result is surfaced on the launch payload under `env` so
callers can see exactly what happened.

**Missing install.** If OpenLoomi is not installed, the plugin supports a
user-approved install flow. The install flow uses official OpenLoomi
artifacts, resolves the current platform's release asset automatically, and
installs with the default installer path where automatic installation is
supported.

### Discovery strategy

The bridge detects the OpenLoomi Desktop GUI app in this order:

```text
1. OPENLOOMI_APP
2. OPENLOOMI_HOME or OPENLOOMI_INSTALL_DIR
3. OPENLOOMI_REPO_DIR
4. PATH lookup for the desktop app binary
5. Platform default packaged install paths
6. Previously saved non-secret plugin config
7. User-provided install path or source checkout path
8. User-approved install flow
```

### Change-map (edit X, also touch Y)

| You changed…                                      | …also update                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `pet` vocabulary                              | `petCommand` in `scripts/loomi-bridge.mjs`; confirm `CAPYBARA_STATES` mirrors Claude's bridge                                                                                   |
| Built-in theme sprite set                         | `BUILTIN_THEMES` map in `apps/web/public/loomi-widget.html` **and** `BUILTIN_THEMES` const in `apps/web/src-tauri/src/pet/theme.rs`                                             |
| Default theme name                                | `DEFAULT_THEME` in `apps/web/src-tauri/src/pet/theme.rs`                                                                                                                        |
| Custom themes dir                                 | `DEFAULT_CUSTOM_THEMES_DIR` in `apps/web/src-tauri/src/pet/theme.rs`                                                                                                            |
| `pet-config.json` schema                          | `PetConfig` struct in `theme.rs`; `PetConfigView` is the wire shape sent to the widget — keep `rename_all = "camelCase"` to avoid the silent `activeTheme → active_theme` no-op |
| Lifecycle hook `→` Pet state mapping              | `hooks/hooks.json` **and** the Codex Pet lifecycle hooks table above                                                                                                            |
| Failure code in `pet <state>` (e.g. `PET_FAILED`) | `petCommand` error block in `scripts/loomi-bridge.mjs` **and** the `openloomi-pet` SKILL.md failure-mode table                                                                  |
| `setup-status` `reason` / `nextAction`            | `STATUS_REASONS` / `NEXT_ACTIONS` in `scripts/loomi-bridge.mjs` **and** the readiness contract above                                                                            |

For packaged installs, common layouts:

```text
# macOS
/Applications/OpenLoomi.app
~/Applications/OpenLoomi.app

# Windows
%LOCALAPPDATA%\OpenLoomi\openloomi.exe
%ProgramFiles%\OpenLoomi\openloomi.exe

# Linux
/opt/openloomi/openloomi
/usr/local/openloomi/openloomi
~/.local/share/openloomi/openloomi
```

For source checkouts, project markers:

```text
<repo-root>/package.json
<repo-root>/apps/web/src-tauri/Cargo.toml
```

### Readiness contract

`setup-status` returns stable JSON:

```json
{
  "mode": "packaged | source | unconfigured",
  "installed": true,
  "appPath": "<resolved OpenLoomi Desktop app path>",
  "version": "openloomi-desktop 0.8.2",
  "tokenPresent": true,
  "session": {
    "tokenPresent": true,
    "guestBootstrapSupported": true,
    "guestBootstrapMode": "local-openloomi-api"
  },
  "aiProviderConfigured": true,
  "aiProviderStatus": "runtime_configured",
  "executionProviderReady": true,
  "executionProviderSource": "ai_provider | native_codex_runtime",
  "nativeRuntimeActive": false,
  "nativeRuntimeProvider": "claude | codex | null",
  "nativeRuntime": {
    "checked": true,
    "available": true,
    "active": false,
    "reason": "CODEX_RUNTIME_INACTIVE",
    "defaultAgent": "claude",
    "codexAgentAvailable": true,
    "agents": [
      {
        "type": "codex",
        "name": "Codex CLI"
      }
    ]
  },
  "connectorStatusAvailable": true,
  "connectors": [
    {
      "id": "gmail",
      "label": "Gmail",
      "connected": false,
      "accountCount": 0
    }
  ],
  "connectorSetupRecommended": true,
  "recommendedNextAction": "configure_connectors",
  "recommendedReason": "CONNECTOR_SETUP_REQUIRED",
  "connectorSetupUrl": "http://localhost:3515/connectors",
  "apiReachable": false,
  "ready": true,
  "nextAction": "run",
  "checks": {
    "aiProviderRuntime": {
      "checked": true,
      "status": "runtime_configured",
      "providers": [
        {
          "providerType": "openai_compatible",
          "configured": true,
          "source": "openloomi-ui",
          "hasApiKey": true,
          "baseUrlPresent": true,
          "modelPresent": true
        }
      ]
    },
    "nativeProvider": {
      "checked": true,
      "available": true,
      "active": false,
      "reason": "CODEX_RUNTIME_INACTIVE"
    },
    "connectors": {
      "checked": true,
      "available": true,
      "reason": "CONNECTOR_STATUS_LOADED",
      "setupRecommended": true
    }
  }
}
```

`aiProviderConfigured` only describes OpenLoomi-owned direct
OpenAI-compatible or Anthropic-compatible provider settings. Native Codex
CLI execution is tracked separately through `nativeRuntime*` and
`executionProvider*` fields. When `/api/native/providers` reports
`defaultAgent: "codex"` and the Codex agent metadata is present,
`setup-status` may return `ready: true` with
`executionProviderSource: "native_codex_runtime"` even while
`aiProviderConfigured` remains `false`.

Connector readiness is a status-only advisory. Missing Gmail, Slack,
GitHub, Calendar, or Linear connections should not block memory-only or
local runtime workflows, so `ready` can remain `true` while
`connectorSetupRecommended` points the user to the OpenLoomi-owned
`/connectors` setup surface. Connector tokens, account identifiers, OAuth
secrets, passwords, and Composio secrets must never be printed by the
Codex bridge.

The bridge first reads the Loop connector status endpoint and then, when a
local session token is available, merges OpenLoomi-owned native integration
accounts from `/api/integrations` as status-only rows. This lets Codex
show native connections such as Gmail or QQbot as connected even when the
Loop/Composio probe is unavailable or slow, while still keeping all
credentials inside OpenLoomi-owned surfaces.

**Common `nextAction` values:**

```text
install_openloomi
provide_install_or_repo_path
build_or_install_openloomi
initialize_openloomi_session
open_openloomi
configure_ai_provider
configure_connectors
show_openloomi_skills
return_without_bridge
run
```

**Common `reason` values:**

```text
OPENLOOMI_APP_NOT_FOUND
OPENLOOMI_APP_INVALID
SOURCE_FOUND_APP_NOT_BUILT
INSTALL_REQUIRED
SESSION_INITIALIZATION_REQUIRED
READY_SESSION_BOOTSTRAP_PENDING
AI_PROVIDER_REQUIRED
AI_PROVIDER_STATUS_UNAVAILABLE
CONNECTOR_SETUP_REQUIRED
READY
```

OpenLoomi guest mode is supported. A missing token should not be treated as
a requirement for account registration or manual login. When OpenLoomi is
installed, the bridge may initialize a guest/session token through the
local OpenLoomi API and write the standard `~/.openloomi/token` file. If
the local API is not reachable, the bridge may launch OpenLoomi and ask
the user to let OpenLoomi initialize its guest session.

The bridge attempts two guest endpoints, in order:

1. `POST /api/remote-auth/guest` — the JSON bearer flow. This is the same
   endpoint the Claude plugin calls and the one that registers a fresh
   guest account in the OpenLoomi runtime's local database before returning
   a bearer. Prefer this when the running OpenLoomi build exposes it.
2. `POST /api/auth/guest?redirectUrl=/` followed by `GET /api/auth/token`
   using the `Set-Cookie` header — the legacy cookie-based flow kept for
   older OpenLoomi builds that don't ship the JSON endpoint. The bridge
   falls back to this path only when the JSON endpoint returns 404 or is
   unreachable before any response, so a transient 5xx or empty payload on
   the JSON path still tries the cookie path before giving up.

Both paths produce the same outcome from the bridge's perspective: a
token written to `~/.openloomi/token`, masked out of logs and stderr, and
reportable via `setup-status` as `session.tokenPresent: true`.

AI provider readiness should respect both environment variables and
OpenLoomi-owned UI/runtime settings. When a token is available, the bridge
may convert that token to a local session cookie through OpenLoomi's
existing auth surface, call the local AI preferences API, and report only
masked status fields such as `hasApiKey`, `baseUrlPresent`, and
`modelPresent`. If OpenLoomi is not running, the bridge reports
`AI_PROVIDER_STATUS_UNAVAILABLE` instead of claiming the provider is
missing.

### First-use runtime and provider setup

The plugin guides users toward the Codex runtime path when OpenLoomi is
first used from Codex. This lets OpenLoomi reuse the user's existing Codex
CLI runtime and avoids requiring a separate OpenLoomi AI provider key for
the first plugin workflow.

Preferred paths:

1. Set or verify `OPENLOOMI_AGENT_PROVIDER=codex` for the OpenLoomi
   desktop runtime, then restart OpenLoomi and verify
   `/api/native/providers`.
2. If the user chooses a separate AI provider fallback, launch or guide an
   OpenLoomi-owned setup flow for:
   - base URL;
   - API key;
   - model name.

Raw API keys must not be pasted into Codex chat. If a setup flow collects
an API key, that input must happen in an OpenLoomi-owned UI or CLI
surface that avoids printing secrets and writes directly to OpenLoomi's
local configuration or secure storage.

### OpenLoomi skill guidance

After OpenLoomi starts, the plugin guides users toward OpenLoomi-related
skills and workflows that are useful from Codex. The Codex plugin ships
one main entry skill (`openloomi`) plus eight sub-skills under
`skills/`. Each sub-skill is auto-loaded by Codex on demand based on its
frontmatter `description` — they share the same `loomi-bridge.mjs`
runtime, no business logic is duplicated.

| Skill                     | Path                                      | Trigger words                                                                  | What it does                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openloomi`               | `skills/openloomi/SKILL.md`               | `OpenLoomi`, `Loomi`, `@OpenLoomi`                                             | Main entrypoint. Dispatches to the right sub-skill or workflow.                                                                                                                                                                                                                                                                                              |
| `openloomi-install`       | `skills/openloomi-install/SKILL.md`       | install, first-use setup, AI provider setup, `SESSION_INITIALIZATION_REQUIRED` | Walks install / first-use / AI-provider setup / session recovery. Translates `setup-status` `reason` codes into concrete next actions.                                                                                                                                                                                                                       |
| `openloomi-loop`          | `skills/openloomi-loop/SKILL.md`          | loop tick, loop schedule, loop inbox, register loop type, add loop rule        | The proactive execution brain — pull signals, classify into decisions, schedule actions, register custom decision types / signal channels / classifier rules. Thin wrapper around `/api/loop/*`.                                                                                                                                                             |
| `openloomi-memory`        | `skills/openloomi-memory/SKILL.md`        | memory search, knowledge base, documents, insights                             | Search or write memory through OpenLoomi-owned runtime surfaces. Thin wrapper — does **not** implement memory storage.                                                                                                                                                                                                                                       |
| `openloomi-connectors`    | `skills/openloomi-connectors/SKILL.md`    | connect platform, integration status, list accounts, disconnect                | Check whether Slack, GitHub, Gmail, Calendar, and other sources are configured before acting. Reports status only; pair with `composio` for non-native accounts.                                                                                                                                                                                             |
| `openloomi-handoff`       | `skills/openloomi-handoff/SKILL.md`       | hand off, delegate, queue, remind, follow up                                   | **Codex-only.** Send the current Codex task to Loomi for follow-up. The Claude Code plugin exposes the same capability through its own `/openloomi:*` slash-command surface instead — see [Handoff parity note](#handoff-parity-note) below.                                                                                                                 |
| `openloomi-pet`           | `skills/openloomi-pet/SKILL.md`           | pet state, set pet, fox sprite, capybara sprite, custom pet theme              | The 9-state Loomi Pet vocabulary (`happy`/`idle`/`juggling`/`needsinput`/`presenting`/`sleeping`/`sweeping`/`thinking`/`working`). Mirrors the Claude plugin's `openloomi-pet` skill with Codex-specific deltas (no slash command, `codex-plugin` source tag). For custom themes & sprite overrides see the [Customize your Loomi Pet](/docs/pet) user docs. |
| `openloomi-api`           | `skills/openloomi-api/SKILL.md`           | API endpoints, backend routes, auth, local API, integrations                   | Reference for the 131 OpenLoomi HTTP routes (auth, AI, RAG, Loop, Pet, workspace, integrations). Triggered on API / backend questions.                                                                                                                                                                                                                       |
| `openloomi-feature-guide` | `skills/openloomi-feature-guide/SKILL.md` | "what can openloomi do", "怎么用", "how does openloomi work"                   | Product overview, capability tour, and how-tos for non-developer questions.                                                                                                                                                                                                                                                                                  |
| `composio`                | `skills/composio/SKILL.md`                | composio, 1000+ apps, external integrations                                    | Third-party 1000+ app integration router (Gmail, Slack, GitHub, Linear, Jira, Notion, etc.) via the Composio CLI. Platform-agnostic; not OpenLoomi business logic.                                                                                                                                                                                           |

The `workflow-guidance` bridge command exposes structured guidance for the
four workflow skills (`openloomi-loop`, `openloomi-memory`,
`openloomi-connectors`, `openloomi-handoff`). All other skills are
documentation or routing helpers. The plugin must not copy OpenLoomi
connector, memory, loop, scheduling, or handoff persistence logic into
Codex — runtime implementations stay inside the OpenLoomi desktop runtime.

**Pairing notes:**

- `openloomi-connectors` covers OpenLoomi's **native 7** platforms
  (Telegram, WhatsApp, iMessage, Feishu, DingTalk, QQ, WeChat). For
  accounts connected through **Composio** (Slack, Discord, X, LinkedIn,
  Notion, HubSpot, Gmail via OAuth, etc.), invoke the `composio` skill in
  parallel and present the union when the user asks "what am I connected
  to?".
- `openloomi-loop` reads/decides only — execution happens on user request
  via `/api/loop/action/schedule`. It is read/derive, never destructive.
- `openloomi-memory` is the canonical store. `openloomi-loop` deliberately
  delegates persistence to memory instead of duplicating it.

#### Handoff parity note

Codex and Claude Code expose the same "send current task to Loomi for
follow-up" capability through **different surfaces**:

- **Codex** (`@OpenLoomi …`): the `openloomi-handoff` skill above — wraps
  the request with the `taskPromptPrefix` returned by `workflow-guidance`
  and pipes it into `loomi-bridge run` over stdin.
- **Claude Code** (`/openloomi:*`): the slash-command surface. There is no
  dedicated `openloomi-handoff` skill because `/openloomi:setup` /
  `/openloomi:status` already cover the same user need through the
  plugin's own commands.

Both surfaces route to the same OpenLoomi runtime — the plugin stays a
thin wrapper; persistence and notification routing live inside the
OpenLoomi desktop runtime.

### Pet state control

The bridge ships a `pet <state>` command that mirrors
`plugins/claude/scripts/loomi-bridge.mjs::cmdPet`. It validates against
the same 9-state sprite vocabulary and POSTs `{state, source:
"codex-plugin"}` to `/api/pet/state` on the local OpenLoomi runtime with
the bearer token from `~/.openloomi/token`. The command tries every
local OpenLoomi API URL in priority order, so a closed 3414 port can
still fall back to a source runtime on 3515.

### Custom pet themes & sprite overrides

The pet's look is **file-driven**, not bridge-driven. The Codex bridge only drives state transitions — the actual sprite Loomi paints comes from the same runtime-side theme system the Claude plugin uses:

| Layer               | Lives at                                           | What it does                                                      |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Built-in themes     | `apps/web/public/loomi-pet/assets/{fox,capybara}/` | Bundled fox (`loomi-*` prefix) and capybara sprites               |
| Custom themes       | `~/.openloomi/pet-custom/<name>/`                  | Any folder with ≥1 recognized-state PNG becomes a theme           |
| Per-state overrides | `~/.openloomi/pet-config.json`                     | `(theme, state) → absolute path` map; wins over both layers above |

End-user guide: see [Customize your Loomi Pet](/docs/pet) — covers
filename conventions, the camelCase `pet-config.json` schema, and the
~250 ms file-watcher live-reload. The plugin also has a matching
[`openloomi-pet` sub-skill](./skills/openloomi-pet/SKILL.md) for in-codex
guidance; it ships the same decision tree as the Claude-side skill with
the Codex-specific deltas documented in § Codex-specific deltas vs the Claude plugin.

**The bridge never writes these files.** Codex users customize the pet
the same way everyone else does — through the right-click menu or by
editing `~/.openloomi/pet-config.json` directly. The runtime's file
watcher does the work; the bridge only owns `pet <state>`.

**Do not** call `pet sleeping` or `pet sweeping` from Codex — the API
rejects them with `400 invalid_state` (the bridge surfaces this as
`PET_FAILED`, not `INVALID_STATE`). The Loop baseline watcher owns those
two states. See [`openloomi-pet/SKILL.md`](./skills/openloomi-pet/SKILL.md)
for the full vocabulary and bridge failure-mode table.

```bash
node plugins/codex/scripts/loomi-bridge.mjs pet happy
node plugins/codex/scripts/loomi-bridge.mjs pet working
```

Valid states:

```text
happy, idle, juggling, needsinput, presenting, sleeping, sweeping, thinking, working
```

> **API-accepted subset:** `POST /api/pet/state` only accepts 7 of these:
> `idle`, `thinking`, `working`, `juggling`, `happy`, `presenting`,
> `needsinput`. `sleeping` and `sweeping` are capybara-theme vocabulary
> managed by the Loop baseline watcher — the API returns 400
> `invalid_state` for them, which the bridge surfaces as `{ok: false,
code: "PET_FAILED"}`. Avoid requesting those two from Codex; let the
> Loop baseline watcher set them.

Failure modes (all return structured JSON, never throw):

- `MISSING_STATE` — no positional state argument.
- `INVALID_STATE` — state not in the vocabulary; response includes
  `validStates` and `received`.
- `TOKEN_MISSING` — `~/.openloomi/token` does not exist or is unreadable.
  Run `setup` or open OpenLoomi Desktop once before driving Pet state.
- `ENDPOINT_MISSING` — runtime answered with HTTP 404. Treat as
  non-blocking: the bridge returns the polite notice that the endpoint is
  pending. Pet control resumes automatically once OpenLoomi ships the
  route.
- `API_UNREACHABLE` — no local API responded on 3414/3515. `attempts`
  lists every URL the bridge tried.
- `PET_FAILED` — runtime answered but with a non-success status code.

The bridge also exposes an internal `state <state> --event <event>`
command for Codex lifecycle hooks. This path is hook-safe: it never
fails the Codex turn, never prompts, and returns `hook: "skipped"` when
OpenLoomi is not ready, the token is missing, or the Pet endpoint is
unavailable.

### Codex Pet lifecycle hooks

Status: implemented as a non-blocking Pet mirror.

The Codex plugin ships `plugins/codex/hooks/hooks.json` and declares it
in `.codex-plugin/plugin.json`. The hook bundle mirrors Codex lifecycle
events onto the OpenLoomi Pet without making authorization or
control-flow decisions.

Current mapping:

- `SessionStart` → Pet `presenting`;
- `UserPromptSubmit` → Pet `thinking`;
- `PreToolUse` → Pet `working`;
- `PermissionRequest` → Pet `needsinput`;
- `PostToolUse` → Pet `thinking`;
- `SubagentStart` → Pet `juggling`;
- `SubagentStop` → Pet `thinking`;
- `Stop` → Pet `happy`.

Hooks use the same runtime-accepted `source: "codex-plugin"` value when
posting to `/api/pet/state`. They are best-effort UI feedback only.
Memory archive, follow-up scheduling, permission decisions, and
connector behavior stay inside OpenLoomi-owned runtime surfaces.

### Secret handling

Codex chat, argv, stdout, and stderr must never receive or print:

- model provider API keys;
- OAuth access tokens or refresh tokens;
- connector app secrets;
- OpenLoomi auth tokens;
- local secure-storage contents.

Allowed status-only checks:

```text
OPENLOOMI_AUTH_TOKEN present/missing
~/.openloomi/token present/missing
guest/session initialization available/unavailable
AI provider configured/missing
AI provider runtime status available/unavailable
AI provider hasApiKey/baseUrl/model presence (per-provider)
connector configured/missing
local API reachable/unreachable
```

Example safe output:

```json
{
  "aiProviderConfigured": true,
  "aiProviderStatus": "runtime_configured",
  "runtime": {
    "source": "openloomi-runtime",
    "checked": true,
    "providers": [
      {
        "providerType": "openai_compatible",
        "configured": true,
        "source": "openloomi-ui",
        "enabled": true,
        "hasApiKey": true,
        "baseUrlPresent": true,
        "modelPresent": true
      },
      {
        "providerType": "anthropic_compatible",
        "configured": false,
        "source": "openloomi-runtime",
        "enabled": false,
        "hasApiKey": false
      }
    ]
  }
}
```

The bridge may report key presence and provider configuration. It must
not print values.

The bridge may receive a guest/session token from the local OpenLoomi
API only to write the standard `~/.openloomi/token` file. It must keep
the token out of argv, stdout, stderr, logs, and the Codex transcript.

Which token-bearing endpoint the bridge ends up calling is
implementation detail — both `POST /api/remote-auth/guest` and the
cookie-based `POST /api/auth/guest` + `GET /api/auth/token` flow end up
writing the same `~/.openloomi/token` file. From outside, the bridge
exposes only that a guest/session token was obtained, not which path
produced it.

### Non-goals

- Do not download or install OpenLoomi without an explicit user
  installation intent or confirmation.
- Do not install from unofficial artifacts or default to custom install
  paths.
- Do not build OpenLoomi from source automatically.
- Do not ask users to paste API keys, OAuth tokens, or auth tokens into
  Codex chat.
- Do not pass secrets as command-line arguments.
- Do not implement connector protocols inside the Codex plugin.
- Do not duplicate the full OpenLoomi runtime inside the Codex plugin.
- Do not make the Codex plugin a replacement for OpenLoomi Desktop.
