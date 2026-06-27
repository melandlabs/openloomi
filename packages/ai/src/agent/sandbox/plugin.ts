/**
 * Sandbox Plugin System
 *
 * Provides the base class and helper functions for creating sandbox providers.
 */

import { execSync } from "node:child_process";
import { extname, join } from "node:path";
import { z } from "zod";

import type {
  ISandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxPlugin,
  SandboxProviderType,
  ScriptOptions,
  VolumeMount,
} from "./types";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect runtime from file extension
 */
export function detectRuntime(filePath: string): {
  runtime: string;
  image: string;
} {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".py":
      return { runtime: "python3", image: "python:3.11-slim" };
    case ".ts":
      return { runtime: "npx", image: "node:18-alpine" };
    case ".js":
      return { runtime: "node", image: "node:18-alpine" };
    case ".sh":
      return { runtime: "bash", image: "node:18-alpine" };
    default:
      return { runtime: "node", image: "node:18-alpine" };
  }
}

/**
 * Get the script path to use inside container/sandbox
 */
export function getContainerScriptPath(
  filePath: string,
  workDir: string,
): string {
  if (filePath.startsWith(workDir)) {
    return filePath.substring(workDir.length);
  }
  return join("/", filePath.split("/").pop() || "script");
}

/**
 * Check if a command is available on the system
 */
export function isCommandAvailable(command: string): boolean {
  try {
    const platform = process.platform;
    const shellCommand =
      platform === "win32" ? `where ${command}` : `which ${command}`;

    execSync(shellCommand, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Base Sandbox Provider
// ============================================================================

/**
 * Abstract base class for sandbox providers.
 */
export abstract class BaseSandboxProvider implements ISandboxProvider {
  abstract readonly type: SandboxProviderType;
  abstract readonly name: string;

  protected config: Record<string, unknown> = {};
  protected volumes: VolumeMount[] = [];
  protected initialized = false;

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.initialized = true;
  }

  abstract isAvailable(): Promise<boolean>;
  abstract exec(options: SandboxExecOptions): Promise<SandboxExecResult>;
  abstract runScript(
    filePath: string,
    workDir: string,
    options?: ScriptOptions,
  ): Promise<SandboxExecResult>;
  abstract getCapabilities(): SandboxCapabilities;

  async stop(): Promise<void> {
    this.initialized = false;
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  setVolumes?(volumes: VolumeMount[]): void {
    this.volumes = volumes;
  }
}

// ============================================================================
// Plugin Definition Helper
// ============================================================================

export function defineSandboxPlugin(plugin: SandboxPlugin): SandboxPlugin {
  if (!plugin.metadata.type) {
    throw new Error("Sandbox plugin must have a type");
  }
  if (!plugin.metadata.name) {
    throw new Error("Sandbox plugin must have a name");
  }
  if (typeof plugin.factory !== "function") {
    throw new Error("Sandbox plugin must have a factory function");
  }

  return plugin;
}

// ============================================================================
// Config Schemas (Zod)
// ============================================================================

/**
 * Get Native Provider config schema
 */
export function getNativeConfigSchema() {
  return z.object({
    allowedDirectories: z.array(z.string()).optional(),
    shell: z.string().default("/bin/bash"),
    defaultTimeout: z.number().default(120000),
  });
}

/**
 * Get Claude Provider config schema
 */
export function getClaudeConfigSchema() {
  return z.object({
    srtPath: z.string().optional(),
    defaultTimeout: z.number().default(120000),
  });
}

/**
 * Get Codex Provider config schema
 */
export function getCodexConfigSchema() {
  return z.object({
    codexPath: z.string().optional(),
    defaultTimeout: z.number().default(120000),
  });
}
