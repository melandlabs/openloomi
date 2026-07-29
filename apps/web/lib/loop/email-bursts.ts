/**
 * Email burst aggregator (SP-3).
 *
 * Direct `email` signals can arrive in short bursts from a single
 * sender — mailing-list traffic, status-page notifications, an
 * autoresponder loop, etc. Left to the per-signal classify path,
 * each email becomes its own `email_reply` decision and the pet
 * bubble fans out N copies of a near-identical card.
 *
 * This module turns a burst into ONE read-only `email_burst_digest`
 * card:
 *   - recognises `email` signals arriving via the built-in `gmail`
 *     pull or a custom `email` channel;
 *   - groups by lowercase sender address (the canonical
 *     `mutes.ts::muteKeyFor({ type: "email", from })` shape — the
 *     existing mutes pipeline already key-dedupes on this exact
 *     normalised value, so a digest dismissed now will block the
 *     next burst from the same sender for the natural re-mute
 *     window);
 *   - applies a 5-emails / 15-min threshold; below that, the
 *     per-signal path still wins (a single important reply is more
 *     valuable than a digest);
 *   - excludes threadIds already represented by a typed `email_reply`
 *     decision or a prior burst digest, so repeated ticks do not
 *     re-pester;
 *   - merges freshly-unseen items into an existing pending digest
 *     instead of creating a second summary card.
 *
 * Mirrors `github-notifications.ts` deliberately — the
 * `classify → digest → decide` shape is identical so the agentic
 * tick wiring in `tick.ts` can compose them the same way. No URL
 * derivation here (email `threadId` is enough identity).
 *
 * Everything here is PURE and READ-ONLY. It never sends mail and
 * never mutates external resources — it only reshapes signals the
 * tick already pulled into a decision the store can persist.
 */

import type { LoopDecision, LoopSignal } from "./types";

/** `action.params.module` value that marks an email-burst digest. */
export const EMAIL_BURSTS_MODULE = "email-bursts";

/** Signal sources that can carry `email` records for this digest.
 *  Mirrors `GITHUB_NOTIFICATION_SOURCES` — kept narrow on purpose:
 *  we only aggregate signals that arrived through Loop's canonical
 *  pull, not arbitrary `manual` / `insights` injects (those carry
 *  user intent and should be surfaced individually). */
const EMAIL_SIGNAL_SOURCES = new Set(["gmail", "email"]);

/** Hard cap on how many items one burst card lists. Keeps the
 *  read-only summary bounded even if a sender firehoses. Newest
 *  win. */
export const MAX_EMAIL_BURST_ITEMS = 10;

/** Minimum number of emails in the window before we aggregate. Below
 *  this the per-signal `email_reply` cards are more useful — a
 *  single important reply beats a digest of one item. */
export const BURST_THRESHOLD = 5;

/** Lookback window for the burst (ms). Combined with the threshold:
 *  5 emails in 15 min → digest. Spaced-out sends remain per-signal. */
export const BURST_WINDOW_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Item shape
// ---------------------------------------------------------------------------

export interface EmailBurstItem {
  /** Canonical, source-independent dedupe key. */
  key: string;
  /** Lowercased sender address — the burst grouping axis. */
  from: string;
  /** Optional display name (preserved for the card render). */
  fromName?: string;
  /** Subject (best-effort, truncated). */
  title: string;
  /** Short preview snippet (best-effort, truncated). */
  snippet?: string;
  /** ISO timestamp the signal arrived. */
  ts: string;
  /** Thread id — used to suppress overlap with typed `email_reply`
   *  decisions. */
  threadId?: string;
}

// ---------------------------------------------------------------------------
// Small payload accessors
// ---------------------------------------------------------------------------

function payloadOf(signal: LoopSignal): Record<string, unknown> {
  const p = signal.payload;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** Lowercased sender email. Same extraction as `mutes.ts::muteKeyFor`
 *  so digest dismissal lines up with future per-sender mutes. */
function fromAddress(p: Record<string, unknown>): string {
  const raw = firstString(p.from, p.sender) ?? "";
  const m = raw.match(/<([^>]+)>/);
  const addr = m ? m[1] : raw;
  return addr.toLowerCase().trim();
}

/** Display name (everything before the angle bracket, or empty). */
function fromNameOf(p: Record<string, unknown>): string | undefined {
  const raw = firstString(p.from, p.sender) ?? "";
  const m = raw.match(/^"?([^"<]*?)"?\s*<[^>]+>/);
  const name = m ? m[1].trim() : "";
  return name || undefined;
}

// ---------------------------------------------------------------------------
// Recognition + canonicalization
// ---------------------------------------------------------------------------

/** True when a signal is an email arriving via the built-in `gmail`
 *  pull or a custom `email` channel. */
