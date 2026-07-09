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

For AI provider setup guidance, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" configure-ai-provider
```

You may pass non-secret preferences such as `--provider`, `--base-url`, and
`--model` when the user provides them. Never pass `--api-key`, tokens, or other
secrets. Secret entry must happen in an OpenLoomi-owned UI or interactive CLI
surface.

For bridge metadata, call:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" version
```

When `setup-status` returns `ready: true`, run a one-shot task by passing the
user task over stdin:

```bash
printf "%s" "<user task>" | node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" run
```

The bridge invokes `openloomi-ctl --one-shot --stdin --json --permission-mode
deny` by default. Only pass `--permission-mode ask` or `--permission-mode allow`
when the user explicitly asks for a different permission mode.
