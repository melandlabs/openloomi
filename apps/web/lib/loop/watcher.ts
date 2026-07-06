/**
 * Loop watcher — pulls new events from each connected integration and
 * appends them as `LoopSignal` rows into `signals.jsonl` so the existing
 * tick pipeline (classify → enrich → enqueue) has fresh material to chew on.
 *
 * Design goals (A1 in the stage plan):
 *   · one `runOnce()` entry that handlers can call BEFORE `tick.run()` —
 *     the tick already filters to a 2h lookback, so anything we append in
 *     the same pass is picked up immediately.
 *   · every connector pull is wrapped in try/catch — one bad credential or
 *     rate-limit should not poison the rest of the pass.
 *   · per-connector `lastSyncAt` is persisted in
 *     `~/.openloomi/loop/sync-state.json` so repeated ticks don't refetch
 *     the world. First run uses a 24h backstop (matches the tick's 2h
 *     lookback minus a generous tail).
 *   · connectors that have no integration account on file short-circuit to
 *     `connected: false` and append nothing — no per-connector code path
 *     needs to know whether the user is signed up.
 *
 * v1 scope (this file): the orchestration skeleton — discovery, dedupe,
 * append, sync-state, error isolation. Per-connector pulls (Gmail OAuth,
 * Slack bot, Google Calendar events.list, GitHub notifications, Linear
 * issues) are intentionally stubbed. The stubs return [] so the watcher
 * passes cleanly when no integration is connected, and they expose the
 * same `Puller` shape so a later commit can drop in real implementations
 * (see `PULLERS` at the bottom) without touching the orchestration.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { listConnectors } from "./connectors";
import { LOOP_PATHS, ensureDirs } from "./paths";
import { log, signals } from "./store";
import type { ConnectorEntry, LoopSignal } from "./types";

/** How far back to look on the very first run, before any lastSyncAt exists. */
const INITIAL_LOOKBACK_HOURS = 24;
/** Cap per-connector fetch size so a long offline period doesn't OOM. */
const PER_CONNECTOR_LIMIT = 100;
/** Safety floor — never go back more than this even if lastSyncAt is ancient. */
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConnectorPullResult {
  source: string;
  fetched: number;
  appended: number;
  skipped: number;
  error?: string;
  durationMs: number;
}

export interface WatcherRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  bySource: Record<string, ConnectorPullResult>;
  totalAppended: number;
}

export interface WatcherOptions {
  userId?: string;
}

interface SyncState {
  /** Map: source id → ISO timestamp of the last successful pull. */
  lastSyncAt: Record<string, string>;
  updatedAt: string;
}

function emptySyncState(): SyncState {
  return { lastSyncAt: {}, updatedAt: new Date(0).toISOString() };
}

