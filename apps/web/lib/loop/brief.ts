/**
 * Loop morning brief — generates a once-a-day snapshot of "what's waiting for
 * you" and enqueues it as a `type:"brief"` decision card.
 *
 * Output shape (persisted to ~/.openloomi/loop/brief.json):
 *   {
 *     date: "2026-07-06",
 *     generatedAt: "<ISO>",
 *     stats: { scanned: number, surfaced: number, muted: number },
 *     items: [
 *       { kind: "rsvp", id, title, action, priority },
 *       ...
 *     ],
 *     narrative?: BriefNarrative  // optional agentic overlay (see types.ts)
 *   }
 *
 * Surfacing rules (in priority order):
 *   1. RSVP decisions (calendar events needing response)
 *   2. PR reviews requested of the user
 *   3. Email replies flagged urgent (please/asap/urgent in subject or snippet)
 *   4. Slack mentions
 *   5. Linear issues assigned to user (capped at 3)
 *
 * "Muted" = signals dropped by hard-skip rules or trimmed because their
 * decision type isn't surfaced (e.g. release_plan, doc_update — interesting
 * but not daily-actionable).
 *
 * Narrative generation:
 *   - buildAndEnqueue() writes a `narrative: { status: "generating", ... }`
 *     placeholder synchronously and enqueues the card immediately, then
 *     kicks off a fire-and-forget enrichment that calls invokeAgentPrompt
 *     and patches both the snapshot file and the decision card's
 *     context.narrative on success.
 *   - Failures (timeout, agent error, parse failure) silently degrade to
 *     `narrative: null` so the UI falls back to the templated dialogue.
 *   - `prefs.narrative === false` short-circuits to undefined so the
 *     "generating" placeholder never appears.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LOOP_PATHS } from "./paths";
import { readPreferences } from "./preferences";
import { invokeAgentPrompt } from "./runner";
import { decisions, log } from "./store";
import { runQuietDayModule } from "./quiet-modules";
import type {
  BriefMuted,
  BriefNarrative,
  ConnectorEntry,
  LoopDecision,
} from "./types";

const BRIEF_PATH = LOOP_PATHS.brief;
const SURFACED_CAP = 6;

/**
 * 20-minute hard ceiling for the agent call. Generous on purpose — agent
 * runs include reasoning + tool use and can be slow under load. The
 * trade-off is that the user can see "Generating morning brief…" for up
 * to this long; the /brief page polls every 3s and the pet card picks up
 * the patch on its next decision-refresh, so they don't have to reload.
 */
const NARRATIVE_TIMEOUT_MS = 20 * 60 * 1000;

export interface BriefItem {
  kind: string;
  id: string;
  title: string;
  action: LoopDecision["action"];
  priority: number;
  reason: string;
}

