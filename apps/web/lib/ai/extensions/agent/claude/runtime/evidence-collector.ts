import { createHash } from "node:crypto";

import type { GoalEvidenceType } from "@openloomi/ai/agent/runtime-instructions";
import type { RuntimeEvidenceDraft } from "@/lib/ai/runtime-instructions/runtime-observation";

const MAX_SOURCE_EVENT_ID_CHARACTERS = 256;
const MAX_NAME_CHARACTERS = 256;
const MAX_SUMMARY_CHARACTERS = 1_000;
const MAX_COMMAND_CHARACTERS = 4_000;
const MAX_DETAIL_CHARACTERS = 8_000;
const MAX_PATH_CHARACTERS = 512;
const MAX_PATHS = 16;
const MAX_JSON_DEPTH = 4;
const MAX_JSON_ENTRIES = 32;
const MAX_JSON_CHARACTERS = 8_000;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|credential|password|private[_-]?key|secret|token|api[_-]?key)/i;

const FILE_CHANGE_TOOLS = new Set([
  "edit",
  "multiedit",
  "notebookedit",
  "write",
]);

const COMMAND_TOOLS = new Set([
  "bash",
  "command",
  "powershell",
  "shell",
  "sandbox_run_command",
  "sandbox_run_script",
]);

const TEST_COMMAND_PATTERNS = [
  /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?=$|\s|:)/i,
  /(?:^|\s)(?:(?:npx|bunx|pnpm\s+exec|yarn\s+exec)\s+)?(?:ava|cypress|jest|mocha|playwright|pytest|vitest)(?=$|\s)/i,
  /(?:^|\s)python(?:3)?\s+-m\s+pytest(?=$|\s)/i,
  /(?:^|\s)(?:cargo|dotnet|go|mix|swift)\s+test(?=$|\s)/i,
  /(?:^|\s)(?:bundle\s+exec\s+)?rspec(?=$|\s)/i,
  /(?:^|\s)(?:\.\/[A-Za-z0-9._-]*gradlew|gradle|mvn|ctest)\s+test(?=$|\s)/i,
];

type RuntimeEvidenceJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeEvidenceJsonValue[]
  | { [key: string]: RuntimeEvidenceJsonValue };

interface ClaudeToolEvidenceInput {
  providerEventId: string;
  toolUseId: string;
  toolName: string;
  outcome: "succeeded" | "failed";
  toolInput: unknown;
  toolResponse?: unknown;
  error?: string;
  durationMs?: number;
  observedAt: string;
}

