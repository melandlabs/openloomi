import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentOptions } from "@openloomi/ai/agent/types";

import { getDefaultMemoryPath } from "@/lib/ai/mcp/tools/memory-path-search";

export const CODEX_MEMORY_MCP_SERVER_NAME = "openloomi_memory";
export const CODEX_MEMORY_MCP_SCRIPT = "openloomi-memory-mcp.mjs";

interface CodexMemoryMcpOptions {
  mode: "run" | "plan" | "execute";
  session?: AgentOptions["session"];
  excludeTools?: string[];
  disallowedTools?: string[];
}

export interface CodexMemoryMcpConfig {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function buildCodexMemoryMcpConfig(
  options: CodexMemoryMcpOptions,
): CodexMemoryMcpConfig | undefined {
  if (!shouldAttachCodexMemoryMcp(options)) {
    return undefined;
  }

  const userId = readSessionUserId(options.session);
  const scriptPath = resolveCodexMemoryMcpScript();
  if (!userId || !scriptPath) {
    return undefined;
  }

  return {
    serverName: CODEX_MEMORY_MCP_SERVER_NAME,
    command: process.execPath,
    args: [scriptPath],
    env: {
      OPENLOOMI_MCP_USER_ID: userId,
      OPENLOOMI_MEMORY_PATH: getDefaultMemoryPath(),
    },
  };
}

export function resolveCodexMemoryMcpScript(): string | null {
  const envPath = process.env.OPENLOOMI_CODEX_MEMORY_MCP;
  if (envPath && isFile(envPath)) {
    return envPath;
  }

  for (const candidate of listCodexMemoryMcpCandidates()) {
    if (isFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function listCodexMemoryMcpCandidates(): string[] {
  return Array.from(
    new Set([
      ...standaloneCandidates(),
      ...devCandidates(),
      ...selfRelativeCandidates(),
    ]),
  ).map((dir) => join(dir, CODEX_MEMORY_MCP_SCRIPT));
}

function shouldAttachCodexMemoryMcp(options: CodexMemoryMcpOptions) {
  if (options.mode === "plan") {
    return false;
  }
  if (!readSessionUserId(options.session)) {
    return false;
  }

  const blocked = new Set([
    ...(options.excludeTools ?? []),
    ...(options.disallowedTools ?? []),
  ]);
  return !blocked.has("searchMemoryPath");
}

function readSessionUserId(session: unknown): string | undefined {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return undefined;
  }

  const user = (session as Record<string, unknown>).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    return undefined;
  }

  const id = (user as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function standaloneCandidates(): string[] {
  const cwd = process.cwd();
  const probes = [
    cwd,
    resolve(cwd, ".."),
    resolve(cwd, "../.."),
    resolve(cwd, "../../.."),
  ];
  const roots: string[] = [];

  for (const probe of probes) {
    roots.push(
      join(probe, "scripts"),
      join(probe, "apps", "web", "scripts"),
      join(probe, ".next", "standalone", "apps", "web", "scripts"),
      join(probe, ".next", "standalone", "scripts"),
    );
  }

  return roots;
}

function devCandidates(): string[] {
  const cwd = process.cwd();
  const probes = [
    cwd,
    resolve(cwd, ".."),
    resolve(cwd, "../.."),
    resolve(cwd, "../../.."),
  ];
  const roots: string[] = [];

  for (const probe of probes) {
    roots.push(join(probe, "apps", "web", "scripts"));
  }

  return roots;
}

function selfRelativeCandidates(): string[] {
  try {
    const importMetaUrl =
      typeof import.meta !== "undefined" ? import.meta.url : "";
    const here = importMetaUrl ? fileURLToPath(importMetaUrl) : __filename;
    const hereDir = dirname(here);
    const webDir = resolve(hereDir, "..", "..", "..", "..", "..");
    const rootDir = resolve(webDir, "..", "..");

    return [join(webDir, "scripts"), join(rootDir, "apps", "web", "scripts")];
  } catch {
    return [];
  }
}

function isFile(filePath: string) {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}
