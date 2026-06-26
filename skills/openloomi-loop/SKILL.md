---
name: openloomi-loop
description: "Use this when the user asks about openloomi's Loop — openloomi's 主动执行大脑 (proactive execution brain). It actively and continuously (主动持续) pulls external signals (Gmail, Calendar, GitHub, Slack) via Composio MCP, enriches them through openloomi-memory, classifies them into typed decisions, and executes via Claude Code. Triggers: 'openloomi loop', 'loop tick', 'loop schedule', 'loop inbox', 'loop run', 'proactive decisions', 'context → decision → execute', 'pull signals', 'decision queue', 'loop serve', '上下文闭环', '主动建议', '主动执行大脑', '主动持续', 'RSVP 提醒', '自动草稿', '决策队列', '拉取信号', '运行决策'"
allowed-tools: Bash(node $SKILL_DIR/scripts/openloomi-loop.cjs *), Bash(node $SKILL_DIR/scripts/loop-tick.cjs *), Bash(node ../../openloomi-memory/scripts/openloomi-memory.cjs *), Bash(tail -f $SKILL_DIR/data/daemon.log), Bash(cat >> $SKILL_DIR/data/signals.jsonl), Bash(echo *), Bash(ls *)
metadata:
  version: 0.6.1
---

> **Note:** If you haven't downloaded or installed openloomi yet, please refer to [Getting Started](https://openloomi.ai/docs/getting-started) for installation instructions.

# OpenLoomi Loop — 主动执行大脑 · The Proactive Execution Brain

> **主动持续 (Proactive & Continuous)** — watches external signals, thinks via openloomi-memory, and acts via Claude Code. **主动执行大脑 (Proactive Execution Brain)** — the always-on execution layer of openloomi.

A **Claude Code skill** that runs **proactively and continuously (主动持续)**, turning ambient signals from your connected tools into finished work. The Loop is openloomi's **proactive execution brain (主动执行大脑)** — a vigilant teammate that watches, thinks, and acts without you having to ask. Three layers, all agentic:

1. **Pull** — Claude, via **Composio MCP**, fetches fresh signals (Gmail, Calendar, GitHub, Slack) into a local signal store.
2. **Enrich + Classify** — Claude calls the **openloomi-memory** skill to look up senders / projects, classify each new signal into a typed decision (`rsvp`, `draft_reply`, `review_pr`, …), and queue it.
3. **Execute** — You browse the decision queue and pick. Picking spawns a fresh Claude Code session with the full context to act — and that session, in turn, writes any memory updates back via openloomi-memory.

No background daemon. No subprocess hacks. No local memory cache. **The Loop is Claude pulling signals, Claude enriching with memory, Claude acting** — every layer is agentic. The brain never sleeps: it ticks, watches, and remembers.

---

## 主动持续 — Proactive & Continuous

The Loop is not a one-shot tool you invoke. It is a **持续运行 (continuously running)** execution brain with two complementary properties:

- **主动 / Proactive** — The Loop watches Gmail, Calendar, GitHub, and Slack in the background. It surfaces decisions *before* you ask: a meeting invitation becomes an `rsvp` suggestion, an unread email from a known person becomes a `draft_reply` card, a PR where you're a reviewer becomes a `review_pr` task. Nothing fires automatically — but everything is queued and waiting the moment you look.
- **持续 / Continuous** — `loop schedule --interval N` runs an infinite tick loop in the background. Each tick: pull new signals → enrich with memory → classify → queue. State persists in `data/decisions.json`, so the queue survives restarts, and each new signal joins the same ongoing conversation. `loop watch` keeps emitting desktop notifications on fresh entries.
- **主动执行大脑 / Proactive Execution Brain** — Openloomi's memory (`openloomi-memory`) stores *what you know*; the Loop is the brain that *decides what to do about it*. Itself not a daemon, not a script, not a cron — the Loop is Claude, looping. Each tick is a fresh `claude -p` invocation; each executed decision is a fresh `claude -p` session. Composability over persistence.

