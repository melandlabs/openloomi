/**
 * Loop connector cache — server-only I/O layer.
 *
 * This file owns the on-disk snapshot + agent-probe plumbing for the
 * Loop's connector status. Everything that touches `node:fs`, talks to the
 * composio bridge, or writes the probe-cooldown marker lives here.
 *
 * Pure helpers (capability derivation, the all-offline `FALLBACK_CONNECTORS`
 * list, etc.) live in `./connectors-pure` so the connected-accounts UI can
 * import them without dragging `node:fs` into the browser bundle.
 *
 * Two ways a connector snapshot reaches the cache:
 *
 *   1. **Tick pass** (`runAgentic` in `tick.ts`) — the full-pipeline
 *      prompt ends with a `result` event whose `connectors` block
 *      captures the agent's probed reality. The tick handler forwards
 *      it to `writeConnectorSnapshot` here.
 *
 *   2. **Explicit refresh** (`refreshConnectors` below) — the dev
 *      panel's "check connections" button or the
 *      `/api/loop/connectors?refresh=1` route fires a small
 *      "probe only" prompt at the agent (see `composio-bridge.ts`)
 *      which returns the same `connectors` block without going through
 *      the full pull/classify/persist pipeline.
 *
 * `listConnectors()` returns the canonical 6-entry shape (gmail /
 * google_calendar / github / slack / linear / obsidian) backed by the
 * most recent snapshot the agent produced, or by a sentinel all-false
 * fallback when no snapshot has ever been written.
 *
 * Cache TTL is 24h: ticks run every `intervalSec` (default 600s = 10min)
 * and the agent's probe is the ground truth — there's no point
 * thrashing the cache between ticks. Use `refreshConnectors()` (or
 * `/api/loop/connectors` with `{ refresh: true }`) when the UI genuinely
 * needs a fresh probe.
 *
 * Obsidian is file-system based and has no Composio adapter — it's
 * reported as `connected: false` with `lastError: "local-only"`; the
 * bridge backfills it automatically. Chronicle owns its watch state.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirs, LOOP_PATHS } from "./paths";
import { customChannels } from "./custom-channels";
import {
  FALLBACK_CONNECTORS,
  withConnectorCapability,
} from "./connectors-pure";
import type { ConnectorEntry } from "./types";

const CACHE_TTL_MS = 1 * 60 * 60 * 1000;

/**
 * #391 — the kind of failure the last connector probe hit. Mirrors the
 * failure arms of `ProbeOutcome` in `composio-bridge.ts` (timeout is
 * observed here in `refreshConnectors`'s silent race, the rest come
 * from the probe itself).
 */
export type ProbeErrorKind =
  | "transport_error"
  | "agent_http_error"
  | "empty_response"
  | "malformed_response"
  | "timeout";

/**
 * #391 — persisted diagnostic for the last failed probe. Lives on the
 * connector cache file alongside the (possibly stale) snapshot so the
 * next API read can return both the entries and the reason the probe
 * couldn't refresh them.
 */
export interface ProbeErrorInfo {
  kind: ProbeErrorKind;
  message: string;
  /** ISO timestamp of when the failure was recorded. */
  at: string;
}

interface ConnectorCache {
  fetchedAt: string;
  connectors: ConnectorEntry[];
  /** #391 — present when the most recent probe failed. */
  lastProbeError?: ProbeErrorInfo;
}

