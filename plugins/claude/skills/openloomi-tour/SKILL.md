---
name: openloomi-tour
description: "Walk a brand-new OpenLoomi user through the entire pipeline in one guided session: setup health → pet reaction → connector onboarding → run a Loop tick → inspect & approve a decision card → seed Memory → optionally register a custom Loop channel / classifier rule / decision type. Triggers: openloomi tour, guided tour, walk me through openloomi, show me everything, end-to-end demo, 带我看一下, 体验一下, 一条龙, 一键体验, first time using openloomi, what's next after setup."
allowed-tools: "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/openloomi-connectors/scripts/openloomi-connectors.cjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/openloomi-memory/scripts/openloomi-memory.cjs *), Bash(composio *), Bash(curl *), Bash(jq *), Bash(cat ~/.openloomi/token *), Bash(base64 -d *)"
---

# OpenLoomi Tour — Hands-on Walkthrough

This skill is the **canonical first-run experience** for Claude Code
users. After `/openloomi:setup` finishes and prints its post-ready
walkthrough, the user can type **`/openloomi:tour`** (or any of the
trigger phrases) and you'll run the same pipeline live, stopping
between phases so the user can react.

The tour is **interactive, idempotent, and skippable**. Each phase
checks its own prerequisite and lets the user move on with `next` /
`skip` / `back`. Nothing is destructive — if the user already did a
phase, you re-confirm it and move on.

---


## Reference docs

Quick links to the OpenLoomi docs that this tour draws from. Every
phase below cites the relevant entries inline.

| Topic | Doc |
| --- | --- |
| Getting started / install / one-time setup | <https://openloomi.ai/docs/getting-started> |
| What OpenLoomi is (the pipeline in one page) | <https://openloomi.ai/docs/what-is-openloomi> |
| Glossary — every term used here (Connector / Signal / Loop channel / Action Runner / etc.) | <https://openloomi.ai/docs/glossary> |
| Loop engine — ticks, Decisions, cards, channels, classifier rules | <https://openloomi.ai/docs/loop> |
| Loop — Approve / Edit Draft / dry-run anatomy of a Card | <https://openloomi.ai/docs/loop#approvals-and-dry-run> |
| Memory — people / projects / notes / insights / Screen Capture | <https://openloomi.ai/docs/memory> |
| Knowledge Base / Library — uploaded documents (PDF, DOCX, MD, …) | <https://openloomi.ai/docs/library> |
| Connectors — Slack / Gmail / GitHub / Linear / Notion / HubSpot / … | <https://openloomi.ai/docs/connectors> |
| Native messaging bots — Telegram / WhatsApp / iMessage / Feishu / DingTalk / QQ / WeChat | <https://openloomi.ai/docs/messaging-apps> |
| Composio / Loop channel — OAuth broker for 1000+ apps | <https://openloomi.ai/docs/glossary#composio--loop-channel> |
| Attention Agent — Loomi the fox, card bubbles, sprite states | <https://openloomi.ai/docs/attention-agent> |
| Agent Runtimes — Claude / Codex / OpenCode / Hermes / OpenClaw | <https://openloomi.ai/docs/reference/agent-runtimes> |
| Plugins — bridge from Claude Code / Codex into OpenLoomi | <https://openloomi.ai/docs/plugins> |
| Automation / Proactive Tasks — recurring scheduled work | <https://openloomi.ai/docs/automation> |
| Chat — conversational entry point (not Loop) | <https://openloomi.ai/docs/chat> |
| Skills — reusable capabilities inside OpenLoomi | <https://openloomi.ai/docs/skills> |
| Audit Log — every consequential moment recorded | <https://openloomi.ai/docs/privacy-security#audit-logs> |
| Privacy & Security — local-first, AES-256, what's stored where | <https://openloomi.ai/docs/privacy-security> |
| Changelog — what's new in each release | <https://openloomi.ai/docs/changelog> |

## Phase 0 — Pre-flight

Before running any phase, do **three** things in this exact order:

```bash
# 1. Readiness (sandbox-aware)
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" setup-status --json

# 2. If loopbackAccessAmbiguous: true, refresh host probe outside sandbox
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" run-host-probe

# 3. Confirm the selected execution provider. Only inspect Claude auth when
#    Claude is selected; Codex/OpenCode/Hermes/OpenClaw use their own auth.
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" setup-status --json | jq '{executionProviderReady, executionProviderSource, nativeRuntimeProvider, nativeRuntime}'
```

Decision tree:

