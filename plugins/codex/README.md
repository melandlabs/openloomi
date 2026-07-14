# OpenLoomi Codex Plugin

## Overview

The OpenLoomi Codex plugin makes Codex an agent shell for a local OpenLoomi
runtime. Codex provides the interactive coding surface, while OpenLoomi owns the
personal memory layer, connector graph, runtime/provider setup, task loop, and
local privacy boundary.

The plugin is designed to:

- discover or install OpenLoomi for the user;
- verify that `openloomi-ctl` is available;
- set up the Codex runtime path and guide AI provider fallback when needed;
- run one-shot tasks through the local OpenLoomi runtime;
- help users access OpenLoomi-related workflows such as `openloomi-loop` and
  `openloomi-memory` from Codex;
- optionally connect Codex task lifecycle events to the OpenLoomi Pet.

This directory contains the Codex plugin design. The Claude Code plugin
lives next to it under `plugins/claude/` and ships its own README, hooks, and
slash-command layout; that surface is intentionally not mirrored here.

```text
plugins/
  codex/
    README.md
```

## Product Positioning

The Codex plugin is a companion integration, not a replacement for OpenLoomi
Desktop. It lets Codex hand tasks to OpenLoomi and receive readiness or task
results. OpenLoomi remains responsible for local execution, memory, connectors,
settings, and secret storage.

The first complete user flow should be:

```text
User installs the Codex plugin
  -> plugin checks whether OpenLoomi is installed
  -> plugin installs or guides installation if OpenLoomi is missing
  -> plugin verifies openloomi-ctl
  -> plugin sets or verifies the Codex runtime path
  -> plugin guides AI provider fallback only when needed
  -> plugin initializes or reuses a guest/session token
  -> plugin runs a one-shot OpenLoomi task
  -> plugin shows related OpenLoomi skills and workflows
```

## User Tour: Install the Plugin

The OpenLoomi Codex plugin lives at `plugins/codex/` inside the OpenLoomi
repository. The repository root doubles as a Codex marketplace root: it ships
`.agents/plugins/marketplace.json` that points at this plugin directory, so
any Codex build that supports `codex plugin marketplace` can install the
plugin directly from the repository.

Pick the install path that matches your workflow.

### Install from GitHub (no clone required)

```bash
codex plugin marketplace add melandlabs/openloomi
codex plugin add openloomi@openloomi
```

Codex will fetch the OpenLoomi repository, discover the marketplace manifest
at the root, and install the `openloomi` plugin into
`~/.codex/plugins/cache/openloomi/openloomi/<version>`. Restart Codex and
start a new thread so the plugin cache is refreshed.

### Install from a local checkout (developers)

```bash
git clone https://github.com/melandlabs/openloomi.git
cd openloomi
codex plugin marketplace add .
codex plugin add openloomi@openloomi
```

The `.` argument tells Codex to use the repository root as a local
marketplace. The same `marketplace.json` resolution rules apply, so the
plugin path resolves to `./plugins/codex`.

To pick up local edits to `plugins/codex/` after the initial install, force
Codex to re-snapshot the marketplace:

```bash
codex plugin marketplace remove openloomi
codex plugin marketplace add .
codex plugin add openloomi@openloomi
```

### Requirements

- A Codex build that supports `codex plugin marketplace` (Codex CLI 0.144+).
- For GitHub install: network access to `github.com`.
- For local install: the OpenLoomi repository checked out somewhere writable.
- OpenLoomi Desktop installed, or a source build that stages `openloomi-ctl`,
  for any runtime task (`run`, handoff, loop, memory, connectors).
- Codex CLI available and configured as the recommended OpenLoomi desktop
  runtime, or an AI provider configured in OpenLoomi Desktop as a fallback.

The plugin alone is enough for setup guidance and workflow discovery. If
`openloomi-ctl` is missing, the plugin can still report readiness, install
instructions, and workflow guidance, but `run` and handoff calls cannot
execute.

### Verify the Bridge Before Using Codex

From the OpenLoomi source checkout, verify the plugin bridge directly:

```bash
node plugins/codex/scripts/loomi-bridge.mjs version
node plugins/codex/scripts/loomi-bridge.mjs setup-status
node plugins/codex/scripts/loomi-bridge.mjs workflow-guidance
node plugins/codex/scripts/loomi-bridge.mjs install-instructions
node plugins/codex/scripts/loomi-bridge.mjs install-openloomi --confirm
node plugins/codex/scripts/loomi-bridge.mjs initialize-session
node plugins/codex/scripts/loomi-bridge.mjs configure-ai-provider
node plugins/codex/scripts/loomi-bridge.mjs help
```

`version` prints the bridge identity, the current plugin phase, and the full
list of bridge commands:

```bash
node plugins/codex/scripts/loomi-bridge.mjs version
```

```json
{
  "name": "openloomi-codex-bridge",
  "version": "0.7.6",
  "pluginPhase": "runtime-provider-readiness",
  "commands": [
    "codex-runtime-info",
    "configure-ai-provider",
    "help",
    "initialize-session",
    "install-instructions",
    "install-openloomi",
    "pet",
    "run",
    "set-codex-runtime-env",
    "setup",
    "setup-status",
    "version",
    "workflow-guidance"
  ]
}
```

Expected readiness milestones for a fully prepared environment:

```text
installed: true
ctlPath: <path to openloomi-ctl>
tokenPresent: true
aiProviderConfigured: true
ready: true
nextAction: run
```

If `setup-status` reports `SOURCE_FOUND_CLI_NOT_BUILT`, the checkout was
detected but no `openloomi-ctl` was found. Install OpenLoomi Desktop or build
and stage the CLI before testing runtime execution.

If `tokenPresent` is `false`, open OpenLoomi Desktop and let it initialize a
guest/session token. The plugin and `openloomi-ctl` read the token from:

```text
~/.openloomi/token
```

If `aiProviderConfigured` is `false`, configure a model provider in
OpenLoomi-owned settings. Do not paste API keys into Codex chat.

You can also drive the same end-to-end flow from a single command:

```bash
node plugins/codex/scripts/loomi-bridge.mjs setup
```

The `setup` command walks the readiness state machine: install (with
explicit `--yes`) -> set the Codex runtime environment -> launch OpenLoomi ->
initialize a local guest/session token -> re-check status. It returns a
structured `steps` array and a final `status` block so Codex can render the path
it took. If the user chooses the AI provider fallback instead of the Codex
runtime, secret entry must happen in OpenLoomi-owned UI or interactive CLI
surfaces.

### Try the Plugin in Codex

After the marketplace is installed and Codex has been restarted, try these
prompts in a new Codex thread:

```text
@OpenLoomi Check whether OpenLoomi is ready.
```

```text
@OpenLoomi Show the OpenLoomi workflows available from Codex.
```

```text
@OpenLoomi Use Loomi to summarize the current task in one sentence.
```

Useful workflow prompts:

```text
@OpenLoomi Use the memory workflow to recall relevant context.
@OpenLoomi Use the loop workflow to plan the next step.
@OpenLoomi Check connector readiness for this task.
@OpenLoomi Hand this task to Loomi for follow-up.
```

The workflow skills are intentionally thin. They expose guidance and route
requests to OpenLoomi runtime surfaces. If the local runtime does not yet
support a requested handoff, reminder, connector, or scheduling action, the
plugin should report the runtime response instead of duplicating that logic in
Codex.

### Troubleshooting

`OpenLoomi is not installed`

: Install the packaged OpenLoomi Desktop release or provide an explicit
`OPENLOOMI_INSTALL_DIR` / `OPENLOOMI_CTL` path for development.

`SOURCE_FOUND_CLI_NOT_BUILT`

: The source checkout was detected, but no staged `openloomi-ctl` exists. The
current plugin does not execute the source tree directly.

`SESSION_INITIALIZATION_REQUIRED`

: OpenLoomi is installed but the local guest/session token could not be
created. Open OpenLoomi Desktop once so the local API can mint a guest
session, then re-run `setup-status` or `setup`.

`AI_PROVIDER_REQUIRED` / `AI_PROVIDER_STATUS_UNAVAILABLE`

: Prefer setting the OpenLoomi desktop runtime to Codex so OpenLoomi can reuse
the user's existing Codex CLI runtime. If the user chooses a separate AI
provider fallback, configure it in OpenLoomi Desktop. Secrets must stay in
OpenLoomi-owned UI or secure storage. If the local API is unreachable, the
plugin reports status as unavailable rather than falsely reporting missing
configuration.

