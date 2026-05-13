import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import type { InsightData, InsightTaskItem } from "@/lib/ai/subagents/insights";
import type {
  GeneratedInsightPayload,
  OverlayContext,
} from "@/lib/insights/types";
import { coerceDate } from "@openloomi/shared";
import type { BotWithAccount } from "../db/queries";
import { normalizeTimestamp } from "@/lib/utils";

type TaskBucketKey = "myTasks" | "waitingForMe" | "waitingForOthers";
type TaskStatus = "pending" | "completed" | "blocked" | "delegated";
const TASK_STATUS_VALUES: TaskStatus[] = [
  "pending",
  "completed",
  "blocked",
  "delegated",
];

/**
 * Generate a deterministic UUID v5 based on a namespace and name
 * This creates a stable UUID that will always be the same for the same input
 *
 * @param namespace - A UUID to use as the namespace (e.g., botId)
 * @param name - The name to generate UUID from (e.g., dedupeKey)
 * @returns A deterministic UUID string
 */
function generateDeterministicUUID(namespace: string, name: string): string {
  // Convert namespace UUID to bytes
  const namespaceBytes = namespace.replace(/-/g, "");
  const namespaceBuffer = Buffer.from(namespaceBytes, "hex");

  // Create a SHA-1 hash of namespace + name (UUID v5 uses SHA-1)
  const hash = createHash("sha1")
    .update(Buffer.concat([namespaceBuffer, Buffer.from(name, "utf8")]))
    .digest();

  // Set version to 5 (UUIDv5) and variant bits
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // variant

  // Convert to UUID string format
  const hex = hash.toString("hex").substring(0, 32);
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-");
}

/**
 * Generate a deterministic insight ID based on botId and dedupeKey
 * This ensures the same group/chat always gets the same insight ID
 *
 * @param botId - The bot ID (namespace)
 * @param dedupeKey - The dedupeKey (name)
 * @returns A deterministic UUID string
 */
export function generateInsightId(botId: string, dedupeKey: string): string {
  return generateDeterministicUUID(botId, dedupeKey);
}

/**
 * Generate a stable dedupeKey based on botId + platform + group
 * This ensures ONE insight ID per group/chat (deterministic)
 *
 * Uses fixed platform from bot.adapter and fixed group name from original message (chatName)
 * to ensure consistency regardless of AI output variations
 *
 * @param item - The insight data from AI
 * @param bot - The bot with adapter info
 * @param fixedGroupName - The original group name from message source (not AI generated)
 * @returns A stable dedupeKey string, or null if cannot be generated
 */
function generateStableDedupeKey(
  item: InsightData,
  bot?: BotWithAccount,
  fixedGroupName?: string, // Fixed group name extracted from original message (chatName)
): string | null {
  const botId = bot?.id;
  const platform = bot?.adapter ?? item.platform ?? "";

  // Only apply to chat platforms with botId
  const isChatPlatform = [
    "slack",
    "discord",
    "telegram",
    "whatsapp",
    "facebook_messenger",
    "teams",
    "linkedin",
    "instagram",
    "twitter",
    "imessage",
  ].includes(platform);

  if (!botId || !isChatPlatform) {
    return null;
  }

  // Prioritize using the passed fixedGroupName (extracted from original message's chatName)
  // This is the true source, doesn't depend on AI-generated content
  if (!fixedGroupName) {
    return null;
  }

  // Create a hash based on botId + fixed platform + fixed group name
  const hashInput = `${botId}:${platform}:${fixedGroupName}`;
  const hash = createHash("sha256")
    .update(hashInput)
    .digest("base64")
    .slice(0, 16);

  return `${platform}_dedupe:${hash}`;
}

