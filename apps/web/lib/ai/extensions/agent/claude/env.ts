import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { AgentConfig } from "@openloomi/ai/agent/types";

import { DEFAULT_AI_MODEL } from "@/lib/env/constants";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("ClaudeAgent");

/**
 * Custom API mode means OpenLoomi owns endpoint/model/auth configuration
 * instead of letting Claude Code read defaults from the user's Claude settings.
 */
export function isUsingCustomApi(config: AgentConfig): boolean {
  return !!config.baseUrl;
}

/**
 * Build extended PATH that includes common package manager bin locations.
 */
export function getExtendedPath(): string {
  const home = homedir();
  const os = platform();
  const isWindows = os === "win32";
  const pathSeparator = isWindows ? ";" : ":";

  const paths = [process.env.PATH || ""];

  if (isWindows) {
    paths.push(
      join(home, "AppData", "Roaming", "npm"),
      join(home, "AppData", "Local", "Programs", "nodejs"),
      join(home, ".volta", "bin"),
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
    );
  } else {
    paths.push(
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/code/node/npm_global/bin`,
    );

    const nvmDir = join(home, ".nvm", "versions", "node");
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(join(nvmDir, version, "bin"));
        }
      }
    } catch {
      // nvm not installed.
    }
  }

  return paths.join(pathSeparator);
}

/**
 * Build environment variables for the Claude Code SDK query.
 */
export function buildClaudeEnvConfig(
  config: AgentConfig,
): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env };

  // Remove the marker used by Claude Code parent sessions. Without this, a
  // nested OpenLoomi-launched Claude Code process can refuse to start.
  env.CLAUDECODE = undefined;
  // Packaged apps often run with a shorter PATH than an interactive shell, so
  // include common Node/package-manager locations before spawning Claude Code.
  env.PATH = getExtendedPath();

  // A modelConfig apiKey must win over ambient shell variables and over
  // ~/.claude/settings.json, so prefer ANTHROPIC_AUTH_TOKEN and clear API_KEY.
  if (config.apiKey) {
    env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    env.ANTHROPIC_API_KEY = undefined;

    if (config.baseUrl) {
      env.ANTHROPIC_BASE_URL = config.baseUrl;
    } else {
      env.ANTHROPIC_BASE_URL = undefined;
      logger.info(
        "[ClaudeAgent] Using custom API key with default Anthropic base URL",
      );
    }
  } else {
    const envKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    if (envKey) {
      logger.info(
        "[ClaudeAgent] Using API config from environment: key present",
      );
    } else {
      logger.warn(
        "[ClaudeAgent] No API key configured in modelConfig or environment variables",
      );
      logger.warn(
        "[ClaudeAgent] Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in environment, or provide apiKey in modelConfig",
      );
    }
  }

  // Set all Claude model aliases to the same configured model. This matters
  // for custom providers where model names do not match Anthropic defaults.
  if (config.model) {
    env.ANTHROPIC_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.model;
  } else if (config.apiKey) {
    const llmModel = process.env.LLM_MODEL;
    if (llmModel) {
      env.ANTHROPIC_MODEL = llmModel;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = llmModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = llmModel;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = llmModel;
    } else {
      env.ANTHROPIC_MODEL = undefined;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = undefined;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = undefined;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = undefined;
    }
  } else {
    env.ANTHROPIC_MODEL = DEFAULT_AI_MODEL;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = DEFAULT_AI_MODEL;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = DEFAULT_AI_MODEL;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = DEFAULT_AI_MODEL;
  }

  // Claude Code reads extended-thinking budget from the environment, while the
  // OpenLoomi config stores the simpler UI-level thinkingLevel enum.
  if (config.thinkingLevel === "disabled") {
    env.ANTHROPIC_THINKING_BUDGET = undefined;
  } else if (config.thinkingLevel === "low") {
    env.ANTHROPIC_THINKING_BUDGET = "2048";
  } else if (config.thinkingLevel === "adaptive") {
    env.ANTHROPIC_THINKING_BUDGET = "32000";
  }

  // Third-party Claude-compatible endpoints can be sensitive to telemetry or
  // auxiliary calls, so reduce non-essential traffic when baseUrl is custom.
  if (isUsingCustomApi(config)) {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }

  // Non-Windows dev/packaged environments may run with elevated permissions.
  // This marker prevents Claude Code from stopping on its root/sudo guard.
  if (process.platform !== "win32") {
    env.IS_SANDBOX = "1";
  }

  // The SDK type is Record<string, string>; keep undefined values out instead
  // of passing environment entries that mean "delete this variable".
  const filteredEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      filteredEnv[key] = value;
    }
  }

  // The SDK spawns Claude Code as a child process. Updating process.env here
  // preserves the old behavior where the child inherited these critical vars.
  if (filteredEnv.ANTHROPIC_BASE_URL) {
    process.env.ANTHROPIC_BASE_URL = filteredEnv.ANTHROPIC_BASE_URL;
  }
  if (filteredEnv.ANTHROPIC_AUTH_TOKEN) {
    process.env.ANTHROPIC_AUTH_TOKEN = filteredEnv.ANTHROPIC_AUTH_TOKEN;
  }
  if (filteredEnv.ANTHROPIC_MODEL) {
    process.env.ANTHROPIC_MODEL = filteredEnv.ANTHROPIC_MODEL;
  }
  if (filteredEnv.ANTHROPIC_THINKING_BUDGET !== undefined) {
    process.env.ANTHROPIC_THINKING_BUDGET =
      filteredEnv.ANTHROPIC_THINKING_BUDGET;
  }
  if (!filteredEnv.CLAUDECODE) {
    process.env.CLAUDECODE = undefined;
  }

  return filteredEnv;
}

export function buildClaudeSettingsConfig(
  config: AgentConfig,
  options?: { skipWebFetchPreflight?: boolean },
): string | undefined {
  // Claude settings are only needed for custom API mode. For default Anthropic
  // usage, letting Claude Code use its normal config path is less intrusive.
  if (!isUsingCustomApi(config)) {
    return undefined;
  }

  // Passing settings directly to the SDK keeps OpenLoomi's selected endpoint,
  // token, model, and thinking budget ahead of user-level Claude settings.
  const customSettings = {
    env: {
      ANTHROPIC_BASE_URL: config.baseUrl || "",
      ANTHROPIC_AUTH_TOKEN: config.apiKey || "",
      ANTHROPIC_MODEL: config.model || "",
      ...(config.thinkingLevel === "disabled"
        ? { ANTHROPIC_THINKING_BUDGET: "" }
        : config.thinkingLevel === "low"
          ? { ANTHROPIC_THINKING_BUDGET: "2048" }
          : config.thinkingLevel === "adaptive"
            ? { ANTHROPIC_THINKING_BUDGET: "32000" }
            : {}),
    },
    ...(options?.skipWebFetchPreflight ? { skipWebFetchPreflight: true } : {}),
  };

  return JSON.stringify(customSettings);
}
