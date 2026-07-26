import {
  exec,
  spawn,
  type ChildProcess,
  type SpawnOptionsWithStdioTuple,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

import { createLineBufferedDiagnosticSink } from "./runtime-preflight";

type ClaudeCodeProcessSpawner = NonNullable<Options["spawnClaudeCodeProcess"]>;
type ClaudeCodeSpawnInput = Parameters<ClaudeCodeProcessSpawner>[0];
type FullyPipedSpawnOptions = SpawnOptionsWithStdioTuple<
  "pipe",
  "pipe",
  "pipe"
>;

/**
 * Create OpenLoomi's Claude Code process launcher.
 *
 * The Claude Agent SDK does not consume stderr when a custom spawner is
 * supplied. Every route therefore goes through one registration boundary
 * which preserves Windows process-tree cancellation and drains stderr through
 * the bounded line sink before the caller redacts and logs it.
 */
export function createClaudeCodeProcessSpawner(
  onDiagnosticLine: (line: string) => void,
): ClaudeCodeProcessSpawner {
  return (options) => spawnClaudeCodeProcess(options, onDiagnosticLine);
}

function spawnClaudeCodeProcess(
  options: ClaudeCodeSpawnInput,
  onDiagnosticLine: (line: string) => void,
) {
  const os = platform();

  const registerWindowsTreeKill = (childProcess: ChildProcess) => {
    if (os === "win32" && childProcess.pid) {
      const signal = options.signal;
      const unregister = () => {
        signal.removeEventListener("abort", killProcessTree);
        childProcess.off("exit", unregister);
        childProcess.off("close", unregister);
      };
      const killProcessTree = () => {
        unregister();
        exec(
          `taskkill /F /T /PID ${childProcess.pid}`,
          { windowsHide: true },
          () => {
            // Ignore errors — the process may already be dead.
          },
        );
      };

      signal.addEventListener("abort", killProcessTree, { once: true });
      childProcess.once("exit", unregister);
      childProcess.once("close", unregister);
    }
  };

  const registerChildProcess = (childProcess: ChildProcess) => {
    registerWindowsTreeKill(childProcess);
    if (childProcess.stderr) {
      // A credential can straddle arbitrary stream chunks. Reassemble bounded
      // lines before forwarding them to the redacting diagnostic callback.
      const stderrSink = createLineBufferedDiagnosticSink(onDiagnosticLine);
      childProcess.stderr.on("data", (data: Buffer | string) => {
        stderrSink.write(data);
      });
      childProcess.stderr.once("end", () => stderrSink.end());
      childProcess.stderr.once("close", () => stderrSink.end());
    }
  };

  const asProcessEnv = (
    env: Record<string, string | undefined>,
  ): NodeJS.ProcessEnv => env as NodeJS.ProcessEnv;

  let resolvedCwd = options.cwd;
  if (resolvedCwd) {
    const isAbsolute =
      os === "win32"
        ? /^[a-zA-Z]:[\\/]/.test(resolvedCwd)
        : resolvedCwd.startsWith("/");
    if (!isAbsolute) {
      resolvedCwd = join(process.cwd(), resolvedCwd);
    }
  }

  const spawnRegistered = (
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
  ) => {
    const spawnOptions: FullyPipedSpawnOptions = {
      cwd: resolvedCwd,
      env: asProcessEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
      windowsHide: true,
    };
    const childProcess = spawn(command, args, spawnOptions);
    registerChildProcess(childProcess);
    return childProcess;
  };

  // Current legacy bundles expose a .cmd/.sh wrapper next to cli.js.
  const isBundledClaude =
    (options.command.endsWith(".sh") || options.command.endsWith(".cmd")) &&
    options.command.includes("cli-bundle");

  if (isBundledClaude) {
    const normalizedCommand = options.command.replace(/\\/g, "/");
    const wrapperDir = normalizedCommand.split("/").slice(0, -1).join("/");
    const markerPath = join(wrapperDir, ".bundle-path");

    let bundleDir = wrapperDir;
    if (existsSync(markerPath)) {
      try {
        const marker = readFileSync(markerPath, "utf-8").trim();
        if (marker && existsSync(marker)) {
          bundleDir = marker;
        }
      } catch {
        // Ignore an invalid marker and fall through to legacy behavior.
      }
    }
    const cliJsPath = join(bundleDir, "cli.js");

    let nodeToUse: string;
    if (os === "win32") {
      const openloomiNode = join(homedir(), ".openloomi", "node", "node.exe");
      nodeToUse = existsSync(openloomiNode) ? openloomiNode : "node";
    } else {
      const nodeBinPath = join(bundleDir, "node");
      nodeToUse = existsSync(nodeBinPath) ? nodeBinPath : "node";
    }

    const childProcess = spawnRegistered(
      nodeToUse,
      [cliJsPath, ...options.args],
      { ...options.env, CLAUDECODE: "" },
    );

    // Prevent a parent Claude Code process from leaking its nesting marker to
    // later children spawned through this long-lived desktop process.
    process.env.CLAUDECODE = "";
    return childProcess;
  }

  const isShellScript =
    options.command.endsWith(".sh") || options.command.endsWith(".cmd");

  if (isShellScript) {
    if (os === "win32") {
      return spawnRegistered(
        "cmd.exe",
        ["/c", options.command, ...options.args],
        options.env,
      );
    }

    return spawnRegistered(
      "/bin/sh",
      [
        "-c",
        `unset CLAUDECODE && exec "$0" "$@"`,
        options.command,
        ...options.args,
      ],
      options.env,
    );
  }

  const isBundledNativeClaude =
    options.command.includes("cli-bundle") &&
    ["claude", "claude.exe"].includes(basename(options.command).toLowerCase());
  return spawnRegistered(
    options.command,
    options.args,
    isBundledNativeClaude ? { ...options.env, CLAUDECODE: "" } : options.env,
  );
}
