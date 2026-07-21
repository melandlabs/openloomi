---
name: openloomi
description: "Use local OpenLoomi from Codex. Triggers: Loomi, OpenLoomi, personal assistant, memory, workspace context, setup, install openloomi, setup openloomi, 一键装好并跑起来, finalize openloomi, fix openloomi."
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

When `setup-status` returns `loopbackAccessAmbiguous: true`, do not conclude
that OpenLoomi is stopped. Codex network sandboxing can block access to the
host's `localhost` even while the desktop API is listening. Prefer the
bridge's own auto-recovery path over manual `lsof` / `curl` paste: invoke

```bash
node $SKILL_DIR/../../scripts/loomi-bridge.mjs run-host-probe
```

from a Codex shell where loopback is allowed. The command probes
`/api/native/providers` outside the sandbox, writes the result to
`~/.openloomi/codex-host-probe-cache.json` (5 minute TTL), and the very next
`setup-status` call rebuilds its readiness decision from that cache
(`ready: true`, `reason: "READY_VIA_HOST_PROBE_CACHE"`). When `setup-status`
returns `nextAction: "run_host_probe"`, run this command yourself instead of
asking the user to paste anything. Fall back to the manual
`loopbackAccess.verification.commands` only if the host probe itself fails.

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

If the user asks to install OpenLoomi or explicitly approves installation, run the end-to-end wizard in one invocation:

```bash
node "$SKILL_DIR/../../scripts/loomi-bridge.mjs" setup --yes
```

That walks the whole state machine: resolve the official release → download → install → set `OPENLOOMI_AGENT_PROVIDER=codex` in the GUI launchd / environment.d → launch the OpenLoomi desktop app → wait for the local API on `http://localhost:3414` → mint a guest session token into `~/.openloomi/token`. Invoking this skill (or the user saying "install" / "install and run" / "一键装好并跑起来") counts as explicit approval to pass `--yes`. If the embedded sandbox lacks the required GitHub, application-directory, or GUI access, give the same verified `loomi-bridge` command to the user for a normal terminal; do not promise an interactive escalation that `codex exec` cannot service.

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

Show the returned platform-specific guidance. The `/openloomi:setup`
wizard auto-restarts the desktop app after writing the env var, so if
setup was used end-to-end the new env is already in effect — just verify
`/api/native/providers` reports `defaultAgent: "codex"`. If instead the
env was written via a direct `set-codex-runtime-env` invocation, ask the
user to Quit+Reopen OpenLoomi Desktop so the freshly forked web server
inherits the new value, then verify the same endpoint.