export function isEmailBurstSignal(
  signal: LoopSignal | null | undefined,
): boolean {
  if (!signal || typeof signal !== "object") return false;
  if (signal.type !== "email") return false;
  return EMAIL_SIGNAL_SOURCES.has(String(signal.source));
}

/** Derive a source-independent canonical key for an email signal.
 *  Prefers the email messageId (stable across `gmail` and `email`
 *  surfaces), then `threadId` + from, then subject + from. The
 *  per-burst coverage collector in `collectCoveredEmailBurstKeys`
 *  uses the same shape so a typed `email_reply` decision keyed by
 *  threadId suppresses the matching digest item. */
export function emailBurstKey(
  signal: LoopSignal | null | undefined,
): string | null {
  if (!signal || typeof signal !== "object") return null;
  const p = payloadOf(signal);
  const msgId = firstString(p.messageId, p.id, p.message_id);
  if (msgId) return `email:msg:${msgId}`;
  const threadId = firstString(p.threadId, p.thread_id);
  const from = fromAddress(p);
  if (threadId && from) return `email:thread:${from}:${threadId}`;
  const subject = firstString(p.subject);
  if (from && subject)
    return `email:from-subject:${from}:${subject.toLowerCase()}`;
  return null;
}

/** Build a normalised item from a single email signal, or null when
 *  the signal lacks a stable identity. */
function toEmailItem(signal: LoopSignal): EmailBurstItem | null {
  const key = emailBurstKey(signal);
  if (!key) return null;
  const p = payloadOf(signal);
  const from = fromAddress(p);
  if (!from) return null;
  const title = firstString(p.subject) ?? "(no subject)";
  const snippet = firstString(p.snippet, p.body) ?? undefined;
  const ts = signal.ts || new Date().toISOString();
  const threadId = firstString(p.threadId, p.thread_id) ?? undefined;
  const name = fromNameOf(p);
  return {
    key,
    from,
    ...(name ? { fromName: name } : {}),
    title: title.slice(0, 160),
    ...(snippet ? { snippet: snippet.slice(0, 280) } : {}),
    ts,
    ...(threadId ? { threadId } : {}),
  };
}

/** Normalize + cross-source deduplicate a batch of signals into
 *  items. Non-email signals are ignored; signals with the same key
 *  collapse (newest ts wins on collision). */
