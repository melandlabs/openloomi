---
name: openloomi-loop
description: "Use this when the user asks about openloomi's Loop — openloomi's proactive execution brain. It actively and continuously pulls external signals (Gmail, Calendar, GitHub, Slack) via Composio MCP, enriches them through openloomi-memory, classifies them into typed decisions, and executes via Claude Code. Triggers: 'openloomi loop', 'loop tick', 'loop schedule', 'loop inbox', 'loop run', 'proactive decisions', 'context → decision → execute', 'pull signals', 'decision queue', 'loop serve'"
allowed-tools: Bash(node $SKILL_DIR/scripts/openloomi-loop.cjs *), Bash(node $SKILL_DIR/scripts/loop-tick.cjs *), Bash(node ../../openloomi-memory/scripts/openloomi-memory.cjs *), Bash(claude -p *), Bash(tail -f $SKILL_DIR/data/daemon.log), Bash(cat >> $SKILL_DIR/data/signals.jsonl), Bash(echo *), Bash(ls *)
metadata:
  version: 0.6.2
---

> **Note:** If you haven't downloaded or installed openloomi yet, please refer to [Getting Started](https://openloomi.ai/docs/getting-started) for installation instructions.

# OpenLoomi Loop — The Proactive Execution Brain

> **Proactive & Continuous** — watches external signals, thinks via openloomi-memory, and acts via Claude Code. **Proactive Execution Brain** — the always-on execution layer of openloomi.

A **Claude Code skill** that runs **proactively and continuously**, turning ambient signals from your connected tools into finished work. The Loop is openloomi's **proactive execution brain** — a vigilant teammate that watches, thinks, and acts without you having to ask. Three layers, all agentic:

1. **Pull** — Claude, via **Composio MCP**, fetches fresh signals (Gmail, Calendar, GitHub, Slack) into a local signal store.
2. **Enrich + Classify** — Claude calls the **openloomi-memory** skill to look up senders / projects, classify each new signal into a typed decision (`rsvp`, `draft_reply`, `review_pr`, …), and queue it.
3. **Execute** — You browse the decision queue and pick. Picking spawns a fresh Claude Code session with the full context to act — and that session, in turn, writes any memory updates back via openloomi-memory.

No background daemon. No subprocess hacks. No local memory cache. **The Loop is Claude pulling signals, Claude enriching with memory, Claude acting** — every layer is agentic. The brain never sleeps: it ticks, watches, and remembers.

---

## Proactive & Continuous

The Loop is not a one-shot tool you invoke. It is a **continuously running** execution brain with two complementary properties:

- **Proactive** — The Loop watches Gmail, Calendar, GitHub, and Slack in the background. It surfaces decisions *before* you ask: a meeting invitation becomes an `rsvp` suggestion, an unread email from a known person becomes a `draft_reply` card, a PR where you're a reviewer becomes a `review_pr` task. Nothing fires automatically — but everything is queued and waiting the moment you look.
- **Continuous** — `loop schedule --interval N` runs an infinite tick loop in the background. Each tick: pull new signals → enrich with memory → classify → queue. State persists in `data/decisions.json`, so the queue survives restarts, and each new signal joins the same ongoing conversation. `loop watch` keeps emitting desktop notifications on fresh entries.
- **Proactive Execution Brain** — Openloomi's memory (`openloomi-memory`) stores *what you know*; the Loop is the brain that *decides what to do about it*. Itself not a daemon, not a script, not a cron — the Loop is Claude, looping. Each tick is a fresh `claude -p` invocation; each executed decision is a fresh `claude -p` session. Composability over persistence.

Together, **Proactive and Continuous** turns Claude into a teammate that never sleeps and never loses context: it remembers people (via openloomi-memory), watches the world (via Composio MCP), and prepares the next move (via the decision queue). You stay in control of execution; the Loop stays in control of awareness.

---

## Quick Start

