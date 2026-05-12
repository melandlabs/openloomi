import { createHash } from "node:crypto";
import { generateText, type ModelMessage } from "ai";
import { jsonrepair } from "jsonrepair";
import { and, asc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import {
  getModelProvider,
  setAIUserContext,
  clearAIUserContext,
} from "@/lib/ai";
import { db } from "@/lib/db/queries";
import {
  bot,
  insight,
  insightCompactionLinks,
  user,
  type Insight,
  type InsertInsight,
  type InsightAction,
  type InsightRiskFlag,
  type InsightTaskItem,
} from "@/lib/db/schema";
import { extractJsonFromMarkdown } from "@alloomi/ai";
import type { GeneratedInsightPayload } from "@/lib/insights/types";
import {
  getInsightCompactionPlatform,
  getInsightCompactionProfile,
  type InsightCompactionPlatform,
} from "@/lib/insights/compaction-profile";
import { getInsightCompactionRuntime } from "@/lib/insights/compaction-runtime";

const DEFAULT_OLDER_THAN_DAYS = 14;
const DEFAULT_LIMIT = 200;
const DEFAULT_MIN_GROUP_SIZE = 2;
const MAX_SOURCE_INSIGHTS_FOR_PROMPT = 24;
const MAX_PROMPT_DETAILS_PER_INSIGHT = 6;
const MAX_PROMPT_TIMELINE_PER_INSIGHT = 8;
const MAX_TEXT_LENGTH = 1200;

const IMPORTANCE_ORDER = [
  "critical",
  "urgent",
  "high",
  "important",
  "medium",
  "normal",
  "low",
  "minor",
] as const;
const URGENCY_ORDER = [
  "critical",
  "urgent",
  "warning",
  "high",
  "soon",
  "normal",
  "medium",
  "low",
  "later",
] as const;

export type InsightCompactionGroup = {
  bucketKey: string;
  botId: string;
  insights: Insight[];
};

export type InsightCompactionPreview = {
  candidates: Insight[];
  groups: InsightCompactionGroup[];
};

export type RunInsightCompactionInput = {
  userId: string;
  botId?: string;
  insightIds?: string[];
  olderThanDays?: number;
  limit?: number;
  minGroupSize?: number;
  dryRun?: boolean;
  triggerType?: "manual" | "scheduled" | "backfill";
  platform?: InsightCompactionPlatform;
  generateWithLLM?: (
    group: InsightCompactionGroup,
    seed: GeneratedInsightPayload,
    input: RunInsightCompactionInput,
  ) => Promise<Partial<GeneratedInsightPayload>>;
  scoreCompactabilityWithLLM?: (
    insight: Insight,
    input: RunInsightCompactionInput,
  ) => Promise<InsightCompactabilityAssessment>;
};

export type RunInsightCompactionResult = {
  candidateCount: number;
  groupCount: number;
  condensedInsightIds: string[];
  archivedInsightIds: string[];
  dryRun: boolean;
};

export type InsightCompactabilityAssessment = {
  score: number;
  shouldCompact: boolean;
  reason: string | null;
};

function normalizeLabel(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function rankLabel(
  value: string | null | undefined,
  order: readonly string[],
  fallback: string,
): number {
  const normalized = normalizeLabel(value, fallback);
  const index = order.indexOf(normalized as (typeof order)[number]);
  return index === -1 ? order.length : index;
}

function pickHighest(
  values: Array<string | null | undefined>,
  order: readonly string[],
  fallback: string,
): string {
  const ranked = values
    .map((value) => ({
      value: normalizeLabel(value, fallback),
      rank: rankLabel(value, order, fallback),
    }))
    .sort((left, right) => left.rank - right.rank);
  return ranked[0]?.value ?? fallback;
}

function monthBucket(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function slugPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

function truncateText(value: string | null | undefined, max = MAX_TEXT_LENGTH) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function dedupeByKey<T>(
  items: T[],
  keyOf: (item: T) => string | null | undefined,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item)?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function flattenArrayField<T>(
  insights: Insight[],
  pick: (item: Insight) => T[] | null | undefined,
): T[] {
  return insights.flatMap((item) => {
    const value = pick(item);
    return Array.isArray(value) ? value : [];
  });
}

function averageNumber(
  values: Array<number | null | undefined>,
): number | null {
  const numericValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numericValues.length === 0) return null;
  const avg =
    numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  return Math.max(0, Math.min(1, Number(avg.toFixed(4))));
}

function pickSingleOrNull(
  values: Array<string | null | undefined>,
): string | null {
  const uniqueValues = dedupeStrings(values);
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function firstNonNull<T>(values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function getAllTasks(item: Insight): InsightTaskItem[] {
  return [item.myTasks, item.waitingForMe, item.waitingForOthers].flatMap(
    (tasks) => (Array.isArray(tasks) ? tasks : []),
  );
}

function isOpenTask(task: InsightTaskItem): boolean {
  return task.status !== "completed";
}

function hasOpenTasks(item: Insight): boolean {
  return getAllTasks(item).some(isOpenTask);
}

function hasActiveRisk(item: Insight): boolean {
  return Array.isArray(item.riskFlags) && item.riskFlags.length > 0;
}

function coerceDate(value: Date | string | number | null | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const normalized = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(normalized);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return new Date(value);
  }
  return new Date();
}

function dedupeDetails(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.details ?? []),
    (detail: any) =>
      `${detail?.time ?? ""}|${detail?.person ?? ""}|${detail?.channel ?? ""}|${detail?.content ?? detail?.originalContent ?? ""}`,
  ).sort((left: any, right: any) => {
    const leftTime = Number(left?.time ?? 0);
    const rightTime = Number(right?.time ?? 0);
    return leftTime - rightTime;
  });
}

function dedupeTimeline(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.timeline ?? []),
    (entry: any) =>
      `${entry?.time ?? ""}|${entry?.summary ?? entry?.title ?? ""}|${entry?.type ?? ""}`,
  ).sort((left: any, right: any) => {
    const leftTime = Number(left?.time ?? 0);
    const rightTime = Number(right?.time ?? 0);
    return leftTime - rightTime;
  });
}