| Pre-flight outcome | Tour action |
| --- | --- |
| `ready: true`, `executionProviderReady: true` | Proceed straight to Phase 1, regardless of which runtime is selected |
| `ready: false`, `nextAction: setup` (or no setup) | Tell the user setup hasn't run yet. Offer to invoke `/openloomi:setup` first, then return to tour |
| `ready: false`, `OPENLOOMI_API_UNREACHABLE` | Re-run `run-host-probe` outside the sandbox; if still unreachable, surface the bridge's `hints[]` and stop |
| `nativeRuntimeProvider: "claude"`, `nativeRuntime.authenticated: false` | Point user at `claude auth login`, then re-run setup-status. The tour can continue but Loop won't have a runtime to drive actions |
| Non-Claude `nativeRuntimeProvider`, `executionProviderReady: true` | Proceed without asking for Claude login or an Anthropic API key; the selected runtime brings its own auth |

Print the user's current state in one line (mode, installed, selected
execution provider, provider ready) before announcing Phase 1.

---

## Phase 1 — Pet reaction (always run)

The pet is the **fastest, cheapest, safest** proof that the desktop is
listening. Run four "sight" states in sequence so the user sees the
sprite set:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" pet happy
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" pet thinking
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" pet working
node "${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs" pet juggling
```

After each, say "Loomi just showed the `<state>` sprite — that proves
the desktop is watching the pet watcher and accepting state changes
from Claude Code." End by leaving the pet at `happy` (success-state
feel).

For the full state taxonomy, see the [Attention Agent](https://openloomi.ai/docs/attention-agent) doc; for the broader pipeline see the [Glossary](https://openloomi.ai/docs/glossary).

If `POST /api/pet/state` returns "would have set state to X — pending
OpenLoomi endpoint", note that the runtime is older than the bridge
expects; the pet widget will catch up via the `~/.openloomi/loop/`
file watcher anyway. Avoid `sleeping` / `sweeping` — those are
watcher-only on the API surface and the bridge will surface a 400
`invalid_state`.

---

## Phase 2 — Onboarding & input sources (interactive)

This is the first **real** action and the first place the user may have
to do something in another window. There are **three** input paths;
offer them all and let the user pick:

> **A. Native bot** ([Telegram / WhatsApp / iMessage / Feishu / DingTalk
> / QQ / WeChat](https://openloomi.ai/docs/messaging-apps)) — fastest, no browser OAuth. Best if you already use
> one of those.
>
> **B. [Composio OAuth](https://openloomi.ai/docs/glossary#composio--loop-channel)** (Gmail / Slack / GitHub / Google Calendar /
> Notion / Linear / HubSpot / LinkedIn / Jira / Asana / Discord / X) —
> one browser click, works for the apps most people already have. Full list at [Connectors](https://openloomi.ai/docs/connectors).
>
> **C. [Screen memory](https://openloomi.ai/docs/memory) (macOS only)** — right-click the Loomi pet on the
> desktop → **Open Settings** → enable **Screen Capture**. The global
> capture shortcut (configurable in the same panel) summarises the
> frontmost window and stores the result directly as a Memory record.
> **Important:** screen memories go to Memory *directly* and do **not**
> flow through Signals — Loop will not tick on them. So screen memory
> alone is **not** enough to drive Phase 3.

Suggested **first** picks by user profile:

- New to OpenLoomi, just want a feel → **Gmail** via `composio link gmail` (richest signal)
- Wants something offline-friendly → **Telegram** via the native CLI
- Wants a work tool → **Slack** or **Linear** via Composio
- Privacy-conscious / wants everything local → enable **screen memory** + skip Phase 3

After the user picks, run the right command and then verify:

```bash
# Native:
node "${CLAUDE_PLUGIN_ROOT}/skills/openloomi-connectors/scripts/openloomi-connectors.cjs" list-accounts

# Composio:
composio execute GMAIL_GET_PROFILE -d '{}'  # or toolkit-specific probe