```bash
# 1. Ask Claude to do one tick (prints the prompt it should run)
node $SKILL_DIR/scripts/openloomi-loop.cjs tick --compact | claude -p

# Or run the tick from inside a Claude Code session — Claude will see the
# "Run openloomi-loop tick" prompt in its context and execute it.

# 2. Drop a signal into the queue (for testing without Composio connected)
echo '{"source":"gmail","type":"email","payload":{"from":"Sarah <sarah@acme.com>","subject":"Q2 review tomorrow","labels":["INBOX"]}}' \
  | node $SKILL_DIR/scripts/openloomi-loop.cjs inject -

# 3. Run the lib-level analyze (ingest inbox → classify → decisions)
node $SKILL_DIR/scripts/openloomi-loop.cjs analyze

# 4. Browse the decision queue
node $SKILL_DIR/scripts/openloomi-loop.cjs inbox           # plain list
node $SKILL_DIR/scripts/openloomi-loop.cjs inbox --pick    # arrow-key picker

# 5. Run a decision (spawns a new claude code session with full context)
node $SKILL_DIR/scripts/openloomi-loop.cjs run dec_xxx

# 6. Optional: schedule ticks in the background every N seconds
node $SKILL_DIR/scripts/openloomi-loop.cjs schedule --interval 600

# 7. Memory operations go through the openloomi-memory skill
node $SKILL_DIR/scripts/openloomi-loop.cjs memory search-all "Sarah"
```

---

## Quick start/stop with `loop-ctl.sh`

For day-to-day use, prefer the bundled `loop-ctl.sh` helper over running the CLI directly. It manages both the `schedule` background loop and the `web` UI as a pair, writes PID files for clean shutdown, and self-heals the `data/` directory on first run.

```bash
# Start schedule + web (defaults: INTERVAL=600s, PORT=3614)
$SKILL_DIR/loop-ctl.sh start

# Check what's running
$SKILL_DIR/loop-ctl.sh status
#   schedule: pid=6948 uptime=18m05s
#   web:      pid=6949 http://127.0.0.1:3614/

# Restart (e.g. after editing scripts/)
$SKILL_DIR/loop-ctl.sh restart

# Stop both
$SKILL_DIR/loop-ctl.sh stop

# Override defaults
PORT=4000 INTERVAL=300 $SKILL_DIR/loop-ctl.sh start
```

What it does:
- **`start`** — runs `openloomi-loop schedule --interval ${INTERVAL:-600}` and `openloomi-loop web --port ${PORT:-3614}` in the background. `schedule` writes its own PID to `data/daemon.pid`; the web PID is written to `data/web.pid`. Both stdout/stderr are redirected to `data/schedule.log` and `data/web.log`. Auto-`mkdir` of `data/` so first-run after a git-clean works. Skips if either is already alive (no double-start).
- **`stop`** — `SIGTERM` each PID recorded in `data/daemon.pid` / `data/web.pid`, plus a `pkill -f` belt-and-suspenders for any orphan. Removes the PID files. No SIGKILL grace — `claude -p` children are expected to terminate cleanly on parent exit.
- **`status`** — prints the `loop status` snapshot, checks that the web port is bound via `lsof`, and lists each PID file as alive / stale / not present.
- **`restart`** — `stop` then `start`.

It does **not** start a tick on its own — `schedule` spawns ticks every `INTERVAL` seconds, independent of any manual invocation. Pair with `loop analyze` or `loop inject` if you want to feed it ad-hoc.

---

## Architecture

```
            ┌───────────────────────────────────────────────┐
            │                                               │
            ▼                                               │
   ┌──────────────┐    ┌──────────────┐    ┌───────────────┴──┐    ┌──────────────┐
   │  External    │───▶│   Context    │───▶│     Decision     │───▶│   Execute    │───▶ Output
   │ Environment  │    │    Layer     │    │      Layer       │    │    Layer     │
   │              │    │              │    │                  │    │              │
   │ Composio MCP │    │ signals.jsonl│    │ openloomi-memory │    │ spawn        │
   │ (gmail/cal/  │    │              │    │  enrichment      │    │   claude     │
   │  gh/slack)   │    │              │    │ + classifier     │    │ with prompt  │
   │   ↘ (no       │    │              │    │ (typed actions)  │    │              │
   │  composio →)  │    │              │    │                  │    │              │
   │ list-insights │    │              │    │                  │    │              │
   │ (openloomi-   │    │              │    │                  │    │              │
   │  memory)      │    │              │    │                  │    │              │
   │ + data/inbox │    │              │    │                  │    │              │
   └──────────────┘    └──────┬───────┘    └────────┬─────────┘    └──────┬───────┘
                              │                     │                    │
                              │       ┌─────────────┘                    │
                              │       │                                  │
                              ▼       ▼                                  ▼
                        openloomi-memory  (single source of truth:
                                           people, projects, insights,
                                           entities, RAG, temporal)
```