function dedupeStoredInsights(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.insights ?? []),
    (entry: any) => `${entry?.category ?? ""}|${entry?.value ?? ""}`,
  ).slice(0, 24);
}

function dedupeSources(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.sources ?? []),
    (source: any) => `${source?.link ?? ""}|${source?.snippet ?? ""}`,
  ).slice(0, 24);
}

function dedupeStakeholders(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.stakeholders ?? []),
    (stakeholder: any) => stakeholder?.name,
  ).slice(0, 24);
}

function dedupeTopVoices(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.topVoices ?? []),
    (voice: any) => voice?.user,
  ).slice(0, 12);
}

function dedupeActions(insights: Insight[]): InsightAction[] {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.nextActions ?? []),
    (action) =>
      `${action.action ?? ""}|${action.owner ?? ""}|${action.eta ?? ""}`,
  ).slice(0, 20);
}
function dedupeFollowUps(insights: Insight[]) {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.followUps ?? []),
    (followUp: any) => `${followUp?.action ?? ""}|${followUp?.reason ?? ""}`,
  ).slice(0, 20);
}

function dedupeTasks(tasks: InsightTaskItem[]) {
  return dedupeByKey(
    tasks,
    (task) =>
      `${task.title ?? ""}|${task.context ?? ""}|${task.owner ?? ""}|${task.requesterId ?? ""}|${task.responderId ?? ""}`,
  ).slice(0, 30);
}

function dedupeRiskFlags(insights: Insight[]): InsightRiskFlag[] {
  return dedupeByKey(
    flattenArrayField(insights, (item) => item.riskFlags ?? []),
    (risk) => risk.issue,
  ).slice(0, 16);
}

async function executeCompactionTransaction<T>(
  platform: InsightCompactionPlatform | undefined,
  callback: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return await getInsightCompactionRuntime(platform).executeTransaction(
    callback,
  );
}
function buildDedupeKey(group: InsightCompactionGroup): string {
  return createHash("sha256")
    .update(
      `${group.bucketKey}:${group.insights.map((item) => item.id).join(",")}`,
    )
    .digest("hex");
}

function buildFallbackTitle(group: InsightCompactionGroup): string {
  const projectName = dedupeStrings(
    group.insights.map((item) => item.projectName),
  )[0];
  if (projectName) return `${projectName} digest`;

  const person = dedupeStrings(
    group.insights.flatMap((item) => item.people ?? []),
  )[0];
  if (person) return `${person} digest`;

  const clientName = dedupeStrings(
    group.insights.map((item) => item.client),
  )[0];
  if (clientName) return `${clientName} digest`;

  return `Insight digest ${monthBucket(new Date(group.insights[group.insights.length - 1]?.time ?? new Date()))}`;
}

function buildFallbackSummary(group: InsightCompactionGroup): string {
  const descriptions = dedupeStrings(
    group.insights.flatMap((item) => [
      item.executiveSummary,
      item.learning,
      item.description,
    ]),
  ).slice(0, 4);
  const peopleCount = dedupeStrings(
    group.insights.flatMap((item) => item.people ?? []),
  ).length;
  const sourceCount = dedupeSources(group.insights).length;

  const sentences = [
    `Compacted ${group.insights.length} older insights into one digest.`,
    peopleCount > 0
      ? `${peopleCount} people remain relevant in this context.`
      : null,
    sourceCount > 0
      ? `${sourceCount} representative sources were retained.`
      : null,
    ...descriptions,
  ].filter((value): value is string => Boolean(value));

  return (
    truncateText(sentences.join(" "), 1600) ??
    `Compacted ${group.insights.length} older insights.`
  );
}

// Fast rule gate: only stale, low-signal insights should spend LLM budget on compaction scoring.
export function isInsightCompactable(item: Insight): boolean {
  const importance = normalizeLabel(item.importance, "medium");
  const urgency = normalizeLabel(item.urgency, "normal");

  if (item.pendingDeletionAt) return false;
  if (item.compactedIntoInsightId) return false;
  if (item.isArchived || item.isFavorited) return false;
  if (item.signalType === "compaction_digest") return false;
  if (["critical", "urgent", "high", "important"].includes(importance))
    return false;
  if (["critical", "urgent", "warning", "high", "soon"].includes(urgency))
    return false;
  if (hasOpenTasks(item)) return false;
  if (hasActiveRisk(item)) return false;
  return true;
}