export interface BriefSnapshot {
  date: string;
  generatedAt: string;
  stats: { scanned: number; surfaced: number; muted: number };
  items: BriefItem[];
  muted?: BriefMuted[];
  /**
   * Optional agentic narrative. `undefined` when prefs.narrative is false;
   * `null` when generation was attempted and failed (silent UI fallback);
   * `{status: "generating"|"ready", ...}` otherwise.
   */
  narrative?: BriefNarrative;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readBrief(): BriefSnapshot | null {
  try {
    if (!existsSync(BRIEF_PATH)) return null;
    return JSON.parse(readFileSync(BRIEF_PATH, "utf8")) as BriefSnapshot;
  } catch {
    return null;
  }
}

function writeBrief(s: BriefSnapshot): void {
  try {
    writeFileSync(BRIEF_PATH, JSON.stringify(s, null, 2));
  } catch (e) {
    console.warn("[loop.brief] write failed:", e);
  }
}

const PRIORITY: Record<string, number> = {
  rsvp: 1,
  deadline_reminder: 1,
  review_pr: 2,
  draft_reply: 3,
  slack_reply: 4,
  todo: 5,
  linear_review: 6,
};

function prioritize(dec: LoopDecision): BriefItem | null {
  const p = PRIORITY[dec.type];
  if (!p) return null;
  return {
    kind: dec.type,
    id: dec.id,
    title: dec.title,
    action: dec.action,
    priority: p,
    reason: (dec.context?.why ?? []).join(" / ") || dec.type,
  };
}

export interface BuildBriefResult {
  stats: { scanned: number; surfaced: number; muted: number };
  items: BriefItem[];
}

/**
 * Build (or refresh) the morning brief. Idempotent within a single date —
 * re-running on the same day overwrites. Returns the assembled stats and
 * item list (the caller decides whether to also enqueue the brief card).
 *
 * `build` is the deterministic aggregator; it does NOT touch the narrative
 * field. Narrative is handled by `buildAndEnqueue` + `enrichWithNarrative`.
 */
export function build(
  opts: { force?: boolean; connectors?: ConnectorEntry[] } = {},
): BriefSnapshot {
  const date = today();
  const existing = readBrief();
  if (
    !opts.force &&
    existing &&
    existing.date === date &&
    existing.items.length > 0
  ) {
    return existing;
  }

  const pending = decisions.pending();
  const sorted = [...pending].sort((a, b) => {
    const pa = PRIORITY[a.type] ?? 99;
    const pb = PRIORITY[b.type] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.ts.localeCompare(a.ts);
  });

  const surfaced: BriefItem[] = [];
  const muted: BriefMuted[] = [];
  let scanned = 0;

  for (const dec of sorted) {
    scanned += 1;
    const item = prioritize(dec);
    if (!item) {
      muted.push({
        id: dec.id,
        kind: dec.type,
        title: dec.title,
        reason: "not surfaced in brief",
      });
      continue;
    }
    if (surfaced.length < SURFACED_CAP) {
      surfaced.push(item);
    } else {
      muted.push({
        id: dec.id,
        kind: dec.type,
        title: dec.title,
        reason: "over cap",
      });
    }
  }

  const snapshot: BriefSnapshot = {
    date,
    generatedAt: new Date().toISOString(),
    stats: { scanned, surfaced: surfaced.length, muted: muted.length },
    items: surfaced,
    muted,
  };
  writeBrief(snapshot);
  log(
    `brief ${date}: ${surfaced.length} surfaced / ${muted.length} muted of ${scanned}`,
  );
  return snapshot;
}

// ---------------------------------------------------------------------------
// Narrative generation
// ---------------------------------------------------------------------------

/**
 * Pure helper: produce a stable 16-char hash over the (priority, kind, id)
 * tuple of the surfaced items. Used as `input_hash` on the narrative so
 * the next call can detect "the queue hasn't changed since last success"
 * and skip the agent call.
 */
export function computeNarrativeInputHash(items: BriefItem[]): string {
  const sorted = [...items]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((i) => `${i.kind}:${i.id}`)
    .join("|");
  return createHash("sha1").update(sorted).digest("hex").slice(0, 16);
}

/**
 * Build the prompt sent to the native agent for the brief narrative.
 * Includes surfaced items + muted FYI so the agent can mention
 * "…also noise from X, Y was muted". v2 of the schema will add a
 * `recommended_focus` field; parsers are already tolerant of unknown
 * keys so the agent can opt-in.
 */
export function buildBriefPrompt(
  items: BriefItem[],
  snapshot: BriefSnapshot,
  muted?: BriefMuted[],
): string {
  const itemsJson = JSON.stringify(
    items.map((i) => ({
      priority: `P${i.priority}`,
      kind: i.kind,
      title: i.title,
      reason: i.reason,
    })),
    null,
    2,
  );

  const mutedJson =
    muted && muted.length > 0
      ? `\nMuted (hidden, FYI only — do NOT lead with these):\n${JSON.stringify(
          muted.map((m) => ({
            kind: m.kind,
            title: m.title,
            reason: m.reason,
          })),
          null,
          2,
        )}`
      : "";

  return `You are writing the morning brief for the user's OpenLoomi Loop — a single, agentic narrative summary of what's waiting for them today. You have tool use — use it to ground the narrative in real past context BEFORE composing.

# Inputs

Date: ${snapshot.date}
Surfaced: ${snapshot.stats.surfaced} of ${snapshot.stats.scanned} pending decisions (muted: ${snapshot.stats.muted}).

Priorities (ordered by priority, P1 = most urgent):
${itemsJson}
${mutedJson}

# Step 1 — REQUIRED: gather focused context from memory + insights

Before writing a single word, run these three queries IN PARALLEL using the Bash tool so the narrative pulls in real past context (people, projects, recent conversations) and isn't just a paraphrase of items[]:

  # 1. Local memory + people + project notes matching today's items.
  #    Pick 3-6 strong keywords from items[] titles + reasons above.
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs search-all "<your keywords>"

  # 2. Channel-agnostic insights from the past 24h — what was the user
  #    doing / saying / committing to yesterday that carries into today.
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs list-insights --days=1 --limit=20

  # 3. Semantic knowledge-base hits for the day's theme (e.g.
  #    "morning priorities", "loomilib review queue", "OKR this week").
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs search-knowledge "<1 short theme>"

Rules for the queries:
- Run all three in ONE assistant turn with parallel Bash calls — do not serialise.
- Hard cap each query at ~8s (use \`timeout 8\` if your shell supports it, or wrap with \`&& true\`).
- If a query errors or returns empty, treat it as "no extra context" and still compose. NEVER fail the brief because memory/insights were unavailable.
- Use anything concrete you find (names, project refs, yesterday's commitments) verbatim in the body. Don't paraphrase a person's name as "your colleague" — look them up.

# Step 2 — Compose the narrative

With items[] + your focused query results, emit a SINGLE SSE \`result\` event whose \`content\` is a JSON object with this exact shape:

{
  "headline": string,        // ≤ 80 chars; NOT "Morning: …" — that is a status line
  "body": string,            // 2-4 sentences, ≤ 400 chars, plain prose, NO markdown
  "model"?: string           // optional, your model id for debugging
}

# Rules

- Plain prose only. No markdown headers, no bullet symbols, no emoji.
- Headline must NOT start with "Morning:". It is the headline, not a status line.
- Lead with what matters: P1 items first, then P2, etc.
- Mention specific people / projects / titles from items[] AND from your query results — generic advice ("check your email") is bad. If search-all surfaced a person profile, use the real name, not "they".
- If items[] is empty, return headline="All clear today", body="Nothing in the queue — go grab a coffee, or revisit one of the muted signals.".
- If you cannot emit a structured \`result\` event for any reason, fall back to emitting a single \`\`\`json fenced block in your text reply containing the same object.
- Do not make external side effects (no sending mail, no creating calendar events). This is read-only summarization.
- v2 will add a \`recommended_focus: string[]\` field (1-3 short action labels tied to items). You may include it now or leave it out — parsers ignore extra/missing optional fields.`;
}

export interface BriefParseResult {
  ok: boolean;
  narrative?: BriefNarrative;
  error?: string;
}

/**
 * Parse the agent response into a BriefNarrative. Two paths:
 *   1. `result` event emitted → structured object, validate fields.
 *   2. result absent but text contains a ```json fenced block → parse that.
 *
 * Anything else returns `{ ok: false, error: ... }` so the caller can
 * fall back to the templated dialogue. Defensive: slices headline/body
 * to bound length so a runaway model can't OOM the snapshot.
 */
export function parseBriefNarrative(
  res: {
    ok: boolean;
    result?: unknown;
    text?: string;
    error?: string;
  },
  items: BriefItem[],
): BriefParseResult {
  const hash = computeNarrativeInputHash(items);

  const fromObj = (obj: unknown): BriefNarrative => {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.headline !== "string" || typeof o.body !== "string")
      return null;
    return {
      status: "ready",
      headline: o.headline.slice(0, 200),
      body: o.body.slice(0, 800),
      generatedAt: new Date().toISOString(),
      ...(typeof o.model === "string" ? { model: o.model } : {}),
      input_hash: hash,
    };
  };