`Codex still shows an old plugin version`

: Remove and re-add the marketplace, restart Codex, and start a new thread.
The cached plugin lives at
`~/.codex/plugins/cache/openloomi/openloomi/<version>`.

## Auto-Enable & First-Use Setup

Once the plugin is installed via the marketplace, it is **enabled
automatically**. The plugin's primary skill (`openloomi`) and its companion
sub-skills (`openloomi-install`, `openloomi-loop`, `openloomi-memory`,
`openloomi-connectors`, `openloomi-handoff`, `openloomi-api`,
`openloomi-feature-guide`) are picked up from
`plugins/codex/.codex-plugin/plugin.json` -> `skills` on the next Codex
start. No additional registration step is required - opening any new Codex
thread and mentioning `@OpenLoomi` (or any of the trigger phrases listed in
the skill front-matter) is enough to route into the bridge.

After enablement, the plugin can also drive itself through first-use setup
end-to-end. From a fresh shell, run:

```bash
node plugins/codex/scripts/loomi-bridge.mjs setup
```

From a Codex thread, ask:

```text
@OpenLoomi Run first-use setup.
```

The `setup` command is an auto-enable wizard that walks a small state
machine in one invocation:

```text
1. status_check      -> read setup-status
2. install           -> download + install OpenLoomi from the official
                        GitHub release (only when --yes/--confirm is set)
3. runtime_env       -> write OPENLOOMI_AGENT_PROVIDER=codex to the host
                        GUI launchd / environment.d, or return Windows
                        user-environment guidance
4. launch_desktop    -> open OpenLoomi Desktop and wait for the local API
                        to come up (configurable via --max-wait)
5. initialize-session -> mint a guest/session token via the local API
                        and write ~/.openloomi/token
6. status_check      -> final readiness check
```

The wizard stops early at any step that requires explicit user action:

- **Install** requires `--yes` (or `--confirm`). Without it, the wizard
  returns `setup: "awaiting_user_action"` with
  `reason: "INSTALL_CONFIRMATION_REQUIRED"` and a clear message - it will
  never download OpenLoomi silently. Per the non-goals, the wizard never
  installs from unofficial artifacts or non-default paths.
- **AI provider configuration is never auto-run.** Secret entry must
  happen in OpenLoomi-owned UI or interactive CLI surfaces. After the
  wizard finishes, `status.aiProviderConfigured` may still be `false`; in
  that case follow the `configure-ai-provider` guidance from the
  `openloomi-install` sub-skill.
- **Source checkout (`SOURCE_FOUND_CLI_NOT_BUILT`)** stops the wizard
  with `nextAction: "build_or_stage_openloomi_ctl"`. The plugin never
  builds OpenLoomi from source automatically.

The wizard returns structured JSON so Codex (or any other caller) can
render each step:

```json
{
  "ok": true,
  "setup": "ready",
  "steps": [
    { "step": "status_check", "ok": true, "reason": "INSTALL_REQUIRED" },
    { "step": "install", "ok": true },
    { "step": "runtime_env", "ok": true, "after": "codex" },
    { "step": "launch_desktop", "ok": true },
    { "step": "initialize-session", "ok": true, "tokenWritten": true },
    { "step": "status_check", "ok": true, "reason": "READY" }
  ],
  "status": {
    "installed": true,
    "ctlPath": "/Applications/OpenLoomi.app/Contents/MacOS/openloomi-ctl",
    "tokenPresent": true,
    "aiProviderConfigured": false,
    "ready": true,
    "nextAction": "configure_ai_provider"
  },
  "message": "OpenLoomi is ready and the desktop app is wired to Codex."
}
```

Flags accepted by `setup`:

- `--yes` / `--confirm` - authorize the install step when OpenLoomi is
  missing. Without this flag the wizard is read-only.
- `--max-wait <ms>` - how long to wait for the local API after launching
  the desktop app (default `30000`).
- `--non-interactive` - fail fast instead of waiting for the local API;
  useful in CI.

Typical first-use run from a Codex prompt:

```text
@OpenLoomi Run first-use setup with --yes so the install step can proceed.
```

That single call enables the plugin, walks the full state machine, writes
`~/.openloomi/token`, and leaves the plugin ready for `run`, `handoff`,
`memory`, `loop`, and `connector` workflows in the same thread.

### Re-running setup

`setup` is idempotent. Re-run it any time to:

- recover from `SESSION_INITIALIZATION_REQUIRED`;
- re-apply `OPENLOOMI_AGENT_PROVIDER=codex` after a Codex upgrade wiped
  the launchd env;
- re-mint a guest/session token after deleting `~/.openloomi/token`;
- confirm that all steps still resolve to `READY` after an OpenLoomi
  Desktop upgrade.

The wizard has a hard ceiling of 8 chained transitions per invocation, so
looping is bounded. If it cannot reach `READY`, the final JSON reports
the blocking `reason` and `nextAction` and the user can drive the
remaining step manually (typically `configure-ai-provider` or
`open_openloomi`).

## Plugin Package Layout

The plugin implementation lives under this module:

```text
plugins/codex/
  README.md
  .codex-plugin/plugin.json
  scripts/loomi-bridge.mjs
  assets/logo.png
  skills/
    openloomi/SKILL.md
    openloomi-install/SKILL.md
    openloomi-loop/SKILL.md
    openloomi-memory/SKILL.md
    openloomi-connectors/SKILL.md
    openloomi-handoff/SKILL.md
    openloomi-api/SKILL.md
    openloomi-feature-guide/SKILL.md
    composio/SKILL.md
    composio/rules/...
  tests/bridge.test.mjs
```

Responsibilities:

- `.codex-plugin/plugin.json`: Codex plugin metadata, display information, and
  skill discovery.
- `skills/openloomi/SKILL.md`: thin Codex entrypoint that decides when to call
  the bridge.
- `scripts/loomi-bridge.mjs`: local adapter for discovery, install guidance,
  readiness checks, AI provider setup handoff, one-shot execution, and future
  hook integration.
- `assets/`: plugin icons and visual assets.

## Architecture

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
              -> openloomi-ctl runner
                  -> OpenLoomi local runtime
                      -> memory
                      -> connectors
                      -> loop
                      -> model provider
                      -> OpenLoomi Pet
```

The plugin should stay thin. It should call OpenLoomi-owned runtime surfaces
instead of copying connector, memory, or loop implementations into Codex.

## Supported Environments

### Packaged Desktop Install

The user installed OpenLoomi through an official desktop installer or release
artifact. The plugin should discover the bundled `openloomi-ctl`, verify it
with `--version`, and use it for local tasks.

### Source Checkout

The user cloned the OpenLoomi repository locally and wants Codex to work against
that checkout. The plugin should detect source checkouts when explicitly
configured or when known project markers are present.

If a source checkout exists but the CLI is not built or staged, the plugin
should return actionable instructions rather than building automatically without
user confirmation.

### Launching the desktop app with the Codex runtime

When OpenLoomi is used from Codex, this is the recommended first-use path: it
lets OpenLoomi reuse the user's existing Codex runtime and avoids requiring a
separate OpenLoomi AI provider key just to complete the first Codex plugin
workflow.

By default the packaged desktop app routes chat and agent requests through the
Claude provider. To run the same desktop binary against the local Codex CLI
instead, set `OPENLOOMI_AGENT_PROVIDER=codex` in the environment the desktop app
actually inherits.

> **macOS caveat:** the desktop app's web server runs inside the GUI launchd
> session, not your terminal. `export FOO=bar` in a terminal does **not** reach
> the running web server. After setting the variable you must Quit and reopen
> `OpenLoomi.app` so the new env is inherited by the freshly forked web process.
> On Linux a per-user env file works after the next login, and on Windows you
> edit the user environment via System Settings.

```bash
node plugins/codex/scripts/loomi-bridge.mjs set-codex-runtime-env codex
# macOS: writes via launchctl setenv.
# Linux: writes ~/.config/environment.d/openloomi-codex.conf.
# Windows: prints manual steps (System Settings -> Environment Variables).

