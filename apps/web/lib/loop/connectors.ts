/**
 * Loop connector status — surface-only.
 *
 * The Loop is fully agentic: the agent at `/api/native/agent` has the
 * `composio` skill and `composio` CLI available and probes connection
 * state itself. The Loop's local module does not hit Composio's REST
 * API directly — that would require a parallel `COMPOSIO_API_KEY` env
 * var and duplicate the agent's discovery work.
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
import type { ConnectorEntry } from "./types";

const CACHE_TTL_MS = 1 * 60 * 60 * 1000;

interface ConnectorCache {
  fetchedAt: string;
  connectors: ConnectorEntry[];
}

const FALLBACK_CONNECTORS: ConnectorEntry[] = [
  {
    id: "gmail",
    label: "Gmail",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
  {
    id: "google_calendar",
    label: "Google Calendar",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
  {
    id: "github",
    label: "GitHub",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
  {
    id: "slack",
    label: "Slack",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
  {
    id: "linear",
    label: "Linear",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    connected: false,
    accountCount: 0,
    probed: false,
    fetchedAt: "",
  },
];

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
    const connectors = (raw.connectors as ConnectorEntry[]).map((c) =>
      typeof (c as { probed?: unknown }).probed === "boolean"
        ? c
        : { ...c, probed: true },
    );
    return {
      fetchedAt: stamp,
      connectors,
    };
  } catch {
    return null;
  }
}

/**
 * Public API — write the agent-reported connector snapshot. Called by the
 * tick handler when the agent's `result` event carries a `connectors`
 * block (see `tick-prompt.ts` §0 hook).
 */
export function writeConnectorSnapshot(connectors: ConnectorEntry[]): void {
  ensureDirs();
  try {
    writeFileSync(
      LOOP_PATHS.connectors,
      JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          connectors,
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
 * open of the Loomi Online card auto-probes (short 6s timeout) and the
 * pill row repaints to truth within a couple of seconds. The cache is
 * the fast path; the probe is the recovery.
 */
export async function listConnectors(
  opts: { force?: boolean } = {},
): Promise<ConnectorEntry[]> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return cached.connectors;
  }
  // Cache miss (or force=true) → delegate to refresh. When called from
  // the regular UI path, this fires a short-timeout silent probe
  // asynchronously and returns the FALLBACK sentinel — the UI renders
  // "Pending first probe" pills immediately and the probe lands in the
  // background. Without this delegation, every fresh install sees the
  // lying "all offline" state for the entire first session.
  return refreshConnectors({ silent: true });
}

const PROBE_TIMEOUT_MS = 6 * 1000;
const PROBE_COOLDOWN_MS = 30 * 1000;

interface ConnectorCacheWithCooldown {
  fetchedAt?: unknown;
  connectors?: unknown;
  /**
   * Set when `refreshConnectors({silent:true})` hits its 6s timeout
   * and no agent probe result was available. Subsequent calls within
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
 * Force-refresh by dispatching a small "connector probe" prompt to the
 * agent via `composio-bridge.ts`. The agent inspects the active
 * composio surfaces (skill / CLI / insights) and returns a fresh
 * snapshot, which we persist via `writeConnectorSnapshot` and return.
 *
 * `opts.silent = true` wraps the probe in a short `PROBE_TIMEOUT_MS`
 * (6s) timeout and falls back to the cache / FALLBACK on timeout,
 * including writing a `probeCooldownUntil` marker so a rapid re-open
 * within `PROBE_COOLDOWN_MS` skips the probe entirely. Used by
 * `listConnectors()`'s cache-miss path so the user's first card open
 * doesn't block on a potentially-slow agent call.
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
    if (cached) return cached.connectors;
    return FALLBACK_CONNECTORS;
  }

  const probe: Promise<ConnectorEntry[] | null> = (async () => {
    const { probeConnectorState } = await import("./composio-bridge");
    return probeConnectorState();
  })();

  // `silent` mode wraps the probe in a short timeout so the first card
  // open is bounded — we don't want to keep the user waiting on a hung
  // agent. On timeout, write the cooldown marker and fall back to
  // whatever's on disk (or FALLBACK).
  let probed: ConnectorEntry[] | null;
  if (opts.silent) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      probed = await Promise.race<ConnectorEntry[] | null>([
        probe,
        new Promise<ConnectorEntry[] | null>((resolve) => {
          timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!probed || probed.length === 0) {
      writeProbeCooldownMarker();
      const cached = readCache();
      if (cached) return cached.connectors;
      return FALLBACK_CONNECTORS;
    }
    return probed;
  }

  probed = await probe;
  if (probed && probed.length > 0) {
    return probed;
  }
  // Probe failed — degrade gracefully.
  const cached = readCache();
  if (cached) {
    return cached.connectors;
  }
  return FALLBACK_CONNECTORS;
}