function sanitizeText(input?: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // Filter out anonymous users and unknown users
  if (trimmed.startsWith("anonymous user") || trimmed.startsWith("unknown")) {
    return null;
  }
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Deduplicate details based on content, person, time, platform, and channel
 * Uses a composite key to identify truly duplicate messages
 */
function deduplicateDetails(
  details: InsightData["details"],
): InsightData["details"] {
  if (!Array.isArray(details) || details.length === 0) {
    return details;
  }

  const seen = new Map<string, NonNullable<InsightData["details"]>[number]>();

  for (const detail of details) {
    // Create a composite key for deduplication
    // Priority: content (most unique) > person+time > platform+channel+time
    const contentKey = detail.content?.trim() || "";
    const personKey = detail.person || "";
    const timeKey = detail.time || 0;
    const platformKey = detail.platform || "";
    const channelKey = detail.channel || "";

    // Generate a unique key for this detail
    // If content is provided and substantial (>20 chars), use it as primary key
    // Otherwise use person+time as fallback
    let dedupeKey: string;
    if (contentKey.length > 20) {
      // Use first 100 chars of content + person + time as unique key
      const contentHash = contentKey.substring(0, 100);
      dedupeKey = `${platformKey}:${channelKey}:${personKey}:${contentHash}`;
    } else {
      // For short/empty content, use person + time + platform + channel
      dedupeKey = `${platformKey}:${channelKey}:${personKey}:${timeKey}`;
    }

    // Only keep the first occurrence of each unique detail
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, detail);
    }
  }

  return Array.from(seen.values());
}

function normalizeDateValue(input?: unknown): string | null {
  if (!input) return null;
  const date = coerceDate(input);
  if (Number.isNaN(date.getTime())) return null;

  // Check if date is in the past (allow 1 day tolerance for timezone issues)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (date < oneDayAgo) {
    console.warn(
      `[Insights] Ignoring past deadline: ${date.toISOString()}, current: ${now.toISOString()}`,
    );
    return null;
  }

  return date.toISOString();
}

function normalizeStringArray(values?: unknown): string[] | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sanitized = values
    .map((entry) => sanitizeText(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (!sanitized.length) return null;
  return Array.from(new Set(sanitized));
}

function ensureTaskDefaults(
  task: InsightTaskItem | null | undefined,
  bucket: TaskBucketKey,
): InsightTaskItem | null {
  if (!task || typeof task !== "object") {
    return null;
  }

  const title = sanitizeText(task.title);
  const context = sanitizeText(task.context);
  if (!title && !context) {
    return null;
  }

  const normalizedStatus =
    typeof task.status === "string" &&
    TASK_STATUS_VALUES.includes(task.status as TaskStatus)
      ? (task.status as TaskStatus)
      : "pending";

  const normalized: InsightTaskItem = {
    ...task,
    id: task.id ?? randomUUID(),
    title,
    context,
    owner: sanitizeText(task.owner),
    ownerType: task.ownerType ?? (bucket === "myTasks" ? "me" : task.ownerType),
    requester: sanitizeText(task.requester),
    requesterId: sanitizeText(task.requesterId),
    responder: sanitizeText(task.responder) ?? sanitizeText(task.owner) ?? null,
    responderId: sanitizeText(task.responderId),
    deadline: normalizeDateValue(task.deadline),
    rawDeadline: task.rawDeadline ?? null,
    followUpAt: normalizeDateValue(task.followUpAt),
    followUpNote: sanitizeText(task.followUpNote),
    lastFollowUpAt: normalizeDateValue(task.lastFollowUpAt),
    acknowledgedAt: normalizeDateValue(task.acknowledgedAt),
    priority: task.priority ?? null,
    status: normalizedStatus,
    confidence:
      typeof task.confidence === "number" && Number.isFinite(task.confidence)
        ? Math.min(Math.max(task.confidence, 0), 1)
        : null,
    labels: normalizeStringArray(task.labels),
    sourceDetailIds: normalizeStringArray(task.sourceDetailIds),
    watchers: normalizeStringArray(task.watchers),
  };

  return normalized;
}

function normalizeTaskCollection(
  tasks: InsightTaskItem[] | null | undefined,
  bucket: TaskBucketKey,
): InsightTaskItem[] | null {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return null;
  }
  const dedup = new Map<string, InsightTaskItem>();
  for (const raw of tasks) {
    const normalized = ensureTaskDefaults(raw, bucket);
    if (!normalized?.id) continue;
    dedup.set(normalized.id, normalized);
  }
  return dedup.size > 0 ? Array.from(dedup.values()) : null;
}

// Default categories list (used when user hasn't configured custom categories)
const DEFAULT_CATEGORIES = [
  "News",
  "Meetings",
  "Funding",
  "R&D",
  "Partnerships",
  "User Growth",
  "Branding",
  "Marketing",
  "HR & Recruiting",
  "HR",
  "Recruiting",
];

/**
 * Filter categories: only keep valid categories (in the valid list)
 * @param cats - AI-returned categories list
 * @param validCategories - Valid categories list (user custom + default)
 */