# Then quit and reopen OpenLoomi so the new env reaches the web server.
```

Flags accepted by `set-codex-runtime-env`:

- `<value>` - defaults to `codex` (other supported values: `claude`,
  `opencode`, `hermes`, `openclaw`).
- `--unset` - clear `OPENLOOMI_AGENT_PROVIDER` from the host environment.
- `--dry-run` - describe what would happen without performing the write.

For a permanent shell-side switch on macOS or Linux, you can additionally append
the export to your shell rc so future shells remember it:

```bash
echo 'export OPENLOOMI_AGENT_PROVIDER=codex' >> ~/.zshrc
```

The shell export helps the bridge itself and `openloomi-ctl`; the
`set-codex-runtime-env` step is what makes the GUI launchd domain and the
desktop session pick the variable up.

Optional companion variables (all read by `apps/web`'s native-agent env resolver
at startup):

```bash
export OPENLOOMI_AGENT_CODEX_COMMAND=codex           # defaults to `codex` on PATH
export OPENLOOMI_AGENT_CODEX_MODEL=gpt-5.4            # optional model override
export OPENLOOMI_AGENT_CODEX_PROFILE=work             # optional `-p <name>`
export OPENLOOMI_AGENT_CODEX_SANDBOX=workspace-write # read-only | workspace-write | danger-full-access
export OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL=on-request # untrusted | on-failure | on-request | never
export OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK=true # default true
export OPENLOOMI_AGENT_CODEX_FULL_AUTO=false         # set true to allow --full-auto under bypassPermissions
export OPENLOOMI_AGENT_CODEX_TIMEOUT_MS=120000       # CLI runtime budget in ms
```

Prerequisites that must hold before the desktop app will actually drive Codex:

- `which codex` resolves to a working Codex CLI binary (install via
  `brew install --cask codex` or `npm i -g @openai/codex`).
- `~/.codex/config.toml` is configured and `OPENAI_API_KEY` (or the Codex CLI's
  other auth) is available to the spawned process.

Verification after launch: the desktop app's `GET /api/native/providers` should
return `codex` inside `agents` and `defaultAgent: "codex"`. If you still see
`defaultAgent: "claude"` after running `set-codex-runtime-env` and reopening the
app, the env change did not stick - re-run
`launchctl getenv OPENLOOMI_AGENT_PROVIDER` in a terminal to confirm the GUI
session actually has it.

### Surface the switch from inside Codex

The Codex plugin bridge exposes the same switch plan as structured JSON so it
can be referenced from skills and shown verbatim in chat without retyping the
shell snippets. From any Codex session, run:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" codex-runtime-info
```

The bridge returns:

- `envProviderKey` (`OPENLOOMI_AGENT_PROVIDER`)
- `switch.oneOff` and `switch.permanent` platform guidance
- `prerequisites` - Codex CLI binary, `~/.codex/config.toml`, `OPENAI_API_KEY`
- `companionEnvVars[]` - `OPENLOOMI_AGENT_CODEX_*` variables with their
  defaults
- `verify.endpoint` / `verify.expectDefaultAgent` - the
  `GET /api/native/providers` contract
- `defaults.currentDefaultProvider` - echoes the active
  `OPENLOOMI_AGENT_PROVIDER`
- `defaults.codexCliOnPath` - best-effort PATH probe for the `codex` binary

