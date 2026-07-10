/**
 * Loop evening wrap — generates a once-a-day snapshot of "what got done today"
 * and enqueues it as a `type:"wrap"` decision card.
 *
 * Output shape (persisted to ~/.openloomi/loop/wrap.json):
 *   {
 *     date: "2026-07-06",
 *     generatedAt: "<ISO>",
 *     stats: { done: number, dismissed: number, stillPending: number },
 *     highlights: [
 *       { id, title, type, completedAt, resultKind },
 *       ...
 *     ],
 *     narrative?: WrapNarrative  // optional agentic overlay (see types.ts)
 *   }
 *
 * Narrative generation mirrors brief.ts: buildAndEnqueue writes a
 * "generating" placeholder synchronously, enqueues the card, and kicks
 * off a fire-and-forget agent call that patches both the snapshot and
 * the decision card on completion.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LOOP_PATHS } from "./paths";
import { readPreferences } from "./preferences";
import { invokeAgentPrompt } from "./runner";
import { decisions, log } from "./store";
import type { LoopDecision, WrapNarrative } from "./types";

const WRAP_PATH = LOOP_PATHS.wrap;
const HIGHLIGHTS_CAP = 8;

/** 20-minute hard ceiling — mirrors brief.ts. */
const NARRATIVE_TIMEOUT_MS = 20 * 60 * 1000;

export interface WrapHighlight {
  id: string;
  title: string;
  type: string;
  completedAt: string;
  resultKind: string;
}

export interface WrapSnapshot {
  date: string;
  generatedAt: string;
  stats: { done: number; dismissed: number; stillPending: number };
  highlights: WrapHighlight[];
  /**
   * Optional agentic narrative. `undefined` when prefs.narrative is false;
   * `null` when generation was attempted and failed; `{status: "generating"|
   * "ready", ...}` otherwise.
   */
  narrative?: WrapNarrative;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readWrap(): WrapSnapshot | null {
  try {
    if (!existsSync(WRAP_PATH)) return null;
    return JSON.parse(readFileSync(WRAP_PATH, "utf8")) as WrapSnapshot;
  } catch {
    return null;
  }
}

function writeWrap(s: WrapSnapshot): void {
  try {
    writeFileSync(WRAP_PATH, JSON.stringify(s, null, 2));
  } catch (e) {
    console.warn("[loop.wrap] write failed:", e);
  }
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function resultKind(dec: LoopDecision): string {
  const r = dec.result;
  if (!r) return "completed";
  if (typeof r === "string") {
    const t = r.trim().toLowerCase();
    if (t.includes("error")) return "error";
    if (t.includes("dry")) return "dry_run";
    if (t.length > 0) return "completed";
  }
  if (typeof r === "object" && r !== null) {
    const status = (r as { status?: string }).status;
    if (typeof status === "string") return status;
  }
  return "completed";
}

export interface BuildWrapResult {
  stats: { done: number; dismissed: number; stillPending: number };
  highlights: WrapHighlight[];
}

/**
 * Build the evening wrap for today. Idempotent within a single date.
 *
 * Like `brief.build`, this is the deterministic aggregator — narrative is
 * handled by `buildAndEnqueue` + `enrichWithNarrative`.
 */
export function build(opts: { force?: boolean } = {}): WrapSnapshot {
  const date = today();
  const existing = readWrap();
  if (
    !opts.force &&
    existing &&
    existing.date === date &&
    existing.highlights.length > 0
  ) {
    return existing;
  }

  const dayStartMs = todayStart();
  const all = decisions.list();
  const todayDone = all.filter(
    (d) =>
      d.status === "done" &&
      d.completed_at &&
      new Date(d.completed_at).getTime() >= dayStartMs,
  );
  const todayDismissed = all.filter(
    (d) =>
      d.status === "dismissed" &&
      d.completed_at &&
      new Date(d.completed_at).getTime() >= dayStartMs,
  );
  const stillPending = decisions.pending().length;

  const highlights: WrapHighlight[] = todayDone
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, HIGHLIGHTS_CAP)
    .map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      completedAt: d.completed_at ?? "",
      resultKind: resultKind(d),
    }));

  const snapshot: WrapSnapshot = {
    date,
    generatedAt: new Date().toISOString(),
    stats: {
      done: todayDone.length,
      dismissed: todayDismissed.length,
      stillPending,
    },
    highlights,
  };
  writeWrap(snapshot);
  log(
    `wrap ${date}: done=${snapshot.stats.done} dismissed=${snapshot.stats.dismissed} pending=${snapshot.stats.stillPending}`,
  );
  return snapshot;
}

// ---------------------------------------------------------------------------
// Narrative generation (mirrors brief.ts)
// ---------------------------------------------------------------------------

/**
 * Stable 16-char hash over highlights. Same input → same hash, so the
 * next wrap on the same day can short-circuit if nothing changed.
 */
export function computeWrapNarrativeInputHash(
  highlights: WrapHighlight[],
): string {
  const sorted = [...highlights]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => `${h.id}:${h.resultKind}`)
    .join("|");
  return createHash("sha1").update(sorted).digest("hex").slice(0, 16);
}