Together, **主动持续** turns Claude into a teammate that never sleeps and never loses context: it remembers people (via openloomi-memory), watches the world (via Composio MCP), and prepares the next move (via the decision queue). You stay in control of execution; the Loop stays in control of awareness.

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
node $SKILL_DIR/scripts/openloomi-loop.cjs schedule --interval 300

# 7. Memory operations go through the openloomi-memory skill
node $SKILL_DIR/scripts/openloomi-loop.cjs memory search-all "Sarah"
```

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
   │ + data/inbox │    │              │    │ (typed actions)  │    │              │
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

1. **Pull** — Claude calls `mcp__composio__COMPOSIO_MANAGE_CONNECTIONS` (list), then `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` in parallel for each connected toolkit (Gmail, Google Calendar, GitHub, Slack, etc...). If `data/inbox/*.json` is present, the lib-level tick also ingests it.
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

---

## Commands

| Command | Purpose |
|---|---|
| `tick [--compact] [--json] [--config k=v]` | Print the prompt Claude runs for one Loop tick. `--compact` for cron; `--json` for structured output. |
| `schedule [--interval N]` | Loop: `claude -p $(loop tick --compact)` every N seconds **and** watch for new decisions (desktop notifications). Writes its own PID for stop. |
| `watch [--interval N]` | Poll `decisions.json` every N seconds and fire desktop notifications on new pending decisions. Pair with external ticks (cron, another `loop schedule`) to feed it. |
| `notify [--all] [--webhook URL]` | Manually fire notifications. `--all` notifies every current pending; default notifies only new (unseen) ones. Webhook (Slack-compatible JSON) optional via `--webhook` or env `LOOP_NOTIFY_WEBHOOK`. |
| `ingest-decision <json\|- or file>` | Append a decision to `decisions.json`. Called by the Claude tick agent. |
| `analyze` | Lib-level tick: ingest `data/inbox/` → classify → decisions. Memory enrichment is skipped (the agentic tick handles that). |
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
| `web [--port N] [--no-open]` | Start HTTP server with REST API + Ink & Circuit style UI at `http://127.0.0.1:N/`. Auto-opens browser. Default port 3414. |

### Notification channels

Every fired notification is written to three places:

1. **`data/notifications.log`** — append-only log of all notifications
2. **macOS desktop notification** — via `osascript` (no extra deps); auto-suppressed on other platforms
3. **Webhook** — Slack-compatible JSON POST, if `LOOP_NOTIFY_WEBHOOK` env var is set or `--webhook` is passed to `notify`

The watcher maintains `data/notifications.seen.json` to ensure each decision fires exactly once.

All commands operate on `$SKILL_DIR/data/` for the signal/decision store. Memory is delegated entirely to openloomi-memory.

---

## Web UI — `loop web`

`loop web` (or `node scripts/loop-web.cjs <port>`) starts an HTTP server on `http://127.0.0.1:3414/` (override with `--port N` or `LOOP_WEB_PORT`). Auto-opens the default browser.

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
| `references/index.html` | The original Alloomi "KNOWLEDGE DISPATCH v41 · INK & CIRCUIT" graph — the design source this UI was adapted from. Keep untouched as a visual reference. |
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

---

## Sources

| Source | What it pulls | When enabled |
|---|---|---|
| **Composio MCP** (`mcp__composio__*`) | Connected toolkits: gmail, googlecalendar, github, slack. Claude pulls in parallel. | Whenever the user has connected those toolkits via Composio. |
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
loop config set intervalSec 300       # for `loop schedule`
loop config set noReplySkip false
loop config set enableSources.file false
```

Defaults:

```json
{
  "intervalSec": 60,
  "maxSignals": 5000,
  "maxDecisions": 500,
  "autoRun": false,
  "enableSources": { "composio": true, "openloomi": true, "file": true },
  "noReplySkip": true,
  "promotionSkip": true
}
```

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
loop schedule --interval 300          # tick every 5 minutes

# Or one-shot via launchd / cron, every 5 min:
*/5 * * * * /usr/local/bin/node $SKILL_DIR/scripts/openloomi-loop.cjs tick --compact | /usr/local/bin/claude -p --output-format text
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
- Local API server (fallback): `http://localhost:3414`
- Token: `~/.openloomi/token` (base64-encoded JWT)
