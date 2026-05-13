/**
 * Native Sandbox Provider
 *
 * Executes code directly on the host system without isolation.
 * Always available as a fallback option.
 */

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
  getNativeConfigSchema,
} from "../plugin";

import type { SandboxPlugin, SandboxProviderMetadata } from "../types";

/**
 * Native Sandbox Provider
 */
export class NativeProvider extends BaseSandboxProvider {
  readonly type = "native" as const;
  readonly name = "Native (No Isolation)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this.config = {
      shell: "/bin/bash",
      defaultTimeout: 120000,
    };

    await super.init(config);

    if (config) {
      const schema = getNativeConfigSchema();
      const validated = schema.parse(config);
      this.config = { ...this.config, ...validated };
    }

    console.log(
      `[NativeProvider] Initialized with timeout: ${this.config.defaultTimeout}ms`,
    );
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const { command, args = [], cwd, env, timeout } = options;

    const execTimeout =
      timeout || (this.config.defaultTimeout as number) || 120000;
    const workDir = cwd || process.cwd();

    console.log(`[NativeProvider] Executing: ${command} ${args.join(" ")}`);

    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proc: any = spawn(command, args, {
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

      proc.on("close", (code: number | null) => {
        const duration = Date.now() - startTime;
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration,
          provider: {
            type: this.type,
            name: this.name,
            isolation: "none",
          },
        });
      });

      proc.on("error", (error: Error) => {
        const duration = Date.now() - startTime;
        resolve({
          stdout,
          stderr: `${stderr}\n${error.message}`,
          exitCode: -1,
          duration,
          provider: {
            type: this.type,
            name: this.name,
            isolation: "none",
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
    const ext = extname(filePath).toLowerCase();
    const { runtime } = detectRuntime(filePath);

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
      console.error(`[NativeProvider] Package installation failed:`, error);
      throw error;
    }
  }

  getCapabilities() {
    return {
      supportsVolumeMounts: false,
      supportsNetworking: true,
      isolation: "none" as const,
      supportedRuntimes: ["node", "python", "bun", "bash"],
      supportsPooling: false,
    };
  }
}

const NATIVE_METADATA: SandboxProviderMetadata = {
  type: "native",
  name: "Native (No Isolation)",
  description:
    "Execute code directly on the host system. Always available but provides no security isolation.",
  version: "1.0.0",
  priority: 10,
  builtin: true,
  capabilities: {
    supportsVolumeMounts: false,
    supportsNetworking: true,
    isolation: "none",
    supportedRuntimes: ["node", "python", "bun", "bash"],
    supportsPooling: false,
  },
  configSchema: getNativeConfigSchema().shape,
};

export const nativePlugin: SandboxPlugin = defineSandboxPlugin({
  metadata: NATIVE_METADATA,
  factory: () => new NativeProvider(),
});

export function createNativeProvider(): NativeProvider {
  return new NativeProvider();
}
