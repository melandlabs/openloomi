/**
 * Loop store — JSON-backed persistence for signals (JSONL) and decisions.
 *
 * Mirrors loop-lib.cjs → signals / decisions in TypeScript so the rest of
 * the main app can use it without touching node:fs directly. Atomic writes
 * via tmp + rename so concurrent writers don't tear the file.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { ensureDirs, ensureParent, LOOP_PATHS } from "./paths";
import type {
  DecisionStatus,
  LoopDecision,
  LoopDecisionBuckets,
  LoopSignal,
} from "./types";

const MAX_SIGNALS = 5000;
const MAX_DECISIONS_PER_BUCKET = 500;

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(p: string, fallback: T): T {
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p: string, obj: unknown): void {
  ensureParent(p);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  // rename is atomic on POSIX (best-effort on Windows)
  // biome-ignore lint/performance/noDelete: tmp file intentionally removed after rename
  try {
    require("node:fs").renameSync(tmp, p);
  } catch {
    writeFileSync(p, JSON.stringify(obj, null, 2));
  }
}

function readJsonl(p: string): unknown[] {
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function appendJsonl(p: string, obj: unknown): void {
  ensureParent(p);
  appendFileSync(p, `${JSON.stringify(obj)}\n`);
}

// ---------------------------------------------------------------------------
// Decision normalization
// ---------------------------------------------------------------------------
//
// Schema contract: `memory_refs` and `insight_refs` live INSIDE `context`.
// Some agent emits put them at the top level of the decision object. This
// hoists them into `context` so every consumer (CLI inbox formatter, webhook
// payload, run-prompt builder, web UI) sees one consistent shape regardless
// of how the decision was originally emitted. Mutates and returns the same
// object — callers can chain or assign. Idempotent: no-op when already nested.
function normalizeDecision(
  dec: LoopDecision | null | undefined,
): LoopDecision | null | undefined {
  if (!dec || typeof dec !== "object") return dec;
  if (!dec.context || typeof dec.context !== "object") dec.context = {};
  const ctx = dec.context as Record<string, unknown>;
  for (const k of ["memory_refs", "insight_refs"]) {
    const top = (dec as unknown as Record<string, unknown>)[k];
    if (Array.isArray(top) && top.length) {
      const bucket: unknown[] = Array.isArray(ctx[k])
        ? (ctx[k] as unknown[])
        : [];
      for (const v of top) {
        if (!bucket.includes(v)) bucket.push(v);
      }
      ctx[k] = bucket;
      delete (dec as unknown as Record<string, unknown>)[k];
    }
  }
  return dec;
}

function emptyBuckets(): LoopDecisionBuckets {
  return { pending: [], done: [], dismissed: [] };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const signals = {
  append(
    source: string,
    type: LoopSignal["type"],
    payload: Record<string, unknown>,
    extra: Partial<LoopSignal> = {},
  ): LoopSignal {
    ensureDirs();
    const sig: LoopSignal = {
      id: uid("sig"),
      ts: nowIso(),
      source,
      type,
      payload,
      ...extra,
    };
    appendJsonl(LOOP_PATHS.signals, sig);
    return sig;
  },
  list(
    opts: { since?: string; source?: string; limit?: number } = {},
  ): LoopSignal[] {
    const { since, source, limit = 200 } = opts;
    let all = readJsonl(LOOP_PATHS.signals) as LoopSignal[];
    if (since) all = all.filter((s) => s.ts >= since);
    if (source) all = all.filter((s) => s.source === source);
    return all.slice(-limit);
  },
  count(): number {
    if (!existsSync(LOOP_PATHS.signals)) return 0;
    return readFileSync(LOOP_PATHS.signals, "utf8").split("\n").filter(Boolean)
      .length;
  },
  trim(max = MAX_SIGNALS): void {
    if (!existsSync(LOOP_PATHS.signals)) return;
    const lines = readFileSync(LOOP_PATHS.signals, "utf8")
      .split("\n")
      .filter(Boolean);
    if (lines.length <= max) return;
    const kept = lines.slice(-max);
    writeFileSync(LOOP_PATHS.signals, `${kept.join("\n")}\n`);
  },
};

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function readDecisions(): LoopDecisionBuckets {
  ensureDirs();
  const d = readJson<LoopDecisionBuckets>(LOOP_PATHS.decisions, emptyBuckets());
  for (const bucket of ["pending", "done", "dismissed"] as const) {
    if (Array.isArray(d[bucket])) {
      for (const dec of d[bucket]) normalizeDecision(dec);
    }
  }
  return d;
}

function writeDecisions(d: LoopDecisionBuckets): void {
  writeJsonAtomic(LOOP_PATHS.decisions, d);
}

function trimBucket(
  bucket: LoopDecision[],
  max = MAX_DECISIONS_PER_BUCKET,
): void {
  if (bucket.length <= max) return;
  bucket.splice(0, bucket.length - max);
}

export const decisions = {
  list(status: DecisionStatus | null = null): LoopDecision[] {
    const d = readDecisions();
    if (!status) return [...d.pending, ...d.done, ...d.dismissed];
    return (d[status] || []).slice();
  },
  pending(): LoopDecision[] {
    return readDecisions().pending;
  },
  add(
    input: Partial<LoopDecision> & {
      type: LoopDecision["type"];
      title: string;
      action: LoopDecision["action"];
    },
  ): LoopDecision {
    const d = readDecisions();
    const dec: LoopDecision = {
      id: input.id || uid("dec"),
      ts: input.ts || nowIso(),
      status: input.status || "pending",
      type: input.type,
      title: input.title,
      action: input.action,
      ...(input.signal_id ? { signal_id: input.signal_id } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(typeof input.confidence === "number"
        ? { confidence: input.confidence }
        : {}),
      ...(input.source_signal ? { source_signal: input.source_signal } : {}),
      ...(input.dialogue ? { dialogue: input.dialogue } : {}),
      ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    };
    normalizeDecision(dec);
    d.pending.unshift(dec);
    trimBucket(d.pending);
    writeDecisions(d);
    return dec;
  },
  get(id: string): LoopDecision | null {
    const d = readDecisions();
    return (
      [...d.pending, ...d.done, ...d.dismissed].find((x) => x.id === id) || null
    );
  },
  update(id: string, patch: Partial<LoopDecision>): LoopDecision | null {
    const d = readDecisions();
    for (const bucket of ["pending", "done", "dismissed"] as const) {
      const idx = d[bucket].findIndex((x) => x.id === id);
      if (idx >= 0) {
        d[bucket][idx] = { ...d[bucket][idx], ...patch };
        normalizeDecision(d[bucket][idx]);
        writeDecisions(d);
        return d[bucket][idx];
      }
    }
    return null;
  },
  moveTo(
    id: string,
    bucket: DecisionStatus,
    result: unknown = null,
  ): LoopDecision | null {
    const d = readDecisions();
    for (const src of ["pending", "done", "dismissed"] as const) {
      const idx = d[src].findIndex((x) => x.id === id);
      if (idx >= 0) {
        const item: LoopDecision = {
          ...d[src][idx],
          status: bucket,
          result: result ?? d[src][idx].result ?? null,
          completed_at: nowIso(),
        };
        normalizeDecision(item);
        d[src].splice(idx, 1);
        d[bucket].unshift(item);
        trimBucket(d[bucket]);
        writeDecisions(d);
        return item;
      }
    }
    return null;
  },
  count(): { pending: number; done: number; dismissed: number } {
    const d = readDecisions();
    return {
      pending: d.pending.length,
      done: d.done.length,
      dismissed: d.dismissed.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Status (last tick summary) — best-effort snapshot, no schema contract
// ---------------------------------------------------------------------------

export interface LoopStatusSnapshot {
  lastTickAt?: string;
  lastSignalCount?: number;
  lastDecisionCount?: number;
  lastError?: string;
}

export function readStatus(): LoopStatusSnapshot {
  return readJson<LoopStatusSnapshot>(LOOP_PATHS.status, {});
}

export function writeStatus(s: LoopStatusSnapshot): void {
  writeJsonAtomic(LOOP_PATHS.status, s);
}

// ---------------------------------------------------------------------------
// Lightweight line logger
// ---------------------------------------------------------------------------

export function log(line: string): void {
  ensureDirs();
  const stamp = new Date().toISOString();
  try {
    appendFileSync(LOOP_PATHS.log, `[${stamp}] ${line}\n`);
  } catch {
    /* best effort */
  }
}
