---
name: openloomi
description: "OpenLoomi runtime integration for Claude Code. Use when the user mentions OpenLoomi, wants to install/configure it, sync their ANTHROPIC_API_KEY/BASE_URL/MODEL into OpenLoomi's AI provider, query their local memory via the Loomi runtime, change the Loomi Pet state, view LLM usage, run a one-shot task through the local runtime, or install the optional hooks that mirror Claude Code's lifecycle onto the Loomi Pet and auto-archive every Stop into OpenLoomi memory. Triggers: openloomi, loomi, /openloomi:*, ANTHROPIC_API_KEY sync, sync claude env, local memory, RAG search, insights, loop, pet state."
metadata:
  version: 0.1.0
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# OpenLoomi Claude Plugin Skill

This skill is the **single entry point** for the OpenLoomi ↔ Claude Code
integration. It is intentionally thin: it delegates to
`loomi-bridge.mjs` for every side effect and **never duplicates** OpenLoomi
business logic, connector implementations, or memory storage.

## When to call `loomi-bridge`

Call `loomi-bridge.mjs` whenever ANY of the following is true:

- User says `openloomi`, `loomi`, `pet`, `/openloomi:*`, or asks about
  "the local AI assistant".
- User wants to install, configure, verify, or update OpenLoomi.
- User has `ANTHROPIC_API_KEY` set and asks to "sync to OpenLoomi" or
  "use my Claude key with OpenLoomi".
- User asks Claude Code to query their memory, look up a previous
  conversation, or "search my notes".
- User wants to set the Loomi Pet to a specific state.
- User wants today's LLM cost / usage.
- User asks about hooking Claude Code up to "the pet" or "loop".

When the user just wants something Claude can do natively (write a file,
answer a question, etc.) and OpenLoomi is **not** mentioned, **do not**
invoke the bridge.

## Bridge subcommands (quick reference)

| Subcommand | Slash command | Typical use |
|---|---|---|
| `setup` | `/openloomi:setup` | First-run install + sync + status |
| `setup-status [--json]` | `/openloomi:status` | Stable JSON status |
| `install [--yes]` | (internal) | User-approved install |
| `login` | (internal) | Open OpenLoomi login surface, report status |
| `sync-claude-env` | (internal) | Read Claude env → OpenLoomi provider |
| `pet <state>` | `/openloomi:pet` | Set Pet state (9 universal states; theme-agnostic) |
| `state <name>` | (internal/hook) | Fire-and-forget Pet state from hook |
| `archive` | (internal/hook) | Archive last transcript on Stop |
| `usage` | `/openloomi:usage` | Today's LLM usage summary |
| `install-hooks` | `/openloomi:hooks install` | Merge hooks into `~/.claude/settings.json` |
| `uninstall-hooks` | `/openloomi:hooks uninstall` | Strip only the plugin's hook block |
| `hooks-status` | `/openloomi:hooks status` | Report hook merge state |
| `version` | (internal) | Print plugin version |

All subcommands emit JSON to stdout unless noted otherwise. All failure
modes emit JSON (never bare stack traces).

## Secrets contract (verbatim from `plugins/codex/README.md` §256–296)

Claude Code must never receive or print:

- model provider API keys (including `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN`);
- OAuth access tokens or refresh tokens;
- connector app secrets;
- OpenLoomi auth tokens;
- local secure-storage contents (e.g. `~/.openloomi/token` contents).

Allowed status-only checks:

```text
OPENLOOMI_AUTH_TOKEN present/missing
~/.openloomi/token present/missing
ANTHROPIC_API_KEY present/missing
ANTHROPIC_BASE_URL configured/unconfigured
AI provider configured/missing
connector configured/missing
local API reachable/unreachable
```

The bridge may report key **names and presence**. It must not print values.

`sync-claude-env` reads the env once at the start into local variables,
POSTs to OpenLoomi, and drops the key from memory. It never caches the
value at module scope and never logs it.

## Discovery chain

The bridge resolves your local OpenLoomi runtime in this order:

1. `OPENLOOMI_BIN`
2. `OPENLOOMI_HOME` / `OPENLOOMI_INSTALL_DIR`
3. `OPENLOOMI_REPO_DIR`
4. `PATH` lookup
5. Platform defaults — the desktop app's main binary:
   - macOS: `~/Applications/OpenLoomi.app/Contents/MacOS/openloomi`
   - Linux: `/opt/openloomi/openloomi` (or `~/.local/bin/openloomi`, `/usr/local/bin/openloomi`)
   - Windows: `%LOCALAPPDATA%\OpenLoomi\openloomi.exe`
6. `${CLAUDE_PLUGIN_DATA}/config.json` (non-secret cached install path)
7. `--bin-path <p>` explicit flag
8. Otherwise: emit `nextAction: install_openloomi`

## Hook events → Pet states

| Claude Code hook | Pet state |
|---|---|
| `SessionStart` | `greet` (fallback `presenting` if capybara theme active) |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` (Bash\|Edit\|Write\|Read\|Grep\|Glob) | `working` |
| `PostToolUse` | `thinking` |
| `Stop` | archive → `happy` |
| `SubagentStart` | `juggling` |
| `SubagentStop` | `thinking` |
| `Notification` (permission_prompt\|elicitation) | `needsinput` |

`idle`, `sleeping`, `sweeping`, `presenting` are managed by the loop
watcher and are **not** set by hooks.

## Reminders for Claude

- **Never paste the API key into chat.** Tell the user to set
  `ANTHROPIC_API_KEY` in their shell, then run `/openloomi:setup`.
- **Never auto-install hooks.** Always require an explicit
  `/openloomi:hooks install`.
- **Always exit 0 on Stop.** Archive failures are reported via stdout JSON
  with `_openloomi.archive: "skipped", reason: ...`.
- **When unsure**, default to running `loomi-bridge setup-status --json`
  and respond based on the structured output — don't guess.