function buildCompactabilityPromptInput(item: Insight) {
  return {
    id: item.id,
    title: item.title,
    description: truncateText(item.description, 600),
    importance: item.importance,
    urgency: item.urgency,
    people: item.people ?? [],
    groups: item.groups ?? [],
    projectName: item.projectName ?? null,
    client: item.client ?? null,
    signalType: item.signalType ?? null,
    confidence: item.confidence ?? null,
    topKeywords: item.topKeywords ?? [],
    learning: truncateText(item.learning ?? null, 240),
    executiveSummary: truncateText(item.executiveSummary ?? null, 240),
    taskCount: getAllTasks(item).length,
    openTaskCount: getAllTasks(item).filter(isOpenTask).length,
    riskCount: Array.isArray(item.riskFlags) ? item.riskFlags.length : 0,
    sourceCount: Array.isArray(item.sources) ? item.sources.length : 0,
    time: item.time,
  };
}

// The model adds a second opinion on top of the rule gate so borderline insights are less likely to be compacted accidentally.
export async function scoreInsightCompactabilityWithLLM(
  item: Insight,
  input: RunInsightCompactionInput,
): Promise<InsightCompactabilityAssessment> {
  if (input.scoreCompactabilityWithLLM) {
    return await input.scoreCompactabilityWithLLM(item, input);
  }

  const profile = getInsightCompactionProfile(input.platform);
  const modelProvider = getModelProvider(
    getInsightCompactionPlatform(input.platform) === "desktop",
  );
  const promptInput = buildCompactabilityPromptInput(item);
  const systemPrompt = `You are rating whether an older Insight is safe to compact into a weekly digest in the ${profile.label} app runtime.
Return exactly one JSON object with:
- score: number between 0 and 1
- shouldCompact: boolean
- reason: short string

Rules:
- Prefer true only for stale, low-signal, low-risk, low-urgency insights.
- Prefer false when the insight still looks actionable, risky, or individually important.
- Do not invent facts.
- Base the score only on the provided Insight snapshot.`;
  const userPrompt = `Evaluate this Insight for compaction eligibility:
${JSON.stringify(promptInput, null, 2)}

Return one JSON object only.`;

  const response = await generateText({
    model: modelProvider.languageModel("chat-model"),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxRetries: 2,
  });

  const raw = extractJsonFromMarkdown(response.text) ?? response.text;
  const parsed = JSON.parse(jsonrepair(raw));
  const score =
    typeof parsed?.score === "number" && Number.isFinite(parsed.score)
      ? Math.max(0, Math.min(1, parsed.score))
      : 0;

  return {
    score,
    shouldCompact:
      typeof parsed?.shouldCompact === "boolean"
        ? parsed.shouldCompact
        : score >= profile.compactabilityThreshold,
    reason:
      typeof parsed?.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : null,
  };
}
export function buildInsightCompactionBucketKey(item: Insight): string {
  const month = monthBucket(new Date(item.time));
  const botKey = slugPart(item.botId) ?? "bot";
  const projectKey = slugPart(item.projectName);
  if (projectKey) return `bot:${botKey}:project:${projectKey}:${month}`;

  const clientKey = slugPart(item.client);
  if (clientKey) return `bot:${botKey}:client:${clientKey}:${month}`;

  const entityKey = slugPart(item.entity);
  if (entityKey) return `bot:${botKey}:entity:${entityKey}:${month}`;

  const personKey = slugPart(item.people?.[0]);
  if (personKey) return `bot:${botKey}:person:${personKey}:${month}`;

  return `bot:${botKey}:window:${month}`;
}

export function groupInsightsForCompaction(
  insights: Insight[],
  minGroupSize = DEFAULT_MIN_GROUP_SIZE,
): InsightCompactionGroup[] {
  const grouped = new Map<string, InsightCompactionGroup>();

  for (const item of insights) {
    const bucketKey = buildInsightCompactionBucketKey(item);
    const existing = grouped.get(bucketKey);
    if (existing) {
      existing.insights.push(item);
      continue;
    }

    grouped.set(bucketKey, {
      bucketKey,
      botId: item.botId,
      insights: [item],
    });
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      insights: [...group.insights].sort(
        (left, right) =>
          new Date(left.time).getTime() - new Date(right.time).getTime(),
      ),
    }))
    .filter((group) => group.insights.length >= minGroupSize);
}

