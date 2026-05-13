import type { TFunction } from "i18next";

// Re-export from @openloomi/shared for backward compatibility
export {
  stripMalformedToolCalls,
  containsMalformedToolCall,
  extractMalformedToolCalls,
} from "@openloomi/shared";

/**
 * Get the display name for a tool, translating MCP tool names
 * @param name - The tool name (e.g., "mcp__business-tools__chatInsight" or "Read")
 * @param t - The i18n translation function
 * @returns The translated display name for the tool
 */
export function getToolDisplayName(
  name: string | undefined | null,
  t: TFunction,
): string {
  // Handle undefined or null name
  if (!name) {
    return t("common.toolNames.unknown") || "Unknown Tool";
  }
  // Extract tool name without prefix (e.g., "mcp__business-tools__chatInsight" -> "chatInsight")
  const toolNameWithoutPrefix = name.includes("__")
    ? name.split("__").pop() || name
    : name;

  switch (toolNameWithoutPrefix) {
    case "Read":
      return t("common.toolNames.Read");
    case "Write":
      return t("common.toolNames.Write");
    case "Edit":
      return t("common.toolNames.Edit");
    case "Bash":
      return t("common.toolNames.Bash");
    case "WebSearch":
      return t("common.toolNames.WebSearch");
    case "WebFetch":
      return t("common.toolNames.WebFetch");
    case "Glob":
      return t("common.toolNames.Glob");
    case "Grep":
      return t("common.toolNames.Grep");
    case "TodoWrite":
      return t("common.toolNames.TodoWrite");
    case "Skill":
      return t("common.toolNames.Skill");
    case "LSP":
      return t("common.toolNames.LSP");
    case "Task":
      return t("common.toolNames.Task");
    case "chatInsight":
      return t("common.toolNames.chatInsight");
    case "queryContacts":
      return t("common.toolNames.queryContacts");
    case "queryIntegrations":
      return t("common.toolNames.queryIntegrations");
    case "sendReply":
      return t("common.toolNames.sendReply");
    case "createInsight":
      return t("common.toolNames.createInsight");
    case "modifyInsight":
      return t("common.toolNames.modifyInsight");
    case "searchKnowledgeBase":
      return t("common.toolNames.searchKnowledgeBase");
    case "getFullDocumentContent":
      return t("common.toolNames.getFullDocumentContent");
    case "listKnowledgeBaseDocuments":
      return t("common.toolNames.listKnowledgeBaseDocuments");
    case "searchMemoryPath":
      return t("common.toolNames.searchMemoryPath");
    case "getRawMessages":
      return t("common.toolNames.getRawMessages");
    case "searchRawMessages":
      return t("common.toolNames.searchRawMessages");
    case "createScheduledJob":
      return t("common.toolNames.createScheduledJob");
    case "listScheduledJobs":
      return t("common.toolNames.listScheduledJobs");
    case "deleteScheduledJob":
      return t("common.toolNames.deleteScheduledJob");
    case "toggleScheduledJob":
      return t("common.toolNames.toggleScheduledJob");
    case "executeScheduledJob":
      return t("common.toolNames.executeScheduledJob");
    default:
      return toolNameWithoutPrefix;
  }
}

/**
 * Get the running status text for a tool
 * @param name - The tool name
 * @param t - The i18n translation function
 * @returns The translated running status text
 */
export function getToolRunningText(
  name: string | undefined | null,
  t: TFunction,
): string {
  // Handle undefined or null name
  if (!name) {
    return (
      t("common.runningIndicator.runningUnknown") || "Running unknown tool..."
    );
  }
  // Extract tool name without prefix
  const toolNameWithoutPrefix = name.includes("__")
    ? name.split("__").pop() || name
    : name;

  switch (toolNameWithoutPrefix) {
    case "Bash":
      return t("common.runningIndicator.runningBash");
    case "Read":
      return t("common.runningIndicator.runningRead");
    case "Write":
      return t("common.runningIndicator.runningWrite");
    case "Edit":
      return t("common.runningIndicator.runningEdit");
    case "WebSearch":
      return t("common.runningIndicator.runningWebSearch");
    case "WebFetch":
      return t("common.runningIndicator.runningWebFetch");
    case "Glob":
      return t("common.runningIndicator.runningGlob");
    case "Grep":
      return t("common.runningIndicator.runningGrep");
    case "chatInsight":
      return t("common.runningIndicator.runningChatInsight");
    case "queryContacts":
      return t("common.runningIndicator.runningQueryContacts");
    case "queryIntegrations":
      return t("common.runningIndicator.runningQueryIntegrations");
    case "sendReply":
      return t("common.runningIndicator.runningSendReply");
    case "createInsight":
      return t("common.runningIndicator.runningCreateInsight");
    case "modifyInsight":
      return t("common.runningIndicator.runningModifyInsight");
    case "searchKnowledgeBase":
      return t("common.runningIndicator.runningSearchKnowledgeBase");
    case "getFullDocumentContent":
      return t("common.runningIndicator.runningGetFullDocumentContent");
    case "listKnowledgeBaseDocuments":
      return t("common.runningIndicator.runningListKnowledgeBaseDocuments");
    case "searchMemoryPath":
      return t("common.runningIndicator.runningSearchMemoryPath");
    case "getRawMessages":
      return t("common.runningIndicator.runningGetRawMessages");
    case "searchRawMessages":
      return t("common.runningIndicator.runningSearchRawMessages");
    case "createScheduledJob":
      return t("common.runningIndicator.running", {
        tool: t("common.toolNames.createScheduledJob"),
      });
    case "listScheduledJobs":
      return t("common.runningIndicator.running", {
        tool: t("common.toolNames.listScheduledJobs"),
      });
    case "deleteScheduledJob":
      return t("common.runningIndicator.running", {
        tool: t("common.toolNames.deleteScheduledJob"),
      });
    case "toggleScheduledJob":
      return t("common.runningIndicator.running", {
        tool: t("common.toolNames.toggleScheduledJob"),
      });
    case "executeScheduledJob":
      return t("common.runningIndicator.running", {
        tool: t("common.toolNames.executeScheduledJob"),
      });
    default: {
      // Fallback: use generic message with tool name
      const toolName = getToolDisplayName(name, t);
      return t("common.runningIndicator.running", { tool: toolName });
    }
  }
}