function readCache(): ConnectorCache | null {
  try {
    if (!existsSync(LOOP_PATHS.connectors)) return null;
    // The on-disk shape can carry the top-level stamp under either
    // `fetchedAt` (current `writeConnectorSnapshot`) or `updatedAt`
    // (older writes / external writers). Read both as a permissive
    // structural type so the cache survives shape drift.
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.connectors, "utf8"),
    ) as Partial<ConnectorCache> & {
      updatedAt?: unknown;
      connectors?: unknown;
      lastProbeError?: unknown;
    };
    if (!Array.isArray(raw?.connectors)) return null;
    // Resolve a stamp from any of: top-level `fetchedAt` (current
    // writer), top-level `updatedAt` (older writes / external writers),
    // or the max `fetchedAt` carried by the connector entries
    // themselves. Without this tolerance the UI falls back to the all-
    // offline FALLBACK_CONNECTORS sentinel whenever the on-disk shape
    // shifts — see issue: "LOOMI ONLINE card shows all channels
    // offline" — because the `if (!raw.fetchedAt)` guard above discards
    // a perfectly valid snapshot.
    const topLevel =
      typeof raw.fetchedAt === "string"
        ? raw.fetchedAt
        : typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : null;
    const entryMax = (raw.connectors as Array<{ fetchedAt?: unknown }>).reduce<
      string | null
    >((acc, c) => {
      const ts = c.fetchedAt;
      if (typeof ts !== "string" || !ts) return acc;
      if (!acc) return ts;
      return new Date(ts).getTime() > new Date(acc).getTime() ? ts : acc;
    }, null);
    const stamp = topLevel ?? entryMax;
    if (!stamp) return null;
    if (Date.now() - new Date(stamp).getTime() > CACHE_TTL_MS) return null;
    // Defensively treat any cache entry that lacks `probed` as
    // probed: true. Cron-executor and other external writers may have
    // written the snapshot before the field existed; if it's in the
    // cache, an agent did the work — just normalize the shape so the
    // UI doesn't render it as "Pending first probe".
    //
    // #361 — also stamp capability fields when missing so older cache
    // entries (written before the field existed) still render with the
    // semantic state on the next read.
    const connectors = (raw.connectors as ConnectorEntry[]).map((c) => {
      const probed =
        typeof (c as { probed?: unknown }).probed === "boolean"
          ? c
          : { ...c, probed: true };
      return withConnectorCapability(probed as ConnectorEntry);
    });
    const probeError = parseProbeError(raw.lastProbeError);
    return {
      fetchedAt: stamp,
      connectors,
      ...(probeError ? { lastProbeError: probeError } : {}),
    };
  } catch {
    return null;
  }
}

const PROBE_ERROR_KINDS: ReadonlySet<string> = new Set<ProbeErrorKind>([
  "transport_error",
  "agent_http_error",
  "empty_response",
  "malformed_response",
  "timeout",
]);

/**
 * Validate a raw `lastProbeError` blob from the on-disk cache into a
 * clean {@link ProbeErrorInfo}, or `null` when the shape is missing /
 * malformed. Permissive about extra fields (like `readCache`).
 */
function parseProbeError(raw: unknown): ProbeErrorInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const kind = rec.kind;
  if (typeof kind !== "string" || !PROBE_ERROR_KINDS.has(kind)) return null;
  const message = typeof rec.message === "string" ? rec.message : "";
  const at = typeof rec.at === "string" ? rec.at : new Date().toISOString();
  return { kind: kind as ProbeErrorKind, message, at };
}

/**
 * Public API — write the agent-reported connector snapshot. Called by the
 * tick handler when the agent's `result` event carries a `connectors`
 * block (see `tick-prompt.ts` §0 hook).
 *
 * Stamps #361 capability fields on each entry before persisting so the
 * readiness API can return a semantic state without re-deriving it on
 * every request.
 */
export function writeConnectorSnapshot(connectors: ConnectorEntry[]): void {
  ensureDirs();
  try {
    const stamped = connectors.map(withConnectorCapability);
    writeFileSync(
      LOOP_PATHS.connectors,
      JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          connectors: stamped,
        } satisfies ConnectorCache,
        null,
        2,
      ),
    );
  } catch (e) {
    console.warn("[loop.connectors] cache write failed:", e);
  }
}

/**
 * Returns the agent-reported (or cached) connector status. When no
 * snapshot has been written yet, returns the FALLBACK list with all
 * entries marked `connected: false` so the UI can still render the pill
 * row.
 *
 * `opts.force = true` bypasses the cache and returns the FALLBACK
 * list — useful for tests that want a deterministic "no data" baseline.
 * Live refresh goes through `refreshConnectors()` which dispatches an
 * agent probe via the bridge.
 *
 * On cache miss, this delegates to `refreshConnectors({ silent: true })`
 * so the user never sees "all OFF" right after install — the first
 * open of the Loomi Online card auto-probes and the pill row repaints
 * to truth once the agent returns or the `PROBE_TIMEOUT_MS` ceiling
 * fires. The cache is
 * the fast path; the probe is the recovery.
 */
