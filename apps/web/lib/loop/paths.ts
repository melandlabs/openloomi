/**
 * Loop filesystem paths.
 *
 * Production location:  ~/.openloomi/loop/
 *   - signals.jsonl       append-only signal log
 *   - decisions.json      { pending, done, dismissed } buckets
 *   - status.json         last-tick summary (for at-a-glance status)
 *   - brief.json          most-recent brief snapshot
 *   - wrap.json           most-recent wrap snapshot
 *   - connectors.json     cached connector status (60s TTL)
 *   - config.json         LoopPreferences
 *   - mutes.json          key-scoped skip rules (dismiss → "don't show this kind again")
 *   - migrated.json       marker written after legacy data migration
 *
 * Legacy location (read once on first boot): skills/openloomi-loop/data/
 * The `migrate()` function copies the legacy signals.jsonl + decisions.json
 * into the new location, never deleting the originals.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const LOOP_HOME = join(homedir(), ".openloomi", "loop");

export const LOOP_PATHS = {
  home: LOOP_HOME,
  signals: join(LOOP_HOME, "signals.jsonl"),
  decisions: join(LOOP_HOME, "decisions.json"),
  status: join(LOOP_HOME, "status.json"),
  brief: join(LOOP_HOME, "brief.json"),
  wrap: join(LOOP_HOME, "wrap.json"),
  connectors: join(LOOP_HOME, "connectors.json"),
  config: join(LOOP_HOME, "config.json"),
  mutes: join(LOOP_HOME, "mutes.json"),
  migrated: join(LOOP_HOME, "migrated.json"),
  log: join(LOOP_HOME, "loop.log"),
  inbox: join(LOOP_HOME, "inbox"),
  /** Per-connector lastSyncAt — read by watcher, written after each pass. */
  syncState: join(LOOP_HOME, "sync-state.json"),
  /**
   * User-defined decision types (label / icon / actionKind). Per-user
   * extension to the closed `DecisionType` union — see `lib/loop/custom-types.ts`.
   */
  customTypes: join(LOOP_HOME, "custom-types.json"),
  /**
   * User-defined signal channels (Composio-backed pullers). Per-user
   * extension to the FALLBACK_CONNECTORS list — see `lib/loop/custom-channels.ts`.
   */
  customChannels: join(LOOP_HOME, "custom-channels.json"),
  /**
   * User-defined deterministic classifier rules. Per-user extension to the
   * hard-coded rules in `classify.ts` and the agentic prompt's §5
   * classifier list — see `lib/loop/classifier-rules.ts`. Rules take
   * priority over the LLM's natural-language classification (server-side
   * enforcement after the agentic tick).
   */
  classifierRules: join(LOOP_HOME, "classifier-rules.json"),
} as const;

export function ensureDirs(): void {
  mkdirSync(LOOP_PATHS.home, { recursive: true });
  mkdirSync(join(LOOP_PATHS.inbox, ".processed"), { recursive: true });
  mkdirSync(join(LOOP_PATHS.inbox, ".failed"), { recursive: true });
}

interface MigrationSource {
  signals: string;
  decisions: string;
}

function legacySourceCandidates(): MigrationSource[] {
  const out: MigrationSource[] = [];
  // Walk up the current working dir looking for skills/openloomi-loop/data.
  // Covers `cd apps/web && node ...` and `cd /path/to/openloomi && node ...`.
  const cwd = process.cwd();
  const probes = [
    cwd,
    resolve(cwd, ".."),
    resolve(cwd, "../.."),
    resolve(cwd, "../../.."),
    resolve(cwd, "../../../.."),
  ];
  for (const dir of probes) {
    const dataDir = join(dir, "skills", "openloomi-loop", "data");
    if (existsSync(join(dataDir, "decisions.json"))) {
      out.push({
        signals: join(dataDir, "signals.jsonl"),
        decisions: join(dataDir, "decisions.json"),
      });
    }
  }
  return out;
}

interface MigratedMarker {
  migratedAt: string;
  sources: { signals: string; decisions: string }[];
  signalsCopied: number;
  decisionsCopied: number;
}

/**
 * Soft-migrate legacy skill data into the new loop home. Idempotent — once
 * the marker file is written, subsequent calls no-op. Never deletes legacy
 * files; users who want to reclaim space can rm -rf them after verifying.
 */
export function migrate(): MigratedMarker | null {
  ensureDirs();
  if (existsSync(LOOP_PATHS.migrated)) {
    try {
      return JSON.parse(
        readFileSync(LOOP_PATHS.migrated, "utf8"),
      ) as MigratedMarker;
    } catch {
      // corrupted marker — re-migrate
    }
  }
  const sources = legacySourceCandidates();
  if (sources.length === 0) return null;

  let signalsCopied = 0;
  let decisionsCopied = 0;
  for (const src of sources) {
    if (existsSync(src.signals)) {
      const target = LOOP_PATHS.signals;
      if (!existsSync(target)) {
        try {
          copyFileSync(src.signals, target);
          signalsCopied = countLines(src.signals);
        } catch (e) {
          console.warn("[loop.migrate] failed to copy signals:", e);
        }
      }
    }
    if (existsSync(src.decisions)) {
      const target = LOOP_PATHS.decisions;
      if (!existsSync(target)) {
        try {
          copyFileSync(src.decisions, target);
          decisionsCopied = countDecisionLines(src.decisions);
        } catch (e) {
          console.warn("[loop.migrate] failed to copy decisions:", e);
        }
      }
    }
  }
  const marker: MigratedMarker = {
    migratedAt: new Date().toISOString(),
    sources: sources.map((s) => ({
      signals: s.signals,
      decisions: s.decisions,
    })),
    signalsCopied,
    decisionsCopied,
  };
  try {
    writeFileSync(LOOP_PATHS.migrated, JSON.stringify(marker, null, 2));
    console.log(
      `[loop.migrate] copied ${signalsCopied} signals + ${decisionsCopied} decisions from ${sources.length} legacy source(s)`,
    );
  } catch (e) {
    console.warn("[loop.migrate] failed to write marker:", e);
  }
  return marker;
}

function countLines(p: string): number {
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function countDecisionLines(p: string): number {
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return (
      (Array.isArray(d.pending) ? d.pending.length : 0) +
      (Array.isArray(d.done) ? d.done.length : 0) +
      (Array.isArray(d.dismissed) ? d.dismissed.length : 0)
    );
  } catch {
    return 0;
  }
}

/** Resolve a directory and ensure it exists. Used by adjacent helpers. */
export function ensureParent(p: string): void {
  mkdirSync(dirname(p), { recursive: true });
}