interface ExplicitToolOutcome {
  success: boolean;
  exitCode?: number;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 16))}\n...[truncated]`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(--(?:api[-_]?key|password|secret|token))(?:=|\s+)\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY))\s*=\s*([^\s;&|]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(authorization|cookie|credential|password|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;&|]+)/gi,
      "$1=[REDACTED]",
    );
}

function normalizedToolName(toolName: string): string {
  const segments = toolName.trim().toLowerCase().split("__");
  return segments.at(-1) ?? "";
}

function isCommandTool(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return (
    COMMAND_TOOLS.has(normalized) ||
    (/sandbox/.test(normalized) && /(?:command|script)$/.test(normalized))
  );
}

function isTestCommand(command: string | undefined): boolean {
  return command
    ? TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
    : false;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findRecordValue(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown {
  if (depth > 3) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;

  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  for (const nested of Object.values(record)) {
    const found = findRecordValue(nested, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractCommand(toolInput: unknown): string | undefined {
  if (typeof toolInput === "string") {
    const command = toolInput.trim();
    return command
      ? truncate(redactSensitiveText(command), MAX_COMMAND_CHARACTERS)
      : undefined;
  }
  const rawCommand = findRecordValue(toolInput, ["command", "cmd"]);
  return typeof rawCommand === "string" && rawCommand.trim()
    ? truncate(redactSensitiveText(rawCommand.trim()), MAX_COMMAND_CHARACTERS)
    : undefined;
}

function extractPaths(toolInput: unknown): string[] {
  const paths: string[] = [];
  const seen = new Set<unknown>();
  const pathKeys = new Set([
    "file",
    "file_path",
    "filePath",
    "notebook_path",
    "notebookPath",
    "path",
  ]);

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH || paths.length >= MAX_PATHS) return;
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_JSON_ENTRIES)) {
        visit(item, depth + 1);
      }
      return;
    }

    for (const [key, item] of Object.entries(value)) {
      if (pathKeys.has(key) && typeof item === "string" && item.trim()) {
        paths.push(truncate(item.trim(), MAX_PATH_CHARACTERS));
        if (paths.length >= MAX_PATHS) return;
      } else {
        visit(item, depth + 1);
      }
    }
  };

  visit(toolInput, 0);
  return [...new Set(paths)];
}

function readExitCode(toolResponse: unknown): number | undefined {
  const value = findRecordValue(toolResponse, ["exit_code", "exitCode"]);
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function explicitOutcome(
  outcome: "succeeded" | "failed",
  toolResponse: unknown,
): ExplicitToolOutcome {
  const exitCode = readExitCode(toolResponse);
  return {
    success: outcome === "succeeded",
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

function stableSourceEventId(
  providerEventId: string,
  toolUseId: string,
): string {
  const raw = `${providerEventId}:tool:${toolUseId}`;
  if (raw.length <= MAX_SOURCE_EVENT_ID_CHARACTERS) return raw;

  const digest = createHash("sha256").update(raw).digest("hex");
  const prefix = truncate(providerEventId, 170).replace(/\s+/g, "-");
  return `${prefix}:tool:${digest}`.slice(0, MAX_SOURCE_EVENT_ID_CHARACTERS);
}

function boundedJsonValue(
  value: unknown,
  remaining: { characters: number; nodes: number },
  seen: Set<unknown>,
  depth = 0,
): RuntimeEvidenceJsonValue {
  if (remaining.nodes <= 0 || remaining.characters <= 0) return "[truncated]";
  remaining.nodes -= 1;

  if (value === null) {
    remaining.characters -= 4;
    return value;
  }
  if (typeof value === "boolean") {
    remaining.characters -= value ? 4 : 5;
    return value;
  }
  if (typeof value === "number") {
    const bounded = Number.isFinite(value) ? value : null;
    remaining.characters -= String(bounded).length;
    return bounded;
  }
  if (typeof value === "string") {
    const available = Math.max(0, remaining.characters);
    const bounded = truncate(
      redactSensitiveText(value),
      Math.min(MAX_DETAIL_CHARACTERS, available),
    );
    remaining.characters -= bounded.length;
    return bounded;
  }
  if (typeof value === "bigint") {
    const bounded = truncate(value.toString(), 128);
    remaining.characters -= bounded.length;
    return bounded;
  }
  if (typeof value !== "object" || value === null) {
    const bounded = truncate(String(value), 128);
    remaining.characters -= bounded.length;
    return bounded;
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_JSON_DEPTH || remaining.characters <= 0) {
    return "[truncated]";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_JSON_ENTRIES)
      .map((item) => boundedJsonValue(item, remaining, seen, depth + 1));
    seen.delete(value);
    return result;
  }

  const result: { [key: string]: RuntimeEvidenceJsonValue } = {};
  for (const [rawKey, item] of Object.entries(value).slice(
    0,
    MAX_JSON_ENTRIES,
  )) {
    if (remaining.characters <= 0) break;
    const key = truncate(rawKey, 128);
    remaining.characters -= key.length;
    result[key] = SENSITIVE_KEY_PATTERN.test(rawKey)
      ? "[REDACTED]"
      : boundedJsonValue(item, remaining, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function boundedDetail(value: unknown): RuntimeEvidenceJsonValue {
  return boundedJsonValue(
    value,
    { characters: MAX_JSON_CHARACTERS, nodes: 256 },
    new Set<unknown>(),
  );
}

function responsePreview(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return truncate(redactSensitiveText(value), MAX_DETAIL_CHARACTERS);
  }
  try {
    return truncate(
      JSON.stringify(boundedDetail(value)),
      MAX_DETAIL_CHARACTERS,
    );
  } catch {
    return "[unserializable tool response]";
  }
}

function safeDuration(durationMs: number | undefined): number | undefined {
  return typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
    ? durationMs
    : undefined;
}

function summaryFor(
  type: GoalEvidenceType,
  toolName: string,
  success: boolean,
  command: string | undefined,
  paths: string[],
): string {
  const outcome = success ? "succeeded" : "failed";
  if (type === "test_result") {
    return truncate(
      `Test command ${outcome}${command ? `: ${command}` : ""}`,
      MAX_SUMMARY_CHARACTERS,
    );
  }
  if (type === "command_result") {
    return truncate(
      `Command ${outcome}${command ? `: ${command}` : ""}`,
      MAX_SUMMARY_CHARACTERS,
    );
  }
  if (type === "file_change") {
    return truncate(
      `File change ${outcome}${paths.length ? `: ${paths.join(", ")}` : ` via ${toolName}`}`,
      MAX_SUMMARY_CHARACTERS,
    );
  }
  return truncate(`Tool ${toolName} ${outcome}`, MAX_SUMMARY_CHARACTERS);
}

/** Extracts a bounded evidence draft from one completed Claude tool hook. */
export function collectClaudeToolEvidence({
  providerEventId,
  toolUseId,
  toolName,
  outcome: hookOutcome,
  toolInput,
  toolResponse,
  error,
  durationMs,
  observedAt,
}: ClaudeToolEvidenceInput): RuntimeEvidenceDraft {
  const normalizedName = normalizedToolName(toolName);
  const command = isCommandTool(toolName)
    ? extractCommand(toolInput)
    : undefined;
  const outcome = explicitOutcome(hookOutcome, toolResponse);
  const paths = extractPaths(toolInput);
  const type: GoalEvidenceType = isCommandTool(toolName)
    ? isTestCommand(command)
      ? "test_result"
      : "command_result"
    : FILE_CHANGE_TOOLS.has(normalizedName) && outcome.success
      ? "file_change"
      : "tool_result";

  const payload: { [key: string]: RuntimeEvidenceJsonValue } = {
    provider: "claude",
    toolName: truncate(toolName.trim() || "unknown", MAX_NAME_CHARACTERS),
    toolUseId: truncate(toolUseId, MAX_NAME_CHARACTERS),
  };
  const boundedDuration = safeDuration(durationMs);
  if (boundedDuration !== undefined) payload.durationMs = boundedDuration;
  if (command !== undefined) payload.command = command;
  if (outcome.exitCode !== undefined) payload.exitCode = outcome.exitCode;
  if (paths.length > 0) payload.paths = paths;
  if (error?.trim())
    payload.error = truncate(
      redactSensitiveText(error.trim()),
      MAX_DETAIL_CHARACTERS,
    );

  // File-writing inputs can contain entire files or patches. Store only paths
  // and execution metadata for those tools, including failed attempts. Tool
  // responses are omitted too because some providers echo the written body.
  if (FILE_CHANGE_TOOLS.has(normalizedName)) {
    payload.inputContentRetained = false;
  } else {
    const preview = responsePreview(toolResponse);
    if (preview !== undefined) payload.outputPreview = preview;
    if (!isCommandTool(toolName)) payload.input = boundedDetail(toolInput);
  }

  return {
    type,
    sourceEventId: stableSourceEventId(providerEventId, toolUseId),
    summary: summaryFor(type, toolName, outcome.success, command, paths),
    success: outcome.success,
    payload,
    observedAt,
  };
}
