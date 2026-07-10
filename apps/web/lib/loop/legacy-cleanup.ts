/**
 * Legacy daemon cleanup (#288).
 *
 * Older debug builds of the `openloomi-loop` skill bundled a
 * `scripts/openloomi-loop.cjs` (~44KB) that ran its own cron-style
 * `schedule --interval 600` / `watch` loop and fired native OS
 * notifications via `osascript` for every fresh `pending` row — including
 * noop / tick_summary / "0 new decisions" records. The release build ships
 * only an 1819-byte shim, but users who installed a debug build once may
 * still have the legacy process running. We sweep and SIGTERM it on app
 * boot.
 *
 * Detection rules (any of):
 *   - $HOME/.openloomi/loop/data/loop.pid exists, points at a live
 *     process, and `ps -p $PID -o args=` matches
 *     /openloomi-loop\.cjs.*(schedule|watch)/
 *   - pgrep -af finds a `node …openloomi-loop.cjs` matching (schedule|watch)
 *
 * All kills are SIGTERM, best-effort. PID file removed on cleanup.
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDirs } from "./paths";

const LEGACY_PID_PATH = join(
  homedir(),
  ".openloomi",
  "loop",
  "data",
  "loop.pid",
);
const LEGACY_LOG_PATH = join(homedir(), ".openloomi", "loop", "loop.log");
const LEGACY_PATTERN = /openloomi-loop\.cjs.*\b(schedule|watch)\b/;

function log(line: string): void {
  ensureDirs();
  const stamp = new Date().toISOString();
  try {
    appendFileSync(LEGACY_LOG_PATH, `[${stamp}] [legacy-cleanup] ${line}\n`);
  } catch {
    /* best effort */
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidArgs(pid: number): string {
  try {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
    });
    return (r.stdout ?? "").trim();
  } catch {
    return "";
  }
}

function killIfMatches(pid: number): boolean {
  if (!pidAlive(pid)) return false;
  const args = pidArgs(pid);
  if (!LEGACY_PATTERN.test(args)) return false;
  try {
    process.kill(pid, "SIGTERM");
    log(`SIGTERM legacy daemon pid=${pid} args=${args.slice(0, 200)}`);
    return true;
  } catch (e) {
    log(`failed SIGTERM pid=${pid}: ${(e as Error).message}`);
    return false;
  }
}

export interface LegacyCleanupResult {
  killedPids: number[];
  scanned: number;
  pidFileRemoved: boolean;
  errors: string[];
}

/**
 * Idempotent. Safe to call on every boot. Never throws.
 */
export function cleanupLegacyLoopDaemon(): LegacyCleanupResult {
  const result: LegacyCleanupResult = {
    killedPids: [],
    scanned: 0,
    pidFileRemoved: false,
    errors: [],
  };

  // 1) Honour the PID file.
  try {
    if (existsSync(LEGACY_PID_PATH)) {
      const raw = readFileSync(LEGACY_PID_PATH, "utf8").trim();
      const pid = Number(raw);
      if (Number.isFinite(pid) && pid > 0) {
        result.scanned++;
        if (killIfMatches(pid)) result.killedPids.push(pid);
      }
      try {
        unlinkSync(LEGACY_PID_PATH);
        result.pidFileRemoved = true;
      } catch (e) {
        result.errors.push(
          `failed to remove pid file: ${(e as Error).message}`,
        );
      }
    }
  } catch (e) {
    result.errors.push(`pid file scan failed: ${(e as Error).message}`);
  }

  // 2) Sweep any other lingering legacy processes.
  try {
    const r = spawnSync("pgrep", ["-af", "openloomi-loop\\.cjs"], {
      encoding: "utf8",
    });
    const out = (r.stdout ?? "").trim();
    if (out) {
      for (const line of out.split("\n")) {
        const m = line.match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const args = m[2] ?? "";
        if (!LEGACY_PATTERN.test(args)) continue;
        result.scanned++;
        if (killIfMatches(pid)) result.killedPids.push(pid);
      }
    }
  } catch (e) {
    result.errors.push(`pgrep failed: ${(e as Error).message}`);
  }

  if (result.killedPids.length > 0) {
    log(`cleanup complete: killed=${result.killedPids.join(",")}`);
  }
  return result;
}