export async function listConnectors(
  opts: { force?: boolean } = {},
): Promise<ConnectorEntry[]> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return appendCustomChannels(cached.connectors);
  }
  // Cache miss (or force=true) → delegate to refresh. When called from
  // the regular UI path, this fires a short-timeout silent probe
  // asynchronously and returns the FALLBACK sentinel — the UI renders
  // "Pending first probe" pills immediately and the probe lands in the
  // background. Without this delegation, every fresh install sees the
  // lying "all offline" state for the entire first session.
  return refreshConnectors({ silent: true });
}

// `silent` probe budget. The agent's full probe (see `composio-bridge.ts`'s
// `invokeAgentPrompt({ timeoutMs: 10 * 60 * 1000 })`) can legitimately
// take several minutes for a cold first probe on a fresh install — it
// has to spin up the agent runtime, load the `composio` skill, run the
// CLI, and enumerate all 5 toolkits. The previous 6 s budget was so
// tight that the race almost always lost, so every card open would fall
// back to the FALLBACK sentinel and show "Awaiting first probe".
//
// 10 minutes mirrors the upper bound of the underlying agent probe, so
// the `silent` race and the underlying SSE timeout align — whichever
// hits first is the effective ceiling. In practice the silent path
// usually resolves much sooner; the long ceiling just makes sure a slow
// first probe doesn't get short-circuited into the cooldown fallback.
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_COOLDOWN_MS = 30 * 1000;

interface ConnectorCacheWithCooldown {
  fetchedAt?: unknown;
  connectors?: unknown;
  /**
   * Set when `refreshConnectors({silent:true})` hits its
   * `PROBE_TIMEOUT_MS` ceiling and no agent probe result was
   * available. Subsequent calls within
   * `PROBE_COOLDOWN_MS` will skip the probe entirely and short-circuit
   * to the FALLBACK sentinel — so a user double-clicking the card
   * after opening it twice in a row doesn't burn another agent round
   * trip on a hung or slowly-loading prompt.
   */
  probeCooldownUntil?: unknown;
}

function readProbeCooldown(): number {
  try {
    if (!existsSync(LOOP_PATHS.connectors)) return 0;
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.connectors, "utf8"),
    ) as ConnectorCacheWithCooldown;
    const v = raw.probeCooldownUntil;
    if (typeof v !== "string") return 0;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) return 0;
    return t;
  } catch {
    return 0;
  }
}

/**
 * Append per-user custom channels to a connector list. The user-defined
 * entries are sourced from `~/.openloomi/loop/custom-channels.json` and
 * are always shown alongside the built-in `FALLBACK_CONNECTORS` (in
 * that order — built-ins first, custom last so the UI's stable layout
 * doesn't reshuffle when a channel is added or removed). The probe
 * never tries to confirm them: their connection state lives in the
 * user's Composio account, and the watcher's pass will surface a real
 * error if the toolkit isn't reachable.
 *
 * #361 — stamps capability fields so a custom channel with a known
 * `kind` (e.g. one that maps to a canonical toolkit via `kind`) gets a
 * real capability state, not just `connected: false`. A user-defined
 * custom channel is `needs_setup` until the watcher confirms it.
 */
function appendCustomChannels(seed: ConnectorEntry[]): ConnectorEntry[] {
  const extras = customChannels.list();
  if (extras.length === 0) return seed;
  const now = new Date().toISOString();
  const out = seed.slice();
  for (const c of extras) {
    const entry: ConnectorEntry = {
      id: c.id,
      label: c.label,
      // Conservatively report as not-yet-probed; the watcher's pass
      // surfaces real failures when the toolkit isn't reachable.
      connected: false,
      accountCount: 0,
      probed: false,
      fetchedAt: now,
    };
    out.push(withConnectorCapability(entry));
  }
  return out;
}