function filterValidCategories(
  cats: string[],
  validCategories: string[],
): string[] {
  const validSet = new Set(validCategories.map((c) => c.toLowerCase()));
  return cats.filter((cat) => validSet.has(cat.toLowerCase()));
}

export function generateInsightPayload(
  item: InsightData,
  bot?: BotWithAccount,
  fixedGroupName?: string, // Fixed group name extracted from original message, doesn't depend on AI generation
  validCategories?: string[], // Valid categories list (user custom + default), for filtering AI-returned categories
): GeneratedInsightPayload {
  const detailList = Array.isArray(item.details) ? item.details : null;
  const timelineList = Array.isArray(item.timeline) ? item.timeline : null;
  const normalizedSources =
    Array.isArray(item.sources) && item.sources.length > 0
      ? item.sources.map((source) => ({
          platform: source.platform ?? null,
          snippet: source.snippet,
          link: source.link ?? null,
        }))
      : null;
  // Filter categories: remove empty strings and strings containing only whitespace
  const filterCategories = (cats: string[]): string[] => {
    const filtered = cats
      .filter((cat): cat is string => typeof cat === "string")
      .map((cat) => cat.trim())
      .filter((cat) => cat.length > 0);

    // Use provided validCategories, or use DEFAULT_CATEGORIES if not provided
    const effectiveValidCategories =
      validCategories && validCategories.length > 0
        ? validCategories
        : DEFAULT_CATEGORIES;

    return filterValidCategories(filtered, effectiveValidCategories);
  };

  const categories =
    Array.isArray(item.categories) && item.categories.length > 0
      ? filterCategories(item.categories)
      : Array.isArray(item.category) && item.category.length > 0
        ? filterCategories(item.category)
        : typeof item.category === "string" && item.category.trim().length > 0
          ? [item.category.trim()]
          : [];

  // Deduplicate details before sorting and using
  const deduplicatedDetailList = deduplicateDetails(detailList);

  if (deduplicatedDetailList) {
    deduplicatedDetailList.sort((a, b) => {
      // Normalize timestamps before sorting (handle mixed second/millisecond level issues)
      const aTime = normalizeTimestamp(a.time);
      const bTime = normalizeTimestamp(b.time);
      return aTime - bTime;
    });
  }
  if (timelineList) {
    timelineList.sort((a, b) => {
      // Normalize timestamps before sorting (handle mixed second/millisecond level issues)
      const aTime = normalizeTimestamp(a.time);
      const bTime = normalizeTimestamp(b.time);
      return aTime - bTime;
    });
  }
  const latestDetail =
    deduplicatedDetailList && deduplicatedDetailList.length > 0
      ? deduplicatedDetailList[deduplicatedDetailList.length - 1]
      : null;
  const computedTime = item.time
    ? coerceDate(item.time)
    : latestDetail?.time
      ? coerceDate(latestDetail.time)
      : new Date();
  const historySummary =
    item.historyInsight !== undefined ? (item.historyInsight ?? null) : null;
  const normalizedMyTasks = normalizeTaskCollection(item.myTasks, "myTasks");
  const normalizedWaitingForMe = normalizeTaskCollection(
    item.waitingForMe,
    "waitingForMe",
  );

  // Extract user identity from bot metadata for filtering tasks
  // Only keep tasks where the owner/responder matches the actual user identity
  const userIdentityPatterns: string[] = [];
  if (bot?.platformAccount?.metadata) {
    const metadata = bot.platformAccount.metadata as Record<string, unknown>;
    // Collect various user identity fields from metadata
    const identityFields = [
      "username",
      "firstName",
      "lastName",
      "displayName",
      "email",
      "name",
    ];
    for (const field of identityFields) {
      const value = metadata[field];
      if (typeof value === "string" && value.trim().length > 0) {
        userIdentityPatterns.push(value.trim().toLowerCase());
        // Also add email local part (before @) for matching
        if (field === "email" && value.includes("@")) {
          const localPart = value.split("@")[0];
          userIdentityPatterns.push(localPart.toLowerCase());
        }
      }
    }
  }

  // Helper function to check if a name matches user identity
  // Uses exact matching for username (starts with @), and includes for other fields
  const isUserIdentity = (name: string | null | undefined): boolean => {
    if (!name || userIdentityPatterns.length === 0) {
      return false;
    }
    const nameLower = name.toLowerCase().trim();

    // Check if name exactly matches a username (starts with @)
    if (nameLower.startsWith("@")) {
      return userIdentityPatterns.some(
        (pattern) =>
          pattern.startsWith("@") &&
          nameLower === `@${pattern.replace("@", "")}`,
      );
    }

    // For other names, use exact match or word boundary match to avoid false positives
    // e.g., "T" should not match "Tom", "Team", etc.
    return userIdentityPatterns.some((pattern) => {
      if (pattern === nameLower) return true; // Exact match
      // Check if pattern is a word boundary match (e.g., "john" matches "john doe" but not "johnson")
      const patternWords = pattern.split(/\s+/);
      const nameWords = nameLower.split(/\s+/);
      return patternWords.some((pw) => nameWords.some((nw) => nw === pw));
    });
  };

  // HARD FILTER: Check if user actually participated in the conversation
  // User participation is defined as:
  // 1. User sent at least one message in the conversation (person matches user identity)
  // 2. OR user was explicitly @mentioned in any message content
  const didUserParticipate = (): boolean => {
    if (!deduplicatedDetailList || userIdentityPatterns.length === 0) {
      return false;
    }

    // Check if user sent any messages
    const userSentMessages = deduplicatedDetailList.some((detail) => {
      if (!detail.person) return false;
      return isUserIdentity(detail.person);
    });

    if (userSentMessages) return true;

    // Check if user was @mentioned in any message content
    const userWasMentioned = deduplicatedDetailList.some((detail) => {
      const content = detail.originalContent;
      if (!content) return false;

      const contentLower = content.toLowerCase();

      // Check for @username mentions
      return userIdentityPatterns.some((pattern) => {
        // For username, look for @username in content
        if (pattern.startsWith("@")) {
          return contentLower.includes(pattern.toLowerCase());
        }
        // For other identity fields, look for @pattern or pattern as a whole word
        const mentionPattern1 = `@${pattern}`.toLowerCase();
        const mentionPattern2 = `@${pattern.replace(/\s+/g, "")}`.toLowerCase();
        return (
          contentLower.includes(mentionPattern1) ||
          contentLower.includes(mentionPattern2)
        );
      });
    });

    return userWasMentioned;
  };

  const userParticipated = didUserParticipate();

  // HARD FILTER: If user didn't participate and wasn't mentioned, remove ALL myTasks
  // This prevents AI from hallucinating task assignments to the user
  if (!userParticipated && normalizedMyTasks && normalizedMyTasks.length > 0) {
    console.log(
      `[Insights] Hard filter: User did not participate in conversation, removing ${normalizedMyTasks.length} myTasks from insight "${item.title}"`,
    );
  }

  // Filter myTasks: only keep tasks owned by the user themselves
  const myTasksAfterFilter =
    userIdentityPatterns.length > 0 && normalizedMyTasks
      ? normalizedMyTasks.filter((task) => {
          // HARD FILTER: If user didn't participate, no tasks should be assigned to them
          if (!userParticipated) {
            return false;
          }
          if (!task.owner || task.ownerType === "others") {
            return false; // Filter out tasks not owned by user
          }
          return isUserIdentity(task.owner);
        })
      : (normalizedMyTasks ?? []);

  // Filter waitingForOthers: remove tasks assigned to the user themselves
  // (should only track OTHER people's commitments, not my own tasks)
  const normalizedWaitingForOthers = normalizeTaskCollection(
    item.waitingForOthers,
    "waitingForOthers",
  );
  const waitingForOthersAfterFilter =
    userIdentityPatterns.length > 0 && normalizedWaitingForOthers
      ? normalizedWaitingForOthers.filter((task) => {
          // Remove if owner/responder is the user themselves
          if (isUserIdentity(task.owner) || isUserIdentity(task.responder)) {
            return false;
          }
          return true;
        })
      : (normalizedWaitingForOthers ?? []);
  const normalizedNextActions: GeneratedInsightPayload["nextActions"] =
    Array.isArray(item.nextActions) && item.nextActions.length > 0
      ? item.nextActions
          .map((entry) => {
            // Remove isBuiltinAction restriction, allow all types of action
            // Keep as long as action field exists and is non-empty string
            if (
              entry &&
              typeof entry.action === "string" &&
              entry.action.trim().length > 0
            ) {
              return {
                ...entry,
                action: entry.action.trim(),
              };
            }
            return null;
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : null;

  const baseInsight: GeneratedInsightPayload = {
    // Use stable dedupeKey generation for chat platforms to prevent duplicates
    // Pass bot and fixedGroupName to use fixed platform (bot.adapter) and original group name
    dedupeKey: generateStableDedupeKey(item, bot, fixedGroupName),
    taskLabel: item.taskLabel ?? "",
    title: item.title ?? "Untitled insight",
    description: item.description ?? "",
    importance: item.importance ?? "general",
    urgency: item.urgency ?? "not_urgent",
    platform: item.platform ?? null,
    account: item.account ?? null,
    groups: Array.isArray(item.groups) ? item.groups : [],
    people: Array.isArray(item.people) ? item.people : [],
    time: computedTime,
    details: deduplicatedDetailList,
    timeline: timelineList,
    insights:
      Array.isArray(item.insights) && item.insights.length > 0
        ? item.insights.map((entry) => ({
            category: entry.type,
            value: entry.content,
            confidence: 0,
          }))
        : null,
    trendDirection: item.trendDirection ?? null,
    trendConfidence:
      typeof item.trendConfidence === "number" ? item.trendConfidence : null,
    sentiment: item.sentiment ?? null,
    sentimentConfidence:
      item.sentimentConfidence !== undefined
        ? (item.sentimentConfidence ?? null)
        : null,
    intent: item.intent ?? null,
    trend: item.trend ?? null,
    issueStatus: item.issueStatus ?? null,
    communityTrend: item.communityTrend ?? null,
    duplicateFlag:
      "duplicateFlag" in item ? (item.duplicateFlag ?? null) : null,
    impactLevel: item.impactLevel ?? null,
    resolutionHint: item.resolutionHint ?? null,
    topKeywords: Array.isArray(item.topKeywords) ? item.topKeywords : [],
    topEntities: Array.isArray(item.topEntities) ? item.topEntities : [],
    topVoices:
      Array.isArray(item.topVoices) && item.topVoices.length > 0
        ? item.topVoices
        : null,
    sources: normalizedSources,
    sourceConcentration: item.sourceConcentration ?? null,
    buyerSignals: Array.isArray(item.buyerSignals) ? item.buyerSignals : [],
    stakeholders:
      Array.isArray(item.stakeholders) && item.stakeholders.length > 0
        ? item.stakeholders
        : null,
    contractStatus: item.contractStatus ?? null,
    signalType: item.signalType ?? null,
    confidence:
      item.confidence !== undefined ? (item.confidence ?? null) : null,
    scope: item.scope ?? null,
    followUps:
      Array.isArray(item.followUps) && item.followUps.length > 0
        ? item.followUps
        : null,
    nextActions: normalizedNextActions,
    actionRequired:
      "actionRequired" in item ? (item.actionRequired ?? null) : null,
    actionRequiredDetails:
      item.actionRequiredDetails !== undefined
        ? (item.actionRequiredDetails ?? null)
        : null,
    myTasks: myTasksAfterFilter,
    waitingForMe: normalizedWaitingForMe,
    waitingForOthers: waitingForOthersAfterFilter,
    clarifyNeeded:
      "clarifyNeeded" in item ? (item.clarifyNeeded ?? null) : null,
    categories,
    learning: item.learning ?? null,
    experimentIdeas:
      Array.isArray(item.experimentIdeas) && item.experimentIdeas.length > 0
        ? item.experimentIdeas
        : null,
    executiveSummary: item.executiveInsight ?? null,
    riskFlags:
      Array.isArray(item.riskFlags) && item.riskFlags.length > 0
        ? item.riskFlags
        : null,
    strategic: item.strategic ?? null,
    client: item.client ?? null,
    projectName: item.projectName ?? null,
    nextMilestone: item.nextMilestone ?? null,
    dueDate: item.dueDate ?? null,
    paymentInfo: item.paymentInfo ?? null,
    entity: item.entity ?? null,
    why: item.why ?? null,
    historySummary,
    roleAttribution: item.roleAttribution ?? null,
    alerts:
      Array.isArray(item.alerts) && item.alerts.length > 0 ? item.alerts : null,
  };

  return baseInsight;
}

export type { GeneratedInsightPayload, OverlayContext };
