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
  DecisionType,
  LoopDecision,
  LoopDecisionBuckets,
  LoopMutes,
  LoopSignal,
  MuteRule,
  MuteScope,
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

// ---------------------------------------------------------------------------
// Noop / tick-summary filter (#288)
// ---------------------------------------------------------------------------
//
// The agentic tick occasionally emits a "Tick clean. 0 new decisions"-shaped
// record that is non-actionable. We never want such records in `pending` —
// the pet reads `pending` to surface cards, and any external watch loop
// fires an OS notification for every fresh `pending` row.
//
// A record is rejected if ANY of the following is true:
//   - type === "noop"
//   - type === "tick_summary"
//   - title matches /^\s*0\s+new\s+decision/i   (defence in depth — the
//     agent occasionally drifts on the literal "type")
//   - context.source === "loop_tick"            (explicit per-tick marker)
//   - context.noop === true                     (escape hatch for the agent)
//
// Rejection is silent to callers (returns null) so the agentic tick
// pipeline keeps working unchanged. The pet watcher polls `decisions.json`
// mtime; rejected records never write the file, so the mtime is stable
// and no spurious "presenting" state fires.

const NOOP_TITLE_RE = /^\s*0\s+new\s+decision/i;

export function isNoopDecision(input: {
  type?: string;
  title?: string;
  context?: Record<string, unknown>;
}): boolean {
  if (!input) return false;
  if (input.type === "noop" || input.type === "tick_summary") return true;
  if (typeof input.title === "string" && NOOP_TITLE_RE.test(input.title))
    return true;
  const ctx = input.context;
  if (ctx && typeof ctx === "object") {
    if (ctx.source === "loop_tick") return true;
    if (ctx.noop === true) return true;
  }
  return false;
}

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
  ): LoopDecision | null {
    // #288 — drop non-actionable tick / noop records at the store layer so
    // they never reach `pending` (and therefore never reach the pet bubble
    // or any external watch loop's notification fan-out).
    if (isNoopDecision(input)) {
      log(
        `[decisions.add] rejected noop/tick_summary record: type=${input.type} title=${JSON.stringify(input.title)}`,
      );
      return null;
    }
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
// Mutes — dismiss-driven skip rules. When a user dismisses a decision, we
// record a normalised key derived from the signal so the next tick does not
// re-surface the same kind of signal (e.g. a re-edited Obsidian note with a
// fresh `mtime_ms`, or a follow-up email from the same sender).
// ---------------------------------------------------------------------------

const MAX_MUTES = 1000;

/** Decision types eligible for auto-muting on dismiss. brief / wrap are
 *  explicitly excluded — those are scheduled and must resurface each day.
 *  `quiet_digest` (#316) is INCLUDED — a digest the user dismisses should
 *  not auto-resurface on the next tick. */
export const MUTABLE_DECISION_TYPES: ReadonlySet<DecisionType> = new Set([
  "rsvp",
  "draft_reply",
  "slack_reply",
  "review_pr",
  "todo",
  "deadline_reminder",
  "release_plan",
  "requirement_synthesis",
  "linear_review",
  "contact_update",
  "doc_update",
  "quiet_digest",
]);

function emptyMutes(): LoopMutes {
  return { version: 1, rules: [], keys: [] };
}

/** Module-level cache — invalidated by `mutes.invalidate()` or by writers
 *  after they touch the file. Keeps `mutes.has()` cheap (Set lookup) in the
 *  hot classify path. */
let mutesCache: LoopMutes | null = null;

function readMutes(): LoopMutes {
  if (mutesCache) return mutesCache;
  ensureDirs();
  const m = readJson<LoopMutes>(LOOP_PATHS.mutes, emptyMutes());
  // Defensive: any drift between `rules` and `keys` is repaired on read.
  const recomputed = Array.from(new Set((m.rules ?? []).map((r) => r.key)));
  mutesCache = {
    version: 1,
    rules: Array.isArray(m.rules) ? m.rules : [],
    keys: recomputed,
  };
  return mutesCache;
}

function writeMutes(m: LoopMutes): void {
  // Always re-derive `keys` from `rules` before writing — defence in depth so
  // a future mutation that forgets to update `keys` cannot desync the file.
  const keys = Array.from(new Set(m.rules.map((r) => r.key)));
  const out: LoopMutes = { version: 1, rules: m.rules, keys };
  writeJsonAtomic(LOOP_PATHS.mutes, out);
  mutesCache = out;
}

/**
 * Compute the normalised mute key for a signal. Returns `null` when the
 * signal type has no stable identity to mute on (e.g. an `insight` without a
 * canonical id). Pure function — reused by `classify.ts` and the dismiss
 * write-sites so they stay in lockstep.
 */
export function muteKeyFor(
  signal: LoopSignal,
): { key: string; scope: MuteScope } | null {
  const p = signal.payload as Record<string, unknown>;

  if (signal.type === "email") {
    const raw = String(p.from ?? p.sender ?? "")
      .trim()
      .toLowerCase();
    if (!raw) return null;
    return { key: raw, scope: { kind: "email", from: raw } };
  }

  if (signal.type === "calendar_event") {
    const org = String(p.organizer ?? "")
      .trim()
      .toLowerCase();
    if (org) {
      return { key: org, scope: { kind: "calendar_event", organizer: org } };
    }
    const eid = String(p.eventId ?? p.id ?? "")
      .trim()
      .toLowerCase();
    if (!eid) return null;
    return {
      key: eid,
      scope: { kind: "calendar_event", organizer: eid, fallback: "eventId" },
    };
  }

  if (signal.type === "slack_message") {
    // Real user ids are alphanumeric strings; broadcast markers
    // ("channel" / "here" / "everyone") should be ignored — they aren't a
    // single person to mute.
    const rawUser = String(p.user ?? "").trim();
    const isBroadcastMarker = /^(channel|here|everyone)$/i.test(rawUser);
    if (rawUser && !isBroadcastMarker) {
      const user = rawUser.toLowerCase();
      return { key: `user:${user}`, scope: { kind: "slack_message", user } };
    }
    const rawChannel = String(p.channel ?? "").trim();
    if (rawChannel) {
      const channel = rawChannel.toLowerCase();
      return {
        key: `channel:${channel}`,
        scope: { kind: "slack_message", channel },
      };
    }
    return null;
  }

  if (signal.type === "obsidian_note_changed") {
    const path = String(p.path ?? "").trim();
    if (!path) return null;
    const key = path.toLowerCase();
    return { key, scope: { kind: "obsidian_note_changed", path: key } };
  }

  if (signal.type === "github_pr") {
    const repo = String(p.repo ?? "")
      .trim()
      .toLowerCase();
    if (!repo) return null;
    return { key: repo, scope: { kind: "github_pr", repo } };
  }

  if (signal.type === "github_issue") {
    const repo = String(p.repo ?? "")
      .trim()
      .toLowerCase();
    if (!repo) return null;
    return { key: repo, scope: { kind: "github_issue", repo } };
  }

  if (signal.type === "linear_issue") {
    const team = p.team as Record<string, unknown> | string | undefined;
    const teamKey =
      typeof team === "object" && team && typeof team.key === "string"
        ? team.key.trim().toLowerCase()
        : typeof team === "string"
          ? team.trim().toLowerCase()
          : "";
    if (teamKey) {
      return {
        key: teamKey,
        scope: { kind: "linear_issue", team: teamKey },
      };
    }
    const project = p.project as Record<string, unknown> | string | undefined;
    const projectId =
      typeof project === "object" && project && typeof project.id === "string"
        ? project.id.trim().toLowerCase()
        : typeof project === "string"
          ? project.trim().toLowerCase()
          : "";
    if (projectId) {
      return {
        key: projectId,
        scope: { kind: "linear_issue", project: projectId },
      };
    }
    return null;
  }

  return null;
}

export const mutes = {
  /** O(1) membership check against the cached key set. */
  has(key: string): boolean {
    return readMutes().keys.includes(key);
  },
  /** List rules, newest first. */
  list(): MuteRule[] {
    return [...readMutes().rules].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  },
  /** Idempotent add — same key returns the existing rule unchanged.
   *  Caps `rules.length` at `MAX_MUTES` by dropping the oldest half of
   *  unique-key entries when the limit is exceeded. */
  add(rule: Omit<MuteRule, "createdAt"> & { createdAt?: string }): MuteRule {
    const cur = readMutes();
    const existing = cur.rules.find((r) => r.key === rule.key);
    if (existing) {
      mutesCache = null;
      return existing;
    }
    const createdAt = rule.createdAt ?? nowIso();
    const next: MuteRule = {
      key: rule.key,
      scope: rule.scope,
      createdAt,
      ...(rule.source ? { source: rule.source } : {}),
    };
    const rules = [...cur.rules, next];
    if (rules.length > MAX_MUTES) {
      // Trim the oldest half by createdAt to give headroom and keep the
      // most-recent dismisses intact.
      const sorted = rules
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const dropCount = sorted.length - Math.floor(MAX_MUTES / 2);
      const survivors = sorted.slice(dropCount);
      writeMutes({
        version: 1,
        rules: survivors,
        keys: survivors.map((r) => r.key),
      });
      return next;
    }
    writeMutes({ version: 1, rules, keys: rules.map((r) => r.key) });
    return next;
  },
  /** Remove by key — exposed for tests and a future mute UI. */
  remove(key: string): boolean {
    const cur = readMutes();
    const next = cur.rules.filter((r) => r.key !== key);
    if (next.length === cur.rules.length) return false;
    writeMutes({ version: 1, rules: next, keys: next.map((r) => r.key) });
    return true;
  },
  /** Drop the in-memory cache — call after external file edits or in tests. */
  invalidate(): void {
    mutesCache = null;
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