# Screen memory: verify via the Memory surfaces after the first capture
# (no list-accounts equivalent — captures land in ~/.openloomi/data/memory/)
```

If the OAuth window never opened (silent exit), note that `composio
link` returns immediately when the toolkit is already authorised —
re-check `list-accounts` first before assuming failure.

### Skipping this phase

Phase 2 is **optional**. If the user says `skip`:

- **Skip + nothing enabled** → also skip Phase 3 (Loop tick) — Loop
  has no signal sources to poll. Move directly to Phase 4 (Seed Memory),
  which is still valuable for grounding.
- **Skip + only screen memory enabled** → also skip Phase 3 — screen
  memory doesn't flow through Signals/Loop. Still move to Phase 4, and
  tell the user their screen captures will start appearing in Memory
  immediately.
- **Skip + a Connector is already connected from a previous session**
  → run Phase 3 anyway, the existing connector will feed signals.

If the user picks screen memory only (option C), Phase 3 is skipped
but Phase 4 becomes the centrepiece — the user will see their screen
captures appear in Memory directly.

---

## Phase 3 — Run one Loop tick (only if a signal source exists)

This phase is the heart of the tour **when there's something for Loop
to tick on** ([Loop engine](https://openloomi.ai/docs/loop)). **Skip it if Phase 2 was skipped and no Connector is
connected** — Loop would have nothing to pull. Screen memory also does
not count here: it bypasses Signals entirely and writes to Memory
directly, so it doesn't drive Loop.

**Important runtime note.** A Loop tick is a long-running **agentic**
call — the desktop spawns a subprocess (`codex exec` for Codex, the
native Claude CLI for Claude Code) and the HTTP `POST /api/loop/tick`
blocks until that subprocess finishes. A cold tick on a fresh inbox
typically takes 30–90s; subsequent ticks 10–30s; very large inboxes
2–3 min. **Do not block the tour on it.** Fire the tick in the
background and poll for completion.

When at least one signal-source Connector is connected, run the
following — the user sees the full pipeline move for the first time.

```bash
TOKEN=$(cat ~/.openloomi/token | base64 -d)
BASE="http://localhost:3414"

