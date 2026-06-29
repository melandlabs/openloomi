import type { SettingsPane } from "@/lib/permissions/registry";

const PERMISSION_ERROR_PATTERNS = [
  /Operation not permitted/i,
  /Permission denied/i,
  /access\s+denied/i,
  /sandbox\s+violation/i,
];

const HOST_PERMISSION_TOOL_NAMES = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "NotebookRead",
  "NotebookEdit",
]);

type PermissionHint =
  | {
      actionType: "macos-settings";
      actionTarget: SettingsPane;
      nameKey: string;
    }
  | { actionType: "request-folder"; actionTarget: string; nameKey: string };

function normalizeToolName(toolName: unknown): string | null {
  if (typeof toolName !== "string") return null;
  return toolName.startsWith("functions.")
    ? toolName.slice("functions.".length)
    : toolName;
}

function getToolLeafName(toolName: string): string {
  return toolName.includes("__")
    ? toolName.split("__").pop() || toolName
    : toolName;
}

function getMcpServerName(toolName: string): string | null {
  const parts = toolName.split("__");
  return parts[0] === "mcp" && parts.length >= 3 ? parts[1] : null;
}

export function canShowSystemPermissionHintForTool(toolName: unknown): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (!normalizedToolName) return false;

  const mcpServerName = getMcpServerName(normalizedToolName);
  if (mcpServerName === "bash") return true;
  if (mcpServerName) return false;

  return HOST_PERMISSION_TOOL_NAMES.has(getToolLeafName(normalizedToolName));
}

export function detectSystemPermissionHint(
  toolName: unknown,
  toolOutput: unknown,
  toolInput: unknown,
): PermissionHint | null {
  if (!canShowSystemPermissionHintForTool(toolName)) return null;
  if (!toolOutput || typeof toolOutput !== "string") return null;
  const isPermError = PERMISSION_ERROR_PATTERNS.some((p) => p.test(toolOutput));
  if (!isPermError) return null;

  // Prefer toolInput paths (more reliable) over toolOutput text.
  const inputText = toolInput ? JSON.stringify(toolInput) : "";
  const sources = [inputText, toolOutput];

  for (const text of sources) {
    if (/\/Downloads\b/i.test(text))
      return {
        actionType: "request-folder",
        actionTarget: "Downloads",
        nameKey: "permissions.downloads.name",
      };
    if (/\/Documents\b/i.test(text))
      return {
        actionType: "request-folder",
        actionTarget: "Documents",
        nameKey: "permissions.documents.name",
      };
    if (/\/Desktop\b/i.test(text))
      return {
        actionType: "request-folder",
        actionTarget: "Desktop",
        nameKey: "permissions.desktop.name",
      };
    if (/screencapture|screenshot/i.test(text))
      return {
        actionType: "macos-settings",
        actionTarget: "Privacy_ScreenCapture",
        nameKey: "permissions.screenRecording.name",
      };
    if (/Library\/Mail|Library\/Messages/i.test(text))
      return {
        actionType: "macos-settings",
        actionTarget: "Privacy_AllFiles",
        nameKey: "permissions.fullDiskAccess.name",
      };
  }

  return {
    actionType: "macos-settings",
    actionTarget: "Privacy_FilesAndFolders",
    nameKey: "permissions.title",
  };
}
