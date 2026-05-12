import type { Insight } from "@/lib/db/schema";

export const INSIGHT_EMBEDDING_TEXT_VERSION = "insight-embedding-text-v1";

const DEFAULT_MAX_TEXT_LENGTH = 12_000;

export type InsightEmbeddingTextInput = Partial<
  Record<
    keyof Pick<
      Insight,
      | "taskLabel"
      | "title"
      | "description"
      | "importance"
      | "urgency"
      | "platform"
      | "account"
      | "groups"
      | "people"
      | "time"
      | "details"
      | "timeline"
      | "insights"
      | "trendDirection"
      | "sentiment"
      | "intent"
      | "trend"
      | "issueStatus"
      | "communityTrend"
      | "impactLevel"
      | "resolutionHint"
      | "topKeywords"
      | "topEntities"
      | "topVoices"
      | "sources"
      | "buyerSignals"
      | "stakeholders"
      | "contractStatus"
      | "signalType"
      | "scope"
      | "nextActions"
      | "followUps"
      | "myTasks"
      | "waitingForMe"
      | "waitingForOthers"
      | "categories"
      | "learning"
      | "experimentIdeas"
      | "executiveSummary"
      | "riskFlags"
      | "strategic"
      | "client"
      | "projectName"
      | "nextMilestone"
      | "dueDate"
      | "paymentInfo"
      | "entity"
      | "why"
      | "historySummary"
      | "roleAttribution"
      | "alerts"
    >,
    unknown
  >
>;

export interface BuildInsightEmbeddingTextOptions {
  maxLength?: number;
}

export interface InsightEmbeddingDocument {
  content: string;
  contentHash: string;
  textVersion: typeof INSIGHT_EMBEDDING_TEXT_VERSION;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPrimitive(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = compactWhitespace(value);
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function flattenValue(value: unknown, depth = 0): string[] {
  const primitive = formatPrimitive(value);
  if (primitive) {
    return [primitive];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenValue(item, depth));
  }

  if (!isPlainRecord(value) || depth > 3) {
    return [];
  }

  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      const flattened = flattenValue(value[key], depth + 1);
      if (flattened.length === 0) {
        return [];
      }
      return flattened.map((item) => `${key}: ${item}`);
    });
}

function appendSection(
  sections: string[],
  label: string,
  value: unknown,
): void {
  const flattened = flattenValue(value);
  if (flattened.length === 0) {
    return;
  }
  const uniqueItems = Array.from(new Set(flattened));
  sections.push(`${label}: ${uniqueItems.join("; ")}`);
}

function truncateAtBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const boundary = Math.max(
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("; "),
    truncated.lastIndexOf(" "),
  );

  if (boundary < Math.floor(maxLength * 0.75)) {
    return truncated.trim();
  }
  return truncated.slice(0, boundary).trim();
}

export function hashInsightEmbeddingContent(content: string): string {
  // FNV-1a 64-bit is enough for change detection and stays runtime-neutral.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < content.length; i += 1) {
    hash ^= BigInt(content.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }

  return `${INSIGHT_EMBEDDING_TEXT_VERSION}:${hash.toString(16).padStart(16, "0")}`;
}

export function buildInsightEmbeddingText(
  insight: InsightEmbeddingTextInput,
  options: BuildInsightEmbeddingTextOptions = {},
): string {
  const sections: string[] = [];

  appendSection(sections, "Title", insight.title);
  appendSection(sections, "Description", insight.description);
  appendSection(sections, "Task", insight.taskLabel);
  appendSection(sections, "Executive summary", insight.executiveSummary);
  appendSection(sections, "Learning", insight.learning);
  appendSection(sections, "Why it matters", insight.why);
  appendSection(sections, "Project", insight.projectName);
  appendSection(sections, "Client", insight.client);
  appendSection(sections, "Entity", insight.entity);
  appendSection(sections, "Next milestone", insight.nextMilestone);
  appendSection(sections, "Due date", insight.dueDate);
  appendSection(sections, "Payment", insight.paymentInfo);
  appendSection(sections, "Platform", insight.platform);
  appendSection(sections, "Account", insight.account);
  appendSection(sections, "Groups", insight.groups);
  appendSection(sections, "People", insight.people);
  appendSection(sections, "Time", insight.time);
  appendSection(sections, "Importance", insight.importance);
  appendSection(sections, "Urgency", insight.urgency);
  appendSection(sections, "Categories", insight.categories);
  appendSection(sections, "Keywords", insight.topKeywords);
  appendSection(sections, "Entities", insight.topEntities);
  appendSection(sections, "Voices", insight.topVoices);
  appendSection(sections, "Buyer signals", insight.buyerSignals);
  appendSection(sections, "Stakeholders", insight.stakeholders);
  appendSection(sections, "Intent", insight.intent);
  appendSection(sections, "Signal type", insight.signalType);
  appendSection(sections, "Scope", insight.scope);
  appendSection(sections, "Sentiment", insight.sentiment);
  appendSection(sections, "Trend direction", insight.trendDirection);
  appendSection(sections, "Trend", insight.trend);
  appendSection(sections, "Issue status", insight.issueStatus);
  appendSection(sections, "Community trend", insight.communityTrend);
  appendSection(sections, "Impact", insight.impactLevel);
  appendSection(sections, "Resolution hint", insight.resolutionHint);
  appendSection(sections, "Contract status", insight.contractStatus);
  appendSection(sections, "Details", insight.details);
  appendSection(sections, "Timeline", insight.timeline);
  appendSection(sections, "Insight signals", insight.insights);
  appendSection(sections, "Sources", insight.sources);
  appendSection(sections, "Next actions", insight.nextActions);
  appendSection(sections, "Follow ups", insight.followUps);
  appendSection(sections, "My tasks", insight.myTasks);
  appendSection(sections, "Waiting for me", insight.waitingForMe);
  appendSection(sections, "Waiting for others", insight.waitingForOthers);
  appendSection(sections, "Experiment ideas", insight.experimentIdeas);
  appendSection(sections, "Risk flags", insight.riskFlags);
  appendSection(sections, "Strategic context", insight.strategic);
  appendSection(sections, "History", insight.historySummary);
  appendSection(sections, "Role attribution", insight.roleAttribution);
  appendSection(sections, "Alerts", insight.alerts);

  const content = sections.join("\n");
  return truncateAtBoundary(
    content,
    options.maxLength ?? DEFAULT_MAX_TEXT_LENGTH,
  );
}

export function buildInsightEmbeddingDocument(
  insight: InsightEmbeddingTextInput,
  options: BuildInsightEmbeddingTextOptions = {},
): InsightEmbeddingDocument {
  const content = buildInsightEmbeddingText(insight, options);
  return {
    content,
    contentHash: hashInsightEmbeddingContent(content),
    textVersion: INSIGHT_EMBEDDING_TEXT_VERSION,
  };
}
