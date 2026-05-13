/**
 * Claude Sandbox Provider
 *
 * Uses Anthropic's official sandbox-runtime (srt) for isolated code execution.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { extname } from "node:path";

import type {
  SandboxExecOptions,
  SandboxExecResult,
  ScriptOptions,
} from "../types";

import {
  BaseSandboxProvider,
  defineSandboxPlugin,
  detectRuntime,
  getClaudeConfigSchema,
  isCommandAvailable,
} from "../plugin";

import type { SandboxPlugin, SandboxProviderMetadata } from "../types";

/**
 * Claude Sandbox Provider
 */
export class ClaudeProvider extends BaseSandboxProvider {
  readonly type = "claude" as const;
  readonly name = "Claude Sandbox";

  private srtPath: string | undefined;

  async isAvailable(): Promise<boolean> {
    this.srtPath = this.detectSrtPath();
    return this.srtPath !== undefined;
  }

  private detectSrtPath(): string | undefined {
    if (process.env.SRT_PATH) {
      const envPath = process.env.SRT_PATH;
      if (existsSync(envPath)) {
        return envPath;
      }
    }

    if (isCommandAvailable("srt")) {
      try {
        const os = platform();
        const shellCommand = os === "win32" ? "where srt" : "which srt";
        const path = execSync(shellCommand, {
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        return path;
      } catch {
        // continue
      }
    }

    const os = platform();
    const homeDir = process.env.HOME || process.env.USERPROFILE;

    const commonPaths =
      os === "darwin"
        ? [
            "/usr/local/bin/srt",
            join(homeDir || "", ".local/bin/srt"),
            "/opt/homebrew/bin/srt",
          ]
        : os === "linux"
          ? [
              "/usr/bin/srt",
              "/usr/local/bin/srt",
              join(homeDir || "", ".local/bin/srt"),
            ]
          : os === "win32"
            ? [
                join(process.env.APPDATA || "", "npm", "srt.cmd"),
                join(process.env.ProgramFiles || "", "srt", "srt.exe"),
              ]
            : [];

    for (const path of commonPaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return undefined;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this.config = {
      defaultTimeout: 120000,
    };

    await super.init(config);

    if (config) {
      const schema = getClaudeConfigSchema();
      const validated = schema.parse(config);
      this.config = { ...this.config, ...validated };

      if (validated.srtPath) {
        this.srtPath = validated.srtPath;
      }
    }

    if (!this.srtPath) {
      this.srtPath = this.detectSrtPath();
    }
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    if (!this.srtPath) {
      throw new Error(
        "Sandbox Runtime (srt) is not available. Please install @anthropic-ai/sandbox-runtime.",
      );
    }

    const startTime = Date.now();
    const { command, args = [], cwd, env, timeout } = options;

    const execTimeout =
      timeout || (this.config.defaultTimeout as number) || 120000;
    const workDir = cwd || process.cwd();
    const srtPath = this.srtPath;

    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proc: any = spawn(srtPath, ["run", "--", command, ...args], {
        cwd: workDir,
        env: { ...process.env, ...env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutHandle = setTimeout(() => {
        proc.kill("SIGTERM");
      }, execTimeout);

      proc.on("close", (code: number | null) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration,
          provider: {
            type: this.type,
            name: this.name,
            isolation: "process",
          },
        });
      });

      proc.on("error", (error: Error) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;
        resolve({
          stdout,
          stderr: `${stderr}\n${error.message}`,
          exitCode: -1,
          duration,
          provider: {
            type: this.type,
            name: this.name,
            isolation: "process",
          },
        });
      });
    });
  }

  async runScript(
    filePath: string,
    workDir: string,
    options?: ScriptOptions,
  ): Promise<SandboxExecResult> {
    const { runtime } = detectRuntime(filePath);
    const ext = extname(filePath).toLowerCase();

    let command = runtime;
    let args: string[] = [];

    switch (ext) {
      case ".py":
        command = "python3";
        args = [filePath];
        break;
      case ".ts":
        command = "npx";
        args = ["tsx", filePath];
        break;
      case ".js":
        command = "node";
        args = [filePath];
        break;
      case ".sh":
        command = "bash";
        args = [filePath];
        break;
      default:
        command = "node";
        args = [filePath];
    }

    if (options?.args) {
      args = [...args, ...options.args];
    }

    if (options?.packages && options.packages.length > 0) {
      await this.installPackages(filePath, options.packages);
    }

    return this.exec({
      command,
      args,
      cwd: workDir,
      env: options?.env,
      timeout: options?.timeout || (this.config.defaultTimeout as number),
    });
  }

  private async installPackages(
    filePath: string,
    packages: string[],
  ): Promise<void> {
    const ext = extname(filePath).toLowerCase();

    let installCommand: string;
    let installArgs: string[];

    switch (ext) {
      case ".py":
        installCommand = "pip3";
        installArgs = ["install", ...packages];
        break;
      case ".ts":
      case ".js":
        installCommand = "npm";
        installArgs = ["install", "--no-save", ...packages];
        break;
      default:
        return;
    }

    try {
      await this.exec({
        command: installCommand,
        args: installArgs,
        timeout: 60000,
      });
    } catch (error) {
      console.error(`[ClaudeProvider] Package installation failed:`, error);
      throw error;
    }
  }

  getCapabilities() {
    return {
      supportsVolumeMounts: false,
      supportsNetworking: true,
      isolation: "process" as const,
      supportedRuntimes: ["node", "python", "bun"],
      supportsPooling: false,
    };
  }
}

const CLAUDE_METADATA: SandboxProviderMetadata = {
  type: "claude",
  name: "Claude Sandbox",
  description:
    "Uses Anthropic's sandbox-runtime (srt) for process-isolated code execution.",
  version: "1.0.0",
  priority: 100,
  builtin: true,
  capabilities: {
    supportsVolumeMounts: false,
    supportsNetworking: true,
    isolation: "process",
    supportedRuntimes: ["node", "python", "bun"],
    supportsPooling: false,
  },
  configSchema: getClaudeConfigSchema().shape,
};

export const claudePlugin: SandboxPlugin = defineSandboxPlugin({
  metadata: CLAUDE_METADATA,
  factory: () => new ClaudeProvider(),
});

export function createClaudeProvider(): ClaudeProvider {
  return new ClaudeProvider();
}
