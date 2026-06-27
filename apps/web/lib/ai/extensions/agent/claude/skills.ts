import { dirname } from "node:path";

import type { SkillsConfig } from "@openloomi/ai/agent/types";
import {
  clearSkillsFromClaude,
  syncSkillsToClaude,
} from "@/lib/ai/skills/loader";

export interface ClaudeRuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Build settingSources for Claude SDK.
 *
 * OpenLoomi syncs ~/.openloomi/skills into project .claude/skills and keeps
 * the SDK on project settings so user ~/.claude/settings.json cannot override
 * API settings supplied by OpenLoomi.
 */
export function buildClaudeSettingSources(
  _skillsConfig?: SkillsConfig,
): ("user" | "project")[] {
  return ["project"];
}

/**
 * Copy OpenLoomi skills into the directories Claude Code will inspect for this
 * session.
 */
export function syncSkillsForClaudeSession({
  sessionId,
  sessionCwd,
  bundledCliPath,
  logger,
  includeTimings = false,
}: {
  sessionId: string;
  sessionCwd: string;
  bundledCliPath?: string;
  logger: ClaudeRuntimeLogger;
  includeTimings?: boolean;
}) {
  try {
    const syncStart = Date.now();
    syncSkillsToClaude(sessionCwd);
    const timing = includeTimings ? ` (${Date.now() - syncStart}ms)` : "";
    logger.info(
      `[Claude ${sessionId}] Synced skills to session directory: ${sessionCwd}${timing}`,
    );

    if (bundledCliPath) {
      const bundleDir = dirname(bundledCliPath);
      // On Windows, the Skill tool can resolve relative files from the bundled
      // Claude Code directory, so mirror skills there as well.
      if (bundleDir !== sessionCwd) {
        const bundleSyncStart = Date.now();
        syncSkillsToClaude(bundleDir);
        const bundleTiming = includeTimings
          ? ` (${Date.now() - bundleSyncStart}ms)`
          : "";
        logger.info(
          `[Claude ${sessionId}] Synced skills to CLI bundle directory: ${bundleDir}${bundleTiming}`,
        );
      }
    }
  } catch (error) {
    logger.error(
      `[Claude ${sessionId}] Failed to sync skills to session:`,
      error,
    );
  }
}

/**
 * Clear session-synced skills on Windows so the next run does not inherit stale
 * generated skill files.
 */
export function clearSkillsForClaudeSession({
  sessionCwd,
  bundledCliPath,
}: {
  sessionCwd: string;
  bundledCliPath?: string;
}) {
  if (process.platform !== "win32") {
    return;
  }

  try {
    // Cleanup is best-effort; failing to remove generated skill files should not
    // hide the actual agent result from the caller.
    clearSkillsFromClaude(sessionCwd);
    if (bundledCliPath) {
      const bundleDir = dirname(bundledCliPath);
      if (bundleDir !== sessionCwd) {
        clearSkillsFromClaude(bundleDir);
      }
    }
  } catch {}
}