The companion command that performs the GUI-session env write is
`set-codex-runtime-env`:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" set-codex-runtime-env codex
# Clear it later:
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" set-codex-runtime-env --unset
# Plan only, do not write:
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" set-codex-runtime-env --dry-run
```

After running `set-codex-runtime-env`, Quit and reopen `OpenLoomi.app` so the
new env actually reaches the freshly forked web process. The env only applies
to GUI processes launched after the env write.

### Missing Install

If OpenLoomi is not installed, the plugin should support a user-approved install
flow. The install flow must use official OpenLoomi artifacts, resolve the
current platform's release asset automatically, and install with the default
installer path where automatic installation is supported.

## Discovery Strategy

The bridge should detect OpenLoomi in this order:

```text
1. OPENLOOMI_CTL
2. OPENLOOMI_HOME or OPENLOOMI_INSTALL_DIR
3. OPENLOOMI_REPO_DIR
4. PATH lookup for openloomi-ctl
5. Platform default packaged install paths
6. Previously saved non-secret plugin config
7. User-provided install path or source checkout path
8. User-approved install flow
```

For packaged installs, check common layouts:

```text
<install-root>/openloomi-ctl
<install-root>/openloomi-ctl.exe
<install-root>/cli/openloomi-ctl
<install-root>/cli/openloomi-ctl.exe
<install-root>/resources/cli/openloomi-ctl
<install-root>/resources/cli/openloomi-ctl.exe
```

For source checkouts, check project markers and likely CLI locations:

```text
<repo-root>/package.json
<repo-root>/apps/web/src-tauri/Cargo.toml
<repo-root>/apps/web/src-tauri/cli/openloomi-ctl
<repo-root>/apps/web/src-tauri/cli/openloomi-ctl.exe
<repo-root>/apps/web/src-tauri/target/release/openloomi-ctl
<repo-root>/apps/web/src-tauri/target/release/openloomi-ctl.exe
```

## Readiness Contract

`setup-status` should return stable JSON:

```json
{
  "mode": "packaged | source | unconfigured",
  "installed": true,
  "ctlPath": "<resolved openloomi-ctl path>",
  "version": "openloomi-ctl 0.7.6",
  "tokenPresent": true,
  "session": {
    "tokenPresent": true,
    "guestBootstrapSupported": true,
    "guestBootstrapMode": "local-openloomi-api"
  },
  "aiProviderConfigured": true,
  "aiProviderStatus": "runtime_configured",
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
    "connectors": {
      "checked": true,
      "available": true,
      "reason": "CONNECTOR_STATUS_LOADED",
      "setupRecommended": true
    }
  }
}
```

Connector readiness is a status-only advisory. Missing Gmail, Slack, GitHub,
Calendar, or Linear connections should not block memory-only or local runtime
workflows, so `ready` can remain `true` while `connectorSetupRecommended`
points the user to the OpenLoomi-owned `/connectors` setup surface. Connector
tokens, account identifiers, OAuth secrets, passwords, and Composio secrets
must never be printed by the Codex bridge.

The bridge first reads the Loop connector status endpoint and then, when a local
session token is available, merges OpenLoomi-owned native integration accounts
from `/api/integrations` as status-only rows. This lets Codex show native
connections such as Gmail or QQbot as connected even when the Loop/Composio
probe is unavailable or slow, while still keeping all credentials inside
OpenLoomi-owned surfaces.

Common `nextAction` values:

```text
install_openloomi
provide_install_or_repo_path
build_or_stage_openloomi_ctl
initialize_openloomi_session
open_openloomi
configure_ai_provider
configure_connectors
show_openloomi_skills
return_without_bridge
run
```

Common `reason` values:

```text
OPENLOOMI_CTL_NOT_FOUND
OPENLOOMI_CTL_INVALID
SOURCE_FOUND_CLI_NOT_BUILT
INSTALL_REQUIRED
SESSION_INITIALIZATION_REQUIRED
READY_SESSION_BOOTSTRAP_PENDING
AI_PROVIDER_REQUIRED
AI_PROVIDER_STATUS_UNAVAILABLE
CONNECTOR_SETUP_REQUIRED
RECURSION_GUARD
READY
```

OpenLoomi guest mode is supported. A missing token should not be treated as a
requirement for account registration or manual login. When OpenLoomi is
installed, the bridge may initialize a guest/session token through the local
OpenLoomi API and write the standard `~/.openloomi/token` file. If the local API
is not reachable, the bridge may launch OpenLoomi and ask the user to let
OpenLoomi initialize its guest session.

The bridge attempts two guest endpoints, in order:

1. `POST /api/remote-auth/guest` - the JSON bearer flow. This is the same
   endpoint the Claude plugin calls and the one that registers a fresh guest
   account in the OpenLoomi runtime's local database before returning a
   bearer. Prefer this when the running OpenLoomi build exposes it.
2. `POST /api/auth/guest?redirectUrl=/` followed by `GET /api/auth/token`
   using the `Set-Cookie` header - the legacy cookie-based flow kept for
   older OpenLoomi builds that don't ship the JSON endpoint. The bridge
   falls back to this path only when the JSON endpoint returns 404 or is
   unreachable before any response, so a transient 5xx or empty payload on
   the JSON path still tries the cookie path before giving up.

Both paths produce the same outcome from the bridge's perspective: a token
written to `~/.openloomi/token`, masked out of logs and stderr, and
reportable via `setup-status` as `session.tokenPresent: true`.

AI provider readiness should respect both environment variables and
OpenLoomi-owned UI/runtime settings. When a token is available, the bridge may
convert that token to a local session cookie through OpenLoomi's existing auth
surface, call the local AI preferences API, and report only masked status
fields such as `hasApiKey`, `baseUrlPresent`, and `modelPresent`. If OpenLoomi
is not running, the bridge should report `AI_PROVIDER_STATUS_UNAVAILABLE`
instead of claiming the provider is missing.

## First-Use Runtime and Provider Setup

The plugin should guide users toward the Codex runtime path when OpenLoomi is
first used from Codex. This lets OpenLoomi reuse the user's existing Codex CLI
runtime and avoids requiring a separate OpenLoomi AI provider key for the first
plugin workflow.

Preferred paths:

1. Set or verify `OPENLOOMI_AGENT_PROVIDER=codex` for the OpenLoomi desktop
   runtime, then restart OpenLoomi and verify `/api/native/providers`.
2. If the user chooses a separate AI provider fallback, launch or guide an
   OpenLoomi-owned setup flow for:
   - base URL;
   - API key;
   - model name.

Raw API keys must not be pasted into Codex chat. If a setup flow collects an API
key, that input must happen in an OpenLoomi-owned UI or CLI surface that avoids
printing secrets and writes directly to OpenLoomi's local configuration or
secure storage.

## OpenLoomi Skill Guidance

After OpenLoomi starts, the plugin should guide users toward OpenLoomi-related
skills and workflows that are useful from Codex. The Codex plugin ships the
following skills under `plugins/codex/skills/`:

- `openloomi`: the main entry point. Triggers on any `OpenLoomi` / `Loomi`
  mention and dispatches to the right sub-skill.
- `openloomi-install`: walks install, first-use setup, AI provider setup,
  and `SESSION_INITIALIZATION_REQUIRED` recovery flows.
- `openloomi-loop`: run attention-loop and follow-up workflows.
- `openloomi-memory`: search or write memory through OpenLoomi-owned runtime
  surfaces. Thin wrapper - does not implement memory storage.
- `openloomi-connectors`: check whether Slack, GitHub, Gmail, Calendar, and
  other sources are configured before acting. Reports status only.
- `openloomi-handoff`: send the current Codex task to Loomi for follow-up.
  Exposed as a Codex skill; the Claude Code plugin exposes the same capability
  through its own `/openloomi:*` slash-command surface instead.
- `openloomi-api`: openloomi HTTP API reference (auth, chat, RAG, workspace,
  integrations, feedback). Triggered by API / backend questions.
- `openloomi-feature-guide`: product overview, capabilities, and how-tos for
  non-developer questions like "what can openloomi do".
- `composio`: third-party 1000+ app integration router (Gmail, Slack,
  GitHub, etc.) via the Composio CLI. Platform-agnostic; not OpenLoomi
  business logic.

The `workflow-guidance` bridge command exposes structured guidance for the
four workflow skills (`openloomi-loop`, `openloomi-memory`,
`openloomi-connectors`, `openloomi-handoff`). All other skills are
documentation or routing helpers. The plugin must not copy OpenLoomi
connector, memory, loop, scheduling, or handoff persistence logic into
Codex - runtime implementations stay inside the OpenLoomi desktop runtime.

## Pet State Control

The bridge ships a `pet <state>` command that mirrors
`plugins/claude/scripts/loomi-bridge.mjs::cmdPet`. It validates against the
same 9-state sprite vocabulary and POSTs `{state, source: "codex-plugin"}`
to `/api/pet/state` on the local OpenLoomi runtime with the bearer token
from `~/.openloomi/token`. The command tries every local OpenLoomi API URL
in priority order, so a closed 3414 port can still fall back to a source
runtime on 3515.

```bash
node plugins/codex/scripts/loomi-bridge.mjs pet happy
node plugins/codex/scripts/loomi-bridge.mjs pet working
```

Valid states:

```text
happy, idle, juggling, needsinput, presenting, sleeping, sweeping, thinking, working
```

Failure modes (all return structured JSON, never throw):

- `MISSING_STATE` - no positional state argument.
- `INVALID_STATE` - state not in the vocabulary; response includes
  `validStates` and `received`.
- `TOKEN_MISSING` - `~/.openloomi/token` does not exist or is unreadable.
  Run `setup` or open OpenLoomi Desktop once before driving Pet state.
- `ENDPOINT_MISSING` - runtime answered with HTTP 404. Treat as
  non-blocking: the bridge returns the polite notice that the endpoint is
  pending. Pet control resumes automatically once OpenLoomi ships the route.
- `API_UNREACHABLE` - no local API responded on 3414/3515. `attempts` lists
  every URL the bridge tried.
- `PET_FAILED` - runtime answered but with a non-success status code.

The bridge also exposes an internal `state <state> --event <event>` command
for Codex lifecycle hooks. This path is hook-safe: it never fails the Codex
turn, never prompts, and returns `hook: "skipped"` when OpenLoomi is not
ready, the token is missing, or the Pet endpoint is unavailable.

## Codex Pet Lifecycle Hooks

Status: implemented as a non-blocking Pet mirror.

The Codex plugin ships `plugins/codex/hooks/hooks.json` and declares it in
`.codex-plugin/plugin.json`. The hook bundle mirrors Codex lifecycle events
onto the OpenLoomi Pet without making authorization or control-flow
decisions.

Current mapping:

- `SessionStart` - Pet `presenting`;
- `UserPromptSubmit` - Pet `thinking`;
- `PreToolUse` - Pet `working`;
- `PermissionRequest` - Pet `needsinput`;
- `PostToolUse` - Pet `thinking`;
- `SubagentStart` - Pet `juggling`;
- `SubagentStop` - Pet `thinking`;
- `Stop` - Pet `happy`.

Hooks use the same runtime-accepted `source: "codex-plugin"` value when
posting to `/api/pet/state`. They are best-effort UI feedback only. Memory
archive, follow-up scheduling, permission decisions, and connector behavior
stay inside OpenLoomi-owned runtime surfaces.

## Secret Handling

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
AI provider hasApiKey/baseUrl/model presence
connector configured/missing
local API reachable/unreachable
```