### Data flow per tick (agentic)

1. **Pull** — Claude calls `mcp__composio__COMPOSIO_MANAGE_CONNECTIONS` (list), then
   `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` in parallel for each connected toolkit
   (Gmail, Google Calendar, GitHub, Slack). For **gmail** and **slack**, if the toolkit is
   not registered, the tick falls back to
   `openloomi-memory list-insights --channel=<gmail|slack> --days=N`. For **googlecalendar**
   and **github** (no dedicated insight channel), the tick falls back to unfiltered
   `list-insights --days=N` and lets the existing classifier drop non-matching channels.
   `data/inbox/*.json` is always available as a manual path and is ingested by the lib-level
   tick. See "Synthesizing signals from insights" below for the payload mapping.
2. **Persist** — Each new signal is appended to `data/signals.jsonl` (deduped by `messageId` / `eventId` / `ts`).
3. **Enrich** — For every signal, Claude calls `openloomi-memory` to look up the sender / organizer / channel:
   - `search-all <name-or-email>` across local files + knowledge base + insights
   - `search-memory <name> --directory=people` for direct hits
   - `list-entities --type=person --search=<name>` for the entity registry
   - `list-insights --channel=<gmail|slack|...> --days=7` for recent context
4. **Remember** — New senders get `add-memory` calls into `~/.openloomi/data/memory/people/`. Recurring calendar event titles get project notes under `~/.openloomi/data/memory/projects/`.
5. **Filter** — Hard rules skip `noreply@*` senders, Gmail `Promotions/Social/Forums/Updates/Spam` labels, already-accepted calendar events, already-replied emails.
6. **Classify** — Survivors get a typed action: `rsvp`, `draft_reply`, `review_pr`, `todo`, `slack_reply`, …
7. **Queue** — Decisions are added to `data/decisions.json` via `loop ingest-decision '<json>'` with `memory_refs` listing the openloomi-memory entries cited. Confidence is **0.85** when the sender is in openloomi-memory, else **0.60**.
8. **Status** — A snapshot is written to `data/status.json` for `loop status`.

The tick is **strictly read/derive**. No external destructive action runs during a tick — execution is always on user request via `loop run <id>`.

### Synthesizing signals from insights

When the composio toolkit is not registered for a channel, the tick prompt instructs Claude
to fall back to `openloomi-memory list-insights` and map each returned insight into the same
`data/signals.jsonl` payload shape that the composio path produces. The mapping is:

| Insight channel | Synthesized signal |
|---|---|
| `gmail`        | `type: "email"` with `payload.messageId = insight.id`, `payload.from = insight.people[0]`, `payload.subject = insight.title`, etc. |
| `slack`        | `type: "slack_message"` with `payload.channel`, `payload.ts`, `payload.user`, `payload.text`. `mentions_me = false` (insights don't carry this flag — conservative). |
| `google_calendar`, `github` | Pull unfiltered insights; synthesize based on `insight.groups[0]`; signals whose `type` is not recognized by `classify()` are safely dropped. |
| Other (`telegram`, `whatsapp`, `discord`, `linkedin`, `twitter`, `weixin`, `rss`, …) | Synthesize as `type: "<channel>_message"`; classifier returns null and the signal is dropped. |

Each synthesized signal carries `_origin: "insights"` in its envelope so `data/daemon.log`
can account for which path produced it. Dedup uses both the existing
`messageId` / `eventId` / `ts` keys and a new `_insightId = insight.id` key, so toggling
composio on/off between ticks does not double-insert.

---

## Commands

| Command | Purpose |
|---|---|
| `tick [--compact] [--json] [--config k=v]` | Print the prompt Claude runs for one Loop tick. `--compact` for cron; `--json` for structured output. |
| `schedule [--interval N] [--watch-interval N]` | Loop: `claude -p $(loop tick --compact)` every N seconds **and** watch for new decisions (desktop notifications). The tick and watch run on **independent timers** — a hung tick never blocks notifications. Tick is hard-killed after `LOOP_CLAUDE_TIMEOUT_MS` (default 15 min). Writes its own PID for stop. |
| `watch [--interval N]` | Poll `decisions.json` every N seconds and fire desktop notifications on new pending decisions. Pair with external ticks (cron, another `loop schedule`) to feed it. |
| `notify [--all] [--webhook URL]` | Manually fire notifications. `--all` notifies every current pending; default notifies only new (unseen) ones. Webhook (Slack-compatible JSON) optional via `--webhook` or env `LOOP_NOTIFY_WEBHOOK`. |
| `ingest-decision <json\|- or file>` | Append a decision to `decisions.json`. Called by the Claude tick agent. |
| `analyze [--seen-init]` | Lib-level tick: ingest `data/inbox/` → classify → decisions. Memory enrichment is skipped (the agentic tick handles that). `--seen-init` also clears `data/notifications.seen.json` so a running watch will re-fire notifications for all current pending on its next poll. |
| `pull` | Alias for `analyze` (kept for backwards compat). |
| `status` | Show last-tick snapshot + counts + config + current watch session (pid, started_at, host). |
| `summary [--since=ISO]` | Activity report from `notifications.log`. **Default** = current watch session window. **`--since=<ISO>`** = everything from that timestamp. Batches tagged `[pid=X]` (this session) vs `[pid=?]` (pre-session, historical). Use to answer *"what did I receive this session?"* without conflating historical log entries. |
| `inbox [--pick] [--limit N]` | List pending decisions (interactive picker). |
| `decisions [--status pending\|done\|dismissed\|all]` | List decisions by bucket. |
| `decision <id>` | Show full JSON for one decision. |
| `run <id> [--dry]` | Spawn `claude -p <prompt>` for that decision. |
| `dismiss <id> [--reason ...]` | Mark as dismissed. |
| `inject <file\|->` | Drop a signal JSON into `data/inbox/`. |
| `memory <subcommand> [args...]` | Delegate to the **openloomi-memory** CLI: `search-all`, `search-memory`, `list-insights`, `add-memory`, `add-insight`, etc. |
| `config [get\|set k v]` | Read/edit config. |
| `logs [-n N]` | Tail the loop log. |
| `serve` | REPL: `list`, `run <id>`, `dismiss <id>`, `analyze`, `status`, `quit`. |
| `web [--port N] [--no-open]` | Start HTTP server with REST API + Ink & Circuit style UI at `http://127.0.0.1:N/`. Auto-opens browser. CLI default port **3414** — **collides with the openloomi desktop app**, which binds 3414. When the app is running, use `--port 3614` (or any other free port), or run via `$SKILL_DIR/loop-ctl.sh start` which defaults to 3614 to avoid the clash. |

### Notification channels

Every fired notification is written to three places:

1. **`data/notifications.log`** — append-only log of all notifications
2. **macOS desktop notification** — via `osascript` (no extra deps); auto-suppressed on other platforms
3. **Webhook** — Slack-compatible JSON POST, if `LOOP_NOTIFY_WEBHOOK` env var is set or `--webhook` is passed to `notify`

The watcher maintains `data/notifications.seen.json` to ensure each decision fires exactly once.

All commands operate on `$SKILL_DIR/data/` for the signal/decision store. Memory is delegated entirely to openloomi-memory.

---

## Web UI — `loop web`

`loop web` (or `node scripts/loop-web.cjs <port>`) starts an HTTP server (override with `--port N` or `LOOP_WEB_PORT`). The CLI default is **3414**, but the **openloomi desktop app also binds 3414** — if both run on the same machine, the second one to start will fail with `EADDRINUSE`. The bundled `$SKILL_DIR/loop-ctl.sh start` defaults to **3614** to sidestep the conflict. Auto-opens the default browser.

**Ink & Circuit** themed UI (amber/dark, Syne + Space Grotesk + JetBrains Mono, hex markers, circuit corners) with three views:

| View | What it shows |
|---|---|
| **Q Queue** | 3-column kanban: PENDING / DONE / DISMISSED. Each card shows type badge, confidence bar, triggering context (⏰/✉️/🔀/💬), 👤 person, 🧠 memory refs, action line. Click → detail panel. |
| **T Timeline** | Canvas graph — decisions as hex nodes positioned by time, grouped by type. Pan/zoom. Click → detail. |
| **A Activity** | Split view: live `notifications.log` feed (left) + recent decisions (right). Auto-refreshes every 4s. |

**Detail panel** (slide-in from right):
- Why-this-surfaced trail, triggering context (organizer/sender/time/labels/snippet/branch)
- 👤 Known contact · 🧠 memory refs (click to inline-load file content)
- Suggested action JSON · raw source signal (click to view original `inbox/.processed/*.json`)
- Action buttons: **▶ RUN** (spawns `claude -p`), **DRY RUN** (shows full prompt), **✓ MARK DONE**, **✕ DISMISS**

**Keyboard**: `Q` / `T` / `A` switch views · `/` open search · `↑↓` navigate · `Enter` run selected · `Esc` close.

**REST API** (CORS-enabled, returns JSON):

```
GET  /api/state                counts, last tick, status
GET  /api/decisions            { pending, done, dismissed }
GET  /api/decision/:id         full decision + bucket
GET  /api/signals?limit=50     tail of signals.jsonl
GET  /api/notifications?limit=50  tail of notifications.log
GET  /api/memory?path=<rel>    read ~/.openloomi/data/memory/<rel>   (path-traversal safe)
GET  /api/source?path=<rel>    read data/inbox/<rel>                 (path-traversal safe)
POST /api/run/:id[?dry=1]      spawn `claude -p <prompt>` (or return prompt if dry=1)
POST /api/dismiss/:id          move pending → dismissed
POST /api/done/:id             move pending → done
POST /api/notify               fire macOS desktop test notification
```

Static UI files served from `web/`. No external deps; no auth (binds 127.0.0.1 only).

### Design system — Ink & Circuit

The web UI is built on the **Ink & Circuit** visual language. Reference files in `references/`:

| File | What |
|---|---|
| `references/DESIGN.md` | Canonical design tokens (colors, type, layout), component patterns, animation rules, keyboard map, "how to adapt to a new domain" guide. **Update first** when extending the visual language. |
| `references/index.html` | The design source this UI was adapted from. Keep untouched as a visual reference. |
| `web/index.html` | The openloomi-loop implementation. Has a header comment linking to `../references/DESIGN.md`. |

The design system maps 5 decision types to the 5 knowledge-graph categories: rsvp (amber), draft_reply (green), review_pr (blue), slack_reply (purple), todo (red). When adding a new decision type, add a CSS variable, a `.t-<type>` card class, a hex color in JS `TC`, and a label in `TL`.

---

## Decision Types

| Type | Trigger | Action |
|---|---|---|
| `rsvp` | Calendar event with `my_response: needsAction` | `calendar_rsvp` |
| `draft_reply` | Email matching meeting/RSVP/invite patterns, or with action verbs (please/could you/need/urgent/…) from a known person | `email_reply` |
| `review_pr` | GitHub PR where you're a reviewer | `github_review` |
| `todo` | GitHub issue assigned to you, open | `todo` |
| `slack_reply` | Slack message that mentions you | `slack_reply` |

Confidence is **0.85** when sender is in openloomi-memory (known contact), else **0.60**.

---

## Running a Decision → Claude Code

`run <id>` builds a prompt like:

```
You are executing an openloomi Loop decision. The user picked this from a proactive suggestion list.

DECISION TYPE: draft_reply
TITLE: Reply: Q2 Roadmap Review tomorrow - please RSVP
CONFIDENCE: 0.85

WHY THIS SURFACED:
- Source: gmail:email
- Subject: Q2 Roadmap Review tomorrow - please RSVP

MEMORY REFS (openloomi-memory):
- people/sarah_chen.md  (3 prior interactions)
- insights/insight_abc  (related deadline discussion from last week)

SOURCE SIGNAL (gmail:email):
{ ...payload... }

SUGGESTED ACTION:
{ "kind": "email_reply", "params": { ... } }

Execute this action now. Steps:
1. Confirm what you're about to do in one line.
2. Take the action (read files, draft replies, update tasks — whatever the action calls for).
3. When done, summarize in 3 bullets: what changed, what was written to memory, follow-ups.
4. If any step is destructive or sends externally, STOP and ask the user to confirm before continuing.

For any new people or insights discovered, use the openloomi-memory skill:
  node $OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs add-memory ...
  node $OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs add-insight ...
```

It then spawns the first available binary among `claude`, `claude-code`, `/usr/local/bin/claude` (or whatever `LOOP_CLAUDE_BIN` is set to) and passes the prompt via `-p`. The CLI's stdio is inherited so you see Claude's output directly.

On exit, the decision is moved to `done` or `dismissed`. Any memory writeback happens in the executing Claude session itself via openloomi-memory.

Use `run <id> --dry` to print the prompt without spawning anything.

### ⚠️ Known issue: `run <id>` fails when called from inside another Claude Code session

When the Loop itself is being driven by a Claude Code session (e.g. the user invokes `loop run <id>` from inside Claude Code, or the Web UI's **▶ RUN** button is clicked while the user is running Claude Code), `run <id>` aborts with:

```
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

Two caveats even with the bypass:

1. **Do NOT `unset CLAUDECODE` blindly.** If the inner `claude -p` exits, errors, or hangs, it can corrupt the parent Claude Code session's stdio / shared resources. The CLI's own check is correct.
2. **Failed spawn is recorded against the decision.** The loop marks the decision as `dismissed` with `result=null` and increments the failure counter (`failed (1/null)` in the run log), even though no action was actually attempted.

**Recommended pattern (no bypass needed):**

1. `loop run <id> --dry` → read the built prompt and the suggested `action.kind` / `action.params`.
2. Take the action **in the parent Claude Code session itself**, by calling the appropriate tool directly:
   - `calendar_rsvp` → `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` with `GOOGLECALENDAR_PATCH_EVENT` (pass `event_id`, `calendar_id="primary"`, `rsvp_response="accepted|declined|tentative"`, `send_updates="none"` if you don't want to spam attendees).
   - `email_reply` → `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` with `GMAIL_SEND_EMAIL` (or `GMAIL_CREATE_DRAFT` for review-first).
   - `github_review` → `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` with `GITHUB_CREATE_REVIEW` / `GITHUB_ADD_REVIEW_COMMENT`.
   - `slack_reply` / `todo` → analogous Composio tool per toolkit.
3. Confirm the action landed (e.g. fetch the event / PR / message again and check the new state).
4. Move the decision to `done` manually — there's no CLI subcommand for it, but it's one `node` call against `decisions.json`:

   ```js
   const fs = require('fs');
   const p = '/path/to/openloomi-loop/data/decisions.json';  // the path `loop status` prints
   const d = JSON.parse(fs.readFileSync(p, 'utf8'));
   const id = 'dec_xxxxxxxxx';
   const item = (d.dismissed || []).splice(
     (d.dismissed || []).findIndex(x => x.id === id), 1
   )[0] || (d.pending || []).splice(
     (d.pending || []).findIndex(x => x.id === id), 1
   )[0];
   item.status = 'done';
   item.result = { action: '<kind>', ...item.action.params, via: 'in_session_api_call' };
   item.completed_at = new Date().toISOString();
   d.done.unshift(item);
   fs.writeFileSync(p, JSON.stringify(d, null, 2));
   ```

**When `unset CLAUDECODE` IS acceptable:** only when the parent Claude Code session is throwaway (e.g. a `claude -p "…"` one-shot from a shell, or a CI job). Not acceptable from inside an interactive Claude Code session that the user wants to keep.

---

## Sources

| Source | What it pulls | When enabled |
|---|---|---|
| **Composio MCP** (`mcp__composio__*`) | Connected toolkits: gmail, googlecalendar, github, slack. Claude pulls in parallel. | Whenever the user has connected those toolkits via Composio. |
| **openloomi-memory insights** (`list-insights`) | Pre-extracted summaries for channels synced by `openloomi-connectors` (gmail, slack, telegram, whatsapp, etc.). Synthesized into signal-shape payloads; the existing classifier handles gmail/slack and drops everything else. | Always on. Kicks in only when the corresponding Composio toolkit is not registered. |
| **openloomi-memory** (`mcp__*` or CLI) | Memory reads/writes for enrichment. | Always — required for proper context. |
| **data/inbox/*.json** | Manual drop folder (or any non-Composio bridge script). | Default `enableSources.file: true`. |

### Inject format

```json
{
  "source": "gmail",
  "type": "email",
  "payload": {
    "from": "Sarah Chen <sarah@acme.com>",
    "subject": "Q2 Roadmap Review",
    "snippet": "...",
    "threadId": "t1",
    "labels": ["INBOX", "IMPORTANT"]
  }
}
```

Or for calendar:

```json
{
  "source": "google_calendar",
  "type": "calendar_event",
  "payload": {
    "eventId": "evt1",
    "title": "Design review with Jamie",
    "start": "2026-06-26T15:00:00Z",
    "my_response": "needsAction"
  }
}
```

---

## Configuration

```bash
loop config get
loop config set intervalSec 600       # for `loop schedule` (10 min)
loop config set noReplySkip false
loop config set enableSources.file false
```

Defaults:

```json
{
  "intervalSec": 600,
  "maxSignals": 5000,
  "maxDecisions": 500,
  "autoRun": false,
  "enableSources": { "composio": true, "openloomi": true, "file": true },
  "noReplySkip": true,
  "promotionSkip": true
}
```

### Environment variables

| Var | Default | Effect |
|---|---|---|
| `LOOP_CLAUDE_BIN` | `claude` | Binary invoked for `claude -p ...` (`schedule`, `run`, `tick`). |
| `LOOP_CLAUDE_TIMEOUT_MS` | `900000` (15 min) | Hard timeout for one tick's `claude -p` child. On timeout: SIGTERM → 5s grace → SIGKILL. Prevents a hung tick from blocking notifications. |
| `LOOP_CLAUDE_SAFE_PERMISSIONS` | _(unset)_ | Set to `1` to **opt out** of `--dangerously-skip-permissions` for the spawned child. Default adds it so the tick can call `mcp__composio__*` and the openloomi CLIs without per-call prompts. Ticks are read/derive only — no email sends, no RSVPs, no dismisses — so the flag is safe. |
| `LOOP_WEB_PORT` | `3414` (CLI) / `3614` (loop-ctl.sh) | Default port for `loop web`. CLI / `LOOP_WEB_PORT` defaults to 3414, which **conflicts with the openloomi desktop app's** Next.js server on the same port. `loop-ctl.sh` defaults to 3614 to avoid that clash; override per-call with `--port N` or this env var. |
| `LOOP_NOTIFY_WEBHOOK` | _(unset)_ | If set, every notification also POSTs a Slack-compatible JSON payload to this URL. |

### Watch independence + `--seen-init`

`loop schedule` runs **two independent timers**: one for ticks (`--interval`, default 600s) and one for watching (`--watch-interval`, default 5s). A hung tick can never block notifications — the watch loop polls `data/decisions.json` every 5s regardless.

If you want to **re-fire notifications for everything currently pending** (e.g. after fixing a bug in the notification path, or to demo it), run `loop analyze --seen-init`. This clears `data/notifications.seen.json`, and the next watch poll — even on a running `loop schedule` / `loop watch` — will treat every current pending decision as new.

---

## Data Layout

```
$SKILL_DIR/data/                       # managed by the loop skill
├── daemon.pid          # current `loop schedule` PID (if running)
├── daemon.log          # append-only log
├── watch.session.json  # { pid, started_at, host } — written by `loop watch`/`schedule` on start; used by `loop summary` to scope "this session" reports
├── notifications.log   # append-only notification audit trail; lines tagged `[pid=X started=Y]` from the current watch
├── notifications.seen.json # dedupe: which decision IDs have already fired
├── status.json         # last tick snapshot
├── config.json         # config
├── decisions.json      # { pending: [], done: [], dismissed: [] }
├── signals.jsonl       # append-only signal log (capped at maxSignals)
└── inbox/              # drop folder for manual signal injection
    ├── *.json          # new signals to ingest
    ├── .processed/     # ingested files
    └── .failed/        # malformed files

~/.openloomi/data/memory/              # managed by openloomi-memory
├── people/             # { email-sanitized }.md   (auto-grown by tick)
├── projects/           # { title-sanitized }.md
├── chats/, channels/, notes/, strategy/
└── ... (full set in openloomi-memory SKILL.md)
```

The loop skill does **not** write to `~/.openloomi/data/memory/` directly — it delegates to the openloomi-memory CLI which handles filesystem layout, naming, and idempotency.

---

## Examples

### End-to-end demo (no Composio needed)

```bash
# Clean state
rm -f $SKILL_DIR/data/decisions.json $SKILL_DIR/data/signals.jsonl

# Drop 3 signals
for s in \
  '{"source":"gmail","type":"email","payload":{"from":"Sarah <sarah@acme.com>","subject":"Q2 review tomorrow please RSVP","labels":["INBOX"]}}' \
  '{"source":"google_calendar","type":"calendar_event","payload":{"eventId":"e1","title":"Design review with Jamie","my_response":"needsAction"}}' \
  '{"source":"github","type":"github_pr","payload":{"repo":"x/y","number":42,"title":"Refactor auth","state":"open","user_is_reviewer":true}}'
; do echo "$s" | loop inject -; done

# Analyze (lib-level, no memory enrichment)
loop analyze

# Browse queue
loop inbox

# Pick the first one
loop run $(loop inbox | grep -oE 'dec_[a-z0-9]+' | head -1)

# Memory peek (delegates to openloomi-memory)
loop memory search-all "Sarah"
```

### Periodic background ticks (cron / launchd)

```bash
# Foreground loop (Ctrl+C to stop)
loop schedule --interval 600          # tick every 10 minutes

# Or one-shot via launchd / cron, every 10 min:
*/10 * * * * /usr/local/bin/node $SKILL_DIR/scripts/openloomi-loop.cjs tick --compact | /usr/local/bin/claude -p --output-format text
```

### REPL session

```bash
loop serve
# loop> list
# loop> run dec_xxx
# loop> dismiss dec_yyy
# loop> analyze
# loop> status
# loop> quit
```

### Activity report — "what did I receive this session?"

```bash
# Default = current watch session window (uses data/watch.session.json)
loop summary
# scope:   current session (pid=26402 started=2026-06-25T11:50:22.290Z)
# batches: 1
# notified: 1 decisions
# types:
#   review_pr      1
#
# batches:
#   2026-06-25T11:50:43.304Z  [pid=26402]  1 new

# Custom window — everything since 09:00 today
loop summary --since=2026-06-25T09:00:00Z
# Batches tagged [pid=X] are from a known watch process; [pid=?]
# marks pre-session (historical) entries from before session tracking existed.
```

### Adding a new tool's signals

1. Append a normalized payload to `data/signals.jsonl` (one JSON object per line).
2. Add a classifier branch in `loop-lib.cjs → classify()` if the new signal type warrants a new decision `type`.
3. Extend the tick prompt in `loop-tick.cjs` to teach Claude how to fetch from the new toolkit via Composio MCP.

---

## Hard-Rule Filters (No-AI Decisions)

These run before the LLM classifier and can short-circuit:

| Signal | Outcome |
|---|---|
| Sender matches `noreply@*`, `no-reply@*`, `donotreply@*`, `mailer-daemon@*`, `notifications?@*` | Skip |
| Gmail label in `Promotions, Social, Forums, Updates, Spam` | Skip |
| Calendar event already `accepted` / `declined` / `tentative` | Skip |
| Email already replied | Skip |

This keeps the LLM work small and the suggestion feed high-signal.

---

## Companion Skills

| When you want… | Use |
|---|---|
| API endpoint reference | `openloomi-api` |
| Connect / manage a platform | `openloomi-connectors` |
| **Search / write memory** | **`openloomi-memory`** (delegated target for all reads/writes) |
| User-facing product / setup | `openloomi-feature-guide` |

This skill (`openloomi-loop`) is the **proactive executor** — `openloomi-memory` is the **memory layer**. The Loop never owns its own memory; it asks openloomi-memory.

---

## Reference

- openloomi website: https://openloomi.ai
- openloomi documents: https://openloomi.ai/docs
- Composio MCP: `mcp__composio__*` tools
- openloomi-memory CLI: `node $SKILL_DIR/../openloomi-memory/scripts/openloomi-memory.cjs <subcommand>`
- openloomi desktop app's local API (separate from this skill): `http://127.0.0.1:3414` — only when the app is running. **Not** the loop web UI; loop's web UI binds `3614` (loop-ctl default) or whatever you pass to `loop web --port`.
- Token: `~/.openloomi/token` (base64-encoded JWT)
