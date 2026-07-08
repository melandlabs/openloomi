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
 *     ]
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
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LOOP_PATHS } from "./paths";
import { decisions, log } from "./store";
import type { ConnectorEntry, LoopDecision } from "./types";

const BRIEF_PATH = LOOP_PATHS.brief;
const SURFACED_CAP = 6;

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
  muted?: { kind: string; title: string; reason: string }[];
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
  const muted: { kind: string; title: string; reason: string }[] = [];
  let scanned = 0;

  for (const dec of sorted) {
    scanned += 1;
    const item = prioritize(dec);
    if (!item) {
      muted.push({
        kind: dec.type,
        title: dec.title,
        reason: "not surfaced in brief",
      });
      continue;
    }
    if (surfaced.length < SURFACED_CAP) {
      surfaced.push(item);
    } else {
      muted.push({ kind: dec.type, title: dec.title, reason: "over cap" });
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

export interface EnqueueBriefResult {
  card: LoopDecision | null;
  snapshot: BriefSnapshot;
}

/**
 * Build the brief AND enqueue it as a `type:"brief"` decision card so it
 * shows up in the pet / inbox / web UI as a single actionable item with
 * "view details" + "snooze" affordances.
 */
export function buildAndEnqueue(
  opts: { force?: boolean; connectors?: ConnectorEntry[] } = {},
): EnqueueBriefResult {
  const snapshot = build(opts);
  const headline = snapshot.items[0]?.title ?? "No todos today";
  const card = decisions.add({
    type: "brief",
    title: `Morning brief · ${snapshot.date}`,
    action: {
      kind: "brief",
      params: { date: snapshot.date },
    },
    dialogue:
      snapshot.items.length > 0
        ? `Morning: ${snapshot.items.length} priorities queued — top one is "${headline}".`
        : "Morning: the queue is clear. Go grab a coffee.",
    nextStep:
      snapshot.items.length > 0
        ? `Tap to see ${snapshot.items.length} items, or say "start" to handle them one by one.`
        : "Nothing needs a decision today; see you at the 9pm wrap.",
    context: {
      why: [
        `Scanned ${snapshot.stats.scanned} pending decisions`,
        `Surfaced ${snapshot.stats.surfaced} priorities, muted ${snapshot.stats.muted}`,
      ],
      memory_refs: [],
    },
    confidence: 1,
  });
  log(`brief card enqueued ${card.id}`);
  return { card, snapshot };
}
