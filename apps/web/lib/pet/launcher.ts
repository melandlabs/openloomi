/**
 * Desktop pet launcher (apps/pet integration).
 *
 * The pet is a standalone Electron app that observes OpenLoomi read-only.
 * This module owns:
 *   - the on/off preference (~/.openloomi/pet-settings.json, default ON)
 *   - locating the pet app (OPENLOOMI_PET_PATH or monorepo apps/pet)
 *   - starting/stopping it (pid file at ~/.openloomipet/pet.pid)
 *
 * Node.js runtime only — never import from Edge/client code paths.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface PetSettings {
  enabled: boolean;
}

const SETTINGS_PATH = join(homedir(), ".openloomi", "pet-settings.json");
const PID_PATH = join(homedir(), ".openloomipet", "pet.pid");
const DEFAULTS: PetSettings = { enabled: true };

export function getPetSettings(): PetSettings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    return { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePetSettings(patch: Partial<PetSettings>): PetSettings {
  const next = { ...getPetSettings(), ...patch };
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf-8");
  } catch (e) {
    console.warn("[Pet] Failed to persist pet settings:", e);
  }
  return next;
}

function readPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isPetRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the pet app directory. Resolution order:
 *   1. OPENLOOMI_PET_PATH env
 *   2. monorepo sibling (apps/web → apps/pet), for `pnpm dev` / repo runs
 * Returns null when not present (e.g. packaged desktop builds that do not
 * bundle the pet) — callers must treat that as a soft miss, not an error.
 */
export function findPetDir(): string | null {
  const candidates = [
    process.env.OPENLOOMI_PET_PATH,
    resolve(process.cwd(), "../pet"),
    resolve(process.cwd(), "apps/pet"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "main.js")) &&
      existsSync(join(dir, "package.json"))
    ) {
      return dir;
    }
  }
  return null;
}

export function launchPet(): { ok: boolean; reason?: string } {
  if (isPetRunning()) return { ok: true, reason: "already running" };
  const dir = findPetDir();
  if (!dir) {
    return {
      ok: false,
      reason:
        "pet app not found (set OPENLOOMI_PET_PATH or run from the monorepo)",
    };
  }
  // electron 可能装在 pet 自己的 node_modules（独立 npm install），也可能被
  // pnpm hoisted 到 monorepo 根 node_modules —— 两处都找。
  const binName = process.platform === "win32" ? "electron.cmd" : "electron";
  const electronBin = [
    join(dir, "node_modules", ".bin", binName),
    resolve(dir, "../../node_modules/.bin", binName),
  ].find((p) => existsSync(p));
  if (!electronBin) {
    return {
      ok: false,
      reason: `electron not installed for ${dir} (run install in the pet dir or monorepo root)`,
    };
  }
  try {
    // 剥掉会毒害 Electron 的继承环境：dev 脚本的 NODE_OPTIONS 带着相对路径
    // 的 --require，在 pet 的 cwd 下解析不到会让进程秒退。
    // （解构剔除而非 delete —— biome lint/performance/noDelete）
    const {
      NODE_OPTIONS: _nodeOptions,
      ELECTRON_RUN_AS_NODE: _electronRunAsNode,
      ...env
    } = process.env;
    const child = spawn(electronBin, ["."], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    console.log(`[Pet] Launched desktop pet from ${dir} (pid ${child.pid})`);
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "spawn failed";
    console.warn("[Pet] Launch failed:", reason);
    return { ok: false, reason };
  }
}

export function stopPet(): { ok: boolean } {
  const pid = readPid();
  if (!pid) return { ok: true };
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[Pet] Stopped desktop pet (pid ${pid})`);
  } catch {
    /* already gone */
  }
  return { ok: true };
}

/** Called once from instrumentation at server boot. */
export function maybeAutoLaunchPet() {
  const settings = getPetSettings();
  if (!settings.enabled) {
    console.log("[Pet] Auto-launch skipped: disabled in settings");
    return;
  }
  const result = launchPet();
  if (!result.ok) console.log(`[Pet] Auto-launch skipped: ${result.reason}`);
}