// Seed payload keeps the full Insight shape alive before the LLM rewrites or trims anything.
export function buildSeedCompactedInsightPayload(
  group: InsightCompactionGroup,
): GeneratedInsightPayload {
  const oldest = group.insights[0];
  const newest = group.insights[group.insights.length - 1];
  const allTasks = dedupeTasks(
    flattenArrayField(group.insights, (item) => getAllTasks(item)),
  );
  const myTasks = dedupeTasks(
    flattenArrayField(group.insights, (item) => item.myTasks ?? []),
  );
  const waitingForMe = dedupeTasks(
    flattenArrayField(group.insights, (item) => item.waitingForMe ?? []),
  );
  const waitingForOthers = dedupeTasks(
    flattenArrayField(group.insights, (item) => item.waitingForOthers ?? []),
  );
  const people = dedupeStrings(
    group.insights.flatMap((item) => item.people ?? []),
  );
  const groups = dedupeStrings(
    group.insights.flatMap((item) => item.groups ?? []),
  );
  const topKeywords = dedupeStrings(
    group.insights.flatMap((item) => item.topKeywords ?? []),
  ).slice(0, 24);
  const topEntities = dedupeStrings(
    group.insights.flatMap((item) => item.topEntities ?? []),
  ).slice(0, 24);
  const buyerSignals = dedupeStrings(
    group.insights.flatMap((item) => item.buyerSignals ?? []),
  ).slice(0, 24);
  const categories = dedupeStrings(
    group.insights.flatMap((item) => item.categories ?? []),
  ).slice(0, 16);
  const summary = buildFallbackSummary(group);

  return {
    dedupeKey: buildDedupeKey(group),
    taskLabel: "compaction_digest",
    title: buildFallbackTitle(group),
    description: summary,
    importance: pickHighest(
      group.insights.map((item) => item.importance),
      IMPORTANCE_ORDER,
      "medium",
    ),
    urgency: pickHighest(
      group.insights.map((item) => item.urgency),
      URGENCY_ORDER,
      "normal",
    ),
    platform: pickSingleOrNull(group.insights.map((item) => item.platform)),
    account: pickSingleOrNull(group.insights.map((item) => item.account)),
    groups,
    people,
    time: new Date(newest.time),
    details: dedupeDetails(group.insights).slice(
      -24,
    ) as GeneratedInsightPayload["details"],
    timeline: dedupeTimeline(group.insights).slice(
      -32,
    ) as GeneratedInsightPayload["timeline"],
    insights: dedupeStoredInsights(
      group.insights,
    ) as GeneratedInsightPayload["insights"],
    trendDirection: pickSingleOrNull(
      group.insights.map((item) => item.trendDirection),
    ),
    trendConfidence: averageNumber(
      group.insights.map((item) => item.trendConfidence),
    ),
    sentiment: pickSingleOrNull(group.insights.map((item) => item.sentiment)),
    sentimentConfidence: averageNumber(
      group.insights.map((item) => item.sentimentConfidence),
    ),
    intent: pickSingleOrNull(group.insights.map((item) => item.intent)),
    trend: pickSingleOrNull(group.insights.map((item) => item.trend)),
    issueStatus: pickSingleOrNull(
      group.insights.map((item) => item.issueStatus),
    ),
    communityTrend: pickSingleOrNull(
      group.insights.map((item) => item.communityTrend),
    ),
    duplicateFlag: false,
    impactLevel: pickSingleOrNull(
      group.insights.map((item) => item.impactLevel),
    ),
    resolutionHint: pickSingleOrNull(
      group.insights.map((item) => item.resolutionHint),
    ),
    topKeywords,
    topEntities,
    topVoices: dedupeTopVoices(
      group.insights,
    ) as GeneratedInsightPayload["topVoices"],
    sources: dedupeSources(
      group.insights,
    ) as GeneratedInsightPayload["sources"],
    sourceConcentration: pickSingleOrNull(
      group.insights.map((item) => item.sourceConcentration),
    ),
    buyerSignals,
    stakeholders: dedupeStakeholders(
      group.insights,
    ) as GeneratedInsightPayload["stakeholders"],
    contractStatus: pickSingleOrNull(
      group.insights.map((item) => item.contractStatus),
    ),
    signalType: "compaction_digest",
    confidence: averageNumber(group.insights.map((item) => item.confidence)),
    scope: pickSingleOrNull(group.insights.map((item) => item.scope)),
    nextActions: dedupeActions(
      group.insights,
    ) as GeneratedInsightPayload["nextActions"],
    followUps: dedupeFollowUps(
      group.insights,
    ) as GeneratedInsightPayload["followUps"],
    actionRequired:
      allTasks.some(isOpenTask) ||
      group.insights.some((item) => Boolean(item.actionRequired)),
    actionRequiredDetails: firstNonNull(
      group.insights.map((item) => item.actionRequiredDetails),
    ) as GeneratedInsightPayload["actionRequiredDetails"],
    isUnreplied: group.insights.some((item) => Boolean(item.isUnreplied)),
    myTasks: myTasks as GeneratedInsightPayload["myTasks"],
    waitingForMe: waitingForMe as GeneratedInsightPayload["waitingForMe"],
    waitingForOthers:
      waitingForOthers as GeneratedInsightPayload["waitingForOthers"],
    clarifyNeeded: group.insights.some((item) => Boolean(item.clarifyNeeded)),
    categories,
    learning:
      dedupeStrings(group.insights.flatMap((item) => [item.learning])).join(
        "\n",
      ) || null,
    priority: null,
    experimentIdeas: dedupeByKey(
      flattenArrayField(group.insights, (item) => item.experimentIdeas ?? []),
      (idea: any) => idea?.idea,
    ).slice(0, 16) as GeneratedInsightPayload["experimentIdeas"],
    executiveSummary: summary,
    riskFlags: dedupeRiskFlags(
      group.insights,
    ) as GeneratedInsightPayload["riskFlags"],
    strategic: firstNonNull(
      group.insights.map((item) => item.strategic),
    ) as GeneratedInsightPayload["strategic"],
    client: pickSingleOrNull(group.insights.map((item) => item.client)),
    projectName: pickSingleOrNull(
      group.insights.map((item) => item.projectName),
    ),
    nextMilestone: pickSingleOrNull(
      group.insights.map((item) => item.nextMilestone),
    ),
    dueDate: pickSingleOrNull(group.insights.map((item) => item.dueDate)),
    paymentInfo: pickSingleOrNull(
      group.insights.map((item) => item.paymentInfo),
    ),
    entity: pickSingleOrNull(group.insights.map((item) => item.entity)),
    why: summary,
    historySummary: {
      title: `Compacted ${group.insights.length} insights`,
      content: summary,
    },
    roleAttribution: firstNonNull(
      group.insights.map((item) => item.roleAttribution),
    ) as GeneratedInsightPayload["roleAttribution"],
    alerts: firstNonNull(
      group.insights.map((item) => item.alerts),
    ) as GeneratedInsightPayload["alerts"],
    isFavorited: false,
    favoritedAt: null,
    isArchived: false,
    archivedAt: null,
  };
}
function sanitizeString(value: unknown, fallback: string | null = null) {
  return typeof value === "string" ? value.trim() : fallback;
}

function sanitizeStringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean | null = null) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeNumber(value: unknown, fallback: number | null = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeNullableArray<T>(value: unknown, fallback: T[] | null) {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function sanitizeNullableObject<T extends Record<string, unknown> | null>(
  value: unknown,
  fallback: T,
): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return fallback;
}

export function mergeCompactedInsightPayload(
  seed: GeneratedInsightPayload,
  modelOutput: Partial<GeneratedInsightPayload> | null | undefined,
): GeneratedInsightPayload {
  const source = modelOutput ?? {};

  return {
    dedupeKey: sanitizeString(source.dedupeKey, seed.dedupeKey ?? null),
    taskLabel:
      sanitizeString(source.taskLabel, seed.taskLabel ?? "compaction_digest") ??
      "compaction_digest",
    title:
      sanitizeString(source.title, seed.title ?? "Compacted insight") ??
      "Compacted insight",
    description:
      sanitizeString(source.description, seed.description ?? "") ?? "",
    importance:
      sanitizeString(source.importance, seed.importance ?? "medium") ??
      "medium",
    urgency:
      sanitizeString(source.urgency, seed.urgency ?? "normal") ?? "normal",
    platform: sanitizeString(source.platform, seed.platform ?? null),
    account: sanitizeString(source.account, seed.account ?? null),
    groups: sanitizeStringArray(source.groups, seed.groups ?? []),
    people: sanitizeStringArray(source.people, seed.people ?? []),
    time: source.time ? coerceDate(source.time) : coerceDate(seed.time),
    details: sanitizeNullableArray(source.details, seed.details ?? null),
    timeline: sanitizeNullableArray(source.timeline, seed.timeline ?? null),
    insights: sanitizeNullableArray(source.insights, seed.insights ?? null),
    trendDirection: sanitizeString(
      source.trendDirection,
      seed.trendDirection ?? null,
    ),
    trendConfidence: sanitizeNumber(
      source.trendConfidence,
      seed.trendConfidence ?? null,
    ),
    sentiment: sanitizeString(source.sentiment, seed.sentiment ?? null),
    sentimentConfidence: sanitizeNumber(
      source.sentimentConfidence,
      seed.sentimentConfidence ?? null,
    ),
    intent: sanitizeString(source.intent, seed.intent ?? null),
    trend: sanitizeString(source.trend, seed.trend ?? null),
    issueStatus: sanitizeString(source.issueStatus, seed.issueStatus ?? null),
    communityTrend: sanitizeString(
      source.communityTrend,
      seed.communityTrend ?? null,
    ),
    duplicateFlag: sanitizeBoolean(
      source.duplicateFlag,
      seed.duplicateFlag ?? false,
    ),
    impactLevel: sanitizeString(source.impactLevel, seed.impactLevel ?? null),
    resolutionHint: sanitizeString(
      source.resolutionHint,
      seed.resolutionHint ?? null,
    ),
    topKeywords: sanitizeStringArray(
      source.topKeywords,
      seed.topKeywords ?? [],
    ),
    topEntities: sanitizeStringArray(
      source.topEntities,
      seed.topEntities ?? [],
    ),
    topVoices: sanitizeNullableArray(source.topVoices, seed.topVoices ?? null),
    sources: sanitizeNullableArray(source.sources, seed.sources ?? null),
    sourceConcentration: sanitizeString(
      source.sourceConcentration,
      seed.sourceConcentration ?? null,
    ),
    buyerSignals: sanitizeStringArray(
      source.buyerSignals,
      seed.buyerSignals ?? [],
    ),
    stakeholders: sanitizeNullableArray(
      source.stakeholders,
      seed.stakeholders ?? null,
    ),
    contractStatus: sanitizeString(
      source.contractStatus,
      seed.contractStatus ?? null,
    ),
    signalType:
      sanitizeString(
        source.signalType,
        seed.signalType ?? "compaction_digest",
      ) ?? "compaction_digest",
    confidence: sanitizeNumber(source.confidence, seed.confidence ?? null),
    scope: sanitizeString(source.scope, seed.scope ?? null),
    nextActions: sanitizeNullableArray(
      source.nextActions,
      seed.nextActions ?? null,
    ),
    followUps: sanitizeNullableArray(source.followUps, seed.followUps ?? null),
    actionRequired: sanitizeBoolean(
      source.actionRequired,
      seed.actionRequired ?? false,
    ),
    actionRequiredDetails: sanitizeNullableObject(
      source.actionRequiredDetails,
      seed.actionRequiredDetails ?? null,
    ),
    isUnreplied: sanitizeBoolean(source.isUnreplied, seed.isUnreplied ?? false),
    myTasks: sanitizeNullableArray(source.myTasks, seed.myTasks ?? null),
    waitingForMe: sanitizeNullableArray(
      source.waitingForMe,
      seed.waitingForMe ?? null,
    ),
    waitingForOthers: sanitizeNullableArray(
      source.waitingForOthers,
      seed.waitingForOthers ?? null,
    ),
    clarifyNeeded: sanitizeBoolean(
      source.clarifyNeeded,
      seed.clarifyNeeded ?? false,
    ),
    categories: sanitizeStringArray(source.categories, seed.categories ?? []),
    learning: sanitizeString(source.learning, seed.learning ?? null),
    priority: sanitizeNumber(source.priority, seed.priority ?? null),
    experimentIdeas: sanitizeNullableArray(
      source.experimentIdeas,
      seed.experimentIdeas ?? null,
    ),
    executiveSummary: sanitizeString(
      source.executiveSummary,
      seed.executiveSummary ?? null,
    ),
    riskFlags: sanitizeNullableArray(source.riskFlags, seed.riskFlags ?? null),
    strategic: sanitizeNullableObject(source.strategic, seed.strategic ?? null),
    client: sanitizeString(source.client, seed.client ?? null),
    projectName: sanitizeString(source.projectName, seed.projectName ?? null),
    nextMilestone: sanitizeString(
      source.nextMilestone,
      seed.nextMilestone ?? null,
    ),
    dueDate: sanitizeString(source.dueDate, seed.dueDate ?? null),
    paymentInfo: sanitizeString(source.paymentInfo, seed.paymentInfo ?? null),
    entity: sanitizeString(source.entity, seed.entity ?? null),
    why: sanitizeString(source.why, seed.why ?? null),
    historySummary: sanitizeNullableObject(
      source.historySummary,
      seed.historySummary ?? null,
    ),
    roleAttribution: sanitizeNullableObject(
      source.roleAttribution,
      seed.roleAttribution ?? null,
    ),
    alerts: sanitizeNullableArray(source.alerts, seed.alerts ?? null),
    isFavorited: false,
    favoritedAt: null,
    isArchived: false,
    archivedAt: null,
  };
}

function buildPromptInput(group: InsightCompactionGroup) {
  return group.insights.slice(-MAX_SOURCE_INSIGHTS_FOR_PROMPT).map((item) => ({
    id: item.id,
    title: item.title,
    description: truncateText(item.description),
    importance: item.importance,
    urgency: item.urgency,
    time: item.time,
    platform: item.platform,
    account: item.account,
    groups: item.groups ?? [],
    people: item.people ?? [],
    details: (item.details ?? [])
      .slice(-MAX_PROMPT_DETAILS_PER_INSIGHT)
      .map((detail: any) => ({
        time: detail?.time ?? null,
        person: detail?.person ?? null,
        channel: detail?.channel ?? null,
        content: truncateText(
          detail?.content ?? detail?.originalContent ?? null,
          280,
        ),
      })),
    timeline: (item.timeline ?? [])
      .slice(-MAX_PROMPT_TIMELINE_PER_INSIGHT)
      .map((entry: any) => ({
        time: entry?.time ?? null,
        title: truncateText(entry?.title ?? null, 180),
        summary: truncateText(entry?.summary ?? null, 220),
        type: entry?.type ?? null,
      })),
    insights: item.insights ?? null,
    topKeywords: item.topKeywords ?? [],
    topEntities: item.topEntities ?? [],
    sources: (item.sources ?? []).slice(0, 5).map((source: any) => ({
      platform: source?.platform ?? null,
      snippet: truncateText(source?.snippet ?? null, 220),
      link: source?.link ?? null,
    })),
    nextActions: item.nextActions ?? null,
    myTasks: item.myTasks ?? null,
    waitingForMe: item.waitingForMe ?? null,
    waitingForOthers: item.waitingForOthers ?? null,
    riskFlags: item.riskFlags ?? null,
    learning: truncateText(item.learning ?? null, 300),
    executiveSummary: truncateText(item.executiveSummary ?? null, 300),
    client: item.client ?? null,
    projectName: item.projectName ?? null,
    entity: item.entity ?? null,
    why: truncateText(item.why ?? null, 300),
  }));
}

async function loadUserAIContext(userId: string) {
  const [record] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return record ?? null;
}

async function generateCondensedInsightWithLLM(
  group: InsightCompactionGroup,
  seed: GeneratedInsightPayload,
  input: RunInsightCompactionInput,
): Promise<Partial<GeneratedInsightPayload>> {
  if (input.generateWithLLM) {
    return await input.generateWithLLM(group, seed, input);
  }

  const modelProvider = getModelProvider(
    getInsightCompactionPlatform(input.platform) === "desktop",
  );
  const promptInput = buildPromptInput(group);
  const systemPrompt = `You are compressing multiple historical Insight records into a single replacement Insight.
Return exactly one JSON object and no markdown.
The JSON object must stay compatible with the existing Insight shape used by the app.
Goals:
- Produce one condensed Insight that can replace the source insights.
- Preserve still-relevant people, topics, tasks, risks, sources, and reasoning.
- Keep details and timeline representative but concise.
- Do not invent facts.
- Prefer null for unknown scalar fields and [] for empty arrays.
- Keep signalType as "compaction_digest".
- The output should be ready to insert as a normal Insight payload.`;
  const userPrompt = `Bucket key: ${group.bucketKey}
Source insight count: ${group.insights.length}

Seed payload (already structurally valid, use it as baseline and improve it rather than changing schema):
${JSON.stringify(seed, null, 2)}

Source insights to compress:
${JSON.stringify(promptInput, null, 2)}

Return one JSON object only.`;

  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const response = await generateText({
    model: modelProvider.languageModel("chat-model"),
    messages,
    maxRetries: 2,
  });

  const raw = extractJsonFromMarkdown(response.text) ?? response.text;
  const repaired = jsonrepair(raw);
  const parsed = JSON.parse(repaired);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Compaction model did not return a JSON object");
  }
  return parsed as Partial<GeneratedInsightPayload>;
}

