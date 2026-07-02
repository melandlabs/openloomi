---
name: openloomi-loop
description: "Use this when the user asks about openloomi's Loop — openloomi's proactive execution brain. It actively and continuously pulls external signals (Gmail, Calendar, GitHub, Slack) via any of three Composio surfaces — **MCP** (`mcp__composio__*`), the **`composio-cli` skill**, or the **`composio` CLI** — enriches them through openloomi-memory, **converts every actionable signal into a typed decision** (`rsvp` / `draft_reply` / `review_pr` / `todo` / `slack_reply` / …), queues it in `data/decisions.json`, and **executes via the openloomi native agent API by default** (`POST http://127.0.0.1:3414/api/native/agent`, the same agentic endpoint the locomo benchmark uses — supports tool use, memory writes, multi-round reasoning; no agent install needed) — with a pluggable spawned-CLI fallback (`claude -p` / `codex` / `aider` / anything via `LOOP_AGENT_BIN`). Triggers: 'openloomi loop', 'loop tick', 'loop schedule', 'loop inbox', 'loop run', 'proactive decisions', 'signal → decision → execute', 'pull signals', 'decision queue', 'loop serve'"
allowed-tools: Bash(node $SKILL_DIR/scripts/openloomi-loop.cjs *), Bash(node $SKILL_DIR/scripts/loop-tick.cjs *), Bash(node $SKILL_DIR/scripts/obsidian-scan.cjs *), Bash(node ../../openloomi-memory/scripts/openloomi-memory.cjs *), Bash(curl *), Bash(claude *), Bash(codex *), Bash(aider *), Bash(tail -f $SKILL_DIR/data/daemon.log), Bash(cat >> $SKILL_DIR/data/signals.jsonl), Bash(echo *), Bash(ls *)
metadata:
  version: 0.6.4
---

> **Note:** If you haven't downloaded or installed openloomi yet, please refer to [Getting Started](https://openloomi.ai/docs/getting-started) for installation instructions.

# OpenLoomi Loop — The Proactive Execution Brain

> **Proactive & Continuous** — watches external signals, thinks via openloomi-memory, and acts via the openloomi AI API (or any agent runtime you choose). **Proactive Execution Brain** — the always-on execution layer of openloomi.

A **Claude Code skill** that runs **proactively and continuously**, turning ambient signals from your connected tools into finished work. The Loop is openloomi's **proactive execution brain** — a vigilant teammate that watches, thinks, and acts without you having to ask. Three layers, all agentic:

1. **Pull** — Claude fetches fresh signals (Gmail, Calendar, GitHub, Slack) into a local signal store (`data/signals.jsonl`) via any of three Composio surfaces: the **Composio MCP** (`mcp__composio__*` tools), the **`composio-cli` skill** (Claude calls `Skill composio-cli …`), or the **`composio` CLI** (Claude shells out with `Bash(composio …)`). The Loop doesn't care which surface — only the resulting signal envelope matters.
2. **Signal → Decision** — Claude calls the **openloomi-memory** skill to enrich every signal with sender / project context, **then converts every actionable signal into a typed decision** (`rsvp`, `draft_reply`, `review_pr`, `todo`, `slack_reply`, …) and appends it to `data/decisions.json`. Signals that survive the hard-rule filters are *never left raw* — they are always either classified into a decision or explicitly dropped with a reason. The queue is the single source of truth for "what's next."
3. **Execute** — You browse the decision queue and pick. Picking hands the built prompt to an **agent runtime** — by default the **openloomi native agent API** (`POST http://127.0.0.1:3414/api/native/agent`, the same agentic endpoint the locomo benchmark uses; supports tool use, memory writes, multi-round reasoning; authenticated with `~/.openloomi/token`; no agent install required). The runtime can be swapped to any **spawned CLI agent** (`claude -p` / `codex` / `aider` / custom binary, picked via `LOOP_AGENT_BIN`) or, when already inside a Claude Code session, executed **in-session** via direct tool calls. All three surfaces read the same prompt, dispatch the same `action.kind`, and write memory back via openloomi-memory.

No background daemon. No subprocess hacks. No local memory cache. **The Loop is Claude pulling signals, Claude enriching with memory, Claude acting** — every layer is agentic. The brain never sleeps: it ticks, watches, and remembers.

---

## Proactive & Continuous

The Loop is not a one-shot tool you invoke. It is a **continuously running** execution brain with two complementary properties:

- **Proactive** — The Loop watches Gmail, Calendar, GitHub, and Slack in the background (via any of the three Composio surfaces — MCP, `composio-cli` skill, or `composio` CLI). It surfaces decisions *before* you ask: a meeting invitation becomes an `rsvp` suggestion, an unread email from a known person becomes a `draft_reply` card, a PR where you're a reviewer becomes a `review_pr` task. Nothing fires automatically — but everything is queued and waiting the moment you look.
- **Continuous** — `loop schedule --interval N` runs an infinite tick loop in the background. Each tick: pull new signals → enrich with memory → classify → queue. State persists in `data/decisions.json`, so the queue survives restarts, and each new signal joins the same ongoing conversation. `loop watch` keeps emitting desktop notifications on fresh entries.
- **Proactive Execution Brain** — Openloomi's memory (`openloomi-memory`) stores *what you know*; the Loop is the brain that *decides what to do about it*. Itself not a daemon, not a script, not a cron — the Loop is an **agent runtime**, looping. Each tick is one call to whichever runtime is configured (openloomi AI API by default, or a spawned CLI agent); each executed decision is one more call. **No Claude install required.** Composability over persistence.

Together, **Proactive and Continuous** turns Claude into a teammate that never sleeps and never loses context: it remembers people (via openloomi-memory), watches the world (via any of the three Composio surfaces — MCP, `composio-cli` skill, or `composio` CLI), and prepares the next move (via the decision queue). You stay in control of execution; the Loop stays in control of awareness.

---

## Quick Start