# 1. Capture baseline lastTickAt so we can detect when the tick lands.
BEFORE=$(curl -sS "$BASE/api/loop/state" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.lastTickAt // "1970-01-01T00:00:00.000Z"')

# 2. (Optional) Force-refresh connector probes. May hang on the Composio
#    cold path — fall back to the cached snapshot if it times out.
curl -sS --max-time 15 "$BASE/api/loop/connectors?refresh=1" \
  -H "Authorization: Bearer $TOKEN" | jq . \
  || echo "(probe refresh timed out — using cached snapshot)"

# 3. Fire the tick in the BACKGROUND with a short HTTP timeout.
#    The desktop accepts the request, spawns the agentic subprocess,
#    and curl returns after --max-time even though the tick keeps
#    running server-side. We then poll state.lastTickAt for completion.
curl -sS --max-time 5 -X POST "$BASE/api/loop/tick" \
  -H "Authorization: Bearer $TOKEN" > /tmp/openloomi-tick.out 2>&1 &
TICK_PID=$!
echo "tick dispatched (HTTP pid=$TICK_PID); agentic subprocess continues server-side"

# 4. While the tick runs, USE THIS TIME TO TALK TO THE USER.
#    Explain the architecture: signals → classifier → decisions →
#    cards → Approve. Ask about their typical day. Preview the
#    card-shape JSON. Do not sit in silence — this is a 1–3 minute
#    window depending on inbox size.

# 5. Poll for completion (lastTickAt advances past $BEFORE).
#    Default max wait: 3 minutes. Raise to 5 if the user has a large inbox.
DEADLINE=$((SECONDS + 180))
while [ $SECONDS -lt $DEADLINE ]; do
  AFTER=$(curl -sS "$BASE/api/loop/state" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.lastTickAt // "1970-01-01T00:00:00.000Z"')
  if [ "$AFTER" != "$BEFORE" ]; then
    echo "tick completed at $AFTER (was $BEFORE)"
    break
  fi
  sleep 5
done

# 6. Inspect the tick output and any decisions it produced.
cat /tmp/openloomi-tick.out
curl -sS "$BASE/api/loop/decisions?status=pending" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

If the poll loop times out without `lastTickAt` advancing, the
agentic subprocess is still running on the desktop (very large
inboxes, slow LLM, or `composio connections endpoint unreachable`).
Surface what the user can do: tell them the tick is still running in
the background, that the next time they run a tick it will be faster
(warm cache), and that they can keep going with Phase 4 — Memory
seeding — while the tick finishes asynchronously.

If no pending decisions appear after a successful tick:

- If no Connectors are connected yet → tell the user that's why, point
  back to Phase 2.
- If Connectors ARE connected but no signals → tell the user Loop
  hasn't accumulated history yet, suggest re-running the tick in a
  minute, or seeding Memory (Phase 4) to give Loop something to
  reason over.

If at least one decision appears, show the **[Card](https://openloomi.ai/docs/loop#approvals-and-dry-run)** shape so the user
sees what the pet would surface:

```bash
DEC_ID=$(curl -sS "$BASE/api/loop/decisions?status=pending" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')

curl -sS "$BASE/api/loop/card/$DEC_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Then **approve** it (the one-tap path the pet bubble would normally
trigger):

```bash
curl -sS -X POST "$BASE/api/loop/action/schedule" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"decision_id\":\"$DEC_ID\",\"action\":\"run\"}"
```

Note: the action fires ~30s later via the scheduler. Tell the user to
check the pet bubble — it'll flip to `presenting` and then `done`.

---

## Phase 4 — Seed Memory (always run, idempotent)

[Memory](https://openloomi.ai/docs/memory) is what makes Chat grounded and Loop sharper. Even with no
Connectors, seeding three canonical files gives the next Loop tick real
grounding. The [Library / Knowledge Base](https://openloomi.ai/docs/library) sits alongside — explicit user-uploaded documents that RAG-search over.

```bash
MEM="${CLAUDE_PLUGIN_ROOT}/skills/openloomi-memory/scripts/openloomi-memory.cjs"

# The required Memory commands are known. Do not run discovery/help probes
# such as `node "$MEM" --help`, `node "$MEM" -h`, or `node "$MEM" help`
# before this phase; go directly to add-memory and search-all.

# Tour seed files are tour-owned demo artifacts. Reruns may overwrite
# these tour/*.md files, but must not write to user-authored memory paths.

# 1. Tour / about me
node "$MEM" add-memory "About me: <one-line role + timezone + how I prefer to work>" \
  --file=tour/about-me.md

# 2. Tour / current project
node "$MEM" add-memory "Current project: <name + goal + next milestone>" \
  --file=tour/current-project.md

# 3. Tour / values
node "$MEM" add-memory "What I optimise for: <signal vs noise, deep work vs responsiveness, etc.>" \
  --file=tour/values.md

# 4. Search-all to prove the new files are indexed
node "$MEM" search-all "<a keyword from the file you just wrote>"
```

If the user is shy, do step 1 only and let them fill the rest later.
The point is to prove `add-memory` writes tour-owned files under
`~/.openloomi/data/memory/tour/` and `search-all` returns them.

After this phase, peek at the Memory surfaces (see [Insights](https://openloomi.ai/docs/memory) and [Library](https://openloomi.ai/docs/library)):

```bash
node "$MEM" list-insights --days=7
curl -sS "$BASE/api/rag/documents?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Phase 5 — Optional extensions (only on user request)

These are the **power-user** surfaces. Skip unless the user says
"show me how to extend it" or similar.

### 5a. Custom [Loop channel](https://openloomi.ai/docs/glossary#composio--loop-channel) (Composio-backed signal source)

Show the user how to register their own signal source — anything
Composio has a toolkit for becomes a Loop signal with one PUT. Full reference: [Loop](https://openloomi.ai/docs/loop).

```bash
TOKEN=$(cat ~/.openloomi/token | base64 -d)
curl -sS -X PUT "http://localhost:3414/api/loop/channels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "id": "demo_stripe_charges",
    "label": "Demo: Stripe charges",
    "toolkit": "stripe",
    "toolSlug": "STRIPE_LIST_CHARGES",
    "pollIntervalSec": 900,
    "signalType": "stripe_charge"
  }'

# Re-list to confirm
curl -sS "http://localhost:3414/api/loop/channels" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 1. Confirmation card — fetch the registered channel back so the user
#    sees the entity they just created, named and labeled.
echo "=== confirmation card: registered channel ==="
curl -sS "http://localhost:3414/api/loop/channels" \
  -H "Authorization: Bearer $TOKEN" | \
  jq '.items[] | select(.id == "demo_stripe_charges")'

# 2. Inject a decision-style insight into the inbox so the user can see
#    the registration event surface in OpenLoomi Memory > Insights. The
#    user can later filter by `groups: ["openloomi-tour"]` to find every
#    registration card the tour produced.
echo "=== injecting registration insight into inbox ==="
curl -sS -X POST "http://localhost:3414/api/insights" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "type": "decision",
    "content": "Custom Loop channel registered: demo_stripe_charges (toolkit=stripe, toolSlug=STRIPE_LIST_CHARGES, pollIntervalSec=900). Next Loop tick will poll and surface stripe_charge signals.",
    "groups": ["openloomi-tour", "loop"],
    "people": []
  }' | jq .
```

Tell the user: this channel will start polling on the next Loop tick
and any returned records become `stripe_charge` signals that Loop
classifies normally.

### 5b. Classifier rule (deterministic override)

For known signal patterns, force a specific decision type without
relying on the LLM classifier. See [Loop — classifier rules](https://openloomi.ai/docs/loop).

```bash
curl -sS -X PUT "http://localhost:3414/api/loop/classifier-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "id": "force_email_reply_high_urgency",
    "when":[
      {"field":"signal.type","op":"eq","value":"gmail_message"},
      {"field":"signal.payload.urgency","op":"eq","value":"high"}
    ],
    "then":{"type":"email_reply","actionKind":"email_reply","confidence":0.95}
  }'

# Dry-run to confirm it matches
curl -sS -X POST "http://localhost:3414/api/loop/classifier-rules/dry-run" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"signal":{"type":"gmail_message","payload":{"urgency":"high","subject":"URGENT: outage"}}}'

# 1. Confirmation card — fetch the registered rule back
echo "=== confirmation card: registered rule ==="
curl -sS "http://localhost:3414/api/loop/classifier-rules" \
  -H "Authorization: Bearer $TOKEN" | \
  jq '.items[] | select(.id == "force_email_reply_high_urgency")'

# 2. Inject a decision-style insight into the inbox
echo "=== injecting registration insight into inbox ==="
curl -sS -X POST "http://localhost:3414/api/insights" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "type": "decision",
    "content": "Classifier rule registered: force_email_reply_high_urgency — gmail_message + payload.urgency=high → email_reply (confidence 0.95). Overrides the LLM classifier for matching signals.",
    "groups": ["openloomi-tour", "loop"],
    "people": []
  }' | jq .
```

### 5c. Custom [decision type](https://openloomi.ai/docs/loop)

For a card style that doesn't exist yet (see [Loop — custom DecisionTypes](https://openloomi.ai/docs/loop)):

```bash
curl -sS -X PUT "http://localhost:3414/api/loop/types" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "id":"birthday_wish",
    "label":"Birthday wish",
    "icon":"ri-cake-2-line",
    "actionKind":"email_reply"
  }'

# 1. Confirmation card — fetch the registered type back
echo "=== confirmation card: registered decision type ==="
curl -sS "http://localhost:3414/api/loop/types" \
  -H "Authorization: Bearer $TOKEN" | \
  jq '.items[] | select(.id == "birthday_wish")'

# 2. Inject a decision-style insight into the inbox
echo "=== injecting registration insight into inbox ==="
curl -sS -X POST "http://localhost:3414/api/insights" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "type": "decision",
    "content": "Custom DecisionType registered: birthday_wish (icon=ri-cake-2-line, actionKind=email_reply). Future Loop ticks can surface decisions with this card style.",
    "groups": ["openloomi-tour", "loop"],
    "people": []
  }' | jq .
```

### 5d. Inventory dump — what did we just register?

After running any of 5a / 5b / 5c, list **everything** that's now
registered so the user sees the full picture at once:

```bash
echo "=== all registered channels ==="
curl -sS "http://localhost:3414/api/loop/channels" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[].id'

echo "=== all registered classifier rules ==="
curl -sS "http://localhost:3414/api/loop/classifier-rules" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[].id'

echo "=== all registered decision types ==="
curl -sS "http://localhost:3414/api/loop/types" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[].id'

echo "=== registration insights in inbox (last 24h) ==="
curl -sS "http://localhost:3414/api/insights?days=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

After any of 5a/5b/5c, you can also re-run the tick from Phase 3 to
see the new channel/rule/type in action — the inbox will now also
contain the three registration cards pushed above so the user can
`list-insights --channel=openloomi-tour` or filter by
`groups: ["openloomi-tour"]` in the desktop UI.

---

## Hand-off

When the tour finishes (user says `done`, `exit`, or all five phases
are complete), print the **quick reference card** from the
`/openloomi:setup` post-ready walkthrough (the closed follow-up
command list) and remind the user:

> The tour is over. OpenLoomi is now wired up — Connectors will keep
> pulling, Loop will keep ticking, and the pet will surface new
> decisions as cards. Approve a card to run an action; dismiss to
> archive it; type `/openloomi:tour` to walk through this again.
>
> Every consequential moment is recorded in the [Audit Log](https://openloomi.ai/docs/privacy-security#audit-logs). The whole reason this tour was possible in the first place is the [Plugin](https://openloomi.ai/docs/plugins) bridge that exposes OpenLoomi to your shell.

---

## Sandbox and network

All API calls in this skill (`/api/loop/*`, `/api/rag/*`,
`/api/integrations/*`) target `http://localhost:3414` from the user's
host. If any call fails with `ECONNREFUSED` / `ETIMEDOUT` /
"unreachable", **request approval and retry outside the sandbox** —
Claude Code's network sandboxing can block loopback to the host even
when the desktop API is listening. Do **not** declare OpenLoomi
unhealthy until an outside-sandbox retry also fails. See the bridge's
`loopbackAccess.verification.commands` for the manual probe.