async function loadInsightCandidates(
  input: RunInsightCompactionInput,
): Promise<Insight[]> {
  const profile = getInsightCompactionProfile(input.platform);
  const olderThanDays = input.olderThanDays ?? profile.olderThanDays;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const whereClauses = [
    eq(bot.userId, input.userId),
    isNull(insight.pendingDeletionAt),
    isNull(insight.compactedIntoInsightId),
    eq(insight.isArchived, false),
    eq(insight.isFavorited, false),
    or(isNull(insight.signalType), ne(insight.signalType, "compaction_digest")),
  ];

  if (input.botId) whereClauses.push(eq(insight.botId, input.botId));
  if (input.insightIds && input.insightIds.length > 0) {
    whereClauses.push(inArray(insight.id, input.insightIds));
  } else {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    whereClauses.push(lt(insight.time, cutoff));
  }

  const rows = await db
    .select({ insight })
    .from(insight)
    .innerJoin(bot, eq(insight.botId, bot.id))
    .where(and(...whereClauses))
    .orderBy(asc(insight.time))
    .limit(limit);

  return rows.map((row: { insight: Insight }) => row.insight);
}

// Preview applies both rule filtering and LLM scoring before we spend work on grouping and generation.
export async function previewInsightCompaction(
  input: RunInsightCompactionInput,
): Promise<InsightCompactionPreview> {
  const profile = getInsightCompactionProfile(input.platform);
  const ruleCandidates = (await loadInsightCandidates(input)).filter(
    isInsightCompactable,
  );
  const candidates: Insight[] = [];
  const userContext = await loadUserAIContext(input.userId);

  try {
    if (userContext) {
      setAIUserContext({
        id: userContext.id,
        email: userContext.email,
        name: userContext.name,
        type: "regular",
      });
    }

    for (const item of ruleCandidates) {
      const assessment = await scoreInsightCompactabilityWithLLM(item, input);
      if (
        assessment.shouldCompact &&
        assessment.score >= profile.compactabilityThreshold
      ) {
        candidates.push(item);
      }
    }
  } finally {
    clearAIUserContext();
  }

  const groups = groupInsightsForCompaction(
    candidates,
    input.minGroupSize ?? profile.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE,
  );

  return { candidates, groups };
}
function buildInsertInsightValues(
  group: InsightCompactionGroup,
  payload: GeneratedInsightPayload,
): InsertInsight {
  const now = new Date();
  return {
    botId: group.botId,
    dedupeKey: payload.dedupeKey ?? buildDedupeKey(group),
    taskLabel: payload.taskLabel ?? "compaction_digest",
    title: payload.title ?? buildFallbackTitle(group),
    description: payload.description ?? buildFallbackSummary(group),
    importance: payload.importance ?? "medium",
    urgency: payload.urgency ?? "normal",
    platform: payload.platform ?? null,
    account: payload.account ?? null,
    groups: payload.groups ?? [],
    people: payload.people ?? [],
    time: coerceDate(payload.time),
    details: payload.details ?? null,
    timeline: payload.timeline ?? null,
    insights: payload.insights ?? null,
    trendDirection: payload.trendDirection ?? null,
    trendConfidence: payload.trendConfidence ?? null,
    sentiment: payload.sentiment ?? null,
    sentimentConfidence: payload.sentimentConfidence ?? null,
    intent: payload.intent ?? null,
    trend: payload.trend ?? null,
    issueStatus: payload.issueStatus ?? null,
    communityTrend: payload.communityTrend ?? null,
    duplicateFlag: payload.duplicateFlag ?? false,
    impactLevel: payload.impactLevel ?? null,
    resolutionHint: payload.resolutionHint ?? null,
    topKeywords: payload.topKeywords ?? [],
    topEntities: payload.topEntities ?? [],
    topVoices: payload.topVoices ?? null,
    sources: payload.sources ?? null,
    sourceConcentration: payload.sourceConcentration ?? null,
    buyerSignals: payload.buyerSignals ?? [],
    stakeholders: payload.stakeholders ?? null,
    contractStatus: payload.contractStatus ?? null,
    signalType: payload.signalType ?? "compaction_digest",
    confidence: payload.confidence ?? null,
    scope: payload.scope ?? null,
    nextActions: payload.nextActions ?? null,
    followUps: payload.followUps ?? null,
    actionRequired: payload.actionRequired ?? false,
    actionRequiredDetails: payload.actionRequiredDetails ?? null,
    isUnreplied: payload.isUnreplied ?? false,
    myTasks: payload.myTasks ?? null,
    waitingForMe: payload.waitingForMe ?? null,
    waitingForOthers: payload.waitingForOthers ?? null,
    clarifyNeeded: payload.clarifyNeeded ?? false,
    categories: payload.categories ?? [],
    learning: payload.learning ?? null,
    priority: payload.priority ?? null,
    experimentIdeas: payload.experimentIdeas ?? null,
    executiveSummary: payload.executiveSummary ?? null,
    riskFlags: payload.riskFlags ?? null,
    strategic: payload.strategic ?? null,
    client: payload.client ?? null,
    projectName: payload.projectName ?? null,
    nextMilestone: payload.nextMilestone ?? null,
    dueDate: payload.dueDate ?? null,
    paymentInfo: payload.paymentInfo ?? null,
    entity: payload.entity ?? null,
    why: payload.why ?? null,
    historySummary: payload.historySummary ?? null,
    roleAttribution: payload.roleAttribution ?? null,
    alerts: payload.alerts ?? null,
    pendingDeletionAt: null,
    compactedIntoInsightId: null,
    isArchived: false,
    isFavorited: false,
    archivedAt: null,
    favoritedAt: null,
    createdAt: now,
    updatedAt: now,
  } as InsertInsight;
}

