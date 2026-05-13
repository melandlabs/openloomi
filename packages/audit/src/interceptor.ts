/**
 * Audit interceptor
 *
 * Automatically records non-project file reads and local command executions
 * during program runtime by replacing key methods of Node.js native fs / child_process modules.
 *
 * Call installAuditInterceptors() in instrumentation.ts's register()
 * to activate on server startup.
 *
 * Note: All Node.js modules are loaded via dynamic require()
 * to avoid Edge Runtime static analysis errors.
 */

let installed = false;
let projectRoot = "";

/**
 * Determine if a file path belongs to "non-project"
 * - Files within project directory are not recorded
 * - node_modules / .next / .openloomi directories are not recorded
 */
function isNonProjectPath(filePath: string): boolean {
  try {
    const { resolve } = require("node:path") as typeof import("node:path");
    const { homedir } = require("node:os") as typeof import("node:os");
    const resolved = resolve(String(filePath));
    if (resolved.includes("node_modules") || resolved.includes(".next")) {
      return false;
    }
    if (resolved.startsWith(projectRoot)) {
      return false;
    }
    // Skip ~/.openloomi app data directory
    const openloomiDir = resolve(homedir(), ".openloomi");
    if (resolved.startsWith(openloomiDir)) {
      return false;
    }
    // Skip /dev/null, /proc and other system pseudo-files
    if (
      resolved.startsWith("/dev/") ||
      resolved.startsWith("/proc/") ||
      resolved.startsWith("/sys/")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Install audit interceptors - runs only once on Node.js server-side
 */
export function installAuditInterceptors() {
  if (installed) return;
  installed = true;

  try {
    const { resolve } = require("node:path") as typeof import("node:path");
    const { logFileRead, logCommandExec } =
      require("./logger") as typeof import("./logger");

    projectRoot = resolve(globalThis.process.cwd());
    // If started from apps/web, project root is two levels up
    if (
      projectRoot.endsWith("/apps/web") ||
      projectRoot.endsWith("\\apps\\web")
    ) {
      projectRoot = resolve(projectRoot, "..", "..");
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cp = require("node:child_process");

    // ────────── Save original function ──────────
    const origReadFileSync = fs.readFileSync;
    const origReadFile = fs.readFile;
    const origExecSync = cp.execSync;
    const origExec = cp.exec;
    const origSpawn = cp.spawn;
    const origSpawnSync = cp.spawnSync;

    // ────────── Intercept fs.readFileSync ──────────
    fs.readFileSync = function auditedReadFileSync(
      path: unknown,
      ...args: unknown[]
    ) {
      try {
        const p = String(path);
        if (isNonProjectPath(p)) {
          logFileRead(resolve(p));
        }
      } catch {
        // Does not affect original call
      }
      return origReadFileSync.apply(fs, [path, ...args]);
    };

    // ────────── Intercept fs.readFile ──────────
    fs.readFile = function auditedReadFile(path: unknown, ...args: unknown[]) {
      try {
        const p = String(path);
        if (isNonProjectPath(p)) {
          logFileRead(resolve(p));
        }
      } catch {
        // Does not affect original call
      }
      return origReadFile.apply(fs, [path, ...args]);
    };

    // Intercept fs.promises.readFile
    if (fs.promises) {
      const origPromisesReadFile = fs.promises.readFile;
      fs.promises.readFile = function auditedPromisesReadFile(
        path: unknown,
        ...args: unknown[]
      ) {
        try {
          const p = String(path);
          if (isNonProjectPath(p)) {
            logFileRead(resolve(p));
          }
        } catch {
          // Does not affect original call
        }
        return origPromisesReadFile.apply(fs.promises, [path, ...args]);
      };
    }

    // ────────── Intercept child_process.execSync ──────────
    cp.execSync = function auditedExecSync(
      command: unknown,
      ...args: unknown[]
    ) {
      try {
        logCommandExec(String(command));
      } catch {
        // Does not affect original call
      }
      return origExecSync.apply(cp, [command, ...args]);
    };

    // ────────── Intercept child_process.exec ──────────
    cp.exec = function auditedExec(command: unknown, ...args: unknown[]) {
      try {
        logCommandExec(String(command));
      } catch {
        // Does not affect original call
      }
      return origExec.apply(cp, [command, ...args]);
    };

    // ────────── Intercept child_process.spawn ──────────
    cp.spawn = function auditedSpawn(
      command: unknown,
      spawnArgs?: unknown,
      ...rest: unknown[]
    ) {
      try {
        const argsArr = Array.isArray(spawnArgs)
          ? spawnArgs.map(String)
          : undefined;
        logCommandExec(String(command), argsArr);
      } catch {
        // Does not affect original call
      }
      return origSpawn.apply(cp, [command, spawnArgs, ...rest]);
    };

    // ────────── Intercept child_process.spawnSync ──────────
    cp.spawnSync = function auditedSpawnSync(
      command: unknown,
      spawnArgs?: unknown,
      ...rest: unknown[]
    ) {
      try {
        const argsArr = Array.isArray(spawnArgs)
          ? spawnArgs.map(String)
          : undefined;
        logCommandExec(String(command), argsArr);
      } catch {
        // Does not affect original call
      }
      return origSpawnSync.apply(cp, [command, spawnArgs, ...rest]);
    };
  } catch (e) {
    console.error("[Audit] Error:", e);
  }
}
