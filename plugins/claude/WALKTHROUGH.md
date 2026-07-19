# OpenLoomi × Claude Code — End-to-End Tour Guide

This is the canonical, end-to-end walkthrough for the OpenLoomi Claude Code
plugin. Every step is a single Claude Code turn or a single desktop-app
interaction; every screenshot is from a real run.

The full path: **install the plugin → land in a ready Claude Code session →
see the Loomi Pet pop on the desktop → flip the pet theme → call
`/openloomi:status` for the canonical JSON → opt into the Pet-mirror +
Stop-archive hooks → connect external apps via Composio → and finally watch
OpenLoomi's Loop surface decision cards in the desktop app** — all driven by
slash commands you typed in Claude Code.

If you only want the commands, the [README](./README.md) is enough. This
document is for when you want to see _what the system actually looks like_
in motion.

---

## 1. Ask Claude Code to install the plugin

```text
> Install the plugin and setup https://github.com/melandlabs/openloomi/tree/main/plugins/claude
```

![Step 1 — User asks Claude Code to install the plugin](../../apps/marketing/public/img/openloomi/plugins/claude/01-install-prompt.png)

## 2. Add the marketplace

```text
> /plugin marketplace add melandlabs/openloomi
```

Claude Code prompts for a source. Enter `melandlabs/openloomi` — it refreshes
the marketplace cache and you now see the `openloomi` plugin in the
marketplace list.

![Step 2 — Add the OpenLoomi marketplace](../../apps/marketing/public/img/openloomi/plugins/claude/02-add-marketplace.png)

## 3. Launch Claude Code pointing at the local plugin

For plugin contributors (or anyone running from a checkout):

```text
% claude --plugin-dir plugins/claude
```

The plugin is now loaded into the session; you can confirm by typing
`/openloomi:` and seeing the autocomplete.

![Step 3 — Launch with --plugin-dir so live edits to the plugin are picked up](../../apps/marketing/public/img/openloomi/plugins/claude/03-local-plugin-dir.png)

## 4. Discover the slash commands

Type `/openloomi:` — Claude Code surfaces the full namespace:

- `/openloomi:setup` — one-time install → launch → ready
- `/openloomi:status` — stable JSON status
- `/openloomi:pet` — set the Loomi Pet state
- `/openloomi:help` — list all commands
- `/openloomi:hooks` — install / uninstall / inspect hooks
- `/openloomi:connect` — walk through composio + screen memory

![Step 4 — /openloomi: autocomplete lists every available command](../../apps/marketing/public/img/openloomi/plugins/claude/04-slash-commands.png)

## 5. Run `/openloomi:setup` — readiness table + fox Pet appears

The wizard auto-chains install → launch → wait API → guest login. When it
finishes, the bridge prints a small readiness table on the **left**, and the
Loomi Pet pops onto your desktop in the **fox** theme on the **right** with
a `Loomi is on watch` badge.

The pet is the file-watcher-driven widget — it doesn't talk to the bridge; it
watches `~/.openloomi/pet-config.json` and the `assets/{fox,capybara}/`
folders.

| Item               | Status     |
| ------------------ | ---------- |
| Guest login        | Successful |
| Runtime mode       | packaged   |
| Version            | 0.8.2      |
| Local API          | Reachable  |
| AI provider        | Configured |
| Execution provider | Ready      |
| Desktop process    | Running    |
| Final status       | **READY**  |

![Step 5 — Setup completes; readiness table is READY and the fox Pet appears on the desktop](../../apps/marketing/public/img/openloomi/plugins/claude/05-setup-ready-and-fox-pet.png)

## 6. Right-click the Pet to open the context menu

The pet's context menu exposes **Open Loomi / Settings / THEME (Fox ✓,
Capybara) / Quit**. The theme switch is hot-reload — the file watcher picks
up `activeTheme` in `pet-config.json` within ~250 ms, and the bridge never
writes these files.

![Step 6 — Right-click the Pet to open the context menu (Fox is currently active)](../../apps/marketing/public/img/openloomi/plugins/claude/06-pet-context-menu.png)

## 7. Pick **Capybara** — the theme hot-reloads immediately

