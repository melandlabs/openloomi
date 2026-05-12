// Re-export all originally exported items from insights.ts
export { refreshActiveBotInsight } from "./refresh";
export { runInsightEmbeddingDream } from "./dream";
export { getInsightsByBotId, dealMessageChunk } from "./processor";
export { userInsightSettingsToPrompt } from "./settings";
export type {
  SummaryUserContext,
  RefreshOptions,
  RefreshResult,
  InsightInput,
  ExtractedMessageInfoWithoutAttachments,
  ExtractEmailInfoWithoutAttachments,
  GroupInsightResult,
  ChunkCapableAdapter,
  DisconnectableAdapter,
  DetailData,
  InsightData,
  TimelineData,
  BotWithAccount,
  Platform,
} from "./bot-types";
export {
  DEBUG,
  EMAIL_TASK_LABEL,
  MAX_EMAIL_INSIGHTS,
  CALENDAR_TASK_LABEL,
  CALENDAR_UPCOMING_WINDOW_MS,
  DEFAULT_GROUP_CONCURRENCY,
  MAX_GROUP_CONCURRENCY,
  MIN_GROUP_CONCURRENCY,
  DEFAULT_CATEGORIES,
} from "./constants";
export {
  normalizeMessagesInput,
  groupMessagesByChannel,
  filterInsightsByGroup,
  mergeIMessageMessagesBySender,
  estimateTokensForMessages,
} from "./grouping";
export {
  generateEventId,
  hashString,
  detectEventChange,
  getInsightCacheKey,
  coerceTimeMs,
  mergeTimelines,
  deduplicateInsightsByGroup,
} from "./timeline";
export {
  buildEmailInsightPayload,
  groupEmailsBySender,
  extractHistoricalEmailsBySender,
  truncateSubject,
  buildMergedEmailDescription,
  buildMergedEmailInsightPayload,
  collectEmailParticipants,
  buildEmailDetailContent,
  formatEmailAddresses,
} from "./email";
export {
  buildHubspotInsightPayload,
  normalizeHubId,
  buildGoogleDocInsight,
  buildOutlookCalendarInsight,
} from "./calendar";
