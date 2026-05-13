/**
 * Utility functions barrel export
 */

// Re-export shared utilities from @openloomi/shared
export {
  cn,
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
  sanitizeText,
  getTextFromMessage,
  getCurrentTimestamp,
  normalizeTimestamp,
  formatToLocalTime,
  getCurrentYearMonth,
  formatBytes,
  coerceDate,
  timeBeforeHours,
  timeBeforeHoursMs,
  timeBeforeMinutes,
  delay,
  filterToolCallText,
  buildNavigationUrl,
  type BuildNavigationUrlOptions,
} from "@openloomi/shared";

// Re-export from integration-error-detector
export {
  INTEGRATION_TOOL_NAMES,
  QUERY_INTEGRATION_TOOL_NAMES,
  isIntegrationTool,
  isQueryIntegrationTool,
  hasNoBotsInResponse,
} from "./integration-error-detector";

// Re-export from file-icons
export {
  IMAGE_FILE_EXTENSIONS,
  isImageFile,
  type FileIconType,
  getFileIcon,
  getFileIconName,
  getFileColor,
  getFileTypeLabel,
} from "@/components/file-icons";

// Re-export from tool-names
export {
  stripMalformedToolCalls,
  containsMalformedToolCall,
  extractMalformedToolCalls,
  getToolDisplayName,
  getToolRunningText,
} from "./tool-names";

// App-specific utilities (formerly in utils.ts)
export {
  fetcher,
  fetcherWithCloudAuth,
  getHomePath,
  fetchWithAuth,
  fetchWithErrorHandlers,
  getLocalStorage,
  convertToUIMessages,
  createPageUrl,
  judgeGuest,
} from "./fetcher";
