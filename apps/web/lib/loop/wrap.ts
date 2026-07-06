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
 *     ]
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LOOP_PATHS } from "./paths";
import { decisions, log } from "./store";
import type { LoopDecision } from "./types";

const WRAP_PATH = LOOP_PATHS.wrap;
const HIGHLIGHTS_CAP = 8;

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
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readWrap(): WrapSnapshot | null {
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

export interface EnqueueWrapResult {
  card: LoopDecision | null;
  snapshot: WrapSnapshot;
}

export function buildAndEnqueue(
  opts: { force?: boolean } = {},
): EnqueueWrapResult {
  const snapshot = build(opts);
  const headline = snapshot.highlights[0]?.title ?? "(nothing moved today)";
  const card = decisions.add({
    type: "wrap",
    title: `Evening wrap · ${snapshot.date}`,
    action: {
      kind: "wrap",
      params: { date: snapshot.date },
    },
    dialogue:
      snapshot.stats.done > 0
        ? `Night: wrapped ${snapshot.stats.done} today — latest was "${headline}".`
        : "Night: nothing got done today. Tomorrow's a fresh shot.",
    nextStep:
      snapshot.stats.stillPending > 0
        ? `${snapshot.stats.stillPending} still pending — the morning brief will re-prioritize.`
        : "Queue's clear — sleep well.",
    context: {
      why: [
        `Done today: ${snapshot.stats.done}`,
        `Dismissed: ${snapshot.stats.dismissed}`,
        `Still pending: ${snapshot.stats.stillPending}`,
      ],
      memory_refs: [],
    },
    confidence: 1,
  });
  log(`wrap card enqueued ${card.id}`);
  return { card, snapshot };
}