The pet re-skins in place. Same 9-state vocabulary (`happy` / `idle` /
`juggling` / `needsinput` / `presenting` / `sleeping` / `sweeping` /
`thinking` / `working`) — only the artwork changes.

![Step 7 — Capybara theme is hot-reloaded in place; readiness table unchanged](../../apps/marketing/public/img/openloomi/plugins/claude/07-pet-capybara-theme.png)

### 7c. Drop in your own theme — `kawaii` cat via `pet-custom/`

The built-in themes are Fox and Capybara, but the pet watcher also
auto-discovers any folder under `~/.openloomi/pet-custom/<name>/` with
PNG state sprites. Drop a folder in, and the theme appears in the
right-click menu within ~250 ms — no bridge call, no restart. Below, a
`kawaii` cat pack is installed and active: the small sprite in the
top-left of the desktop app swaps to the kawaii cat, and the
inline chat pet (shown `thinking` with a thought bubble while a tool
call is in flight) renders from the same pack.

![Step 7c — Custom kawaii theme via ~/.openloomi/pet-custom/kawaii/; desktop sprite + inline chat pet both render from the pack](../../apps/marketing/public/img/openloomi/plugins/claude/07c-pet-kawaii-theme.png)

### 7b. Manually override the Pet state with `/openloomi:pet`

The hot-reload pet also accepts manual overrides from Claude Code. Type
`/openloomi:pet <state>` and the bridge writes the new state to
`~/.openloomi/pet/runtime_state.json`; the file watcher picks it up and the
sprite swaps within ~250 ms. Useful for "task done" beats where you want the
pet to flip to `happy` between turns.

![Step 7b — /openloomi:pet happy overrides the sprite; runtime state persisted to ~/.openloomi/pet/runtime_state.json](../../apps/marketing/public/img/openloomi/plugins/claude/07b-pet-command-happy.png)

## 8. `/openloomi:status` returns the canonical JSON

For any triage / bug report, paste the JSON output verbatim. The shape is
stable: `mode / installed / version / tokenPresent / aiProviderConfigured /
nativeRuntime / apiReachable / hooksInstalled / ready / nextAction / reason /
source`.

![Step 8 — /openloomi:status prints stable readiness JSON (fox pet is back on watch)](../../apps/marketing/public/img/openloomi/plugins/claude/08-status-json.png)

## 9. Opt into the Pet mirror + Stop archive

```text
> /openloomi:hooks
```

The command accepts `install | uninstall | status`. After install, the bridge
writes a marked block (`_openloomi_plugin`, keyed
`__openloomi_claude_plugin_hooks__`) into `~/.claude/settings.json` —
merge-no-overwrite, atomic, idempotent.

![Step 9 — /openloomi:hooks walks you through install / uninstall / status](../../apps/marketing/public/img/openloomi/plugins/claude/09-hooks-command.png)

## 10. Hooks status — confirm install

```text
> /openloomi:hooks status
```

You should see:

- `installed: true`
- Settings path: `~/.claude/settings.json`
- Marker: `_openloomi_plugin`
- Schema: `per-event`
- Legacy block key: `__openloomi_claude_plugin_hooks__`

The Stop hook now reads your session transcript (last 6 turns, ≤6 KB) and
POSTs a `note` to `/api/insights` under the `claude-code` group. It always
exits 0.

![Step 10 — Hooks report shows installed: true, marker and schema confirmed](../../apps/marketing/public/img/openloomi/plugins/claude/10-hooks-status.png)

## 11. `/openloomi:connect` — three independent y/N choices

The wizard walks you through three independent questions: install the
`composio` skill, enable Screen Memory (`Preferences → Chronicle → Screen
Memory` in the desktop app), and connect a messaging connector
(`openloomi-connectors` skill — native 7 platforms; or composio for the
broader 1000+).

The screenshot below shows the connector step in the middle of the wizard.

![Step 11 — /openloomi:connect wizard — Step 3 "Connect a messaging connector"](../../apps/marketing/public/img/openloomi/plugins/claude/11-connect-wizard.png)

## 12. After Composio connects — 6 active apps