/**
 * Build the prompt sent to the native agent for the wrap narrative.
 * Mirrors brief.ts but: headline rule is "do NOT start with 'Night:'",
 * optional `carry: string[]` field for v2 (parsers ignore unknowns).
 */
export function buildWrapPrompt(
  highlights: WrapHighlight[],
  snapshot: WrapSnapshot,
): string {
  const highlightsJson = JSON.stringify(
    highlights.map((h) => ({
      title: h.title,
      type: h.type,
      completedAt: h.completedAt,
      resultKind: h.resultKind,
    })),
    null,
    2,
  );

  return `You are writing the evening wrap for the user's OpenLoomi Loop — a single, agentic narrative summary of what got resolved today and what's still open. You have tool use — use it to ground the narrative in real past context BEFORE composing.

# Inputs

Date: ${snapshot.date}
Done: ${snapshot.stats.done} decisions resolved today.
Dismissed: ${snapshot.stats.dismissed} dismissed.
Still pending: ${snapshot.stats.stillPending} carried into tomorrow.

Highlights (most recent first, capped at 8):
${highlightsJson}

# Step 1 — REQUIRED: gather focused context from memory + insights

Before writing, run these three queries IN PARALLEL using the Bash tool so the wrap names actual people, references yesterday's commitments, and ties today's work to projects you find in memory — instead of restating highlights[]:

  # 1. Any open thread on the projects touched today — what's left to do,
  #    who is blocked on what. Pull from local memory + knowledge base.
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs search-all "<2-4 keywords from highlights>"

  # 2. Today's insights — what conversations / decisions happened today
  #    that may not be in highlights[] (chats, off-record commitments,
  #    follow-ups promised but not yet due).
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs list-insights --days=1 --limit=20

  # 3. Semantic hits for the day's theme (e.g. "loomilib sprint close",
  #    "weekend coverage", "OKR check-in").
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs search-knowledge "<1 short theme>"

Rules for the queries:
- Run all three in ONE assistant turn with parallel Bash calls — do not serialise.
- Hard cap each query at ~8s.
- If a query errors or returns empty, treat it as "no extra context" and still compose. NEVER fail the wrap because memory/insights were unavailable.
- Use anything concrete you find (names, project refs, prior commitments) verbatim. If a profile names a person, write their real name.

# Step 2 — Compose the narrative

With highlights[] + your focused query results, emit a SINGLE SSE \`result\` event whose \`content\` is a JSON object with this exact shape:

{
  "headline": string,        // ≤ 80 chars; NOT "Night: …" — that is a status line
  "body": string,            // 2-4 sentences, ≤ 400 chars, plain prose, NO markdown
  "model"?: string           // optional, your model id for debugging
}

# Rules

- Plain prose only. No markdown headers, no bullet symbols, no emoji.
- Headline must NOT start with "Night:". It is the headline, not a status line.
- Lead with what was actually completed (specific titles / projects), then
  what carried over.
- Mention specific titles from highlights[] AND from your query results — generic advice ("got stuff done") is bad.
- If highlights[] is empty, return headline="Quiet day", body="Nothing got done today. Tomorrow is a fresh shot — the morning brief will re-prioritize.".
- If you cannot emit a structured \`result\` event for any reason, fall back
  to emitting a single \`\`\`json fenced block in your text reply containing
  the same object.
- Do not make external side effects (no sending mail, no creating calendar
  events). This is read-only summarization.
- v2 will add a \`carry: string[]\` field (1-3 short labels for what the
  user should look at first tomorrow). You may include it now or leave it
  out — parsers ignore extra/missing optional fields.`;
}

export interface WrapParseResult {
  ok: boolean;
  narrative?: WrapNarrative;
  error?: string;
}

