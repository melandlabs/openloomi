# OpenLoomi Codex Plugin Design Plan

## Overview

This document proposes an OpenLoomi Codex plugin that lets Codex use a local
OpenLoomi runtime as an agent shell for memory, connector readiness, and
one-shot task execution.

The first milestone is intentionally small: Codex should be able to detect a
local OpenLoomi installation, verify `openloomi-ctl`, check setup readiness
without exposing secrets, send a one-shot task, and display the OpenLoomi
result.

The plugin is a companion adapter. It does not embed the full OpenLoomi
runtime, connector implementations, or secret-management flows. OpenLoomi
Desktop and `openloomi-ctl` remain responsible for local runtime execution,
login, model provider configuration, connector setup, memory access, and
secret storage.

## Product Context

OpenLoomi is designed as a local-first assistant that checks connector
availability, understands the user's work state, routes attention, and can
appear through different agent shells such as Codex, Claude Code, or Hermes.

The Codex plugin turns that product narrative into a concrete integration path:
Codex becomes a shell that can ask the local OpenLoomi runtime for context,
readiness, and task execution while OpenLoomi continues to own the attention
brain, memory layer, connector graph, and local privacy boundary.

## Goals

- Detect packaged OpenLoomi desktop installs.
- Detect developer source checkouts.
- Verify that `openloomi-ctl` is present and executable.
- Report login, model provider, local API, and connector readiness as status
  only.
- Run a simple one-shot task through `openloomi-ctl --one-shot --json`.
- Provide safe setup handoffs when OpenLoomi, login, model configuration, or
  connector configuration is missing.
- Avoid sending API keys, OAuth tokens, connector secrets, or OpenLoomi auth
  tokens to Codex chat.
- Keep the Codex plugin thin and let OpenLoomi own memory, connectors, loop
  execution, settings, and secret storage.

## Non-Goals

- Do not implement connector protocols inside the Codex plugin.
- Do not ask users to paste API keys, OAuth tokens, or auth tokens into Codex.
- Do not pass secrets as command-line arguments.
- Do not automatically download, install, or build OpenLoomi.
- Do not require a running local web server for the MVP.
- Do not duplicate the full set of OpenLoomi skills inside the Codex plugin.
- Do not make the Codex plugin a replacement for OpenLoomi Desktop.

## Supported User Environments

### Packaged Desktop Install

The user installed OpenLoomi through the official desktop installer or release
artifact. The plugin should discover the bundled `openloomi-ctl`, verify it
with `--version`, and run one-shot tasks through it.

### Source Checkout

The user cloned the OpenLoomi repository locally and wants Codex to work against
that checkout. The plugin should detect a source checkout when explicitly
configured or when a known source layout is found. If the source checkout exists
but the CLI binary is missing, the plugin should return an actionable readiness
state instead of building automatically.

## High-Level Architecture

```text
Codex plugin
  -> Codex skill entrypoint
      -> loomi-bridge
          -> discovery layer
          -> readiness layer
          -> setup handoff layer
          -> openloomi-ctl runner
              -> OpenLoomi local runtime
                  -> memory
                  -> connectors
                  -> model provider
                  -> loop execution
```

## Component Responsibilities

### Codex Plugin Bundle

Future plugin skeleton:

```text
apps/plugin/codex/
  .codex-plugin/plugin.json
  skills/openloomi/SKILL.md
  scripts/loomi-bridge.mjs
  assets/logo.png
```

The plugin bundle provides marketplace metadata, a thin Codex skill entrypoint,
and a local bridge script. It should not include full connector or memory
implementations.

### `skills/openloomi/SKILL.md`

The skill is the Codex-facing entrypoint. It decides when to call the bridge and
how to interpret bridge output.

Expected behavior:

- Run `setup-status` before task execution.
- If OpenLoomi is not installed, return install instructions.
- If OpenLoomi is installed but login or model setup is incomplete, return a
  setup handoff.
- If ready, call the bridge `run` command with the user's task.

### `scripts/loomi-bridge.mjs`

The bridge is the local adapter between Codex and OpenLoomi.

MVP commands:

```text
setup-status
install-instructions
version
run
```

The bridge must prefer process spawning with explicit argument arrays and stdin
over shell command strings.

