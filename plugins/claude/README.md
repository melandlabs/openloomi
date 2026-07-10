# OpenLoomi Claude Code Plugin

Wires Claude Code into a local OpenLoomi runtime. Once installed you get the
`/openloomi:*` slash namespace:

- `/openloomi:setup` / `:status` — discover, install, sync your Claude env.
- `/openloomi:pet <state>` — flip the Loomi Pet sprite.
- `/openloomi:usage` — today's LLM cost.
- `/openloomi:hooks install` — _(opt-in)_ mirror Claude's lifecycle onto the Pet + auto-archive every Stop into OpenLoomi memory.

The plugin never duplicates OpenLoomi business logic — every side effect hits
your local OpenLoomi runtime (the desktop app's HTTP API on `127.0.0.1:3414`,
fallback `127.0.0.1:3515`, or its bundled helper CLI under the hood).

---

## 1. Install

Pick the channel that matches your situation:

```text
# Recommended (works today, before marketplace publish)
/plugin marketplace add melandlabs/openloomi
/plugin install openloomi

# Hacking on the plugin itself (local source after clone opneloomi GitHub repo)
git clone https://github.com/melandlabs/openloomi.git && cd openloomi
claude --plugin-dir plugins/claude
```

Inside the running session `/openloomi:help` lists all 8 commands.

## 2. First-run

```text
/openloomi:setup
```

A fully automated wizard: **install → launch → wait API → guest login → sync Claude env → ready**.
Nothing GUI is required from you. The bridge:

- downloads & installs OpenLoomi.app if missing,
- launches the desktop app via `open -a`,
- polls the local HTTP API until it answers,
- calls `POST /api/remote-auth/guest` to register a guest user in the runtime's local DB and mint a bearer token (saved to `~/.openloomi/token`),
- PUTs your shell's `ANTHROPIC_API_KEY` to `/api/preferences/ai` (the runtime's per-user AI settings — source of truth since the LLM\_\* env-var fallback refactor).

The only thing it ever prompts for is the install y/N — and only if the
shell has a TTY. From Claude Code's Bash tool you pass `--yes`.