The next Claude Code turn can list what the user is actually wired up to. In
this run: Gmail, Google Calendar, Google Drive, GitHub, Linear, Slack — all
through Composio, with the workspace org and test user echoed back.

```text
Connected via Composio (6 active): Gmail, Google Calendar, Google Drive, GitHub, Linear, Slack
Org: timi_workspace · Test user: pg-test-…
```

From this point on, Claude Code is a thin UI on top of OpenLoomi. Anything
that happens in your connected apps — emails, PRs, calendar RSVPs, Linear
issues, Slack messages — gets pulled into OpenLoomi's memory and (if you opt
in) into its proactive Loop.

![Step 12 — After Composio connects, 6 active apps listed in Claude Code](../../apps/marketing/public/img/openloomi/plugins/claude/12-composio-connected.png)

## 13. `/openloomi:memory` — see what's already in your local memory

```text
> /openloomi:memory
```

The command searches the local memory + knowledge base + insights and returns
a digest of what OpenLoomi already knows. In this run, the digest includes:

- A **"From Loomi" callout** at the top: "Sarah's signature says 'Head of
  Product' — memory still says PM" — the same drift that the Loop is
  about to surface as a `CONTACT_UPDATE` card.
- A **"Last 7 days (50 insights total)" table** with columns `# / Time
(UTC) / Type / Importance / Title` — auto-captured Claude Code session
  snapshots, Screen Memory captures, and the occasional archive note.