  if (res.ok) {
    const fromResult = fromObj(res.result);
    if (fromResult) return { ok: true, narrative: fromResult };
    const m = /```json\s*([\s\S]+?)```/.exec(res.text ?? "");
    if (m) {
      try {
        const fromText = fromObj(JSON.parse(m[1]));
        if (fromText) return { ok: true, narrative: fromText };
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      error: "no parseable narrative in agent response",
    };
  }
  return { ok: false, error: res.error ?? "agent call failed" };
}

/**
 * Try to enrich a snapshot with an agentic narrative. Never throws —
 * any failure (prefs off, agent error, parse failure, unexpected
 * exception) collapses to `narrative: null` so callers can keep the
 * template path. Failure details are logged via `log()` for admin
 * panel visibility but never bubbled to the user.
 */
export async function enrichWithNarrative(
  snapshot: BriefSnapshot,
  opts: { force?: boolean } = {},
): Promise<BriefSnapshot> {
  try {
    const prefs = readPreferences();
    if (prefs.narrative === false) return snapshot;

    const hash = computeNarrativeInputHash(snapshot.items);

    // Same-day, same-hash hit → reuse the previous narrative.
    if (
      !opts.force &&
      snapshot.narrative &&
      snapshot.narrative.status === "ready" &&
      snapshot.narrative.input_hash === hash
    ) {
      return snapshot;
    }

    if (snapshot.items.length === 0) {
      // Nothing to summarize — skip the agent call, write null so the
      // UI shows "all clear" via the existing templated path.
      return { ...snapshot, narrative: null };
    }

    const prompt = buildBriefPrompt(snapshot.items, snapshot, snapshot.muted);
    const res = await invokeAgentPrompt(prompt, {
      timeoutMs: NARRATIVE_TIMEOUT_MS,
    });
    const parsed = parseBriefNarrative(res, snapshot.items);
    if (parsed.ok && parsed.narrative) {
      return { ...snapshot, narrative: parsed.narrative };
    }
    log(`[loop.brief] narrative unavailable: ${parsed.error ?? "unknown"}`);
    return { ...snapshot, narrative: null };
  } catch (e) {
    // Defensive: any throwable collapses to null.
    log(
      `[loop.brief] narrative enrich threw: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { ...snapshot, narrative: null };
  }
}

/**
 * Compute the card dialogue for a brief snapshot, depending on narrative
 * state. Shared by `buildAndEnqueue` (initial enqueue) and the bg enrich
 * patch path so the "ready" headline shows up in both the snapshot read
 * AND the card's top-level `dialogue` field — without this, the pet
 * card stays on the "Morning brief is generating…" stub forever.
 */
export function computeBriefDialogue(
  snapshot: BriefSnapshot,
  items: BriefItem[],
): string {
  const n = snapshot.narrative;
  if (n?.status === "generating") {
    return "Morning brief is generating — pull to refresh in a moment.";
  }
  if (n?.status === "ready") {
    return `${n.headline} — ${n.body.split("\n")[0] ?? ""}`.slice(0, 280);
  }
  if (items.length > 0) {
    return `Morning: ${items.length} priorities queued — top one is "${items[0].title}".`;
  }
  return "Morning: the queue is clear. Go grab a coffee.";
}

/**
 * Fire-and-forget enricher: receives a `generating`-state snapshot,
 * runs the agent, persists the enriched snapshot back to disk, and
 * patches the decision card's context.narrative + top-level dialogue
 * so the pet card and any other in-memory consumers see the headline
 * /body without polling.
 *
 * MUST NOT throw — callers kick this off without awaiting. All errors
 * are logged via `log()` and absorbed.
 */
export function kickOffBackgroundEnrichment(
  snapshot: BriefSnapshot,
  cardId: string,
): void {
  void (async () => {
    try {
      const enriched = await enrichWithNarrative(snapshot, { force: true });

      // 1) Persist the snapshot (idempotent — same date overwrites).
      try {
        writeBrief(enriched);
      } catch (e) {
        log(`[loop.brief] persist (bg) failed: ${e}`);
      }

      // 2) Patch the decision card so the pet card / web UI / inbox
      //    reflect the new narrative without re-reading the snapshot.
      //    We patch BOTH `context.narrative` (consumed by the /brief page
      //    and the pet card's narrative block) AND `dialogue` (the card's
      //    primary copy, shown in the inbox / bubble before the user
      //    expands the card).
      try {
        const card = decisions.get(cardId);
        if (!card) return;
        const ctx = { ...(card.context ?? {}) };
        const next = enriched.narrative;
        const patch: Partial<LoopDecision> = { context: ctx };
        if (next && next.status === "ready") {
          ctx.narrative = next;
          const why = Array.isArray(ctx.why) ? [...ctx.why] : [];
          why.push(`Narrative: ${next.headline}`);
          ctx.why = why;
          // Also flip the top-level dialogue so the pet card's
          // top-line text reflects the headline immediately.
          patch.dialogue = computeBriefDialogue(enriched, enriched.items);
          patch.confidence = 0.85;
        } else {
          // Failed — clear any prior narrative so the UI falls back to
          // the templated dialogue.
          ctx.narrative = undefined;
          patch.dialogue = computeBriefDialogue(enriched, enriched.items);
        }
        decisions.update(cardId, patch);
      } catch (e) {
        log(`[loop.brief] patch card failed: ${e}`);
      }
    } catch (e) {
      log(
        `[loop.brief] background enrich threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  })();
}

// ---------------------------------------------------------------------------
// buildAndEnqueue — the orchestrator the cron / API path calls.
// ---------------------------------------------------------------------------

export interface EnqueueBriefResult {
  card: LoopDecision | null;
  snapshot: BriefSnapshot;
}

/**
 * Build the brief AND enqueue it as a `type:"brief"` decision card so it
 * shows up in the pet / inbox / web UI as a single actionable item with
 * "view details" + "snooze" affordances.
 *
 * Two-phase to keep the cron path snappy:
 *   1. Deterministic build → write snapshot with `narrative: "generating"`
 *      (or skip the field entirely if prefs off / items empty / cache hit)
 *      → enqueue card synchronously. Caller returns to cron within ms.
 *   2. Fire-and-forget background enrich → on success patch snapshot +
 *      card.context.narrative; on failure patch nothing / delete the
 *      card's context.narrative so the UI silently falls back to the
 *      templated dialogue.
 *
 * The returned snapshot reflects step 1 (the "generating" placeholder
 * or cached "ready" — never the result of the background pass).
 */
export async function buildAndEnqueue(
  opts: { force?: boolean; connectors?: ConnectorEntry[] } = {},
): Promise<EnqueueBriefResult> {
  const built = build(opts);
  const items = built.items;
  const hash = computeNarrativeInputHash(items);

  // Decide the narrative's initial state. The four branches:
  //   - prefs off                → undefined (no field written)
  //   - cache hit (same hash)    → reuse the existing ready narrative
  //   - items empty              → null (skip agent, fall through to "all clear")
  //   - new / hash changed       → "generating" placeholder + bg enrich
  let initialNarrative: BriefNarrative | undefined;
  const prefs = readPreferences();
  if (prefs.narrative === false) {
    initialNarrative = undefined;
  } else if (
    !opts.force &&
    built.narrative &&
    built.narrative.status === "ready" &&
    built.narrative.input_hash === hash
  ) {
    initialNarrative = built.narrative;
  } else if (items.length > 0) {
    initialNarrative = {
      status: "generating",
      startedAt: new Date().toISOString(),
      input_hash: hash,
    };
  } else {
    initialNarrative = null;
  }

  const snapshot: BriefSnapshot = { ...built, narrative: initialNarrative };

  // Persist the placeholder (idempotent; the background pass overwrites).
  try {
    writeBrief(snapshot);
  } catch (e) {
    log(`[loop.brief] persist failed: ${e}`);
  }

  // #316 — quiet-mode branch. When zero items surfaced, the default
  // behaviour is to skip the templated "nothing to do" card entirely:
  // no badge increment, no pet bubble. The snapshot above is still on
  // disk for history, so the user can read it via GET /api/loop/brief.
  //
  // Two sub-branches:
  //   1. `prefs.quietDayFiller !== "none"` → try the module. If it
  //      returns a `quiet_digest` decision, enqueue that instead of
  //      skipping. The user opted into a filler on purpose.
  //   2. otherwise → log + return `{ card: null, snapshot }`.
  //
  // When `prefs.quietWhenEmpty === false`, the legacy behaviour wins
  // and we fall through to the templated card (the existing code path
  // below).
  if (items.length === 0 && prefs.quietWhenEmpty !== false) {
    if (prefs.quietDayFiller && prefs.quietDayFiller !== "none") {
      log(`[loop.brief] empty brief — running module ${prefs.quietDayFiller}`);
      const moduleDecision = await runQuietDayModule(prefs.quietDayFiller, {
        kind: "brief",
        date: snapshot.date,
        prefs,
      });
      if (moduleDecision) {
        // Route the digest through the same `decisions.add` path the
        // legacy templated card uses (#316 follow-up). Without this
        // the card lived only on `brief.json.quiet_digest` and never
        // reached `decisions.json` — the pet watcher (which only
        // watches `decisions.json`) would never surface it, the
        // badge would never increment, and the user could not dismiss
        // it via the standard card flow. `decisions.add` accepts the
        // already-built `LoopDecision` shape and normalises it
        // (`memory_refs` hoisting etc.) — we use the returned record
        // so the snapshot-stashed copy and the card we return are
        // byte-identical to what's on disk.
        const persisted = decisions.add(moduleDecision) ?? moduleDecision;

        // Re-stamp the persisted snapshot with the module decision's
        // own context.items, so the /brief page can render them too
        // (it's a read-through view of the snapshot). We do NOT swap
        // the snapshot's own items[] — that's the queue's empty
        // truth; we just attach the module's payload alongside.
        const enrichedSnapshot: BriefSnapshot = {
          ...snapshot,
          // Reuse the existing narrative field for the digest so
          // /brief can read it through one path. `null` is the
          // canonical "no narrative" shape; we just patch a marker.
          narrative: null,
        };
        // Stash the digest on the snapshot so the /brief page can
        // surface it without re-running the module.
        (
          enrichedSnapshot as BriefSnapshot & { quiet_digest?: LoopDecision }
        ).quiet_digest = persisted;
        try {
          writeBrief(enrichedSnapshot);
        } catch (e) {
          log(`[loop.brief] persist (digest) failed: ${e}`);
        }
        log(
          `[loop.brief] digest card enqueued ${persisted.id} (module=${prefs.quietDayFiller})`,
        );
        return { card: persisted, snapshot: enrichedSnapshot };
      }
      // Module returned null (unavailable, parse failure, etc.) —
      // degrade to skipping the card.
      log(
        `[loop.brief] empty brief — module ${prefs.quietDayFiller} returned no decision, skipping card`,
      );
      return { card: null, snapshot };
    }
    log("[loop.brief] empty brief — quietWhenEmpty=true, skipping card");
    return { card: null, snapshot };
  }

  // Card dialogue: prefer the narrative headline when ready, otherwise
  // the "generating" stub so the user immediately sees feedback.
  const dialogue = computeBriefDialogue(snapshot, items);

  const card = decisions.add({
    type: "brief",
    title: `Morning brief · ${snapshot.date}`,
    action: {
      kind: "brief",
      params: { date: snapshot.date },
    },
    dialogue,
    nextStep:
      items.length > 0
        ? `Tap to see ${items.length} items, or say "start" to handle them one by one.`
        : "Nothing needs a decision today; see you at the 9pm wrap.",
    context: {
      why: [
        `Scanned ${snapshot.stats.scanned} pending decisions`,
        `Surfaced ${snapshot.stats.surfaced} priorities, muted ${snapshot.stats.muted}`,
        ...(snapshot.narrative?.status === "generating"
          ? ["Narrative: generating"]
          : snapshot.narrative?.status === "ready"
            ? [`Narrative: ${snapshot.narrative.headline}`]
            : []),
      ],
      memory_refs: [],
      ...(snapshot.narrative ? { narrative: snapshot.narrative } : {}),
    },
    // Slightly soften the confidence when an actual agent wrote the
    // headline vs. a templated line — reflects the inherent
    // hallucination risk of free-form prose.
    confidence: snapshot.narrative?.status === "ready" ? 0.85 : 1,
  });

  // Fire-and-forget background enrich — never awaited, never throws.
  // #288 — `card` is now `LoopDecision | null` because decisions.add() may
  // reject noop / tick_summary records. For type:"brief" the filter never
  // matches, but the nullable contract is acknowledged here defensively.
  if (card && snapshot.narrative?.status === "generating") {
    kickOffBackgroundEnrichment(snapshot, card.id);
  }

  log(
    `brief card enqueued ${card?.id ?? "<rejected>"}${
      snapshot.narrative?.status === "generating"
        ? " (narrative: generating)"
        : snapshot.narrative?.status === "ready"
          ? " (narrative: ready)"
          : " (templated)"
    }`,
  );
  return { card, snapshot };
}
