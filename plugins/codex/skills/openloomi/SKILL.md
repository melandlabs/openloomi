---
name: openloomi
description: "Use local OpenLoomi from Codex. Triggers: Loomi, OpenLoomi, personal assistant, memory, workspace context, setup."
allowed-tools: "Bash(node $SKILL_DIR/../../scripts/loomi-bridge.mjs *)"
---

# OpenLoomi

Use this skill when the user wants Codex to work with OpenLoomi as a local
personal assistant, memory layer, or setup guide.

This skill is intentionally thin. It calls the local bridge and lets OpenLoomi
own runtime execution, memory, connectors, settings, and secret storage.

Before taking action, check plugin readiness:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup-status
```

If the bridge returns `ready: false`, follow the reported `nextAction`. Do not
ask the user to paste API keys, OAuth tokens, connector secrets, or OpenLoomi
auth tokens into Codex chat.

OpenLoomi guest sessions are supported. A missing token is not a request for
account registration or manual token entry. When the bridge reports
`initialize_openloomi_session` or `open_openloomi`, initialize a guest/session
through OpenLoomi-owned surfaces:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" initialize-session
```

For installation guidance, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" install-instructions
```

If the user asks to install OpenLoomi or explicitly approves installation, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" install-openloomi --confirm
```

The bridge resolves the official GitHub release artifact for the current
platform and architecture automatically, downloads it, and installs it with the
default installer path when automatic installation is supported. Only pass
`--artifact-url` when the user explicitly provides an official allowlisted
artifact URL as an override. Add `--download-only` only when the user asks to
download without installing. Add `--launch` only when the user asks to use the
interactive installer UI instead of default automatic installation. Add
`--sha256 "<official checksum>"` only when the user wants to require a specific
checksum; otherwise the bridge verifies GitHub release digest metadata when
available.

For bridge metadata, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" version
```

For available OpenLoomi workflows, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance
```

For workflow-specific guidance, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-loop
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-memory
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-connectors
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" workflow-guidance --workflow openloomi-handoff
```

Use the thin wrapper skills when the user specifically asks for loop, memory,
connector readiness, or handoff workflows. The plugin must not copy OpenLoomi
connector, memory, loop, scheduling, or handoff persistence logic into Codex.

---

## Launching the desktop app with the Codex runtime

When OpenLoomi is used from Codex, prefer the desktop Codex runtime so
OpenLoomi can reuse the user's existing Codex CLI runtime for the first
workflow.

When the user asks to make OpenLoomi spawn Codex as the native-agent executor,
or diagnostics show that the desktop runtime is not using Codex, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" codex-runtime-info
```

Show the returned platform-specific guidance, then ask the user to restart
OpenLoomi and verify `/api/native/providers` reports `defaultAgent: "codex"`.