Your `ANTHROPIC_API_KEY` is read locally and never printed (see
[§5.2](#52-where-does-the-api-key-come-from)).

A successful run prints `{setup: "ready", steps: [...]}` — you're done.

## 3. Daily use

| Command                | What it does                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `/openloomi:pet happy` | Set Pet state — also `idle juggling needsinput presenting sleeping sweeping thinking working` |
| `/openloomi:usage`     | Today's LLM tokens / cost                                                                     |
| `/openloomi:connect`   | Guided install of composio skill + screen memory (3 independent y/N)                          |
| `/openloomi:status`    | Stable JSON: `mode / installed / ready / nextAction / reason`                                 |

Failure modes surface as structured JSON — never stack traces. See
[§5.1](#51-decoding-reason-codes) for the full table.

## 4. Optional: Pet mirror + Stop archive

The plugin **never** modifies `~/.claude/settings.json` unless you opt in:

```text
/openloomi:hooks install     # append a marked block; other plugins untouched
/openloomi:hooks status      # see what's installed
/openloomi:hooks uninstall   # strip only our block
```

After install, 8 lifecycle events map to Pet states:

| When Claude Code…                                 | Pet state         |
| ------------------------------------------------- | ----------------- |
| starts a session                                  | `greet`           |
| receives your prompt                              | `thinking`        |
| starts a Bash / Edit / Write / Read / Grep / Glob | `working`         |
| finishes a tool call                              | `thinking`        |
| starts a subagent                                 | `juggling`        |
| shows a permission prompt                         | `needsinput`      |
| completes the turn                                | archive → `happy` |

The bridge is theme-agnostic — it sends state names; the OpenLoomi
`map_state_to_pet` watcher picks the matching sprite from whichever set is
active (the plugin ships fox; capybara is also supported and falls back
`greet → presenting`).

The Stop hook reads your session transcript, takes the last 6 turns, caps at
6 KB, and POSTs `{type: "note", groups: ["claude-code"]}` to
`/api/insights`. It **always exits 0** — no archive is not an error.

Avoid manually setting `idle`, `sleeping`, `sweeping`, or `presenting`; the
loop watcher owns those.

## 5. Troubleshooting

### 5.1 Decoding `reason` codes

When `/openloomi:status` says `ready: false`, look at `reason`:

| `reason`                     | What it means                                                                                                             | Fix                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENLOOMI_NOT_INSTALLED`    | OpenLoomi Desktop isn't detected anywhere on this machine.                                                                | `/openloomi:install` — the desktop bundle will land and finalize on first launch.                                                                                    |
| `OPENLOOMI_NOT_FINALIZED`    | OpenLoomi Desktop is installed, but the local helper binary isn't on disk yet (the first launch of the app lays it down). | `/openloomi:setup` auto-launches the app and waits for the API — no manual launch needed. **Don't re-run the installer** — it will just fail again at the same step. |
| `SOURCE_FOUND_CLI_NOT_BUILT` | `OPENLOOMI_REPO_DIR` is set but the Rust crate isn't built yet.                                                           | `cd $OPENLOOMI_REPO_DIR/apps/web/src-tauri && cargo build --release`                                                                                                 |
| `LOGIN_REQUIRED`             | OpenLoomi is installed but you haven't signed in.                                                                         | `/openloomi:setup` auto-mints a guest bearer. For a real account, sign in via the desktop app and re-run setup.                                                      |
| `AI_PROVIDER_REQUIRED`       | Signed in, but no provider set.                                                                                           | `/openloomi:setup` auto-syncs `ANTHROPIC_API_KEY` from the env. If no key is set, walk through OpenLoomi Desktop → API Settings.                                     |
| `CLAUDE_ENV_NOT_SET`         | `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` isn't in your shell.                                                         | `export ANTHROPIC_API_KEY=…` and retry                                                                                                                               |
| `READY`                      | All good.                                                                                                                 | Use any other command                                                                                                                                                |

### 5.2 Where does the API key come from?

The bridge reads `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) from
`process.env`. The variable reaches it one of two ways:

| You set the key in                     | How it reaches the bridge                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shell rc (`.zshrc` / `.bashrc`)        | Claude Code inherits the shell env on launch → bridge sees it                               |
| `~/.claude/settings.json` under `env:` | Claude Code merges that block into `process.env` at startup → bridge inherits it on `spawn` |

The plugin **does not** re-parse `~/.claude/settings.json` itself — that would
duplicate the framework's work and silently drift if Claude Code's env-merge
semantics ever change.

If `/openloomi:status` reports `claudeEnvSyncable: false` after configuring the key:

1. Restart Claude Code (settings changes are read on launch).
2. Confirm the key is in the `env:` block, not `permissions:` or elsewhere.
3. Run `echo $ANTHROPIC_API_KEY` in a fresh terminal to verify the shell sees it.

### 5.3 Pet not switching?

1. `/openloomi:hooks status` — must say `installed: true`.
2. If false, run `/openloomi:hooks install`.
3. If true but no sprite change, make sure the desktop pet is visible
   (clicking the tray icon unhides it).

### 5.4 Status says `unconfigured`

The plugin needs the OpenLoomi helper CLI only for `:ask`. Pet / usage / sync
/ hooks still work without it. If discovery is failing, point `OPENLOOMI_BIN`
at the helper binary directly (advanced override).

### 5.5 Stop-hook archives

In OpenLoomi Desktop → **Memory → Insights**, in the `claude-code` group.
One note per session, ~6 KB tail-of-conversation summary, deduplicated by
`sessionId`.

---

## 6. Quick reference

```
/openloomi:setup                 discover → install → sync → status
/openloomi:status                stable JSON status
/openloomi:pet <state>           set Loomi Pet sprite (9 universal states)
/openloomi:usage                 today's LLM cost summary
/openloomi:connect               guided install of composio + screen memory
/openloomi:hooks install         merge lifecycle hooks into settings.json
/openloomi:hooks uninstall       strip them back out
/openloomi:hooks status          show hook merge state
/openloomi:help                  list these commands
```

If a command misbehaves, open an issue referencing `/openloomi:status` JSON —
the `reason` field makes bugs easy to triage.

---

# Part 7 — For contributors

## Architecture

```text
Claude Code
  └── /openloomi:* slash commands          (commands/*.md)
       └── skills/openloomi/SKILL.md        (auto-loaded entrypoint)
            └── scripts/loomi-bridge.mjs    (zero-dep Node 18+ ESM)
                 ├── discovery (8-step chain)
                 ├── sync-claude-env (secrets-sensitive; never logs key)
                 ├── ask (one-shot task, prompt via stdin)
                 ├── pet / hook state (fire-and-forget, 2s timeout)
                 ├── archive (Stop hook; always exit 0)
                 └── install-hooks (merge-no-overwrite into settings.json)
                       ↓
            OpenLoomi Desktop runtime (helper CLI + 127.0.0.1:3414 / fallback 3515)
```

## Plugin layout

```
plugins/claude/
  .claude-plugin/plugin.json      manifest, slash namespace "openloomi:*"
  skills/openloomi*/SKILL.md      auto-loaded entry + 3 sub-skills
  commands/*.md                  the 8 slash commands
  hooks/hooks.json               8 lifecycle events → Pet states
  scripts/loomi-bridge.mjs        single zero-dep Node 18+ ESM entrypoint
  scripts/hooks-merge.cjs        CJS companion for install/uninstall hooks
  scripts/install-assets/setup.{macos,linux,windows}.*
  tests/bridge.test.mjs          15 node:test cases
  tests/e2e/setup.md             human-run checklist (A–K)
  assets/logo.png                plugin icon
```

## Discovery chain (loomi-bridge.mjs → `discovery()`)

1. `OPENLOOMI_BIN` env var
2. `OPENLOOMI_HOME` / `OPENLOOMI_INSTALL_DIR`
3. `OPENLOOMI_REPO_DIR` (with hint if CLI not built)
4. `PATH` lookup
5. Platform defaults (macOS bundle, Linux `/opt/openloomi`, Windows `%LOCALAPPDATA%`)
6. Saved `~/.claude/plugins/openloomi/config.json`
7. `--bin-path` flag
8. → `nextAction: install_openloomi`

## Readiness JSON

`setup-status` returns stable JSON: `mode`, `installed`, `version`, `tokenPresent`,
`aiProviderConfigured`, `claudeEnvSyncable`, `apiReachable`, `hooksInstalled`,
`ready`, `nextAction`, `reason`, `source`. See `loomi-bridge.mjs → buildStatus()`
for the exact shape. `claudeEnvSyncable` is `true` only if the env contains
`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; the key value is never read into
stdout or logs.

## Change-map (edit X, also touch Y)

| You changed…                     | …also update                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| New bridge subcommand            | `commands/<x>.md` + subcommand table in `skills/openloomi/SKILL.md`                                                                       |
| New env var                      | Secrets contract section below                                                                                                            |
| New Pet state                    | `CAPYBARA_STATES` constant in `loomi-bridge.mjs`; confirm sprite exists in both `apps/web/public/loomi-pet/assets/fox/` and `…/capybara/` |
| New lifecycle hook               | `hooks/hooks.json` + the hook→state table above                                                                                           |
| `nextAction` enum value          | `NEXT_ACTIONS` set in `loomi-bridge.mjs` + reason table                                                                                   |
| Default base URL / model / port  | Top-of-file constants in `loomi-bridge.mjs` only                                                                                          |
| Slash command auto-discover text | `description:` frontmatter line (matched char-by-char)                                                                                    |

## Where each concern lives in code

- **Secrets contract** (`sync-claude-env`): `loomi-bridge.mjs → syncClaudeEnv()`.
  Reads `process.env.ANTHROPIC_API_KEY || ANTHROPIC_AUTH_TOKEN` once, POSTs, drops
  the local var. Verify with `ANTHROPIC_API_KEY=sk-leaktest-… node loomi-bridge.mjs sync-claude-env` and `grep sk-leaktest` over captured output.
- **Pet state validation**: `loomi-bridge.mjs → CAPYBARA_STATES`; both
  `cmdPet()` and `cmdState()` gate on it before any HTTP call.
- **Hooks settings.json merge**: `loomi-bridge.mjs → installHooks() / uninstallHooks()`
  (atomic write, marker `_openloomi_plugin`, block key `__openloomi_claude_plugin_hooks__`).
- **Stop archive**: `loomi-bridge.mjs → cmdArchive()` — caps at 5 MB transcript / 6 turns / 6 KB content, always `process.exit(0)`.
- **Install scripts**: `scripts/install-assets/setup.{macos,linux,windows}.*` (executable); y/N prompt before run unless `--yes`.

## PR checklist

1. `node --test plugins/claude/tests/bridge.test.mjs` — 15/15 pass.
2. `claude --plugin-dir plugins/claude` launches clean; `/openloomi:help` lists 8.
3. If you touched any HTTP path, grep `loomi-bridge.mjs` (`apiGET`/`apiPOST` callsites) and update this doc.
4. If you touched the secrets contract, run the leak-test grep (above).
5. If you added a hook, run `tests/e2e/setup.md` §E + §F.