```bash
# 1. Ask your agent runtime to do one tick (prints the prompt it should run).
#    Default = openloomi native agent API (no install needed, just ~/.openloomi/token):
PROMPT=$(node $SKILL_DIR/scripts/openloomi-loop.cjs tick --json | jq -r .prompt)
curl -sX POST http://127.0.0.1:3414/api/native/agent \
  -H "Authorization: Bearer $(cat ~/.openloomi/token | base64 -d)" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$PROMPT" '{prompt: $p, provider: "claude"}')"

# Or, if you have the `claude` CLI installed and want a spawned agent:
node $SKILL_DIR/scripts/openloomi-loop.cjs tick --compact | claude -p

# Or run the tick from inside a Claude Code session — Claude will see the
# "Run openloomi-loop tick" prompt in its context and execute it directly.

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
# Start schedule + web (defaults: INTERVAL=600s, LOOP_WEB_PORT=3614)
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
LOOP_WEB_PORT=4000 INTERVAL=300 $SKILL_DIR/loop-ctl.sh start
```

What it does:
- **`start`** — runs `openloomi-loop schedule --interval ${INTERVAL:-600}` and `openloomi-loop web --port ${LOOP_WEB_PORT:-3614}` in the background. `schedule` writes its own PID to `data/daemon.pid`; the web PID is written to `data/web.pid`. Both stdout/stderr are redirected to `data/schedule.log` and `data/web.log`. Auto-`mkdir` of `data/` so first-run after a git-clean works. Skips if either is already alive (no double-start).
- **`stop`** — `SIGTERM` each PID recorded in `data/daemon.pid` / `data/web.pid`, plus a `pkill -f` belt-and-suspenders for any orphan. Removes the PID files. No SIGKILL grace — spawned-agent children are expected to terminate cleanly on parent exit.
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
   │ Composio (3  │    │ signals.jsonl│    │ openloomi-memory │    │ Agent        │
   │ surfaces):   │    │  (raw sigs)  │    │  enrichment      │    │ runtime (3   │
   │ • MCP        │    │      │       │    │       │          │    │ surfaces):   │
   │   mcp__compos│    │      ▼       │    │       ▼          │    │ • openloomi  │
   │   io__*      │    │  signal →    │    │  signal →        │    │   AI API     │
   │ • composio-  │    │  decision    │    │  decision        │    │   (default,  │
   │   cli Skill  │    │  conversion  │    │  classification  │    │   no install)│
   │ • composio   │    │              │    │ (typed actions)  │    │ • spawned    │
   │   CLI        │    │              │    │ decisions.json   │    │   CLI agent  │
   │   ↘ (no       │    │              │    │                  │    │   (claude -p,│
   │  composio →)  │    │              │    │                  │    │   codex,     │
   │ list-insights │    │              │    │                  │    │   aider, …)  │
   │ (openloomi-   │    │              │    │                  │    │ • in-session │
   │  memory)      │    │              │    │                  │    │   (direct    │
   │ + data/inbox │    │              │    │                  │    │   tool calls)│
   └──────────────┘    └──────┬───────┘    └────────┬─────────┘    └──────┬───────┘
                              │                     │                    │
                              │       ┌─────────────┘                    │
                              │       │                                  │
                              ▼       ▼                                  ▼
                        openloomi-memory  (single source of truth:
                                           people, projects, insights,
                                           entities, RAG, temporal)
```

**Execute-layer pick order** (configurable; default shown):

1. **openloomi native agent API** (`POST http://127.0.0.1:3414/api/native/agent`) — `Authorization: Bearer $(cat ~/.openloomi/token | base64 -d)`. Default, no install. The same agentic endpoint the locomo benchmark uses; supports tool use, memory writes, multi-round reasoning, SSE streaming.
2. **Spawned CLI agent** (`claude -p` / `codex` / `aider` / custom, picked via `LOOP_AGENT_BIN`) — only when the runtime needs features the native agent API can't drive (e.g. a different provider, a custom local toolset, or a CLI already wired into the user's shell). Costs a binary install and per-tick spawn.
3. **In-session** — when the user is already inside a parent agent session (Claude Code, Cursor, etc.) and wants zero spawn cost. Uses the parent's tools directly. No API key or child process.

**Signal → Decision is a hard contract, not a suggestion.** Every signal that survives the hard-rule filters in step 5 must be turned into a queued decision (step 6) before the tick returns. If `classify()` cannot map a signal to a known decision type, the tick queues a `{type: "unknown"}` decision with `reason: "no_matching_action"` rather than dropping it silently — so a signal either becomes an actionable decision or becomes a visible queue item the user can act on. No raw signals linger past a tick.

### Data flow per tick (agentic)

1. **Pull** — Claude fetches fresh data through **whichever Composio surface is available**. The default is the **Composio MCP** (`mcp__composio__COMPOSIO_MANAGE_CONNECTIONS` + `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` in parallel for each connected toolkit). If MCP isn't loaded, Claude falls back to the **`composio-cli` skill** (`Skill composio-cli` to discover and execute tools), or shells out to the **`composio` CLI** directly (`Bash(composio …)`). All three surfaces are equivalent — pick whichever the runtime supports.
   For **gmail** and **slack**, if no Composio surface is connected for that channel, the tick falls back to
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
6. **Convert signal → decision** — Every survivor **must** be converted into a typed decision. Survivors get a typed action: `rsvp`, `draft_reply`, `review_pr`, `todo`, `slack_reply`, … A signal that cannot be classified is **not** silently dropped — it is queued as `{type: "unknown", reason: "no_matching_action"}` so the human can decide, or the classifier / tick prompt can be extended. The Loop never holds a raw signal in memory that hasn't been turned into a queued decision.
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
| `schedule [--interval N] [--watch-interval N]` | Loop: call the agent runtime with `loop tick --compact` every N seconds **and** watch for new decisions (desktop notifications). The tick and watch run on **independent timers** — a hung tick never blocks notifications. Tick is hard-killed after `LOOP_AGENT_TIMEOUT_MS` (default 15 min). Writes its own PID for stop. |
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
| `run <id> [--dry]` | Hand the built prompt to the configured agent runtime (`openloomi AI API` by default; spawned CLI agent fallback). |
| `dismiss <id> [--reason ...]` | Mark as dismissed. |
| `inject <file\|->` | Drop a signal JSON into `data/inbox/`. |
| `memory <subcommand> [args...]` | Delegate to the **openloomi-memory** CLI: `search-all`, `search-memory`, `list-insights`, `add-memory`, `add-insight`, etc. |
| `config [get\|set k v]` | Read/edit config. |
| `logs [-n N]` | Tail the loop log. |
| `serve` | REPL: `list`, `run <id>`, `dismiss <id>`, `analyze`, `status`, `quit`. |
| `web [--port N] [--no-open]` | Start HTTP server with REST API + Ink & Circuit style UI at `http://127.0.0.1:N/`. Auto-opens browser. CLI default port **3614** — **collides with the openloomi desktop app**, which binds 3614. When the app is running, use `--port 3614` (or any other free port), or run via `$SKILL_DIR/loop-ctl.sh start` which defaults to 3614 to avoid the clash. |