- **Notes** at the bottom explaining the mix (e.g. "duplicated sessions —
  two ingestion channels writing the same session", "two oldest sessions
  reference loop tick / Loomi card / 继续切 decision — carry-over from
  prior work before today's `/openloomi:setup` finished wiring up").

This is the read-only doorway into OpenLoomi's local memory. For a deeper
search, pass a query: `/openloomi:memory <query>`.

![Step 13 — /openloomi:memory returns the recent-insights table + From Loomi callout](../../apps/marketing/public/img/openloomi/plugins/claude/13-openloomi-memory-output.png)

### 13b. Write to memory from Claude Code with `add-memory`

Reading is half the story — you can also write. From any Claude Code turn,
invoke `openloomi-memory add-memory "<text>" --file=<path>` and the entry
lands in `~/.openloomi/data/memory/<path>`. Below, "My boss is Tom." is saved
to `people/boss.md` and immediately searchable via `search-memory "boss"` or
`search-all "boss tom"`.

![Step 13b — openloomi-memory add-memory saves "My boss is Tom." to people/boss.md and is searchable right after](../../apps/marketing/public/img/openloomi/plugins/claude/13b-add-memory-boss-tom.png)

## 14. `/openloomi:loop` — see the Loop dashboard snapshot

```text
> /openloomi:loop
```

The command hits `GET /api/loop/state` and returns the Loop dashboard:

- **Header**: `enabled: true`, last tick timestamp.
- **Counts**: pending decisions, done, dismissed, signals seen (with
  unsupported count).
- **Connector health**: per-connector status (`needs_setup` /
  `local-only` / linked) for every platform the Loop can pull from.
- **Prefs in effect**: tick frequency, brief time, wrap time, quiet-when-
  empty, desktop notifications, promotion/no-reply skip, narrative mode.
- **Notes**: actionable observations — e.g. "all 5 Composio-backed
  connectors share one failure: the local Composio surface isn't
  reachable. Loop can't pull signals or generate decisions from
  Gmail/Calendar/GitHub/Slack/Linear until `/openloomi:connect` walks the
  Composio install."

This is purely a dashboard snapshot — the Loop never takes destructive
actions from this command. For actions, the Loop pops cards in the
desktop app (see step 15) and you decide there.

![Step 14 — /openloomi:loop prints the dashboard: counts, connector health, prefs, notes](../../apps/marketing/public/img/openloomi/plugins/claude/14-openloomi-loop-dashboard.png)

## 15. The Loop surfaces decision cards in OpenLoomi Desktop

This is what the system looks like when it's actually doing its job.
OpenLoomi's **Loop** is the proactive execution brain — it watches your
connected signals, classifies them into one of the decision types, and pops
a card into the desktop app with the `From Loomi` reasoning trace and the
action buttons you can hit.

Each card has the same shape: a `Signal` + `Type` + `Received` + `Confidence`
row at the top, the `From Loomi` explanation next, the `Reason 1 / Reason 2`
evidence trace, and the action buttons at the bottom.

| Decision type           | What it does                                | Example                                                                                |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `RSVP`                  | Reply Yes / No to a calendar invitation     | "Reverb Q3 review — Wed 10:00 PT, organizer Sarah, conflicts with standup"             |
| `IM_REPLY`              | Draft a reply to a known contact            | "Alice is bumping the Q3 deck timeline — Thursday is close, she wants it locked today" |
| `EMAIL_REPLY`           | Pre-draft an outbound email                 | "Sarah needs the Q3 OKR draft status by Friday to align with finance"                  |
| `LINEAR_REVIEW`         | Triage a Linear issue assigned to you       | "LIN-1234 (pet bubble drag-and-drop) is in In Review with you assigned"                |
| `REQUIREMENT_SYNTHESIS` | Cluster PRs/issues into a requirements doc  | "14 PRs/issues tagged loop/v0.9 — needs a single requirements doc"                     |
| `RELEASE_PLAN`          | Draft a release plan from merged PRs        | "12 PRs merged since v0.8.2 — time to draft the v0.8.2 release plan"                   |
| `CONTACT_UPDATE`        | Update a contact record when memory drifts  | "Sarah's signature says 'Head of Product' — memory still says PM"                      |
| `DOC_UPDATE`            | Refresh a stale doc for the next version    | "docs/getting-started.md is stale (42 days, pre-v0.8.2)"                               |
| `REVIEW_PR`             | Surface a PR waiting on your review         | "PR #220 (lifestyle image prompts) is waiting on your review"                          |
| `DEADLINE_REMINDER`     | Surface an upcoming due date                | "v0.8.2 release plan due Friday — 3 PRs blocking the cut"                              |
| `TODO`                  | Add a follow-up to your todo list           | "Bug: historical self-owned calendar events surface as fake RSVP decisions"            |
| `DIGEST` (QUIET)        | Consolidate a flood of low-priority signals | "8 GitHub notifications — none urgent individually, but here's the consolidated view"  |

A few of the cards in detail:

![Loop card — IM_REPLY for an Alice follow-up, with the From Loomi reasoning trace](../../apps/marketing/public/img/openloomi/plugins/claude/15-loop-im-reply.png)

![Loop card — IM_REPLY expanded into a full reply composer with To: and Body fields](../../apps/marketing/public/img/openloomi/plugins/claude/16-loop-im-reply-expanded.png)

![Loop card — LINEAR_REVIEW for LIN-1234 "pet bubble drag-and-drop" in In Review](../../apps/marketing/public/img/openloomi/plugins/claude/17-loop-linear-review.png)

![Loop card — REQUIREMENT_SYNTHESIS for 14 PRs/issues tagged loop/v0.9](../../apps/marketing/public/img/openloomi/plugins/claude/18-loop-requirement-synthesis.png)

![Loop card — RELEASE_PLAN for v0.8.2 "classifier-rules UX + custom channels"](../../apps/marketing/public/img/openloomi/plugins/claude/19-loop-release-plan.png)

![Loop card — CONTACT_UPDATE for Sarah Chen's new "Head of Product" role](../../apps/marketing/public/img/openloomi/plugins/claude/20-loop-contact-update.png)

![Loop card — DOC_UPDATE for docs/getting-started.md (42 days stale) with working pet sprite](../../apps/marketing/public/img/openloomi/plugins/claude/21-loop-doc-update.png)

![Loop card — DRAFT_REPLY for the Q3 OKR status email to Sarah Chen](../../apps/marketing/public/img/openloomi/plugins/claude/22-loop-draft-reply.png)

![Loop card — DRAFT_REPLY expanded with Subject and Body reply editor (happy pet sprite)](../../apps/marketing/public/img/openloomi/plugins/claude/23-loop-draft-reply-expanded.png)

![Loop card — REVIEW_PR for PR #220 "compose lifestyle image prompts"](../../apps/marketing/public/img/openloomi/plugins/claude/24-loop-review-pr.png)

![Loop card — TODO for issue #382 "historical RSVPs misclassified"](../../apps/marketing/public/img/openloomi/plugins/claude/25-loop-todo.png)

![Loop card — DIGEST (QUIET) consolidating 8 GitHub notifications, opened from the chat response](../../apps/marketing/public/img/openloomi/plugins/claude/26-loop-digest.png)

### 15b. From the card — Dry run / Edit / Run / Dismiss

The action row at the bottom of every card turns a recommendation into a real
outcome. The exact buttons depend on the card type:

- **`RSVP`** (calendar invitation): **Attend** (primary) · **Decline** (outline) ·
  **View original** (ghost). Tap Attend or Decline and OpenLoomi fires your
  `Yes` / `No` straight back through the connected Google Calendar as a
  `calendar_rsvp` action — no opening the event yourself to click the RSVP
  buttons.
- **Reply / update cards** (`IM_REPLY`, `EMAIL_REPLY`, `REVIEW_PR`,
  `LINEAR_REVIEW`, `REQUIREMENT_SYNTHESIS`, `RELEASE_PLAN`, `CONTACT_UPDATE`,
  `DOC_UPDATE`, `DEADLINE_REMINDER`, `TODO`): **Dry run** (outline) · **Edit**
  · **Run** (primary when ready) · **Dismiss** (ghost). `Dry run` previews
  the exact draft or plan without firing; `Run` schedules the action through
  the right connector — `email_reply` via Gmail, `im_reply` via Slack /
  iMessage, `github_review` via the GitHub Reviews API, `linear_review` via
  Linear, `requirement_synthesis` / `release_plan` / `doc_update` into the
  local knowledge base, `contact_update` into memory, `todo` into the local
  todo store.
- **Quiet digests** (`DIGEST` / `QUIET_DIGEST` / `github_notification`):
  **Mark as read** only — read-only aggregations, nothing to execute.

Two affordances live outside the action row so they never collide with the
decision itself:

- **Card-level Dismiss** sits in the header kebab (three-dot menu).
  Dismissing a card never accidentally declines a meeting. A mute rule is
  created for that signal scope, so the same hint won't resurface today.
- **Cancel scheduled action** appears for ~30 s after you tap Run / Attend /
  Decline. The action is queued as a cron job before it actually fires —
  `Cancel` stops it. A per-card audit history (under the technical details)
  records every attempt with its terminal state (`completed` / `skipped` /
  `blocked` / `failed` / `cancelled` / `superseded`), so contradictory
  responses (e.g. RSVP "No" then "Yes") appear side-by-side instead of
  overwriting each other.

If the underlying connector refuses (the runner returns `blocked` or
`failed`), the action row stays open with a one-tap retry — the card never
silently flips to `done` when nothing actually happened.

## 16. Register your own decision types

The Loop ships with the decision types above out of the box. You can register
your own — the contract is just a `PUT /api/loop/types` against the local
runtime. From a Bash block in Claude Code:

```bash
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3414/api/loop/types \
  -d '{
    "id": "mom_imessage_alert",
    "label": "Mom iMessage",
    "icon": "👩",
    "actionKind": "todo",
    "description": "Triggers when mom sends an iMessage — surfaces as a high-priority todo so you never miss her"
  }'
```

![Step 14 — Register a custom decision type via PUT /api/loop/types](../../apps/marketing/public/img/openloomi/plugins/claude/27-register-loop-type.png)

## 17. The custom type fires on the next signal

When the next matching signal arrives, your custom card appears in the
desktop app with the icon and label you registered, the `iMessage` signal +
type metadata, and the standard action row.

![Step 15 — MOM_IMESSAGE_ALERT custom type fires and surfaces a high-priority todo card](../../apps/marketing/public/img/openloomi/plugins/claude/28-loop-mom-imessage-alert.png)

---

That's the full flow. Claude Code stays the surface you already know;
OpenLoomi becomes the memory, the connector layer, the proactive brain, and
the always-on desktop pet.
