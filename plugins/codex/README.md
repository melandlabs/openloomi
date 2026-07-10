# OpenLoomi Codex Plugin

## Overview

The OpenLoomi Codex plugin makes Codex an agent shell for a local OpenLoomi
runtime. Codex provides the interactive coding surface, while OpenLoomi owns the
personal memory layer, connector graph, model provider setup, task loop, and
local privacy boundary.

The plugin is designed to:

- discover or install OpenLoomi for the user;
- verify that `openloomi-ctl` is available;
- guide first-use AI provider setup;
- run one-shot tasks through the local OpenLoomi runtime;
- help users access OpenLoomi-related workflows such as `openloomi-loop` and
  `openloomi-memory` from Codex;
- optionally connect Codex task lifecycle events to the OpenLoomi Pet.

This directory contains the Codex plugin design. Claude Code should use the
same top-level module layout under `plugins/claude`.

```text
plugins/
  codex/
    README.md
    ROADMAP.md
  claude/
    README.md
    ROADMAP.md
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
  -> plugin guides first-use AI provider setup
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
- An AI provider configured in OpenLoomi Desktop for runtime tasks.

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
explicit `--yes`) -> initialize a local guest/session token -> re-check
status. It returns a structured `steps` array and a final `status` block so
Codex can render the path it took. The AI provider step is never automated;
secret entry must happen in OpenLoomi-owned UI or interactive CLI surfaces.

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

: Configure the AI provider in OpenLoomi Desktop. Secrets must stay in
OpenLoomi-owned UI or secure storage. If the local API is unreachable, the
plugin reports status as unavailable rather than falsely reporting missing
configuration.

`Codex still shows an old plugin version`

: Remove and re-add the marketplace, restart Codex, and start a new thread.
The cached plugin lives at
`~/.codex/plugins/cache/openloomi/openloomi/<version>`.

## Plugin Package Layout

The plugin implementation lives under this module:

```text
plugins/codex/
  README.md
  ROADMAP.md
  .codex-plugin/plugin.json
  skills/openloomi/SKILL.md
  scripts/loomi-bridge.mjs
  assets/logo.png
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
  "version": "openloomi-ctl 0.7.0",
  "tokenPresent": true,
  "session": {
    "tokenPresent": true,
    "guestBootstrapSupported": true,
    "guestBootstrapMode": "local-openloomi-api"
  },
  "aiProviderConfigured": true,
  "aiProviderStatus": "runtime_configured",
  "connectorStatusAvailable": false,
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
    }
  }
}
```

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
READY
```

OpenLoomi guest mode is supported. A missing token should not be treated as a
requirement for account registration or manual login. When OpenLoomi is
installed, the bridge may initialize a guest/session token through the local
OpenLoomi API and write the standard `~/.openloomi/token` file. If the local API
is not reachable, the bridge may launch OpenLoomi and ask the user to let
OpenLoomi initialize its guest session.

AI provider readiness should respect both environment variables and
OpenLoomi-owned UI/runtime settings. When a token is available, the bridge may
convert that token to a local session cookie through OpenLoomi's existing auth
surface, call the local AI preferences API, and report only masked status
fields such as `hasApiKey`, `baseUrlPresent`, and `modelPresent`. If OpenLoomi
is not running, the bridge should report `AI_PROVIDER_STATUS_UNAVAILABLE`
instead of claiming the provider is missing.

## First-Use AI Provider Setup

The plugin should guide users through AI provider configuration when OpenLoomi
is first used from Codex.

Preferred paths:

1. Use Codex OAuth for Codex subscribers if an official supported surface is
   available.
2. Otherwise, launch or guide an OpenLoomi-owned setup flow for:
   - base URL;
   - API key;
   - model name.
3. Keep OpenLoomi Desktop settings as a fallback.

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
  surfaces. Thin wrapper — does not implement memory storage.
- `openloomi-connectors`: check whether Slack, GitHub, Gmail, Calendar, and
  other sources are configured before acting. Reports status only.
- `openloomi-handoff`: send the current Codex task to Loomi for follow-up.
  Codex-specific (Claude Code does not yet have an equivalent).
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
Codex — runtime implementations stay inside the OpenLoomi desktop runtime.

## Optional Codex Hooks

Status: deferred pending Codex platform support.

The Codex plugin surface does not currently expose Claude-style lifecycle
hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`Stop`, `SubagentStart`, `SubagentStop`, `Notification`). The Claude Code
plugin (`plugins/claude`) implements these via `hooks/hooks.json` plus
`scripts/hooks-merge.cjs`; there is no equivalent mechanism on the Codex
side as of the current Codex plugin API.

The intended Pet notification surface is:

- a Codex task completes — Pet `happy`;
- a Codex task needs user input — Pet `needsinput`;
- a handoff has been queued for Loomi follow-up — Pet `working`;
- OpenLoomi connector or model setup is blocking a task — Pet `thinking`.

Until Codex adds an official lifecycle event surface, this section stays
open. Do not ship a hand-rolled polling loop inside the Codex plugin to
fake hooks — it would duplicate Claude-only state and conflict with the
"thin wrapper, no business logic" rule (see `ROADMAP.md` Phase 8).

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