### Notification channels

Every fired notification is written to three places:

1. **`data/notifications.log`** — append-only log of all notifications
2. **macOS desktop notification** — via `osascript` (no extra deps); auto-suppressed on other platforms
3. **Webhook** — Slack-compatible JSON POST, if `LOOP_NOTIFY_WEBHOOK` env var is set or `--webhook` is passed to `notify`

The watcher maintains `data/notifications.seen.json` to ensure each decision fires exactly once.

All commands operate on `$SKILL_DIR/data/` for the signal/decision store. Memory is delegated entirely to openloomi-memory.

---

## Web UI — `loop web`

`loop web` (or `node scripts/loop-web.cjs <port>`) starts an HTTP server (override with `--port N` or `LOOP_WEB_PORT`). The CLI default is **3614**, but the **openloomi desktop app also binds 3614** — if both run on the same machine, the second one to start will fail with `EADDRINUSE`. The bundled `$SKILL_DIR/loop-ctl.sh start` defaults to **3614** to sidestep the conflict. Auto-opens the default browser.

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
- Action buttons: **▶ RUN** (hands prompt to agent runtime), **DRY RUN** (shows full prompt), **✓ MARK DONE**, **✕ DISMISS**

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
POST /api/run/:id[?dry=1]      hand prompt to agent runtime (or return prompt if dry=1)
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

## Running a Decision → Agent Runtime

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

…then hands that prompt to **whichever agent runtime is configured**. There are three interchangeable surfaces — pick based on what you have installed and where the loop is running:

### Surface A — openloomi native agent API (default, **no install required**)

The Loop's default execution surface is the **native agent API** served by the same openloomi desktop app / local server that the locomo benchmark hits: `POST http://127.0.0.1:3414/api/native/agent` (cloud override: `https://app.alloomi.ai/api/native/agent`). It accepts a prompt, drives the underlying model with tool use + memory reads/writes + multi-round reasoning, and streams the answer back as Server-Sent Events.

Authentication uses the same JWT the desktop app stores locally:

```bash
TOKEN=$(cat ~/.openloomi/token | base64 -d)
PROMPT='You are executing an openloomi Loop decision …'
curl -sNX POST http://127.0.0.1:3414/api/native/agent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$PROMPT" '{prompt: $p, provider: "claude"}')"
```

Response is an **SSE stream**, one `data: {…}` event per line. Loop the response, pick the events you care about:

| Event `type` | Meaning |
|---|---|
| `session` | First event — carries `sessionId` and `messageId`. Save it for tracing. |
| `reasoning` | Model's chain-of-thought / scratchpad (optional, can be filtered out). |
| `text` | The model's user-visible reply (`content` is the chunk). Concatenate all `text` chunks. |
| `tool_use` | Model invoked a tool (the agent API drives tool calls server-side, you don't have to handle them). |
| `tool_result` | Tool returned. Loop can ignore — the agent API chains it back into the model. |
| `done` | Final event — model finished, stream complete. |

A minimal parser that just collects the user-visible answer:

```js
const lines = responseText.split('\n');
let answer = '';
for (const line of lines) {
  if (!line.startsWith('data:')) continue;
  const raw = line.slice(5).trim();
  if (!raw || raw === '[DONE]') continue;
  const evt = JSON.parse(raw);
  if (evt.type === 'text' && evt.content) answer += evt.content;
}
```

**Why this is the default:** zero install, identical auth to the desktop app, true agentic behavior (tools + memory + multi-round), SSE streaming, works inside any sandbox, runs from cron / CI without extra config. The Loop's `run <id>` defaults to this surface and uses the same provider/model the rest of openloomi picks.

**Limitations:** the model and tool policy are server-side; you don't get to swap them mid-request. If you need a different provider (Anthropic direct, OpenAI, Gemini), use Surface B with a spawned CLI agent that already speaks that provider's API.

### Surface B — Spawned CLI agent (configurable via `LOOP_AGENT_BIN`)

When a decision genuinely needs a stateful, tool-using agent — long-running shell sessions, persistent file edits, multi-round MCP — the Loop can shell out to any CLI that accepts a prompt on stdin / `-p`:

```bash
LOOP_AGENT_BIN=claude   node $SKILL_DIR/scripts/openloomi-loop.cjs run dec_abc   # default
LOOP_AGENT_BIN=codex    node $SKILL_DIR/scripts/openloomi-loop.cjs run dec_abc   # OpenAI Codex
LOOP_AGENT_BIN=aider    node $SKILL_DIR/scripts/openloomi-loop.cjs run dec_abc   # Aider
LOOP_AGENT_BIN=/opt/my-agent/bin/mybot  node …/run dec_abc                       # any custom binary
```

The spawned binary's stdio is inherited so you see its output directly. On exit, the decision is moved to `done` (exit 0) or `dismissed` (non-zero). Memory writeback happens inside the spawned agent itself via openloomi-memory.

This surface costs a binary install and per-tick spawn overhead. Use it only when Surface A can't drive the decision (e.g. the action requires terminal commands the API doesn't expose).

### Surface C — In-session (the parent does the work)

When `run <id>` is invoked from inside an agent session that already has tools loaded (Claude Code, Cursor, etc.), the cleanest path is to **not spawn anything** — read the built prompt with `--dry`, then have the parent session call the tools itself. See the **Recommended pattern (no bypass needed)** section below.