// Run the full compaction pass: preview -> generate condensed insights -> archive source insights.
export async function runInsightCompaction(
  input: RunInsightCompactionInput,
): Promise<RunInsightCompactionResult> {
  const preview = await previewInsightCompaction(input);
  if (input.dryRun || preview.groups.length === 0) {
    return {
      candidateCount: preview.candidates.length,
      groupCount: preview.groups.length,
      condensedInsightIds: [],
      archivedInsightIds: [],
      dryRun: Boolean(input.dryRun),
    };
  }

  const userContext = await loadUserAIContext(input.userId);
  const drafts: Array<{
    group: InsightCompactionGroup;
    payload: GeneratedInsightPayload;
  }> = [];

  try {
    if (userContext) {
      setAIUserContext({
        id: userContext.id,
        email: userContext.email,
        name: userContext.name,
        type: "regular",
      });
    }

    for (const group of preview.groups) {
      const seed = buildSeedCompactedInsightPayload(group);
      const modelOutput = await generateCondensedInsightWithLLM(
        group,
        seed,
        input,
      );
      const payload = mergeCompactedInsightPayload(seed, modelOutput);
      drafts.push({ group, payload });
    }
  } finally {
    clearAIUserContext();
  }

  return await executeCompactionTransaction(input.platform, async (tx) => {
    const now = new Date();
    const condensedInsightIds: string[] = [];
    const archivedInsightIds: string[] = [];

    for (const draft of drafts) {
      const [created] = await tx
        .insert(insight)
        .values(buildInsertInsightValues(draft.group, draft.payload))
        .returning({ id: insight.id });

      condensedInsightIds.push(created.id);

      await tx.insert(insightCompactionLinks).values(
        draft.group.insights.map((source) => ({
          userId: input.userId,
          compactedInsightId: created.id,
          sourceInsightId: source.id,
          createdAt: now,
        })) as any,
      );

      const sourceIds = draft.group.insights.map((source) => source.id);
      archivedInsightIds.push(...sourceIds);

      await tx
        .update(insight)
        .set({
          pendingDeletionAt: null,
          compactedIntoInsightId: created.id,
          isArchived: true,
          archivedAt: now,
          updatedAt: now,
        } as any)
        .where(inArray(insight.id, sourceIds));
    }

    return {
      candidateCount: preview.candidates.length,
      groupCount: preview.groups.length,
      condensedInsightIds,
      archivedInsightIds,
      dryRun: false,
    };
  });
}