export function parseWrapNarrative(
  res: {
    ok: boolean;
    result?: unknown;
    text?: string;
    error?: string;
  },
  highlights: WrapHighlight[],
): WrapParseResult {
  const hash = computeWrapNarrativeInputHash(highlights);

  const fromObj = (obj: unknown): WrapNarrative => {
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
 * any failure collapses to `narrative: null` so callers keep the
 * template path. Failures are logged for admin visibility only.
 */
export async function enrichWithNarrative(
  snapshot: WrapSnapshot,
  opts: { force?: boolean } = {},
): Promise<WrapSnapshot> {
  try {
    const prefs = readPreferences();
    if (prefs.narrative === false) return snapshot;

    const hash = computeWrapNarrativeInputHash(snapshot.highlights);

    if (
      !opts.force &&
      snapshot.narrative &&
      snapshot.narrative.status === "ready" &&
      snapshot.narrative.input_hash === hash
    ) {
      return snapshot;
    }

    if (snapshot.highlights.length === 0) {
      return { ...snapshot, narrative: null };
    }

    const prompt = buildWrapPrompt(snapshot.highlights, snapshot);
    const res = await invokeAgentPrompt(prompt, {
      timeoutMs: NARRATIVE_TIMEOUT_MS,
    });
    const parsed = parseWrapNarrative(res, snapshot.highlights);
    if (parsed.ok && parsed.narrative) {
      return { ...snapshot, narrative: parsed.narrative };
    }
    log(`[loop.wrap] narrative unavailable: ${parsed.error ?? "unknown"}`);
    return { ...snapshot, narrative: null };
  } catch (e) {
    log(
      `[loop.wrap] narrative enrich threw: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { ...snapshot, narrative: null };
  }
}

/**
 * Compute the card dialogue for a wrap snapshot. Mirrors
 * `computeBriefDialogue` — shared logic so the pet card's top-line
 * text reflects the headline immediately after the bg enrich lands.
 */
export function computeWrapDialogue(
  snapshot: WrapSnapshot,
  highlights: WrapHighlight[],
): string {
  const n = snapshot.narrative;
  if (n?.status === "generating") {
    return "Evening wrap is generating — pull to refresh in a moment.";
  }
  if (n?.status === "ready") {
    return `${n.headline} — ${n.body.split("\n")[0] ?? ""}`.slice(0, 280);
  }
  const headline = highlights[0]?.title ?? "(nothing moved today)";
  return snapshot.stats.done > 0
    ? `Night: wrapped ${snapshot.stats.done} today — latest was "${headline}".`
    : "Night: nothing got done today. Tomorrow's a fresh shot.";
}

export function kickOffBackgroundEnrichment(
  snapshot: WrapSnapshot,
  cardId: string,
): void {
  void (async () => {
    try {
      const enriched = await enrichWithNarrative(snapshot, { force: true });

      try {
        writeWrap(enriched);
      } catch (e) {
        log(`[loop.wrap] persist (bg) failed: ${e}`);
      }

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
          patch.dialogue = computeWrapDialogue(enriched, enriched.highlights);
          patch.confidence = 0.85;
        } else {
          ctx.narrative = undefined;
          patch.dialogue = computeWrapDialogue(enriched, enriched.highlights);
        }
        decisions.update(cardId, patch);
      } catch (e) {
        log(`[loop.wrap] patch card failed: ${e}`);
      }
    } catch (e) {
      log(
        `[loop.wrap] background enrich threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  })();
}

// ---------------------------------------------------------------------------
// buildAndEnqueue — orchestrator the cron / API path calls.
// ---------------------------------------------------------------------------

export interface EnqueueWrapResult {
  card: LoopDecision | null;
  snapshot: WrapSnapshot;
}

export async function buildAndEnqueue(
  opts: { force?: boolean } = {},
): Promise<EnqueueWrapResult> {
  const built = build(opts);
  const highlights = built.highlights;
  const hash = computeWrapNarrativeInputHash(highlights);

  let initialNarrative: WrapNarrative | undefined;
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
  } else if (highlights.length > 0) {
    initialNarrative = {
      status: "generating",
      startedAt: new Date().toISOString(),
      input_hash: hash,
    };
  } else {
    initialNarrative = null;
  }

  const snapshot: WrapSnapshot = { ...built, narrative: initialNarrative };

  try {
    writeWrap(snapshot);
  } catch (e) {
    log(`[loop.wrap] persist failed: ${e}`);
  }

  const dialogue = computeWrapDialogue(snapshot, highlights);

  const card = decisions.add({
    type: "wrap",
    title: `Evening wrap · ${snapshot.date}`,
    action: {
      kind: "wrap",
      params: { date: snapshot.date },
    },
    dialogue,
    nextStep:
      snapshot.stats.stillPending > 0
        ? `${snapshot.stats.stillPending} still pending — the morning brief will re-prioritize.`
        : "Queue's clear — sleep well.",
    context: {
      why: [
        `Done today: ${snapshot.stats.done}`,
        `Dismissed: ${snapshot.stats.dismissed}`,
        `Still pending: ${snapshot.stats.stillPending}`,
        ...(snapshot.narrative?.status === "generating"
          ? ["Narrative: generating"]
          : snapshot.narrative?.status === "ready"
            ? [`Narrative: ${snapshot.narrative.headline}`]
            : []),
      ],
      memory_refs: [],
      ...(snapshot.narrative ? { narrative: snapshot.narrative } : {}),
    },
    confidence: snapshot.narrative?.status === "ready" ? 0.85 : 1,
  });

  // #288 — `card` is now `LoopDecision | null` because decisions.add() may
  // reject noop / tick_summary records. For type:"wrap" the filter never
  // matches, but the nullable contract is acknowledged here defensively.
  if (card && snapshot.narrative?.status === "generating") {
    kickOffBackgroundEnrichment(snapshot, card.id);
  }

  log(
    `wrap card enqueued ${card?.id ?? "<rejected>"}${
      snapshot.narrative?.status === "generating"
        ? " (narrative: generating)"
        : snapshot.narrative?.status === "ready"
          ? " (narrative: ready)"
          : " (templated)"
    }`,
  );
  return { card, snapshot };
}
