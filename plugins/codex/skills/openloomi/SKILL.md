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

If the bridge returns `ready: false`, explain the `nextAction` and stop. Do not
ask the user to paste API keys, OAuth tokens, connector secrets, or OpenLoomi
auth tokens into Codex chat.

For installation guidance, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" install-instructions
```

If the user explicitly approves installing OpenLoomi from an official artifact,
call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" install-openloomi --confirm --artifact-url "<official OpenLoomi installer URL>"
```

Only add `--launch` when the user explicitly approves launching the downloaded
installer. Prefer adding `--sha256 "<official checksum>"` when official checksum
metadata is available.

For bridge metadata, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" version
```

Task execution is reserved for a later implementation phase. When it becomes
available, call the bridge with stdin-based prompt passing so the prompt is not
placed in command-line arguments.
