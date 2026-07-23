---
description: Run OpenLoomi one-time setup — auto-chains install → launch → guest login → ready in one call
argument-hint: ""
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:setup

The bridge is now an **end-to-end** wizard. A single `setup` invocation
walks the full state machine:

```
install OpenLoomi.app
  → launch the desktop app (`open -a <desktopMarker>`)
  → wait for the local HTTP API to come up
  → mint a guest bearer (one-tap sign-in)
  → { ready: true }
```

Each transition is automatic. **Do not** ask the user to click anything in
the GUI. The bridge only surfaces a stop condition when the next step
truly requires human action (e.g. no selected execution runtime is ready and
no direct AI provider is configured — if Claude is selected, point the user at
`claude auth login`; otherwise use OpenLoomi Desktop → API Settings).

## Steps

1. If the install needs explicit consent (the bridge returns
   `setup: install_attempted` is the only case where this matters —
   normally `--yes` is passed straight through), confirm with the user
   before re-running.
2. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs setup --yes [--max-wait <ms>]`
3. Read the JSON. The bridge writes an audit trail of what it did into
   `steps[]`. Surface that to the user so they can see which transitions
   fired.
4. If `setup: ready` → done.
5. If `setup: awaiting_user_action` → the chain hit a step that genuinely
   needs the user (e.g. `nextAction: login_openloomi` but `canGuestLogin:
false` because the local runtime didn't come up, or `nextAction:
configure_ai_provider` because the runtime reports no ready selected
   execution provider and no per-user provider row). Explain what the
   user needs to do and stop.

## Flags

| Flag                   | Default | Meaning                                                                                                                                                        |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--yes`                | off     | Pre-approve install (otherwise the bridge prompts y/N — but in Claude Code's Bash tool there is no TTY, so without `--yes` the install would silently cancel). |
| `--max-wait`           | 120000  | Global cap across all wait stages (in milliseconds). Defaults to 120s to absorb the first-run install + TCC prompts.                                           |
| `--api-timeout`        | 120000  | Per-stage budget for "waiting for local API". Independent of `--max-wait`.                                                                                     |
| `--install-timeout`    | 300000  | Per-stage budget for "installing OpenLoomi". Covers download + copy on a 50 Mbps link.                                                                         |
| `--launch-timeout`     | 10000   | Per-stage budget for `open -a <bundle>`. Almost never actually hit; included for symmetry.                                                                     |
| `--permission-timeout` | 60000   | Extra wait after `--api-timeout` if the desktop process is up but the API never woke up — typical macOS TCC/Accessibility prompt path.                         |
| `--bin-path`           | _auto_  | Override the discovered helper binary path (advanced).                                                                                                         |

## Live status

While the wizard is inside a long stage, the bridge writes a throttled
1 Hz line to **stderr** so the user can see progress:

```
  · installing OpenLoomi  (12s / max 5m) …
  · waiting for local API  (4s / max 2m) …
  · waiting on macOS permission prompt  (3s / max 1m) …
```

Stdout is reserved for the final JSON result — do not mix it.

## `api_not_ready` payload

When `--api-timeout` elapses, the wizard returns an **actionable** JSON
payload you can use to drive chat-side guidance. The original
`setup: "api_not_ready"` shape is preserved for backwards compatibility;
new fields are added alongside it.

| Field               | Type     | Meaning                                                                                                             |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `ok`                | bool     | Always `false` for this stop condition.                                                                             |
| `setup`             | string   | Always `"api_not_ready"` here.                                                                                      |
| `code`              | string   | Stable machine code: `"API_NOT_READY"` or `"PERMISSION_PROMPT_LIKELY"` (when desktop process is up but API is not). |
| `stage`             | string   | Always `"wait_api"`. Reserved for future per-stage error codes.                                                     |
| `elapsedMs`         | number   | Wall-clock time since `/openloomi:setup` started.                                                                   |
| `effectiveBudgetMs` | number   | Total wait budget actually granted (api + permission grace if it kicked in).                                        |
| `canResume`         | bool     | Always `true`. Re-running the slash command is the supported "keep waiting" action.                                 |
| `resumeCommand`     | string   | A pre-built slash command the user can paste — already uses a sensible raised `--max-wait`.                         |
| `hints`             | string[] | 1–3 hints, safe to print verbatim. Includes the macOS TCC prompt hint on Darwin.                                    |
| `overCap`           | bool     | `true` if the elapsed time exceeded the global `--max-wait` cap (informational).                                    |
| `steps`             | Step[]   | The existing audit trail.                                                                                           |
| `wait`              | object   | The raw `waitForApi` payload (code, stage, permissionLikely, lastError).                                            |
| `status`            | object   | The latest `setup-status` snapshot.                                                                                 |

## Stop conditions and what they mean

| `setup`                | When it fires                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                | All transitions completed. Show `mode` and `version`.                                                                                                                                                                                                                                   |
| `install_attempted`    | First invocation: install ran. The user pre-approved; this is just informational.                                                                                                                                                                                                       |
| `install_failed`       | The platform install script exited non-zero (or `code: "INSTALL_TIMEOUT"` from the per-stage budget). Show `install.code` / `install.stderr`.                                                                                                                                           |
| `launch_failed`        | `open -a <desktopMarker>` returned a non-zero exit. On macOS this almost never happens for a signed .app; if it does, fall back to manual launch instructions.                                                                                                                          |
| `api_not_ready`        | The desktop app was launched but the local HTTP API didn't respond within `--api-timeout`. **New behavior**: `code` distinguishes network/slow vs TCC prompt; `hints[]` and `resumeCommand` are pre-built; `canResume: true` makes re-running the slash command the recommended action. |
| `guest_login_failed`   | API is up but the one-tap guest login was rejected. Show `guest.code` / `guest.error`. The user can sign in via the GUI and re-run setup.                                                                                                                                               |
| `awaiting_user_action` | A transition that needs the user ran without a programmatic path. Most commonly: `configure_ai_provider` when no selected execution runtime is ready and no per-user provider is configured — for Claude, run `claude auth login`; otherwise use OpenLoomi Desktop → API Settings.      |
| `step_limit_reached`   | Hit the internal step ceiling without reaching READY (default 8 transitions). Almost certainly means a state-machine bug; show `steps[]`.                                                                                                                                               |

The bridge's stdout output is authoritative. Never invoke the platform
install script (`setup.{macos,linux,windows}.*`) directly — only the
bridge may run it, and only after explicit y/N consent.

## Post-`ready` walkthrough

When `setup: ready` fires, the wizard is done. Print the canonical
post-setup hand-off so the user knows what they just installed and what
to try next. The bridge JSON above is for machines; this section is the
human-facing surface and supersedes the earlier "do not improvise" rule
with a richer, scripted intro + tour. Print all four parts on the very
first `setup: ready` emission. On later re-runs you may abbreviate to
the audit table plus the "where to go next" line, but never skip the
intro.

### 1. One-paragraph intro

> OpenLoomi is your **local-first AI coworker**. It runs as a desktop
> app on your Mac, connects to the tools you authorise (Gmail, Slack,
> GitHub, Google Calendar, Notion, Linear, etc. via Composio, plus
> native bots for Telegram / WhatsApp / iMessage / Feishu / DingTalk /
> QQ / WeChat), watches the signals that come in, and surfaces daily
> decisions as cards on the desktop pet (Loomi the fox). You tap
> **Approve** and the action runs through the same connector — the
> result is written back into Memory so the next judgement is sharper.
> Nothing leaves your machine unless you opt in to a Connector.

### 2. Where things live (orientation)

| Surface            | Where                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Desktop app        | `/Applications/OpenLoomi.app`                                                                          |
| Local HTTP API     | `http://localhost:3414` (fallback `3515`)                                                              |
| Guest bearer token | `~/.openloomi/token` (base64-encoded JWT)                                                              |
| Agent runtime      | Selected native runtime; Claude uses `claude auth login`, while non-Claude runtimes use their own auth |
| Memory files       | `~/.openloomi/data/memory/{people,projects,notes,strategy,chats,channels}/`                            |
| Knowledge Base     | `GET /api/rag/documents`                                                                               |
| Audit log          | `GET /api/audit/...`                                                                                   |
| Pet widget         | Watcher polls `~/.openloomi/loop/decisions.json` every 2s                                              |
| Hooks (optional)   | `/openloomi:hooks install` wires Stop / PreToolUse / PostToolUse into Claude Code                      |

### 3. The five-step first tour

After `setup: ready`, suggest this exact sequence. Each step is a
single command plus a one-line description of what the user will see.
Skip steps the user has already done — but always emit step 1 (health
check) so the user knows what "still ready" looks like.

| #   | What                  | Command                                                                  | What you'll see                                                                                                                                                             |
| --- | --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Health check**      | `/openloomi:status`                                                      | Same audit table you just got. Confirms the selected execution provider is still ready.                                                                                     |
| 2   | **Pet reacts**        | `/openloomi:pet happy`                                                   | Loomi the fox flips to the happy sprite. Try `thinking`, `working`, `juggling` to see the rest of the 7-state API set.                                                      |
| 3   | **Connect a tool**    | Native: `/openloomi:connect telegram` _or_ OAuth: `composio link gmail`  | A QR scan or browser OAuth opens; once you approve, the account shows in `list-accounts`.                                                                                   |
| 4   | **Run one Loop tick** | `/openloomi:loop refresh` then `/openloomi:loop tick`                    | Loop pulls signals, classifies them, and enqueues decisions. Then `GET /api/loop/decisions?status=pending` to see the cards. Approve with `POST /api/loop/action/schedule`. |
| 5   | **Seed Memory**       | `/openloomi:memory "about me"` (then `add-memory` for `tour/*.md` files) | A tour-owned `.md` shows up in `~/.openloomi/data/memory/tour/`. Future Loop ticks have grounding context without overwriting user memory.                                  |

Optional extensions after step 4 (skip if the user is new):

- **Custom Loop channel** — register your own signal source
  (`PUT /api/loop/channels` with `toolkit` + `toolSlug`).
- **Classifier rule** — deterministic overrides for known signal
  patterns (`PUT /api/loop/classifier-rules`).
- **Custom decision type** — your own `DecisionType` icon + label
  (`PUT /api/loop/types`).

If the user asks for a hands-on walkthrough rather than just a
recommendation, hand off to `/openloomi:tour` — it runs the same five
steps with live probes and stops between each one for the user to
react.

### 4. Quick reference card

End with this closed list so the user doesn't have to memorise URLs.

| Want to…              | Run                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| See health            | `/openloomi:status`                                                                                                                      |
| Flip the pet          | `/openloomi:pet <state>`                                                                                                                 |
| Today's LLM usage     | `/openloomi:usage`                                                                                                                       |
| List connectors       | `composio connections list` _or_ `node ${CLAUDE_PLUGIN_ROOT}/skills/openloomi-connectors/scripts/openloomi-connectors.cjs list-accounts` |
| Search memory         | `/openloomi:memory "<query>"`                                                                                                            |
| Run a Loop tick       | `/openloomi:loop tick`                                                                                                                   |
| See pending decisions | `GET /api/loop/decisions?status=pending`                                                                                                 |
| Approve a decision    | `POST /api/loop/action/schedule {decision_id, action:"run"}`                                                                             |
| Install hooks         | `/openloomi:hooks install`                                                                                                               |
| Archive old data      | `/openloomi:archive`                                                                                                                     |

### 5. Hand-off

Finish with: "Run `/openloomi:tour` from this Claude session for a
guided walkthrough, or pick a number above and I'll run that step for
you."

## After `api_not_ready`

When the wizard times out waiting for the API, the recommended chat-side
flow is:

1. Show the bridge's `hints[]` verbatim. Each is safe-to-print.
2. If `canResume: true` (always the case for `api_not_ready`), suggest
   the user simply re-runs the slash command. The state machine is
   idempotent — already-completed steps (e.g. install) will be skipped
   immediately, and the wizard will land back inside `wait_api`.
3. If the user wants to _raise_ the budget once, ship the pre-built
   `resumeCommand` (e.g. `/openloomi:setup --yes --max-wait 180000`)
   rather than asking them to invent the flag.

| Follow-up         | Command                    | When to suggest                                                                         |
| ----------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| Opt-in connectors | `/openloomi:connect`       | User asks about connecting apps, or hasn't installed the composio CLI yet.              |
| Opt-in hooks      | `/openloomi:hooks install` | User asks about hooks, transcript capture, or wants Pet state to drive the desktop app. |
| Status check      | `/openloomi:status`        | User asks "is everything wired up?" — read-only snapshot.                               |