// Archives older rows left in the legacy pending-deletion state.
// New compaction archives sources immediately, so this is only compatibility cleanup.
export async function archiveLegacyPendingDeletionInsights(input: {
  userId?: string;
  botId?: string;
  olderThanDays?: number;
  platform?: InsightCompactionPlatform;
}): Promise<string[]> {
  const profile = getInsightCompactionProfile(input.platform);
  const cutoff = new Date(
    Date.now() -
      (input.olderThanDays ?? profile.pendingDeletionRetentionDays) *
        24 *
        60 *
        60 *
        1000,
  );

  const whereClauses = [lt(insight.pendingDeletionAt, cutoff)];
  if (input.botId) {
    whereClauses.push(eq(insight.botId, input.botId));
  }
  if (input.userId) {
    whereClauses.push(eq(bot.userId, input.userId));
  }

  const rows = input.userId
    ? await db
        .select({ id: insight.id })
        .from(insight)
        .innerJoin(bot, eq(insight.botId, bot.id))
        .where(and(...whereClauses))
    : await db
        .select({ id: insight.id })
        .from(insight)
        .where(and(...whereClauses));

  const ids = rows.map((row: { id: string }) => row.id);
  if (ids.length === 0) return [];

  await db
    .update(insight)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      pendingDeletionAt: null,
      updatedAt: new Date(),
    } as any)
    .where(inArray(insight.id, ids));
  return ids;
}
