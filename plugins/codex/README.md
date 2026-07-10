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

## User Tour: Try the Plugin from a Source Checkout

This tour is for users who cloned the OpenLoomi repository and want to try the
Codex plugin before it is available through a public plugin marketplace.

The source checkout provides the Codex plugin files. Runtime execution still
needs a local OpenLoomi runtime with `openloomi-ctl`. The easiest test path is
to install the packaged OpenLoomi Desktop release, then install this plugin into
Codex from a local marketplace that points at `plugins/codex`.

### Requirements

- A Codex build that supports `codex plugin marketplace`.
- A local OpenLoomi source checkout.
- A local marketplace root whose `marketplace.json` exposes this plugin.
- OpenLoomi Desktop installed, or a source build that stages `openloomi-ctl`.
- An initialized OpenLoomi guest/session token at `~/.openloomi/token` for
  one-shot execution.
- An AI provider configured in OpenLoomi Desktop for runtime tasks.

The source checkout alone is not enough for runtime execution. If
`openloomi-ctl` is missing, the plugin can still show setup and workflow
guidance, but `run` and workflow handoff calls cannot execute.

### Install the Local Marketplace

Point Codex at the local marketplace root provided by the OpenLoomi checkout or
by a development checkout of the marketplace package:

```powershell
codex.cmd plugin marketplace add <path-to-openloomi-local-marketplace>
```

On macOS or Linux, use:

```bash
codex plugin marketplace add <path-to-openloomi-local-marketplace>
```

The marketplace root must contain a `marketplace.json` entry for the
`openloomi` plugin, and that entry must resolve to this plugin directory:

```text
openloomi/
  plugins/
    codex/
      .codex-plugin/plugin.json
      skills/
      scripts/
      assets/
```

After adding or updating the marketplace, restart Codex and start a new thread
so the plugin cache is refreshed.

During local development, if Codex still loads an older cached plugin, remove
and add the marketplace again:

```powershell
codex.cmd plugin marketplace remove <marketplace-name>
codex.cmd plugin marketplace add <path-to-openloomi-local-marketplace>
```

### Verify the Bridge Before Using Codex

From the OpenLoomi source checkout, verify the plugin bridge directly:

```powershell
node plugins\codex\scripts\loomi-bridge.mjs version
node plugins\codex\scripts\loomi-bridge.mjs setup-status
node plugins\codex\scripts\loomi-bridge.mjs workflow-guidance
```

Expected readiness milestones:

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

`not_authenticated`

: `openloomi-ctl` could not read `~/.openloomi/token`. Open OpenLoomi Desktop
and initialize guest mode, then re-run `setup-status`.

`AI_PROVIDER_REQUIRED`

: Configure the AI provider in OpenLoomi Desktop. Secrets must stay in
OpenLoomi-owned UI or secure storage.

`Codex still shows an old plugin version`

: Remove and re-add the local marketplace, restart Codex, and start a new
thread.

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
skills and workflows that are useful from Codex:

- `openloomi-loop`: run attention-loop and follow-up workflows;
- `openloomi-memory`: search or write memory through OpenLoomi-owned runtime
  surfaces;
- `openloomi-connectors`: check whether Slack, GitHub, Gmail, Calendar, and
  other sources are configured before acting;
- `openloomi-handoff`: send the current Codex task to Loomi for follow-up.

The `workflow-guidance` bridge command exposes structured guidance for these
workflows. The Codex plugin exposes thin wrapper skills, but the OpenLoomi
runtime owns the underlying connector, memory, loop, and handoff
implementation.

## Optional Codex Hooks

The plugin may later add Codex hooks so the OpenLoomi Pet can notify the user
when:

- a Codex task completes;
- a Codex task needs user input;
- a handoff has been queued for Loomi follow-up;
- OpenLoomi connector or model setup is blocking a requested task.

Hook support is optional and should be added after the core install, readiness,
AI provider setup, and one-shot flows are stable.

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