function writeProbeCooldownMarker(): void {
  // Stamp a cooldown marker on the existing cache file (or write a
  // barebones one if the file doesn't exist yet) so a second cold
  // open within PROBE_COOLDOWN_MS skips the probe. We *don't* clobber
  // a previously-persisted snapshot — the goal is "don't hammer the
  // agent when it's slow", not "forget what we last learned".
  try {
    let existing: ConnectorCacheWithCooldown = {};
    if (existsSync(LOOP_PATHS.connectors)) {
      try {
        existing = JSON.parse(
          readFileSync(LOOP_PATHS.connectors, "utf8"),
        ) as ConnectorCacheWithCooldown;
      } catch {
        existing = {};
      }
    }
    ensureDirs();
    writeFileSync(
      LOOP_PATHS.connectors,
      JSON.stringify(
        {
          ...existing,
          probeCooldownUntil: new Date(
            Date.now() + PROBE_COOLDOWN_MS,
          ).toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    /* swallow — cooldown is an optimization, not a correctness lever */
  }
}

/**
 * Clear any pending `probeCooldownUntil` marker on the on-disk cache.
 *
 * Intended for callers that have just kicked off a *real* (non-silent)
 * probe in the background and want the next card-open `silent` probe
 * to fall through to the cache (which the background probe is
 * populating) rather than be short-circuited by the stale marker left
 * over from a prior timeout. Mirrors `writeProbeCooldownMarker`'s
 * "preserve existing snapshot" policy — we only drop the marker
 * field, the connector rows stay.
 *
 * Swallows all errors (cooldown is an optimization, not correctness).
 */
export function clearProbeCooldown(): void {
  try {
    if (!existsSync(LOOP_PATHS.connectors)) return;
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.connectors, "utf8"),
    ) as ConnectorCacheWithCooldown;
    if (typeof raw.probeCooldownUntil !== "string") return;
    raw.probeCooldownUntil = undefined;
    ensureDirs();
    writeFileSync(LOOP_PATHS.connectors, JSON.stringify(raw, null, 2));
  } catch {
    /* swallow — cooldown is an optimization, not a correctness lever */
  }
}

/**
 * #391 — stamp a `lastProbeError` diagnostic on the existing cache file
 * (or a barebones one if it doesn't exist yet) so the next API read can
 * surface WHY the probe couldn't refresh, alongside the last-known
 * snapshot. Mirrors `writeProbeCooldownMarker`'s "preserve the existing
 * snapshot, append one field" policy — we never clobber previously-
 * persisted connector rows. A subsequent successful probe rewrites the
 * whole file via `writeConnectorSnapshot`, which naturally drops this
 * field (success clears the error).
 *
 * Swallows all errors — a missing diagnostic must never block a probe.
 */
export function writeProbeError(kind: ProbeErrorKind, message: string): void {
  try {
    let existing: Record<string, unknown> = {};
    if (existsSync(LOOP_PATHS.connectors)) {
      try {
        existing = JSON.parse(
          readFileSync(LOOP_PATHS.connectors, "utf8"),
        ) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }
    ensureDirs();
    writeFileSync(
      LOOP_PATHS.connectors,
      JSON.stringify(
        {
          ...existing,
          lastProbeError: {
            kind,
            message,
            at: new Date().toISOString(),
          } satisfies ProbeErrorInfo,
        },
        null,
        2,
      ),
    );
  } catch {
    /* swallow — the diagnostic is best-effort */
  }
}

/**
 * #391 — read the persisted `lastProbeError` from the connector cache,
 * or `null` when the last probe succeeded (or none ran yet). Mirrors
 * `clearProbeCooldown`'s permissive read. Used by the `connectors()`
 * server wrapper to thread the diagnostic into `/api/loop/connectors`.
 */
export function getLastProbeError(): ProbeErrorInfo | null {
  try {
    if (!existsSync(LOOP_PATHS.connectors)) return null;
    const raw = JSON.parse(readFileSync(LOOP_PATHS.connectors, "utf8")) as {
      lastProbeError?: unknown;
    };
    return parseProbeError(raw.lastProbeError);
  } catch {
    return null;
  }
}

/**
 * Force-refresh by dispatching a small "connector probe" prompt to the
 * agent via `composio-bridge.ts`. The agent inspects the active
 * composio surfaces (skill / CLI / insights) and returns a fresh
 * snapshot, which we persist via `writeConnectorSnapshot` and return.
 *
 * `opts.silent = true` wraps the probe in a `PROBE_TIMEOUT_MS`
 * (10 min) ceiling and falls back to the cache / FALLBACK on timeout,
 * including writing a `probeCooldownUntil` marker so a rapid re-open
 * within `PROBE_COOLDOWN_MS` skips the probe entirely. Used by
 * `listConnectors()`'s cache-miss path so the user's first card open
 * gets the room it needs for a cold first probe without immediately
 * falling back to "Pending first probe" pills.
 *
 * Failure modes (in order of preference):
 *
 *   1. Probe succeeded → return + persist the entries.
 *   2. Probe failed (transport / timeout / malformed result) but the
 *      cache is fresh (within CACHE_TTL_MS) → return the cache. The
 *      pill row stays accurate to the last good agent report; we just
 *      can't give the user a live update.
 *   3. Probe failed AND cache is stale / missing → return FALLBACK so
 *      the UI can still render the row. Caller should surface a
 *      "stale" hint to the user.
 */
export async function refreshConnectors(
  opts: { silent?: boolean } = {},
): Promise<ConnectorEntry[]> {
  // `silent` mode additionally consults the cooldown marker — if we're
  // still inside the post-timeout window, skip the probe entirely and
  // return whatever the cache (or FALLBACK) has. This prevents a stuck
  // or slow agent from being hammered on rapid card re-opens.
  if (opts.silent && Date.now() < readProbeCooldown()) {
    const cached = readCache();
    if (cached) return appendCustomChannels(cached.connectors);
    return appendCustomChannels(FALLBACK_CONNECTORS);
  }

  const probe = (async () => {
    const { probeConnectorState } = await import("./composio-bridge");
    return probeConnectorState();
  })();

  // A sentinel the timeout race resolves to so we can tell "the probe
  // returned a (possibly failed) ProbeOutcome" from "the timer fired
  // first". The ProbeOutcome's own failure kinds are already persisted
  // by `probeConnectorState`; only the timeout is observed here.
  const TIMED_OUT = Symbol("probe-timeout");

  if (opts.silent) {
    // `silent` mode wraps the probe in a short timeout so the first
    // card open is bounded — we don't keep the user waiting on a hung
    // agent. On timeout, write the cooldown marker + a `timeout`
    // diagnostic and fall back to whatever's on disk (or FALLBACK).
    let timer: ReturnType<typeof setTimeout> | null = null;
    let raced: Awaited<typeof probe> | typeof TIMED_OUT;
    try {
      raced = await Promise.race<Awaited<typeof probe> | typeof TIMED_OUT>([
        probe,
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), PROBE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (raced === TIMED_OUT) {
      writeProbeError("timeout", `probe exceeded ${PROBE_TIMEOUT_MS}ms`);
      writeProbeCooldownMarker();
      const cached = readCache();
      if (cached) return appendCustomChannels(cached.connectors);
      return appendCustomChannels(FALLBACK_CONNECTORS);
    }
    if (raced.kind === "ok" && raced.entries.length > 0) {
      return appendCustomChannels(raced.entries);
    }
    // A structured failure (already persisted by the probe) or an empty
    // ok — treat like a soft failure: leave a cooldown so a rapid re-
    // open doesn't hammer a broken probe, and degrade to cache/FALLBACK.
    writeProbeCooldownMarker();
    const cached = readCache();
    if (cached) return appendCustomChannels(cached.connectors);
    return appendCustomChannels(FALLBACK_CONNECTORS);
  }

  const outcome = await probe;
  if (outcome.kind === "ok" && outcome.entries.length > 0) {
    return appendCustomChannels(outcome.entries);
  }
  // Probe failed (the diagnostic was already persisted by
  // `probeConnectorState`) — degrade gracefully to the last-known
  // snapshot, or the FALLBACK sentinel when the cache is stale/missing.
  const cached = readCache();
  if (cached) {
    return appendCustomChannels(cached.connectors);
  }
  return appendCustomChannels(FALLBACK_CONNECTORS);
}