Example safe output:

```json
{
  "aiProviderConfigured": false,
  "checked": [
    {
      "key": "OPENAI_API_KEY",
      "present": false,
      "source": "env"
    },
    {
      "key": "ANTHROPIC_API_KEY",
      "present": true,
      "source": ".env.local"
    }
  ]
}
```

The bridge may report key names and presence. It must not print values.

The bridge may receive a guest/session token from the local OpenLoomi API only
to write the standard `~/.openloomi/token` file. It must keep the token out of
argv, stdout, stderr, logs, and the Codex transcript.

Which token-bearing endpoint the bridge ends up calling is implementation
detail - both `POST /api/remote-auth/guest` and the cookie-based
`POST /api/auth/guest` + `GET /api/auth/token` flow end up writing the same
`~/.openloomi/token` file. From outside, the bridge exposes only that a
guest/session token was obtained, not which path produced it.

## One-Shot Execution

The MVP should prefer `openloomi-ctl` for local execution:

```bash
openloomi-ctl --one-shot --stdin --json --permission-mode deny
```

Using `--stdin` avoids shell quoting issues and keeps the task prompt out of
command-line arguments.

The local API is optional for the MVP. It may be used later for richer
readiness checks, connector status, and setup handoffs, but every local API
check must preserve the no-secrets contract.

## Non-Goals

- Do not download or install OpenLoomi without an explicit user installation
  intent or confirmation.
- Do not install from unofficial artifacts or default to custom install paths.
- Do not build OpenLoomi from source automatically.
- Do not ask users to paste API keys, OAuth tokens, or auth tokens into Codex
  chat.
- Do not pass secrets as command-line arguments.
- Do not implement connector protocols inside the Codex plugin.
- Do not duplicate the full OpenLoomi runtime inside the Codex plugin.
- Do not make the Codex plugin a replacement for OpenLoomi Desktop.
