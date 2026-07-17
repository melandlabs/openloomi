# OpenLoomi Claude Plugin — Manual E2E Checklist

This is the human-driven verification checklist for the OpenLoomi Claude Code
plugin. The unit suite under `tests/bridge.test.mjs` covers the deterministic
paths; this file covers the surface area that needs Claude Code itself
(menus, hooks, sprite switching) and is run by hand during release prep.

## Pre-flight

1. Node 18+ is on `PATH` (`node --version`).
2. Claude Code is installed. The e2e checklist is load-channel-agnostic;
   pick whichever matches your situation:
   - **GitHub install** — two-step inside any session:
     ```text
     /plugin marketplace add melandlabs/openloomi
     /plugin install openloomi
     ```
     To point at a fork / branch, use `melyourname/openloomi@branch-name`.
   - **Built-in marketplace install** (after publish): `/plugin install openloomi` (short name, no `marketplace add` step needed).
   - **Dev from source** (only if you're editing the plugin): `claude --plugin-dir /Users/timi/codes/openloomi/plugins/claude`
3. OpenLoomi Desktop is **not** installed yet (for the missing-install test).

## A. Plugin loads

- [ ] The chosen load channel (the GitHub two-step, the marketplace
      short-name, or `claude --plugin-dir /Users/timi/codes/openloomi/plugins/claude`)
      starts a session without warnings.
- [ ] Inside the running session, `/openloomi:help` lists all 7 commands
      (`setup`, `status`, `pet`, `usage`, `connect`, `hooks`, `help`).
- [ ] `/openloomi:status` returns JSON with `mode: "unconfigured"`,
      `installed: false`, `nextAction: "install_openloomi"`.

## B. Missing-install → install happy path

- [ ] `/openloomi:setup` reports `OPENLOOMI_NOT_INSTALLED` and prompts y/N.
- [ ] Accepting y launches the appropriate platform install script
      (`setup.macos.sh`, `setup.linux.sh`, or `setup.windows.ps1`).
- [ ] After install completes, `/openloomi:setup` reaches
      `setup: ready` without prompting the user for an API key (the
      runtime self-closes AI provider config via the local `claude`
      CLI auth probe — no shell key-sync step exists any more).
- [ ] If no native Claude runtime is authenticated and no per-user
      provider row exists, `setup-status` reports
      `reason: "AI_PROVIDER_REQUIRED"` and `nextAction: "configure_ai_provider"`
      — the user is pointed at the OpenLoomi Desktop Preferences page.

## C. Already-installed detection

- [ ] `/openloomi:status` with `OPENLOOMI_BIN` set to a working binary
      resolves to that path (`source: "OPENLOOMI_BIN"`).
- [ ] With no env var, `/openloomi:status` falls back through
      `OPENLOOMI_HOME` → `OPENLOOMI_REPO_DIR` → `PATH` → platform defaults.
- [ ] The auth token presence is reported as a boolean only.

## D. Pet state mirror

- [ ] Manually call `/openloomi:pet happy`. The pet sprite switches
      to `loomi-happy.png` (fox theme) within ~1s.
- [ ] `/openloomi:pet nonsense` returns
      `INVALID_STATE` with the list of valid states.
- [ ] If the runtime does not expose `POST /api/pet/state`, the bridge
      returns a polite "pending endpoint" notice — the session is not
      blocked.

## F. Hooks install/uninstall round-trip

- [ ] Run `/openloomi:hooks status`. Confirm `installed: false`.
- [ ] Note any existing `~/.claude/settings.json` `hooks.*` entries
      (e.g. the `hyper` plugin's brief / observe / prompt hooks).
- [ ] Run `/openloomi:hooks install`.
- [ ] Re-inspect `~/.claude/settings.json`. Confirm:
  - [ ] `hooks.__openloomi_claude_plugin_hooks__` is now present with
        the 8 lifecycle events from `hooks/hooks.json`.
  - [ ] **All previous hooks are still there** (no overwrite).
  - [ ] The `_openloomi_plugin: true` marker is set on the block.
- [ ] Re-run `/openloomi:hooks install`. Confirm `alreadyInstalled: true`.
- [ ] Run `/openloomi:hooks uninstall`. Confirm:
  - [ ] `__openloomi_claude_plugin_hooks__` block is gone.
  - [ ] Other plugins' hooks are still present.
- [ ] Re-run `/openloomi:hooks uninstall`. Confirm `removed: false`
      and that other plugins' hooks are untouched.

## G. Pet state lifecycle (hooks fired)

With hooks installed:

- [ ] Start a new session → pet flips to `greet` (fox theme default)
      / fallback `presenting` if you're on the capybara theme.
- [ ] Send a message → pet flips to `thinking`.
- [ ] Trigger a Bash tool call → pet flips to `working`.
- [ ] Open a permission prompt → pet flips to `needsinput`.
- [ ] End the turn → pet flips to `happy` after a brief archive
      sequence (5s – 30s depending on transcript size).

## H. Stop-time archive

- [ ] Complete 2–3 message exchanges, then `/exit` or press
      <kbd>Ctrl</kbd>+<kbd>D</kbd>.
- [ ] Open OpenLoomi Desktop → Memory → Insights.
- [ ] Confirm a new entry of `type: "note"`, `groups: ["claude-code"]`
      with the session id and a tail-of-conversation summary.
- [ ] Repeat the same session end — confirm only one insight is
      created (idempotent via `sessionId`).
- [ ] Stop OpenLoomi Desktop entirely, complete a session, and
      confirm Claude Code **does not** show an error and the bridge
      exits 0 with `archive: "skipped", reason: "api_unreachable"`.

## I. Secrets contract

- [ ] The bridge never reads AI provider API keys from the environment.
- [ ] The bridge's stdout contains no AI provider key names or values
      even when the user has them in their shell.
- [ ] `/openloomi:setup` reaches `ready` purely on runtime-detected
      `claude` CLI auth; the plugin does not POST env-var values to any
      `/api/preferences/ai` endpoint.

## J. Plugin validation

- [ ] Run the community validator (if available for this Claude Code
      version) and confirm no warnings.
- [ ] Run `node --test plugins/claude/tests/bridge.test.mjs` and
      confirm all tests pass.

## K. Cleanup

- [ ] `/openloomi:hooks uninstall` so the user's `~/.claude/settings.json`
      is restored to pre-test state.
- [ ] No orphan files under `~/.claude/plugins/openloomi/`.

## Release prep (per `ROADMAP.md` Phase 9)

- [ ] README & ROADMAP updated.
- [ ] plugin.json validates.
- [ ] Bridge subcommands are documented in `skills/openloomi/SKILL.md`.
- [ ] Prettier passes on all plugin markdown (run from repo root).
- [ ] CI green (`node --test` on tests/bridge.test.mjs).
- [ ] Manual e2e checklist (this file) signed off.