### `openloomi-ctl`

`openloomi-ctl` is the official local execution boundary. The MVP should call:

```bash
openloomi-ctl --one-shot --stdin --json --permission-mode deny
```

Using `--stdin` avoids shell quoting issues and keeps the prompt out of command
arguments.

### OpenLoomi Desktop and Setup Surfaces

OpenLoomi Desktop owns login, model provider configuration, connector
configuration, local settings, and secret storage. The Codex plugin may point
users to OpenLoomi-owned setup surfaces, but it must not collect secrets itself.

## Discovery Strategy

The plugin should detect OpenLoomi in this order:

```text
1. OPENLOOMI_CTL
2. OPENLOOMI_HOME or OPENLOOMI_INSTALL_DIR
3. OPENLOOMI_REPO_DIR
4. PATH lookup for openloomi-ctl
5. Platform default packaged install paths
6. Previously saved non-secret plugin config
7. User-provided install path or source checkout path
```

### Packaged Install Layouts

The bridge should check platform-specific defaults and common packaged layouts:

```text
<install-root>/openloomi-ctl
<install-root>/openloomi-ctl.exe
<install-root>/cli/openloomi-ctl
<install-root>/cli/openloomi-ctl.exe
<install-root>/resources/cli/openloomi-ctl
<install-root>/resources/cli/openloomi-ctl.exe
```

### Source Checkout Layouts

For source checkouts, the bridge should check for known project markers and CLI
binary locations:

```text
<repo-root>/package.json
<repo-root>/apps/web/src-tauri/Cargo.toml
<repo-root>/apps/web/src-tauri/cli/openloomi-ctl
<repo-root>/apps/web/src-tauri/cli/openloomi-ctl.exe
<repo-root>/apps/web/src-tauri/target/release/openloomi-ctl
<repo-root>/apps/web/src-tauri/target/release/openloomi-ctl.exe
```

If a source checkout is found but no CLI binary exists, return:

```json
{
  "ready": false,
  "reason": "SOURCE_FOUND_CLI_NOT_BUILT",
  "nextAction": "build_or_stage_openloomi_ctl"
}
```

The plugin should not build automatically. It should provide actionable
instructions and wait for explicit user action.

## Readiness Contract

`setup-status` should return a stable JSON object:

```json
{
  "mode": "packaged | source | unconfigured",
  "installed": true,
  "ctlPath": "<resolved openloomi-ctl path>",
  "version": "openloomi-ctl 0.7.0",
  "tokenPresent": true,
  "modelProviderConfigured": true,
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
configure_model_provider
configure_connectors
run
```

Common `reason` values:

```text
OPENLOOMI_CTL_NOT_FOUND
OPENLOOMI_CTL_INVALID
SOURCE_FOUND_CLI_NOT_BUILT
LOGIN_REQUIRED
MODEL_PROVIDER_REQUIRED
CONNECTOR_SETUP_REQUIRED
READY
```

## Secret Handling Rules

Codex must never receive or print:

- model provider API keys
- OAuth access tokens or refresh tokens
- connector app secrets
- OpenLoomi auth tokens
- local secure-storage contents

Allowed status-only checks:

```text
OPENLOOMI_AUTH_TOKEN present/missing
~/.openloomi/token present/missing
model provider configured/missing
connector configured/missing
local API reachable/unreachable
```

Example safe output:

