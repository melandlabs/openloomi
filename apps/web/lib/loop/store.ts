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
import { derivePriority } from "./readiness";
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
//
// SP-1: also stamps `context.priority` (and the top-level `dec.priority`
// mirror) via `readiness.ts::derivePriority`. The Rust watcher reads
// `context.priority` verbatim to render the chip; the TS side reads
// either field, preferring the top-level when present. `dec.priority`
// is set whenever `derivePriority` runs, so the two stay in lockstep.
function normalizeDecision(
  dec: LoopDecision | null | undefined,
  now: Date = new Date(),
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
  // SP-1: compute the priority once and persist it under `context.priority`
  // (Rust source of truth) AND mirror at the top level (TS consumers).
  // The Rust watcher reads `context.priority` via `dec_priority(d)`; the
  // pet bubble + dashboard both rely on the persisted value, so a record
  // missing it would silently fall back to "p2" — which is the safer
  // default but masks the real ranking. The dual-write keeps both worlds
  // happy without recomputing on every read.
  if (ctx.priority === undefined) {
    const computed = derivePriority(
      dec as unknown as { type: string; action: LoopDecision["action"] },
      now,
    );
    ctx.priority = computed;
    (dec as unknown as Record<string, unknown>).priority = computed;
  } else if (dec.priority === undefined) {
    // Legacy record that already has `context.priority` (written by an
    // earlier patch or the migration) but no top-level mirror. Sync up.
    dec.priority = ctx.priority as LoopDecision["priority"];
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
//   - type === "unknown"                        (#378 — passive/unmapped
//     signals must NOT fan out into one Run card each; they are aggregated
//     into a read-only digest instead — see github-notifications.ts)
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
  if (
    input.type === "noop" ||
    input.type === "tick_summary" ||
    input.type === "unknown"
  )
    return true;
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
  const raw = readJson<LoopDecisionBuckets & { version?: number }>(
    LOOP_PATHS.decisions,
    emptyBuckets(),
  );
  const d: LoopDecisionBuckets = {
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    done: Array.isArray(raw.done) ? raw.done : [],
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed : [],
  };
  for (const bucket of ["pending", "done", "dismissed"] as const) {
    if (!Array.isArray(d[bucket])) d[bucket] = [];
    for (const dec of d[bucket]) normalizeDecision(dec);
  }
  // #378 — migrate stale non-actionable pending cards into `dismissed` on
  // read. Before the notification aggregator existed, each passive
  // `github_notification` became its own `unknown` decision, leaving a
  // burst of Run-carrying cards in `pending`. `isNoopDecision` now rejects
  // those at ingest, but records already on disk must also be cleaned up so
  // an upgrade doesn't leave the burst alive. We keep them (audit trail) and
  // stamp a filtering reason instead of deleting.
  const survivors: LoopDecision[] = [];
  const migrated: LoopDecision[] = [];
  for (const dec of d.pending) {
    if (isNoopDecision(dec)) {
      migrated.push({
        ...dec,
        status: "dismissed",
        result: dec.result ?? { filtered: "non_actionable" },
        context: {
          ...(dec.context ?? {}),
          filtered_reason: "non_actionable_migrated",
        },
        completed_at: dec.completed_at ?? nowIso(),
      });
    } else {
      survivors.push(dec);
    }
  }
  if (migrated.length > 0) {
    d.pending = survivors;
    d.dismissed = [...migrated, ...d.dismissed];
    trimBucket(d.dismissed);
    log(
      `[decisions.read] migrated ${migrated.length} non-actionable pending card(s) → dismissed`,
    );
  }
  // SP-1 — one-shot backfill of `context.priority` (and top-level
  // `dec.priority` mirror) for legacy rows. `normalizeDecision` above
  // already stamped priority for every record on the first read
  // after this gate fires; the only question is whether to persist
  // the backfill or rely on the read-time computation.
  //
  // Persist once, gate by `version: 2`. Without the gate, every poll
  // would re-write the file (mtime churn → watcher wakes → re-write)
  // because `normalizeDecision` mutates in place. The Rust watcher
  // depends on mtime/contents-based transition diffs to drive its
  // `loop:state` / `loop:decision` emissions; if the backfill re-wrote
  // the file indefinitely, the bubble would re-fire on every poll.
  // Once `version: 2` lands, future reads see the gate and no-op.
  if ((raw as { version?: number }).version !== 2) {
    writeDecisions(d);
    log(
      `[decisions.read] stamped version:2 — SP-1 priority backfill persisted`,
    );
  }
  return d;
}

function writeDecisions(d: LoopDecisionBuckets): void {
  // SP-1 — stamp `version: 2` on every write so the readDecisions
  // migration gate is sticky. The migration fires once on the first
  // read after upgrade; every subsequent write keeps the flag set,
  // so the gate is idempotent.
  const stamped = { version: 2 as const, ...d };
  writeJsonAtomic(LOOP_PATHS.decisions, stamped);
}

function trimBucket(
  bucket: LoopDecision[],
  max = MAX_DECISIONS_PER_BUCKET,
): void {
  if (bucket.length <= max) return;
  bucket.splice(0, bucket.length - max);
}

// ---------------------------------------------------------------------------
// RSVP dedup helpers (#364 follow-up)
// ---------------------------------------------------------------------------
//
// Pull `eventId` from a decision's `action.params`. Returns `null` when
// the shape is wrong — callers treat null as "no dedup possible" and let
// the decision through.
function readRsvpEventId(
  action: LoopDecision["action"] | undefined,
): string | null {
  if (!action || typeof action !== "object") return null;
  const params = (action as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const eid = (params as Record<string, unknown>).eventId;
  return typeof eid === "string" && eid.length > 0 ? eid : null;
}

// Pull `start` (ISO 8601) from a decision's `action.params`. Returned
// verbatim — the future-check is a separate helper so the two can be
// unit-tested in isolation.
function readRsvpStart(
  action: LoopDecision["action"] | undefined,
): string | null {
  if (!action || typeof action !== "object") return null;
  const params = (action as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const start = (params as Record<string, unknown>).start;
  return typeof start === "string" && start.length > 0 ? start : null;
}

// True iff the parsed `start` timestamp is strictly after now. Used by
// the RSVP dedup gate to decide whether an existing decision still
// blocks new pending RSVPs for the same event. Unparseable / missing
// `start` defaults to `true` (treat as future) — under-surfacing is
// safer than re-pestering.
function isEventStartInFuture(start: string | null): boolean {
  if (!start) return true;
  const ms = Date.parse(start);
  if (Number.isNaN(ms)) return true;
  return ms > Date.now();
}

// Find any existing decision (pending / done / dismissed) for the same
// calendar event. Scans all three buckets so a Yes → Done AND a
// Yes → Dismissed chain both count. Returns the first match (FIFO
// across the read order — pending → done → dismissed).
function findExistingRsvpForEvent(eventId: string): LoopDecision | null {
  const d = readDecisions();
  const all: LoopDecision[] = [...d.pending, ...d.done, ...d.dismissed];
  for (const dec of all) {
    if (dec.type !== "rsvp") continue;
    if (readRsvpEventId(dec.action) === eventId) return dec;
  }
  return null;
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
    // #288 / #378 — drop non-actionable tick / noop / unknown records at the
    // store layer so they never reach `pending` (and therefore never reach
    // the pet bubble or any external watch loop's notification fan-out).
    if (isNoopDecision(input)) {
      log(
        `[decisions.add] rejected non-actionable record: type=${input.type} title=${JSON.stringify(input.title)}`,
      );
      return null;
    }
    // RSVP dedup gate (#364 follow-up). Once a user has responded (or
    // dismissed) a calendar invite, the same event id must not produce
    // a new pending RSVP on every tick — otherwise the watcher polls
    // `pending.first()` every 2s and re-shows the card (#364 user
    // report: "user said Yes, the same RSVP card popped up again").
    //
    // Window: until the event's `start` time. The user can respond
    // once per future meeting; past meetings are no longer worth
    // nagging about. When `start` is missing or unparseable we treat
    // it as "future" (block) — better to under-surface than to
    // re-pester the user about a meeting whose time we can't read.
    if (input.type === "rsvp") {
      const incomingEventId = readRsvpEventId(input.action);
      if (incomingEventId) {
        const existing = findExistingRsvpForEvent(incomingEventId);
        if (existing && isEventStartInFuture(readRsvpStart(existing.action))) {
          log(
            `[decisions.add] rejected RSVP duplicate: eventId=${incomingEventId} existing=${existing.id} status=${existing.status}`,
          );
          return null;
        }
      }
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
 *  not auto-resurface on the next tick. `email_burst_digest` (SP-3) is
 *  also INCLUDED — a burst digest the user dismisses should suppress the
 *  next burst from the same sender, paired with the SP-4 cooldown. */
export const MUTABLE_DECISION_TYPES: ReadonlySet<DecisionType> =
  new Set<DecisionType>([
    "rsvp",
    "email_reply",
    "im_reply",
    "review_pr",
    "todo",
    "deadline_reminder",
    "release_plan",
    "requirement_synthesis",
    "linear_review",
    "contact_update",
    "doc_update",
    "quiet_digest",
    "email_burst_digest",
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
  /**
   * SP-4 — true when the rule for `key` carries a `cooldown_until`
   * strictly in the future. Returns `false` for rules without
   * `cooldown_until` (so the existing mute behaviour is preserved
   * bit-for-bit — cooldowns are additive, not replacement).
   *
   * Used by `notifyForDecisions` to suppress the OS-notification
   * fan-out for a source the user just dismissed, while still
   * letting the bubble surface the underlying decision.
   */
  cooldownActive(key: string, now: Date = new Date()): boolean {
    const rule = readMutes().rules.find((r) => r.key === key);
    if (!rule || !rule.cooldown_until) return false;
    const until = Date.parse(rule.cooldown_until);
    if (Number.isNaN(until)) return false;
    return until > now.getTime();
  },
  /** List rules, newest first. */
  list(): MuteRule[] {
    return [...readMutes().rules].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  },
  /**
   * Idempotent add — same key returns the existing rule unchanged.
   * Caps `rules.length` at `MAX_MUTES` by dropping the oldest half of
   * unique-key entries when the limit is exceeded.
   *
   * SP-4: accepts an optional `cooldown_until` ISO string. When set,
   * the rule is persisted with the cooldown timestamp and the
   * `notifyForDecisions` fan-out consults `cooldownActive` to
   * throttle the OS-notification path. A rule carrying a past
   * `cooldown_until` degrades to a regular mute (still blocks per
   * `mutes.has`). Callers should pass an ISO timestamp strictly in
   * the future — the function does not validate that the value is
   * sensible, so a misconfigured cooldown_until that's already past
   * simply no-ops.
   */
  add(rule: Omit<MuteRule, "createdAt"> & { createdAt?: string }): MuteRule {
    const cur = readMutes();
    const existing = cur.rules.find((r) => r.key === rule.key);
    if (existing) {
      // Refresh the cooldown_until if the caller is bumping an
      // existing rule. This is the "second dismiss within an hour
      // extends the window" semantics — without the refresh, a
      // second dismiss would land on the same already-existing rule
      // and the cooldown wouldn't extend.
      if (
        rule.cooldown_until &&
        rule.cooldown_until !== existing.cooldown_until
      ) {
        const updated: MuteRule = {
          ...existing,
          cooldown_until: rule.cooldown_until,
        };
        const rules = cur.rules.map((r) => (r.key === rule.key ? updated : r));
        writeMutes({
          version: 1,
          rules,
          keys: rules.map((r) => r.key),
        });
        return updated;
      }
      mutesCache = null;
      return existing;
    }
    const createdAt = rule.createdAt ?? nowIso();
    const next: MuteRule = {
      key: rule.key,
      scope: rule.scope,
      createdAt,
      ...(rule.source ? { source: rule.source } : {}),
      ...(rule.cooldown_until ? { cooldown_until: rule.cooldown_until } : {}),
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
  /**
   * #361 — number of signals received at the last tick whose `source`
   * / `type` had no canonical Loop mapping and were intentionally
   * dropped. Surfaced by the readiness API so users aren't left
   * wondering why an authorized integration produced zero decisions.
   */
  unsupportedSignals?: number;
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
