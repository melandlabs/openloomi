/**
 * Loop connector status — derived from the main app's integrations module.
 *
 * Caches results to ~/.openloomi/loop/connectors.json with a 60s TTL so the
 * pet / CLI / web UI can poll without hitting the underlying auth surface on
 * every request. Cache miss falls through to a synchronous best-effort probe.
 *
 * The Loop currently only needs a coarse "is this connected + how many
 * accounts" view per integration; deep health probing happens in the
 * integration's own adapter when an action runs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirs, LOOP_PATHS } from "./paths";
import type { ConnectorEntry } from "./types";

const CACHE_TTL_MS = 60_000;

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
    fetchedAt: "",
  },
  {
    id: "google_calendar",
    label: "Google Calendar",
    connected: false,
    accountCount: 0,
    fetchedAt: "",
  },
  {
    id: "github",
    label: "GitHub",
    connected: false,
    accountCount: 0,
    fetchedAt: "",
  },
  {
    id: "slack",
    label: "Slack",
    connected: false,
    accountCount: 0,
    fetchedAt: "",
  },
  {
    id: "linear",
    label: "Linear",
    connected: false,
    accountCount: 0,
    fetchedAt: "",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    connected: false,
    accountCount: 0,
    fetchedAt: "",
  },
];

function readCache(): ConnectorCache | null {
  try {
    if (!existsSync(LOOP_PATHS.connectors)) return null;
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.connectors, "utf8"),
    ) as ConnectorCache;
    if (!raw?.fetchedAt || !Array.isArray(raw.connectors)) return null;
    if (Date.now() - new Date(raw.fetchedAt).getTime() > CACHE_TTL_MS)
      return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(connectors: ConnectorEntry[]): void {
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
 * Returns the live (or cached) connector status. Best-effort — when the
 * integrations module can't be probed synchronously (e.g. it depends on
 * async session context), returns the fallback connector list with all
 * entries marked `connected: false` so the UI can still render.
 */
export async function listConnectors(
  opts: { force?: boolean } = {},
): Promise<ConnectorEntry[]> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return cached.connectors;
  }
  const entries = await probeConnectors();
  writeCache(entries);
  return entries;
}

async function probeConnectors(): Promise<ConnectorEntry[]> {
  const stamp = new Date().toISOString();
  // Best-effort: query the integrationAccounts table directly. When the DB
  // is unavailable (CLI scripts running outside the Next.js runtime, missing
  // DATABASE_URL, etc.) we fall back to the FALLBACK list so the UI can
  // still render. Counts are best-effort — the pet / web UI does not gate
  // any decision on this number, only uses it for the status row.
  const snapshot: ConnectorEntry[] = FALLBACK_CONNECTORS.map((c) => ({
    ...c,
    fetchedAt: stamp,
  }));
  try {
    const { db } = await import("@/lib/db/index");
    const { integrationAccounts } = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db
      .select({
        platform: integrationAccounts.platform,
        count: sql<number>`count(*)::int`,
      })
      .from(integrationAccounts)
      .groupBy(integrationAccounts.platform);
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(
        String((r as { platform?: string }).platform ?? ""),
        Number((r as { count?: number }).count ?? 0),
      );
    }
    return snapshot.map((entry) => {
      const count = map.get(entry.id) ?? 0;
      return { ...entry, accountCount: count, connected: count > 0 };
    });
  } catch {
    /* DB unavailable — keep fallback shape */
    return snapshot;
  }
}

/** Force-refresh the connector cache. Used by the /api/loop/connectors route. */
export async function refreshConnectors(): Promise<ConnectorEntry[]> {
  return listConnectors({ force: true });
}
