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
  -> plugin checks login and readiness
  -> plugin runs a one-shot OpenLoomi task
  -> plugin shows related OpenLoomi skills and workflows
```

## Plugin Package Layout

The future plugin implementation should live under this module:

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
flow. The install flow must use official OpenLoomi artifacts, avoid silent
execution, and clearly explain what will be installed before taking action.

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
  "aiProviderConfigured": true,
  "connectorStatusAvailable": false,
  "apiReachable": false,
  "ready": true,
  "nextAction": "run"
}
```

Common `nextAction` values:

```text
install_openloomi
provide_install_or_repo_path
build_or_stage_openloomi_ctl
login_openloomi
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
LOGIN_REQUIRED
AI_PROVIDER_REQUIRED
CONNECTOR_SETUP_REQUIRED
READY
```

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
- connector readiness: check whether Slack, GitHub, Gmail, Calendar, and other
  sources are configured before acting;
- handoff workflows: send the current Codex task to Loomi for follow-up.

The Codex plugin may expose thin wrapper skills for these workflows, but the
OpenLoomi runtime should own the underlying implementation.

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

Codex must never receive or print:

- model provider API keys;
- OAuth access tokens or refresh tokens;
- connector app secrets;
- OpenLoomi auth tokens;
- local secure-storage contents.

Allowed status-only checks:

```text
OPENLOOMI_AUTH_TOKEN present/missing
~/.openloomi/token present/missing
AI provider configured/missing
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

- Do not silently download, install, or build OpenLoomi.
- Do not ask users to paste API keys, OAuth tokens, or auth tokens into Codex
  chat.
- Do not pass secrets as command-line arguments.
- Do not implement connector protocols inside the Codex plugin.
- Do not duplicate the full OpenLoomi runtime inside the Codex plugin.
- Do not make the Codex plugin a replacement for OpenLoomi Desktop.