```json
{
  "modelProviderConfigured": false,
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

## Setup Handoff Model

The MVP should hand off setup to OpenLoomi-owned surfaces.

When login is missing:

```text
OpenLoomi login is required.
Open OpenLoomi Desktop and sign in, then ask Codex to re-check setup.
```

When model provider configuration is missing:

```text
OpenLoomi model provider setup is required.
Open OpenLoomi Desktop > Settings > Models, add a provider, then re-check setup.
```

When a connector is missing:

```text
OpenLoomi connector setup is required.
Open OpenLoomi Desktop > Settings > Integrations, connect the provider, then
re-check setup.
```

Future setup commands may be added if they are owned by OpenLoomi, mask input,
avoid argv-based secrets, avoid logging secret values, and return only
success/failure status to Codex.

## Local API Role

The local API is optional for the MVP.

The plugin should prefer `openloomi-ctl --one-shot --json` for execution because
it does not require the desktop app process, local Next.js dev server, or local
API service to be running.

The bridge may use a local API later for richer readiness checks, connector
status, and setup handoffs. Any local API check must preserve the no-secrets
contract.

## MVP Plugin Behavior

### `setup-status`

Checks install mode, `openloomi-ctl`, token presence, optional local API
reachability, and high-level readiness.

### `install-instructions`

Returns official installation guidance and explains that the Codex plugin is a
companion adapter requiring OpenLoomi Desktop or a configured source checkout.

### `version`

Resolves `openloomi-ctl` and returns the output of `openloomi-ctl --version`.

### `run`

Runs one one-shot prompt through `openloomi-ctl`.

Execution contract:

```text
input: user prompt over stdin
output: OpenLoomi JSON result
permissions: default to --permission-mode deny for non-interactive MVP
```

## Connector Readiness

The agent-shell workflow depends on Loomi knowing which connectors are online
before acting. The plugin should not implement connector protocols, but it can
report connector readiness once OpenLoomi exposes a stable status surface.

Future connector status shape:

```json
{
  "connectors": [
    {
      "name": "github",
      "configured": true,
      "reachable": true
    },
    {
      "name": "slack",
      "configured": false,
      "nextAction": "open_connector_setup"
    }
  ]
}
```

Codex should receive only readiness state and next actions. OpenLoomi should own
the actual connector OAuth, app-password, QR, webhook, and token flows.

## Phased Implementation Plan

### Phase 1: Design Document

Add this module design document under `apps/plugin/`.

### Phase 2: MVP Plugin Skeleton

Add:

```text
apps/plugin/codex/
  .codex-plugin/plugin.json
  skills/openloomi/SKILL.md
  scripts/loomi-bridge.mjs
  assets/logo.png
```

### Phase 3: Discovery and Readiness

Implement packaged install discovery, source checkout discovery, version
validation, token presence checks, and readiness JSON output.

### Phase 4: One-Shot Execution

Run:

```bash
openloomi-ctl --one-shot --stdin --json --permission-mode deny
```

### Phase 5: Setup Handoffs

Support `LOGIN_REQUIRED`, `MODEL_PROVIDER_REQUIRED`, and
`CONNECTOR_SETUP_REQUIRED` through Desktop settings handoff messages.

### Phase 6: Connector Readiness

Expose connector-level status once OpenLoomi has a stable status API or CLI
surface.

### Phase 7: Agent Shell Workflows

Add starter prompts:

```text
Check whether OpenLoomi is ready
Ask Loomi to summarize my current work context
Ask Loomi to triage today's signals
Ask Loomi to prepare a decision brief
Send this task to Loomi for follow-up
```

### Phase 8: Tests

Required tests:

- packaged install detected
- source checkout detected
- source checkout without CLI returns `SOURCE_FOUND_CLI_NOT_BUILT`
- missing token returns `LOGIN_REQUIRED`
- missing model provider returns `MODEL_PROVIDER_REQUIRED`
- no secret values are printed
- one-shot prompt succeeds when ready
- connector missing config returns setup handoff
- setup handoff never prints API keys, OAuth secrets, or auth tokens

## Acceptance Criteria

- The design document is added under `apps/plugin/`.
- The plan describes packaged and source-checkout support.
- The plan defines a stable readiness JSON contract.
- The plan explicitly forbids secret collection through Codex chat.
- The plan treats automatic OpenLoomi installation/building as out of scope.
- The plan relies on `openloomi-ctl --one-shot --stdin --json` for MVP
  execution.
- The plan maps the Codex plugin to OpenLoomi's agent-shell architecture.
- The plan keeps OpenLoomi Desktop responsible for runtime execution, settings,
  connectors, memory, and secret storage.

## Open Questions

- What minimum `openloomi-ctl` version should the plugin require?
- Should non-secret plugin configuration be stored by Codex, OpenLoomi, or both?
- Which OpenLoomi command should expose stable model-provider readiness?
- Which OpenLoomi command should expose stable connector readiness?
- Should a future local setup page use an `openloomi://` deep link, a localhost
  page with a short-lived nonce, or both?