export function normalizeEmailBursts(signals: LoopSignal[]): EmailBurstItem[] {
  const map = new Map<string, EmailBurstItem>();
  for (const s of signals) {
    if (!isEmailBurstSignal(s)) continue;
    const item = toEmailItem(s);
    if (!item) continue;
    const existing = map.get(item.key);
    if (!existing) {
      map.set(item.key, item);
      continue;
    }
    // Newest ts wins on collision.
    if (item.ts > existing.ts) {
      map.set(item.key, item);
    } else {
      // Merge snippet / fromName if the new one has them and the
      // existing doesn't.
      map.set(item.key, {
        ...existing,
        ...(item.snippet && !existing.snippet ? { snippet: item.snippet } : {}),
        ...(item.fromName && !existing.fromName
          ? { fromName: item.fromName }
          : {}),
      });
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Burst grouping + coverage
// ---------------------------------------------------------------------------

interface SenderBucket {
  from: string;
  items: EmailBurstItem[];
}

/** Group items by lowercase sender. Items with the same `from`
 *  collapse into one bucket; the bucket is then evaluated against
 *  BURST_THRESHOLD + BURST_WINDOW_MS. */
function groupBySender(items: EmailBurstItem[]): SenderBucket[] {
  const map = new Map<string, SenderBucket>();
  for (const it of items) {
    let bucket = map.get(it.from);
    if (!bucket) {
      bucket = { from: it.from, items: [] };
      map.set(it.from, bucket);
    }
    bucket.items.push(it);
  }
  return [...map.values()];
}

/** True when a bucket qualifies as a burst: at least BURST_THRESHOLD
 *  items, and the spread between oldest and newest is within
 *  BURST_WINDOW_MS. */
function isBurst(bucket: SenderBucket, now: number): boolean {
  if (bucket.items.length < BURST_THRESHOLD) return false;
  const sorted = bucket.items.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const oldest = Date.parse(sorted[0].ts);
  const newest = Date.parse(sorted[sorted.length - 1].ts);
  if (Number.isNaN(oldest) || Number.isNaN(newest)) {
    // Unparseable timestamps: fall through to the size-only check
    // — if we have BURST_THRESHOLD items from the same sender, that's
    // still a burst worth surfacing.
    return true;
  }
  return newest - oldest <= BURST_WINDOW_MS;
}

/** True when a decision is an email-burst `email_burst_digest` card. */
export function isEmailBurstDecision(dec: LoopDecision): boolean {
  if (!dec || dec.type !== "email_burst_digest") return false;
  const params = dec.action?.params as Record<string, unknown> | undefined;
  const module =
    params?.module ??
    (dec.context && (dec.context as Record<string, unknown>).module);
  return module === EMAIL_BURSTS_MODULE;
}

/** Read the persisted items array off an email-burst digest
 *  decision. */
function readBurstItems(dec: LoopDecision): EmailBurstItem[] {
  const raw = (dec.context as Record<string, unknown> | undefined)?.items;
  if (!Array.isArray(raw)) return [];
  const out: EmailBurstItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const key = firstString(o.key);
    if (!key) continue;
    out.push({
      key,
      from: firstString(o.from) ?? "unknown",
      ...(firstString(o.fromName) ? { fromName: String(o.fromName) } : {}),
      title: firstString(o.title) ?? "(no subject)",
      ...(firstString(o.snippet) ? { snippet: String(o.snippet) } : {}),
      ts: firstString(o.ts) ?? new Date().toISOString(),
      ...(firstString(o.threadId) ? { threadId: String(o.threadId) } : {}),
    });
  }
  return out;
}

/**
 * Collect the email thread keys already represented by existing
 * decisions:
 *   - threadIds listed on any prior email-burst digest
 *     (`context.burst_keys`);
 *   - the `threadId` of any typed, NON-unknown `email_reply` decision
 *     whose `source_signal` is an email.
 *
 * Untyped `unknown` records are intentionally NOT treated as
 * summarized — they carry no real coverage and should not suppress
 * the burst.
 */
export function collectCoveredEmailBurstKeys(
  decisions: LoopDecision[],
): Set<string> {
  const set = new Set<string>();
  for (const d of decisions) {
    if (isEmailBurstDecision(d)) {
      const keys = (d.context as Record<string, unknown> | undefined)
        ?.burst_keys;
      if (Array.isArray(keys)) {
        for (const k of keys) if (typeof k === "string") set.add(k);
      }
      continue;
    }
    if (d.type === "unknown") continue;
    if (d.type !== "email_reply") continue;
    const src = d.source_signal;
    if (src && isEmailBurstSignal(src)) {
      const k = emailBurstKey(src);
      if (k) set.add(k);
    }
  }
  return set;
}

/** Find the first pending email-burst digest, or null. */
export function findPendingEmailBurst(
  decisions: LoopDecision[],
): LoopDecision | null {
  return (
    decisions.find((d) => d.status === "pending" && isEmailBurstDecision(d)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

function burstId(): string {
  return `email_burst_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

interface BuildDigestOpts {
  /** Reuse an existing decision id when merging into a pending digest. */
  id?: string;
  /** Timestamp for the (re)built digest. Defaults to now. */
  ts?: string;
  /** Original creation timestamp, preserved across merges for provenance. */
  createdTs?: string;
}

/** Build a bounded, read-only `email_burst_digest` decision from
 *  items. The decision carries NO executable action — `action.kind`
 *  is `email_burst_digest` and `params.module` marks it as the
 *  email-bursts summary, which the web card and pet card render
 *  read-only with a local "Mark as read". */
export function buildEmailBurstDigest(
  from: string,
  fromName: string | undefined,
  items: EmailBurstItem[],
  opts: BuildDigestOpts = {},
): LoopDecision {
  const bounded = items.slice(-MAX_EMAIL_BURST_ITEMS);
  const count = bounded.length;
  const ts = opts.ts ?? new Date().toISOString();
  const sender = fromName ? `${fromName} <${from}>` : from;
  const title = `${count} email${count === 1 ? "" : "s"} from ${sender}`;
  const dialogue = `${count} email${count === 1 ? "" : "s"} from ${sender} in the last ${Math.round(
    BURST_WINDOW_MS / 60_000,
  )} minutes.`;

  return {
    id: opts.id ?? burstId(),
    ts,
    status: "pending",
    type: "email_burst_digest",
    title,
    action: {
      kind: "email_burst_digest",
      params: { module: EMAIL_BURSTS_MODULE, from },
    },
    dialogue,
    nextStep: "Mark as read once you've caught up.",
    context: {
      module: EMAIL_BURSTS_MODULE,
      from,
      ...(fromName ? { fromName } : {}),
      count,
      burst_keys: bounded.map((i) => i.key),
      thread_ids: bounded
        .map((i) => i.threadId)
        .filter((v): v is string => typeof v === "string"),
      items: bounded.map((i) => ({
        key: i.key,
        from: i.from,
        ...(i.fromName ? { fromName: i.fromName } : {}),
        title: i.title,
        ...(i.snippet ? { snippet: i.snippet } : {}),
        ts: i.ts,
        ...(i.threadId ? { threadId: i.threadId } : {}),
      })),
      why: [
        `Grouped ${count} email${count === 1 ? "" : "s"} from ${from} into one read-only summary`,
      ],
      ...(opts.createdTs ? { created_ts: opts.createdTs } : {}),
    },
    confidence: 0.85,
  };
}

// ---------------------------------------------------------------------------
// Aggregation entry point
// ---------------------------------------------------------------------------

export interface EmailBurstInput {
  /** Recent signal window (the tick already pulled these). */
  signals: LoopSignal[];
  /** All decisions across pending / done / dismissed buckets. */
  decisions: LoopDecision[];
  /** Injectable clock for deterministic tests. */
  now?: number;
}

export interface EmailBurstAggregationResult {
  /**
   *  - "create" → no pending digest existed; `decision` is a fresh
   *    card to persist via `decisions.add()`.
   *  - "merge"  → a pending digest existed; `decision` (same id)
   *    carries the merged items and should be written via
   *    `decisions.update()`.
   *  - "noop"   → nothing new to surface; `decision` is null.
   */
  kind: "create" | "merge" | "noop";
  decision: LoopDecision | null;
  /** Keys added by this aggregation pass (empty for noop). */
  newKeys: string[];
}

/**
 * Aggregate email bursts (>= BURST_THRESHOLD from same sender within
 * BURST_WINDOW_MS) into a single read-only digest per sender.
 *
 * Pure: reads signals + existing decisions, returns an instruction
 * for the caller to persist. Never touches the store, mail servers,
 * or any external resource itself.
 */
export function aggregateEmailBursts(
  input: EmailBurstInput,
): EmailBurstAggregationResult {
  const items = normalizeEmailBursts(input.signals);
  if (items.length === 0) {
    return { kind: "noop", decision: null, newKeys: [] };
  }
  const now = input.now ?? Date.now();
  const buckets = groupBySender(items).filter((b) => isBurst(b, now));
  if (buckets.length === 0) {
    return { kind: "noop", decision: null, newKeys: [] };
  }
  // Coverage from everything EXCEPT the pending digests we'll merge
  // into (their own keys are preserved separately below).
  const pendingDigests = input.decisions
    .filter((d) => d.status === "pending" && isEmailBurstDecision(d))
    .map((d) => ({ from: fromOfDigest(d), dec: d }));
  const others = input.decisions.filter(
    (d) => !pendingDigests.some((p) => p.dec === d),
  );
  const covered = collectCoveredEmailBurstKeys(others);

  // Pick the largest burst from this tick. Multi-sender bursts at
  // once are rare; if they do happen, surfacing the largest first
  // matches "show me the loudest signal" without flooding the user.
  const candidate = buckets
    .slice()
    .sort((a, b) => b.items.length - a.items.length)[0];

  const pendingDigest = pendingDigests.find(
    (p) => p.from === candidate.from,
  )?.dec;

  const existingItems = pendingDigest ? readBurstItems(pendingDigest) : [];
  const existingKeys = new Set(existingItems.map((i) => i.key));
  const fresh = candidate.items.filter(
    (i) => !covered.has(i.key) && !existingKeys.has(i.key),
  );
  if (fresh.length === 0 && !pendingDigest) {
    return { kind: "noop", decision: null, newKeys: [] };
  }
  // If a pending digest exists but no fresh items, leave it alone.
  if (fresh.length === 0) {
    return { kind: "noop", decision: null, newKeys: [] };
  }
  const merged = pendingDigest ? [...existingItems, ...fresh] : fresh;
  const newKeys = fresh.map((i) => i.key);
  // Pick a friendly fromName from any item (first one wins).
  const fromName = candidate.items.find((i) => i.fromName)?.fromName;

  if (pendingDigest) {
    const decision = buildEmailBurstDigest(candidate.from, fromName, merged, {
      id: pendingDigest.id,
      ts: new Date(now).toISOString(),
      createdTs:
        ((pendingDigest.context as Record<string, unknown> | undefined)
          ?.created_ts as string | undefined) ?? pendingDigest.ts,
    });
    return { kind: "merge", decision, newKeys };
  }
  const decision = buildEmailBurstDigest(candidate.from, fromName, merged, {
    ts: new Date(now).toISOString(),
  });
  return { kind: "create", decision, newKeys };
}

function fromOfDigest(dec: LoopDecision): string {
  const ctx = dec.context as Record<string, unknown> | undefined;
  const fromParam = (dec.action?.params as Record<string, unknown> | undefined)
    ?.from;
  if (typeof fromParam === "string" && fromParam) return fromParam;
  if (ctx && typeof ctx.from === "string") return ctx.from;
  return "";
}