This surface has no install requirement, no API key, and no spawn cost — the user is already paying for the parent's context.

### Choosing a runtime

| Concern | Pick |
|---|---|
| No agent CLI installed; user only has openloomi | **Surface A (openloomi AI API)** |
| Decision needs terminal / shell / file-system access | Surface B (spawned agent with shell tools) |
| Decision needs persistent multi-round MCP tool use | Surface B (spawned Claude/codex/aider) |
| User is already inside Claude Code / Cursor / another agent | Surface C (in-session) |
| Running headless (cron, CI, container) with no agent installed | Surface A (openloomi AI API) |
| Need full transparency / want to see the agent "think" | Surface B with `--verbose` |
| Need to handle destructive actions safely (extra confirm gate) | Surface A (cleanest for a single confirmation round) |

On exit, the decision moves to `done` or `dismissed`. Any memory writeback happens in whatever runtime handled the call — for Surface A, the Loop itself POSTs back to openloomi-memory after the AI returns; for Surface B/C, the runtime does the writeback.

Use `run <id> --dry` to print the prompt without invoking any runtime.

### ⚠️ Known issue: Surface B (spawned agent) refuses to nest

When the Loop is being driven from inside another agent session that uses the **same** `LOOP_AGENT_BIN` (e.g. the user invokes `loop run <id>` from inside Claude Code, or the Web UI's **▶ RUN** button is clicked while Claude Code is the parent), Surface B aborts with the agent's own nested-session error. For Claude Code that looks like:

```
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

Two caveats even with the bypass:

1. **Do NOT bypass blindly.** If the inner agent exits, errors, or hangs, it can corrupt the parent's stdio / shared resources. The CLI's own check is correct.
2. **Failed spawn is recorded against the decision.** The loop marks the decision as `dismissed` with `result=null` and increments the failure counter (`failed (1/null)` in the run log), even though no action was actually attempted.

**Recommended pattern (no bypass needed):**

Switch surfaces instead of bypassing. If you're already inside an agent session, you don't need Surface B at all — use Surface C (in-session) or Surface A (openloomi AI API) instead.

1. `loop run <id> --dry` → read the built prompt and the suggested `action.kind` / `action.params`.
2. Take the action **in the parent agent session itself** (Surface C), by calling Composio via whichever surface is loaded. Pick one — don't try all three:

   | `action.kind` | MCP call (if loaded) | `composio-cli` Skill (if no MCP) | `composio` CLI (if neither) |
   |---|---|---|---|
   | `calendar_rsvp` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` → `GOOGLECALENDAR_PATCH_EVENT` (`event_id`, `calendar_id="primary"`, `rsvp_response="accepted\|declined\|tentative"`, `send_updates="none"` to skip attendee spam) | `Skill composio-cli` → "execute GOOGLECALENDAR_PATCH_EVENT on googlecalendar with …" | `Bash(composio googlecalendar patch_event --json '{…}')` |
   | `email_reply` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` → `GMAIL_SEND_EMAIL` (or `GMAIL_CREATE_DRAFT` for review-first) | `Skill composio-cli` → "execute GMAIL_SEND_EMAIL on gmail with …" | `Bash(composio gmail send_email --json '{…}')` |
   | `github_review` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` → `GITHUB_CREATE_REVIEW` / `GITHUB_ADD_REVIEW_COMMENT` | `Skill composio-cli` → "execute GITHUB_CREATE_REVIEW on github with …" | `Bash(composio github create_review --json '{…}')` |
   | `slack_reply` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` → `SLACK_SEND_MESSAGE` (`channel`, `text`, `thread_ts`) | `Skill composio-cli` → "execute SLACK_SEND_MESSAGE on slack with …" | `Bash(composio slack send_message --json '{…}')` |
   | `todo` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` → `GITHUB_UPDATE_ISSUE` (assign / label) | `Skill composio-cli` → "execute GITHUB_UPDATE_ISSUE on github with …" | `Bash(composio github update_issue --json '{…}')` |

   Tag the result with `via: '<mcp|skill|cli>_in_session_api_call'` so the decision log captures which surface executed it.

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

**When forcing Surface B IS acceptable:** only when the parent agent session is throwaway (e.g. a `claude -p "…"` one-shot from a shell, or a CI job that doesn't need the parent anymore). Not acceptable from inside an interactive Claude Code session that the user wants to keep.

---

## Sources

The Loop accepts signals from **four surfaces** — three Composio-shaped (pick whichever the runtime supports) plus a manual drop folder. They're tried in priority order and produce the same signal envelope, so downstream code is identical.

| # | Source | What it pulls | When enabled | Transport |
|---|---|---|---|---|
| 1 | **Composio MCP** | `mcp__composio__COMPOSIO_MANAGE_CONNECTIONS` lists registered toolkits; `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` calls them in parallel. Pulls connected toolkits: gmail, googlecalendar, github, slack, etc. | Whenever the user has connected toolkits via Composio **and** the MCP server is loaded in this Claude Code session. | Structured args, no shell — fastest. |
| 2 | **Composio Skill** (`composio-cli`) | Claude invokes `Skill composio-cli …` to discover tools, connect accounts, and execute actions. Same toolkit coverage as MCP. | When MCP isn't loaded but the `composio-cli` skill is installed in the Claude Code session. | Skill-mediated — loads schemas on demand. |
| 3 | **Composio CLI** | `Bash(composio <toolkit> <action> --json …)` shells out to the installed `composio` binary. Same toolkit coverage. | Headless contexts (cron, Surface A scheduled runs, CI, container) where neither MCP nor the skill is available. Most portable. | Subprocess spawn + JSON parse per call. |
| 4 | **openloomi-memory insights** (`list-insights`) | Pre-extracted summaries for channels synced by `openloomi-connectors` (gmail, slack, telegram, whatsapp, etc.). Synthesized into signal-shape payloads; the existing classifier handles gmail/slack and drops everything else. | Always on. Kicks in only when no Composio surface is connected for that channel. | File-backed — no external auth needed. |
| 5 | **Obsidian vault** (`OBSIDIAN_VAULT` env) | Recursively scans a local Obsidian vault for `.md` files whose `mtime` changed since the last tick. Emits one `obsidian_note_changed` signal per changed file (capped at `OBSIDIAN_VAULT_CAP`, default 50). | When `OBSIDIAN_VAULT` is set. Tauri / desktop reads the path directly; browser web view reads from a `FileSystemDirectoryHandle` persisted in IndexedDB. | Filesystem — desktop: `@tauri-apps/plugin-fs`; web: File System Access API; headless: `node:fs`. |
| — | **openloomi-memory** (`mcp__*` or CLI) | Memory reads/writes for enrichment. | Always — required for proper context. | Skill / CLI. |
| — | **data/inbox/*.json** | Manual drop folder (or any non-Composio bridge script). | Default `enableSources.file: true`. | Filesystem. |

The Loop tries sources in the order **1 → 2 → 3 → 4** for each requested channel and uses the first one that returns data. This means: if MCP works, it always wins; if MCP is missing, `composio-cli` Skill picks up; if both are missing (e.g. cron), `composio` CLI runs; if no Composio surface is connected at all, the openloomi-memory insights fallback kicks in.

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
| `LOOP_AGENT_RUNTIME` | `api` | Which Execute surface to use. `api` = Surface A (openloomi AI API). `cli` = Surface B (spawned CLI agent from `LOOP_AGENT_BIN`). `auto` = Surface A if reachable, else Surface B. |
| `LOOP_AGENT_BIN` | `claude` | Binary invoked for Surface B (`schedule`, `run`, `tick`). Any CLI that accepts a prompt on `-p` works — `claude`, `codex`, `aider`, custom. |
| `LOOP_AGENT_TIMEOUT_MS` | `900000` (15 min) | Hard timeout for one Surface B child. On timeout: SIGTERM → 5s grace → SIGKILL. Prevents a hung tick from blocking notifications. |
| `LOOP_AGENT_SAFE_PERMISSIONS` | _(unset)_ | Set to `1` to **opt out** of `--dangerously-skip-permissions` for the spawned Claude child. Default adds it so the tick can call `mcp__composio__*` and the openloomi CLIs without per-call prompts. Ticks are read/derive only — no email sends, no RSVPs, no dismisses — so the flag is safe. Ignored on non-Claude agents. |
| `LOOP_NATIVE_AGENT_URL` | `http://127.0.0.1:3414` | Base URL for Surface A (openloomi native agent API). Loop appends `/api/native/agent`. Override to `https://app.alloomi.ai` for cloud. |
| `LOOP_NATIVE_AGENT_PROVIDER` | `claude` | `provider` field sent in the Surface A request body. The server picks the matching model + auth. |
| `LOOP_NATIVE_AGENT_TIMEOUT_MS` | `2400000` (40 min) | HTTP timeout for one Surface A request. The native agent is multi-round; 40 min mirrors the locomo benchmark default so long tool-use chains don't get cut off. Drop to 60–120 s if you want fail-fast on stuck decisions. |
| `LOOP_OPENLOOMI_TOKEN` | `~/.openloomi/token` | Path to the base64-encoded JWT used to authenticate Surface A. Override only for testing / multi-account setups. The desktop app writes this on login; the Loop reads it on each request. |
| `LOOP_WEB_PORT` | 3614 | Default port for `loop web`. CLI / `LOOP_WEB_PORT` defaults to 3614, which **conflicts with the openloomi desktop app's** Next.js server on the same port. `loop-ctl.sh` defaults to 3614 to avoid that clash; override per-call with `--port N` or this env var. |
| `LOOP_NOTIFY_WEBHOOK` | _(unset)_ | If set, every notification also POSTs a Slack-compatible JSON payload to this URL. |
| `OBSIDIAN_VAULT` | _(unset)_ | Absolute path to the user's local Obsidian vault. When set, each tick scans the vault for `.md` files whose `mtime` changed since the last scan and emits one `obsidian_note_changed` signal per change into `data/signals.jsonl`. The Tauri desktop app reads the path directly; the browser web view uses a `FileSystemDirectoryHandle` persisted in IndexedDB (picked via **Settings → Obsidian vault**). Skip the step entirely by leaving this unset. |
| `OBSIDIAN_VAULT_EXT` | `.md` | Comma-separated extensions the scanner treats as Obsidian notes. Change to `.md,.markdown` if you also keep raw `.markdown` files. |
| `OBSIDIAN_VAULT_CAP` | `50` | Max `obsidian_note_changed` signals per tick. Beyond this the scanner emits a single `obsidian_scan_overflow` signal and drops the rest. Prevents a fresh clone of the vault from swamping the queue. |
| `OBSIDIAN_VAULT_RECURSIVE` | `1` | Set to `0` to scan only the vault root (skip subdirectories). Default recurses while skipping hidden and `node_modules` directories. |

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
# Foreground loop (Ctrl+C to stop). Defaults to Surface A (openloomi native agent API).
loop schedule --interval 600          # tick every 10 minutes

# Or one-shot via launchd / cron, every 10 min — Surface A, no agent install needed:
*/10 * * * * /usr/local/bin/node $SKILL_DIR/scripts/openloomi-loop.cjs tick --json \
  | xargs -I{} curl -sNX POST $LOOP_NATIVE_AGENT_URL/api/native/agent \
      -H "Authorization: Bearer $(cat ~/.openloomi/token | base64 -d)" \
      -H "Content-Type: application/json" -d '{}'

# Or, if you have the `claude` CLI installed and want Surface B:
LOOP_AGENT_RUNTIME=cli LOOP_AGENT_BIN=claude loop schedule --interval 600
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
3. Extend the tick prompt in `loop-tick.cjs` to teach Claude how to fetch from the new toolkit via the available Composio surface (MCP → `composio-cli` skill → `composio` CLI → openloomi-memory insights fallback, in that order).

---

## Extending Signals, Decisions, and Actions

The Loop has three independent extension axes. You can add any one of them without touching the other two — but a new signal usually needs **all three** wired up before it can reach a user-actionable button.

### Mental model

```
   raw event (Gmail / Calendar / GitHub / your-own-bridge)
        │
        ▼  normalize
   ┌─────────┐
   │ signal  │   ← what the world said
   └────┬────┘
        │   classifier (loop-lib.cjs → classify())
        ▼   hard contract: every survivor becomes a decision
   ┌──────────┐
   │ decision │   ← what we should do
   └────┬─────┘
        │   executor (run <id> → buildPrompt() → agent runtime: API | CLI | in-session)
        ▼   action.kind tells the executor which Composio tool to call
   ┌────────┐
   │ action │   ← what we actually did
   └────────┘
```

- **Signal** = a normalized JSON envelope on `data/signals.jsonl`. Source-agnostic.
- **Decision** = `{ type, title, action: { kind, params }, memory_refs, confidence, ... }` queued in `data/decisions.json`. Always derived from a signal.
- **Action** = `{ kind, params }` — the typed instruction the executor runs. Decoupled from the decision `type` (one decision type can map to several actions over time).

### 1. Add a new signal source (channel)

A "signal source" is any path that emits a normalized JSON envelope into `data/signals.jsonl` (or `data/inbox/*.json`). Four concrete paths — three are Composio surfaces (pick whichever the runtime supports), plus a manual escape hatch:

| Path | Surface | Where to wire it |
|---|---|---|
| **Composio MCP** | `mcp__composio__*` tools (Claude Code MCP client) | Teach the agentic tick prompt in `loop-tick.cjs` to call `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` for the new toolkit, and synthesize the result into the signal shape below. |
| **Composio Skill** | `composio-cli` skill (Claude invokes `Skill composio-cli …`) | Same destination — different transport. The tick prompt should treat `Skill composio-cli <action>` as equivalent to the MCP `COMPOSIO_MULTI_EXECUTE_TOOL` call. Use this when the MCP server isn't loaded but the `composio-cli` skill is installed. |
| **Composio CLI** | `composio` binary in `$PATH` | The tick prompt runs `Bash(composio <toolkit> <action> --json …)` and parses stdout. Useful when neither MCP nor the skill is available — e.g. headless CI, Surface A scheduled cron runs, or a stripped-down container. |
| **openloomi-memory insights** | `list-insights` CLI | No code change needed — `list-insights --channel=<name> --days=N` is already a fallback. Just make sure the channel is synced via `openloomi-connectors`. The fallback synthesizer in `loop-tick.cjs` will map insights to `<channel>_message` signals automatically. |
| **Manual / bridge script** | file drop or `loop inject -` | Drop a `.json` file into `data/inbox/` (or `loop inject -` on stdin). Anything that writes to `data/signals.jsonl` directly is also fine — dedupe keys (`messageId` / `eventId` / `ts` / `_insightId`) prevent double-insert. |

**Choosing between the three Composio surfaces**

All three return the same Composio tool result — they differ only in transport:

| Surface | Best when… | Cost / latency |
|---|---|---|
| MCP (`mcp__composio__*`) | MCP server is loaded in the current Claude Code session. Fastest (no shell, structured args). | One MCP handshake per session. |
| `composio-cli` Skill | MCP server is **not** loaded but the skill is installed. Useful for portable / project-local setups. | Slightly slower — skill loads schemas on demand. |
| `composio` CLI | Headless contexts (cron, Surface A scheduled runs, CI), no MCP server, no skill installed. Most portable. | Slowest — subprocess spawn + JSON parse per call. Prefer parallel batches. |

The tick prompt should try them in this order: **MCP → `composio-cli` skill → `composio` CLI → `openloomi-memory` insights fallback**, stopping at the first that returns data. Don't try all four blindly — pick the highest-fidelity one available.

**Required envelope shape** — every signal must have at minimum:

```jsonc
{
  "source":  "gmail",                       // channel id (free-form, used for log grouping)
  "type":    "email",                       // semantic type the classifier branches on
  "payload": { "from": "...", "subject": "..." /* channel-specific */ },
  "ts":      "2026-06-30T08:00:00Z",        // ISO timestamp, used for ordering + dedupe
  "messageId": "gmail:abc123",              // dedupe key (or eventId / ts)
  "_origin": "composio"                     // "composio" | "insights" | "inbox" (optional)
}
```

Conventions:
- `source` is the **channel** (toolkit / provider). `type` is the **semantic kind** within that channel. A new source can reuse an existing `type` (e.g. a `trello` source with `type: "trello_message"`); the classifier only branches on `type`.
- If a dedupe key isn't natural (RSS, scrape, manual drop), set `_insightId` to a stable hash of the payload — the dedupe code accepts it as a fallback.
- The hard-rule filters in `loop-lib.cjs → isHardSkipped()` are currently Gmail-flavored. New channels should extend that function (or run their own pre-filter before appending) so `noreply@*` / `mailer-daemon` / etc. are skipped at the signal level, not the decision level.

### Obsidian vault (optional)

When `OBSIDIAN_VAULT` is set, each tick runs `scripts/obsidian-scan.cjs` as a fifth signal source (after the Composio path runs, before classify). The scanner:

1. Recursively walks the vault (Tauri: `@tauri-apps/plugin-fs readDir` + `stat`; browser: `FileSystemDirectoryHandle.entries()`; headless: `node:fs`) and filters to the configured extensions (default `.md`).
2. Diffs each entry's `mtimeMs` against `data/obsidian.state.json`. The state file is rewritten every tick with the new mtime map so the next tick only emits signals for files that actually changed.
3. For each change, appends one NDJSON line to `data/signals.jsonl` with `source: "obsidian"`, `type: "obsidian_note_changed"`, and `payload: { path, mtime_ms, size, vault }`. The path is slash-normalized and relative to the vault root (e.g. `ideas/onboarding_redesign.md`), so memory lookups by path are portable.
4. Caps per-tick emissions at `OBSIDIAN_VAULT_CAP` (default 50) and emits a single `obsidian_scan_overflow` signal with the dropped count if exceeded — protects the queue from a fresh clone of a large vault.

The vault itself is **not a Composio toolkit** — it's a local filesystem adapter, which is what makes the multi-source "product-research iteration" scenario (Linear + GitHub + Obsidian) possible without adding another cloud dependency. On Tauri the path is read directly (no extra permissions beyond the app's existing scope). On the browser, the user picks the directory once via **Settings → Obsidian vault**; the resulting `FileSystemDirectoryHandle` is persisted in IndexedDB so the next tick reads without re-prompting. Safari and Firefox do not currently grant persistent directory access — the scanner silently skips in those browsers, the rest of the tick is unaffected.

The classifier maps each `obsidian_note_changed` signal to a typed decision based on its path prefix:

| Path prefix | Decision type |
|---|---|
| `projects/`, `plans/` | `release_plan` |
| `people/` | `todo` (action `contact_update`) |
| `customers/` | `requirement_synthesis` |
| `ideas/`, `drafts/`, (other) | `doc_update` |

The enrich step then reads up to ~2 KB of each changed note via the same `PlatformFileSystem.readFile` interface and indexes it into `openloomi-memory` keyed by path — so future `linear_review` / `requirement_synthesis` cards can look up `people/sarah_chen.md`, `projects/q2_roadmap.md`, `ideas/onboarding_redesign.md` by path to fold the same evidence into typed decisions.

### 2. Add a new decision type

A decision type is the user-facing label ("review a PR", "RSVP to a meeting"). Adding one has three touch points:

**(a) The classifier branch** — `scripts/loop-lib.cjs → classify(signal)` must return an object of this shape:

```js
{
  type:   '<decision_type>',       // NEW — e.g. 'merge_pr', 'archive_email'
  title:  'Human-readable line',   // shown in inbox, web UI cards, notifications
  action: { kind: '<action_kind>', params: { ... } },   // see §3
  memory_refs: [ /* optional, populated by the agentic tick */ ],
  confidence: 0.85 | 0.60,
}
```

Returning `null` from `classify()` means "I don't know what to do with this signal" — the tick should fall back to queuing a `{ type: 'unknown', reason: 'no_matching_action' }` decision so the human sees it. Returning nothing / throwing breaks the signal → decision contract and must be avoided.

**(b) The decision type table** — update these so the new type renders and gets dispatched correctly:

| File | What to add |
|---|---|
| `scripts/loop-lib.cjs` | A `case '<your_type>':` branch in `classify()` (or guard in the relevant signal-type branch). |
| `SKILL.md` (this file) | A row in the **Decision Types** table (Type / Trigger / Action columns). |
| `scripts/loop-web.cjs` (UI) | A hex color in `TC`, a label in `TL`, and a `.t-<type>` CSS class — see the **Design system — Ink & Circuit** section. The 5 default colors are amber / green / blue / purple / red; pick a new one and document the mapping. |
| `scripts/loop-tick.cjs` | If the new type needs different enrichment logic (e.g. look up labels, not people), extend the tick prompt that teaches Claude how to enrich this type. |

**(c) The hard contract reminder** — per §"Data flow per tick", every signal that survives hard filters must produce a decision. So when you add a classifier branch, you also implicitly accept responsibility for handling all the signals that match it. If your branch covers 90% and silently drops 10%, fix the branch — don't add a "skip silently" path.

### 3. Add a new action kind

An action kind is the **executable verb** the run prompt tells Claude to perform. It is intentionally decoupled from the decision type: one decision type can dispatch to multiple action kinds over its lifetime, and one action kind can be triggered by several decision types.

**Where action kinds live:**

| Layer | What it does | Where to edit |
|---|---|---|
| **Decision envelope** | Carries `{ action: { kind, params } }` so the executor knows what to run. | Set in `classify()` (or by the agentic tick via `ingest-decision`). |
| **Executor prompt** | `scripts/openloomi-loop.cjs → buildPrompt(dec)` embeds `kind` / `params` into the prompt that gets sent to the agent runtime (openloomi AI API by default; spawned CLI agent via `LOOP_AGENT_BIN`; in-session when called from a parent agent). | The default prompt already reads `dec.action.kind` and `dec.action.params` and instructs the runtime to dispatch. Custom per-kind prompts go here. |
| **In-session fallback** | The "Recommended pattern (no bypass needed)" section describes how to handle a decision in the parent Claude session: call Composio via whichever surface is loaded (`mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL`, `Skill composio-cli …`, or `Bash(composio …)`) with the right tool slug and arguments, then mark the decision `done` manually. | No code change needed — just document the Composio tool slug + required params in this file so the executor (whether spawned or in-session) knows what to call. |

**To add a new action kind**, do this:

1. **Define the verb.** Choose a `kind` string (snake_case, stable — changing it is a breaking change for existing queued decisions). Document it in a new row below.
2. **Define the params.** What does the executor need? `eventId` for an RSVP, `repo` + `number` for a PR review, etc. Keep params JSON-serializable and Composio-call-shaped. Anything the executor can't reduce to a tool call belongs in the decision's `context`, not in `params`.
3. **Wire it into the run prompt.** Either:
   - Rely on the default `buildPrompt()` output (it already says "take the action the action calls for") if the kind maps 1:1 to a Composio tool, **or**
   - Add a per-kind prompt section in `buildPrompt()` if the kind needs special handling (multi-step, confirmation gates, side effects to record). The prompt should instruct the executor to try **MCP → `composio-cli` skill → `composio` CLI** in that order, same as Pull.
4. **Document the executor path.** Add a row to the table below so both humans and future-Claude know which Composio tool slug handles this kind, across all three surfaces.

#### Current action kinds

| `action.kind` | Composio tool slug | MCP call | `composio-cli` Skill call | `composio` CLI call | Agent runtime dispatch (any of 3 surfaces) |
|---|---|---|---|---|---|
| `calendar_rsvp` | `GOOGLECALENDAR_PATCH_EVENT` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL({ tool_slug, arguments: { event_id, calendar_id: "primary", rsvp_response, send_updates } })` | `Skill composio-cli` → "execute GOOGLECALENDAR_PATCH_EVENT on googlecalendar with …" | `Bash(composio googlecalendar patch_event --json '{…}')` | The runtime reads `params.eventId`, decides accept/decline, calls via whichever surface is loaded. Works on **Surface A** (one HTTP roundtrip), **Surface B** (spawned agent uses the same call), **Surface C** (parent session calls directly). |
| `email_reply` | `GMAIL_SEND_EMAIL` / `GMAIL_CREATE_DRAFT` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL({ tool_slug, arguments: { to, subject, body, threadId } })` | `Skill composio-cli` → "execute GMAIL_SEND_EMAIL on gmail with …" | `Bash(composio gmail send_email --json '{…}')` | Runtime drafts via `params.to` / `params.subject` / `params.threadId`. Surface A may return the draft text in the AI response and let the Loop POST the actual send to keep destructive sends behind a separate confirm. |
| `github_review` | `GITHUB_CREATE_REVIEW` / `GITHUB_ADD_REVIEW_COMMENT` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL({ tool_slug, arguments: { repo, number, body, event } })` | `Skill composio-cli` → "execute GITHUB_CREATE_REVIEW on github with …" | `Bash(composio github create_review --json '{…}')` | Runtime reads `params.repo` / `params.number`. Surface A returns the review body; the Loop (or the runtime) posts it via Composio. |
| `slack_reply` | `SLACK_SEND_MESSAGE` | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL({ tool_slug, arguments: { channel, text, thread_ts } })` | `Skill composio-cli` → "execute SLACK_SEND_MESSAGE on slack with …" | `Bash(composio slack send_message --json '{…}')` | Runtime uses `params.channel` / `params.ts`. |
| `todo` | `GITHUB_UPDATE_ISSUE` (assign / label) **or** local task tracker | `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL({ tool_slug, arguments: { repo, number, state, labels } })` | `Skill composio-cli` → "execute GITHUB_UPDATE_ISSUE on github with …" | `Bash(composio github update_issue --json '{…}')` | Runtime records against `params.title` / `params.repo` / `params.number`. |

#### Adding a new kind — checklist

- [ ] `kind` is snake_case and irreversible (treat it as an API).
- [ ] `params` is a flat JSON object — no functions, no Buffers, no callbacks.
- [ ] Composio tool slug (or in-session API call) is documented in the table above.
- [ ] If the kind is destructive (sends, deletes, transfers money), the run prompt **must** explicitly instruct Claude to STOP and confirm with the user. The default prompt already does this; don't bypass it.
- [ ] The decision can still be `done` / `dismissed` normally — no new status required.
- [ ] `loop run <id> --dry` shows a sensible prompt for the new kind (verify by hand).

### 4. End-to-end extension recipe (worked example)

Suppose you want to add **Trello**: "when I'm @-mentioned on a Trello card, surface a `reply_trello` decision that opens the card and drafts a reply."

1. **Signal** — Trello isn't on Composio out of the box, so wire it as an `openloomi-connectors`-synced channel. That makes it appear in `openloomi-memory list-insights --channel=trello`. The tick's fallback synthesizer emits `{ source: 'trello', type: 'trello_message', payload: { cardId, mentionsMe, text, url } }`. Verify with `loop inject -` first.

2. **Decision type** — pick `type: 'reply_trello'`. Add a `case` in `loop-lib.cjs → classify()` keyed off `signal.type === 'trello_message' && p.mentionsMe`. Document the new type in the **Decision Types** table, add a hex color to the web UI's `TC` map, add a label to `TL`, and add a `.t-reply_trello` CSS class.

3. **Action kind** — pick `kind: 'trello_reply'` with `params: { cardId, url }`. Add a row to the **Current action kinds** table pointing at the Trello Composio tool slug (or REST call if not on Composio yet). The default `buildPrompt()` will pick it up; if the reply flow needs multi-step handling (fetch card → fetch comments → post reply), extend `buildPrompt()` with a per-kind section.

4. **Sanity check** — drop a fake signal:

   ```bash
   echo '{"source":"trello","type":"trello_message","ts":"2026-06-30T08:00:00Z","messageId":"t1","payload":{"cardId":"c1","mentionsMe":true,"text":"@timi thoughts?","url":"https://trello.com/c/c1"}}' \
     | loop inject -
   loop analyze
   loop inbox           # should show 1 reply_trello decision
   loop run <id> --dry  # should show a prompt that mentions trello_reply
   ```

5. **Iterate** — once green on `--dry`, flip the agentic tick (`loop schedule --interval 600`) and watch the new decisions flow in.

### Hard contracts (don't break these when extending)

1. **Every survivor signal → a queued decision.** `classify()` may return a typed decision, or the tick must queue a `{ type: 'unknown', reason: 'no_matching_action' }` decision. Never let a signal silently disappear.
2. **`action.kind` is an API.** Renaming a kind breaks every queued decision that referenced it. Add new kinds; don't repurpose old ones.
3. **`action.params` is JSON.** No closures, no live objects, no Date instances — the decision may be reloaded days later from disk.
4. **Destructive actions confirm.** If a new action kind sends, deletes, transfers, or charges, the spawned executor must ask before acting. The default prompt already does this; preserve the gate when adding per-kind prompt sections.
5. **Memory is openloomi-memory's job.** New signal sources that learn about new people / projects should `add-memory` / `add-insight` via the openloomi-memory CLI — don't write to `~/.openloomi/data/memory/` directly from the loop skill.

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
- **Composio MCP**: `mcp__composio__*` tools (preferred when loaded)
- **Composio Skill**: `composio-cli` skill (`Skill composio-cli …`, used when MCP server isn't loaded)
- **Composio CLI**: `composio` binary in `$PATH` (`Bash(composio …)`, used for headless / CI / scheduled runs)
- **openloomi native agent API** (default Execute surface): `POST http://127.0.0.1:3414/api/native/agent` — agentic endpoint (tool use, memory, multi-round, SSE streaming), request body `{prompt, provider}`, `Authorization: Bearer $(cat ~/.openloomi/token | base64 -d)`. Cloud: `https://app.alloomi.ai/api/native/agent`. Same endpoint the `benchmark/locomo` suite drives.
- **openloomi API docs**: see the `openloomi-api` skill (Native module `/api/native/*`, AI module `/api/ai/*`).
- openloomi-memory CLI: `node $SKILL_DIR/../openloomi-memory/scripts/openloomi-memory.cjs <subcommand>`
- Token: `~/.openloomi/token` (base64-encoded JWT)