function loadSyncState(): SyncState {
  try {
    if (!existsSync(LOOP_PATHS.syncState)) return emptySyncState();
    const raw = JSON.parse(
      readFileSync(LOOP_PATHS.syncState, "utf8"),
    ) as Partial<SyncState>;
    return {
      lastSyncAt:
        raw && typeof raw.lastSyncAt === "object" && raw.lastSyncAt
          ? (raw.lastSyncAt as Record<string, string>)
          : {},
      updatedAt:
        typeof raw?.updatedAt === "string"
          ? raw.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return emptySyncState();
  }
}

function saveSyncState(state: SyncState): void {
  ensureDirs();
  try {
    writeFileSync(LOOP_PATHS.syncState, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn("[loop.watcher] failed to write sync-state.json:", e);
  }
}

function sinceMsFor(state: SyncState, source: string): number {
  const last = state.lastSyncAt[source];
  if (last) {
    const ts = new Date(last).getTime();
    if (Number.isFinite(ts)) {
      // Cap at MAX_LOOKBACK_MS so a long-offline period doesn't pull forever.
      const floor = Date.now() - MAX_LOOKBACK_MS;
      return Math.max(floor, ts);
    }
  }
  return Date.now() - INITIAL_LOOKBACK_HOURS * 60 * 60 * 1000;
}

/**
 * Best-effort dedupe against what's already in `signals.jsonl`. We keep a
 * Set of existing ids for the pass — if a connector emits the same id
 * twice in one run, we drop the second copy. The persistent dedupe in
 * `tick.ts::alreadyProcessed` still handles cross-pass duplicates.
 */
function buildExistingIds(): Set<string> {
  const ids = new Set<string>();
  try {
    if (!existsSync(LOOP_PATHS.signals)) return ids;
    const lines = readFileSync(LOOP_PATHS.signals, "utf8").split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { id?: string };
        if (parsed.id) ids.add(parsed.id);
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* soft-fail */
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* Per-connector pulls                                                         */
/* -------------------------------------------------------------------------- */

type Puller = (
  sinceMs: number,
  limit: number,
  userId: string | null,
) => Promise<LoopSignal[]>;

/**
 * Gmail puller — for each enabled Gmail bot on the user:
 *   1. Load credentials (refresh-token based OAuth only — app-password bots
 *      are out of scope here).
 *   2. Construct a GmailOAuthAdapter, call `getEmailsByTime(sinceSec)`.
 *   3. Map each `ExtractEmailInfo` to a `LoopSignal` of type `email` and
 *      carry the body / sender / timestamp / subject in the payload so the
 *      tick's classifier + enricher have real content to chew on.
 *
 * Best-effort: every per-bot failure is swallowed so one bad credential
 * doesn't poison the rest of the pass. The watcher orchestrator will
 * short-circuit this puller entirely when `connectors` says `gmail.connected
 * === false` so we still avoid the DB hit on the cold path.
 */
async function pullGmail(
  sinceMs: number,
  limit: number,
  userId: string | null,
): Promise<LoopSignal[]> {
  if (!userId) return [];
  try {
    const { db } = await import("@/lib/db");
    const { integrationAccounts } = await import("@/lib/db/schema");
    const { bot } = await import("@/lib/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { getBotCredentials } = await import("@/lib/bots/token");
    const { GmailOAuthAdapter } = await import("@/lib/integrations/gmail");
    const { parseGmailInsightSyncState } =
      await import("@/lib/integrations/gmail");

    // Pull enabled gmail bots on this user with a linked integration account.
    // `innerJoin` on platformAccountId makes sure we skip bots that aren't
    // fully wired (no OAuth handshake yet).
    const rows = await db
      .select({
        id: bot.id,
        userId: bot.userId,
        adapter: bot.adapter,
        enable: bot.enable,
        adapterConfig: bot.adapterConfig,
        platformAccountId: bot.platformAccountId,
        accountId: integrationAccounts.id,
      })
      .from(bot)
      .innerJoin(
        integrationAccounts,
        eq(bot.platformAccountId, integrationAccounts.id),
      )
      .where(and(eq(bot.userId, userId), eq(bot.adapter, "gmail")));

    if (rows.length === 0) return [];

    const sinceSec = Math.floor(sinceMs / 1000);
    const out: LoopSignal[] = [];
    for (const row of rows) {
      if (row.enable === false) continue;
      try {
        // `getBotCredentials` returns the typed credentials for the adapter;
        // for Gmail OAuth that's the GmailStoredCredentials shape with a
        // refreshToken. App-password bots return null here — silently skip.
        const credentials = (await getBotCredentials(
          "gmail" as never,
          {
            id: row.id,
            userId: row.userId,
            adapter: "gmail" as never,
            adapterConfig: row.adapterConfig as never,
            platformAccountId: row.platformAccountId,
          } as never,
        )) as {
          accessToken?: string | null;
          refreshToken?: string | null;
          expiryDate?: number | null;
        } | null;
        if (!credentials?.refreshToken) continue;

        const adapter = new GmailOAuthAdapter({
          bot: {
            id: row.id,
            userId: row.userId,
            adapter: "gmail" as never,
            adapterConfig: row.adapterConfig as never,
            platformAccount: {
              id: row.accountId,
              credentials,
            },
          } as never,
          credentials,
          // No attachments in the loop pipeline — ownerUserId/ownerUserType
          // are only used by `ingestEmailAttachments` which we'll bypass.
          ownerUserId: undefined,
          ownerUserType: undefined,
        });

        const emails = await adapter.getEmailsByTime(sinceSec, limit);

        // Best-effort: persist Gmail's historyId so a future insight pass can
        // resume from there instead of a 24h bootstrap. We don't fail the
        // pull if this write explodes.
        try {
          const lastHistoryId = parseGmailInsightSyncState(
            (row.adapterConfig as Record<string, unknown> | null | undefined)
              ?.gmailSync,
          )?.historyId;
          if (lastHistoryId) {
            const accountRow = await db
              .select({ metadata: integrationAccounts.metadata })
              .from(integrationAccounts)
              .where(eq(integrationAccounts.id, row.accountId))
              .limit(1);
            // (intentionally not writing — the existing insight pipeline
            // already handles historyId persistence on its own cadence)
            void accountRow;
          }
        } catch {
          /* soft-fail */
        }

        for (const e of emails) {
          out.push({
            id: `gmail:${e.uid}`,
            ts: new Date(e.timestamp * 1000).toISOString(),
            source: "gmail",
            type: "email",
            payload: {
              messageId: e.uid,
              subject: e.subject,
              from: e.from?.email ?? "",
              fromName: e.from?.name ?? "",
              snippet: e.snippet ?? "",
              body: e.text ?? "",
              ts: e.timestamp,
              labelIds: e.labelIds ?? [],
              priority: e.priority ?? null,
              gmailCategory: e.gmailCategory ?? null,
            },
          });
        }
      } catch (perBotErr) {
        log(
          `[watcher] gmail bot ${row.id} pull failed: ${(perBotErr as Error).message}`,
        );
      }
    }
    return out;
  } catch (e) {
    log(`[watcher] gmail puller failed: ${(e as Error).message}`);
    return [];
  }
}

/** Slack stub. Real impl uses getChatsByTime(sinceMs) on SlackAdapter. */
async function pullSlack(
  _sinceMs: number,
  _limit: number,
  _userId: string | null,
): Promise<LoopSignal[]> {
  return [];
}

/**
 * Google Calendar stub. There is no calendar adapter in
 * `lib/integrations/` yet. When it lands, drop in a
 * `calendar.events.list({timeMin: new Date(sinceMs).toISOString(), ...})`
 * call here and map each event to a `calendar_event` signal.
 */
async function pullGoogleCalendar(
  _sinceMs: number,
  _limit: number,
  _userId: string | null,
): Promise<LoopSignal[]> {
  return [];
}

/**
 * GitHub stub. There is no GitHub adapter in `lib/integrations/` yet. When
 * it lands, call `notifications` (REST) or the GraphQL
 * `viewer.unreadNotifications` and map to `github_pr` / `github_issue`.
 */
async function pullGitHub(
  _sinceMs: number,
  _limit: number,
  _userId: string | null,
): Promise<LoopSignal[]> {
  return [];
}

/** Linear stub. No polling API wired up yet. */
async function pullLinear(
  _sinceMs: number,
  _limit: number,
  _userId: string | null,
): Promise<LoopSignal[]> {
  return [];
}

/**
 * Obsidian is file-system based, not API based — its watcher lives in the
 * Chronicle subsystem. The loop only consumes `obsidian_note_changed`
 * signals that Chronicle has already written into `signals.jsonl`. The
 * stub returns [] so the per-connector dispatch stays uniform.
 */
async function pullObsidian(): Promise<LoopSignal[]> {
  return [];
}

const PULLERS: Record<string, Puller> = {
  gmail: pullGmail,
  google_calendar: pullGoogleCalendar,
  github: pullGitHub,
  slack: pullSlack,
  linear: pullLinear,
  obsidian: async () => pullObsidian(),
};

/* -------------------------------------------------------------------------- */
/* Public entry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Run one full pass: for each connector that's `connected: true`, call its
 * puller, dedupe, append new signals to `signals.jsonl`. Returns per-source
 * counts plus a total. Never throws — every pull is soft-failed.
 */
export async function runOnce(
  opts: WatcherOptions = {},
): Promise<WatcherRunResult> {
  const startedAt = new Date();
  const result: WatcherRunResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    durationMs: 0,
    bySource: {},
    totalAppended: 0,
  };

  // Discover which connectors are actually connected BEFORE we start
  // pulling — saves OAuth round-trips for accounts the user doesn't have.
  let connectors: ConnectorEntry[] = [];
  try {
    connectors = await listConnectors({ force: true });
  } catch (e) {
    log(`[watcher] listConnectors failed: ${(e as Error).message}`);
  }

  const syncState = loadSyncState();
  const existingIds = buildExistingIds();
  const nextSyncState: SyncState = {
    lastSyncAt: { ...syncState.lastSyncAt },
    updatedAt: new Date().toISOString(),
  };

  for (const [source, puller] of Object.entries(PULLERS)) {
    const entry = connectors.find((c) => c.id === source);
    const connected = entry?.connected ?? false;
    const sinceMs = sinceMsFor(syncState, source);
    const t0 = Date.now();

    if (!connected) {
      result.bySource[source] = {
        source,
        fetched: 0,
        appended: 0,
        skipped: 0,
        durationMs: Date.now() - t0,
      };
      continue;
    }

    try {
      const raw = await puller(
        sinceMs,
        PER_CONNECTOR_LIMIT,
        opts.userId ?? null,
      );
      let appended = 0;
      let skipped = 0;
      for (const sig of raw) {
        if (existingIds.has(sig.id)) {
          skipped += 1;
          continue;
        }
        try {
          // `signals.append` mints its own id/timestamp; we pass through
          // the connector-supplied id/ts via `extra` only if the puller
          // minted one. Most pullers will leave id blank and let the
          // store derive a stable uid.
          signals.append(
            sig.source,
            sig.type,
            sig.payload,
            sig.id ? { id: sig.id, ts: sig.ts } : { ts: sig.ts },
          );
          existingIds.add(sig.id);
          appended += 1;
        } catch (e) {
          log(
            `[watcher] append failed for ${source}:${sig.id}: ${(e as Error).message}`,
          );
        }
      }
      result.bySource[source] = {
        source,
        fetched: raw.length,
        appended,
        skipped,
        durationMs: Date.now() - t0,
      };
      result.totalAppended += appended;
      // Only advance lastSyncAt if we actually got something OR the puller
      // returned 0 (no new events). On error, leave it for the next pass.
      nextSyncState.lastSyncAt[source] = new Date().toISOString();
      log(
        `[watcher] ${source} fetched=${raw.length} appended=${appended} skipped=${skipped} in ${Date.now() - t0}ms`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.bySource[source] = {
        source,
        fetched: 0,
        appended: 0,
        skipped: 0,
        error: msg,
        durationMs: Date.now() - t0,
      };
      log(`[watcher] ${source} error: ${msg}`);
      // Do NOT update lastSyncAt on error — next pass will retry the window.
    }
  }

  saveSyncState(nextSyncState);

  const finishedAt = new Date();
  result.finishedAt = finishedAt.toISOString();
  result.durationMs = finishedAt.getTime() - startedAt.getTime();
  log(
    `[watcher] pass done: appended=${result.totalAppended} across ${Object.keys(result.bySource).length} sources in ${result.durationMs}ms`,
  );
  return result;
}
