import {
  getBotsByUserId,
  getChatById,
  getChatInsights,
  getMessagesByChatId,
  getStoredInsightsByBotIds,
  getUserInsightSettings,
  getUserProfile,
} from "@/lib/db/queries";
import { getUserFileById } from "@/lib/db/storageService";
import { getUserMemoryPath } from "@/lib/utils/path";
import type { DBMessage, Insight } from "@/lib/db/schema";
import type {
  ImageGenerationRequest,
  ImageReference,
} from "@openloomi/ai/agent";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LifestyleReferenceImageRole = "style" | "subject";

export type LifestyleComposerWarningCode =
  | "profile_unavailable"
  | "settings_unavailable"
  | "chat_not_found_or_forbidden"
  | "chat_messages_unavailable"
  | "chat_insights_unavailable"
  | "recent_insights_unavailable"
  | "user_memories_unavailable"
  | "reference_image_not_found"
  | "reference_image_unsupported_type"
  | "reference_image_invalid"
  | "reference_images_collected_not_forwarded";

export interface LifestyleComposerWarning {
  code: LifestyleComposerWarningCode;
  message: string;
  source?: string;
}

export interface LifestyleReferenceImageInput {
  fileId?: string;
  url?: string;
  dataUrl?: string;
  b64Json?: string;
  mimeType?: string;
  role?: LifestyleReferenceImageRole;
  note?: string;
}

export interface LifestyleReferenceImageSummary {
  fileId?: string;
  url?: string;
  mimeType?: string;
  role: LifestyleReferenceImageRole;
  note?: string;
}

export interface LifestylePromptSourceSummary {
  profile: {
    name: string | null;
    industries: string[];
    workDescription: string | null;
  };
  focus: {
    people: string[];
    topics: string[];
  };
  recentInterests: string[];
  lifeKeywords: string[];
  memories: string[];
  referenceImages: LifestyleReferenceImageSummary[];
}

export interface ComposeLifestyleImagePromptInput {
  userId: string;
  chatId?: string;
  referenceImages?: LifestyleReferenceImageInput[];
  generation?: Partial<ImageGenerationRequest>;
  days?: number;
  recentInsightLimit?: number;
  chatMessageLimit?: number;
  passReferenceImagesToProvider?: boolean;
}

export interface ComposeLifestyleImagePromptResult {
  prompt: string;
  sourceSummary: LifestylePromptSourceSummary;
  warnings: LifestyleComposerWarning[];
  imageGenerationRequest: ImageGenerationRequest;
}

type NormalizedReferenceImage = {
  summary: LifestyleReferenceImageSummary;
  providerImage: ImageReference;
};

const DEFAULT_RECENT_INSIGHT_LIMIT = 12;
const DEFAULT_CHAT_MESSAGE_LIMIT = 24;
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_REFERENCE_IMAGES = 4;
const MAX_USER_MEMORY_FILES = 8;
const MAX_MEMORY_SUMMARIES = 4;
const MAX_MEMORY_SUMMARY_LENGTH = 160;
const USER_MEMORY_CATEGORIES = ["people", "projects", "notes", "strategy"];
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function composeLifestyleImagePrompt(
  input: ComposeLifestyleImagePromptInput,
): Promise<ComposeLifestyleImagePromptResult> {
  const warnings: LifestyleComposerWarning[] = [];
  const [
    profile,
    settings,
    chatContext,
    recentInsights,
    userMemories,
    referenceImages,
  ] = await Promise.all([
    loadProfile(input.userId, warnings),
    loadInsightSettings(input.userId, warnings),
    loadChatContext(input, warnings),
    loadRecentInsights(input, warnings),
    loadUserMemories(input.userId, warnings),
    normalizeReferenceImages(input.userId, input.referenceImages, warnings),
  ]);

  const allInsights = dedupeInsights([
    ...chatContext.insights,
    ...recentInsights,
  ]);
  const profileSummary = {
    name: profile?.name ?? null,
    industries: normalizeStringList(settings?.identityIndustries, 6, 80),
    workDescription: clipText(settings?.identityWorkDescription ?? null, 500),
  };
  const focus = {
    people: normalizeStringList(settings?.focusPeople, 8, 80),
    topics: normalizeStringList(settings?.focusTopics, 8, 100),
  };
  const recentInterests = dedupeStrings([
    ...extractMessageSnippets(chatContext.messages),
    ...extractInsightLabels(chatContext.insights),
  ]).slice(0, 8);
  const lifeKeywords = dedupeStrings([
    ...allInsights.flatMap(extractInsightKeywords),
    ...focus.topics,
  ]).slice(0, 12);
  const memories = dedupeStrings([
    ...userMemories,
    ...summarizeMemories(allInsights),
  ]).slice(0, MAX_MEMORY_SUMMARIES);
  const sourceSummary: LifestylePromptSourceSummary = {
    profile: profileSummary,
    focus,
    recentInterests,
    lifeKeywords,
    memories,
    referenceImages: referenceImages.map((item) => item.summary),
  };
  const prompt = buildLifestylePrompt(sourceSummary);
  const providerReferences = input.passReferenceImagesToProvider
    ? referenceImages.map((item) => item.providerImage)
    : [];

  if (referenceImages.length > 0 && providerReferences.length === 0) {
    warnings.push({
      code: "reference_images_collected_not_forwarded",
      source: "referenceImages",
      message:
        "Reference images were collected in the source summary but not forwarded to the provider by default.",
    });
  }

  const generation = input.generation ?? {};
  return {
    prompt,
    sourceSummary,
    warnings,
    imageGenerationRequest: {
      ...generation,
      prompt,
      referenceImages:
        providerReferences.length > 0 ? providerReferences : undefined,
      metadata: {
        ...(generation.metadata ?? {}),
        lifestyle: {
          sourceSummary,
          warningCodes: warnings.map((warning) => warning.code),
        },
      },
    },
  };
}

async function loadProfile(
  userId: string,
  warnings: LifestyleComposerWarning[],
) {
  try {
    return await getUserProfile(userId);
  } catch (error) {
    warnings.push({
      code: "profile_unavailable",
      source: "profile",
      message: messageFromError(error, "User profile is unavailable."),
    });
    return null;
  }
}

async function loadInsightSettings(
  userId: string,
  warnings: LifestyleComposerWarning[],
) {
  try {
    return await getUserInsightSettings(userId);
  } catch (error) {
    warnings.push({
      code: "settings_unavailable",
      source: "settings",
      message: messageFromError(error, "Insight settings are unavailable."),
    });
    return null;
  }
}

async function loadChatContext(
  input: ComposeLifestyleImagePromptInput,
  warnings: LifestyleComposerWarning[],
): Promise<{ messages: DBMessage[]; insights: Insight[] }> {
  if (!input.chatId) {
    return { messages: [], insights: [] };
  }

  try {
    const chat = await getChatById({ id: input.chatId });
    if (!chat || chat.userId !== input.userId) {
      warnings.push({
        code: "chat_not_found_or_forbidden",
        source: "chat",
        message: "The requested chat could not be used for this user.",
      });
      return { messages: [], insights: [] };
    }
  } catch (error) {
    warnings.push({
      code: "chat_not_found_or_forbidden",
      source: "chat",
      message: messageFromError(error, "The requested chat is unavailable."),
    });
    return { messages: [], insights: [] };
  }

  const [messages, insights] = await Promise.all([
    loadChatMessages(input.chatId, input.chatMessageLimit, warnings),
    loadChatInsights(input.chatId, warnings),
  ]);
  return { messages, insights };
}

async function loadChatMessages(
  chatId: string,
  limit: number | undefined,
  warnings: LifestyleComposerWarning[],
): Promise<DBMessage[]> {
  try {
    const messageLimit = limit ?? DEFAULT_CHAT_MESSAGE_LIMIT;
    const messages = await getMessagesByChatId({
      id: chatId,
      limit: Math.max(messageLimit, 100),
    });
    return messages.slice(-messageLimit);
  } catch (error) {
    warnings.push({
      code: "chat_messages_unavailable",
      source: "chatMessages",
      message: messageFromError(error, "Recent chat messages are unavailable."),
    });
    return [];
  }
}

async function loadChatInsights(
  chatId: string,
  warnings: LifestyleComposerWarning[],
): Promise<Insight[]> {
  try {
    return await getChatInsights({ chatId });
  } catch (error) {
    warnings.push({
      code: "chat_insights_unavailable",
      source: "chatInsights",
      message: messageFromError(error, "Chat insights are unavailable."),
    });
    return [];
  }
}

async function loadRecentInsights(
  input: ComposeLifestyleImagePromptInput,
  warnings: LifestyleComposerWarning[],
): Promise<Insight[]> {
  try {
    const { bots } = await getBotsByUserId({
      id: input.userId,
      limit: 50,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: null,
    });
    const botIds = bots.map((bot) => bot.id).filter(Boolean);
    if (botIds.length === 0) return [];

    const { insights } = await getStoredInsightsByBotIds({
      ids: botIds,
      days: input.days ?? DEFAULT_LOOKBACK_DAYS,
      limit: input.recentInsightLimit ?? DEFAULT_RECENT_INSIGHT_LIMIT,
    });
    return insights as Insight[];
  } catch (error) {
    warnings.push({
      code: "recent_insights_unavailable",
      source: "recentInsights",
      message: messageFromError(error, "Recent insights are unavailable."),
    });
    return [];
  }
}

async function loadUserMemories(
  userId: string,
  warnings: LifestyleComposerWarning[],
): Promise<string[]> {
  try {
    const memoryRoot = getUserMemoryPath(userId);
    const filesByCategory = await Promise.all(
      USER_MEMORY_CATEGORIES.map((category) =>
        readMemoryCategory(memoryRoot, category),
      ),
    );
    const files = filesByCategory.flat().slice(0, MAX_USER_MEMORY_FILES);
    const memories = await Promise.all(
      files.map(async (file) => {
        const content = await readFile(file.filePath, "utf8");
        return summarizeUserMemoryFile(content, file.category, file.fileName);
      }),
    );
    return memories.filter((memory): memory is string => Boolean(memory));
  } catch (error) {
    warnings.push({
      code: "user_memories_unavailable",
      source: "userMemories",
      message: messageFromError(error, "User memories are unavailable."),
    });
    return [];
  }
}

async function readMemoryCategory(
  memoryRoot: string,
  category: string,
): Promise<Array<{ category: string; fileName: string; filePath: string }>> {
  const categoryDir = path.join(memoryRoot, category);
  try {
    const entries = await readdir(categoryDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => ({
        category,
        fileName: entry.name,
        filePath: path.join(categoryDir, entry.name),
      }));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function summarizeUserMemoryFile(
  content: string,
  category: string,
  fileName: string,
): string | null {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-*_]{3,}$/.test(line));
  const heading = lines
    .find((line) => /^#{1,6}\s+\S/.test(line))
    ?.replace(/^#{1,6}\s+/, "")
    .trim();
  const body = lines
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 1)
    .join(" ");
  const title = heading || fileName.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  return clipText(
    `${category}: ${title}${body ? ` - ${body}` : ""}`,
    MAX_MEMORY_SUMMARY_LENGTH,
  );
}

async function normalizeReferenceImages(
  userId: string,
  images: LifestyleReferenceImageInput[] | undefined,
  warnings: LifestyleComposerWarning[],
): Promise<NormalizedReferenceImage[]> {
  if (!images?.length) return [];

  const normalized: NormalizedReferenceImage[] = [];
  for (const image of images.slice(0, MAX_REFERENCE_IMAGES)) {
    const role = normalizeReferenceRole(image.role);
    const note = clipText(image.note ?? null, 160) ?? undefined;

    if (image.fileId) {
      const fileImage = await normalizeFileReferenceImage(
        userId,
        image.fileId,
        role,
        note,
        warnings,
      );
      if (fileImage) normalized.push(fileImage);
      continue;
    }

    const directImage = normalizeDirectReferenceImage(
      image,
      role,
      note,
      warnings,
    );
    if (directImage) normalized.push(directImage);
  }

  return normalized;
}

async function normalizeFileReferenceImage(
  userId: string,
  fileId: string,
  role: LifestyleReferenceImageRole,
  note: string | undefined,
  warnings: LifestyleComposerWarning[],
): Promise<NormalizedReferenceImage | null> {
  const file = await getUserFileById({ userId, fileId });
  if (!file) {
    warnings.push({
      code: "reference_image_not_found",
      source: "referenceImages",
      message: `Reference image file ${fileId} was not found for this user.`,
    });
    return null;
  }

  if (!isImageMimeType(file.contentType)) {
    warnings.push({
      code: "reference_image_unsupported_type",
      source: "referenceImages",
      message: `Reference file ${fileId} is not a supported image type.`,
    });
    return null;
  }

  return {
    summary: {
      fileId,
      url: file.blobUrl,
      mimeType: file.contentType,
      role,
      note,
    },
    providerImage: {
      url: file.blobUrl,
      mimeType: file.contentType,
    },
  };
}

function normalizeDirectReferenceImage(
  image: LifestyleReferenceImageInput,
  role: LifestyleReferenceImageRole,
  note: string | undefined,
  warnings: LifestyleComposerWarning[],
): NormalizedReferenceImage | null {
  const dataUrlParts = image.dataUrl ? parseDataUrl(image.dataUrl) : null;
  const mimeType = normalizeMimeType(
    image.mimeType ?? dataUrlParts?.mimeType ?? null,
  );

  if (image.dataUrl && dataUrlParts && isImageMimeType(dataUrlParts.mimeType)) {
    return {
      summary: {
        mimeType: dataUrlParts.mimeType,
        role,
        note,
      },
      providerImage: {
        dataUrl: image.dataUrl.trim(),
        b64Json: dataUrlParts.b64Json,
        mimeType: dataUrlParts.mimeType,
      },
    };
  }

  if (image.b64Json && mimeType && isImageMimeType(mimeType)) {
    const b64Json = stripDataUrlPrefix(image.b64Json);
    return {
      summary: {
        mimeType,
        role,
        note,
      },
      providerImage: {
        b64Json,
        dataUrl: `data:${mimeType};base64,${b64Json}`,
        mimeType,
      },
    };
  }

  const url = normalizeUrl(image.url);
  if (url && mimeType && isImageMimeType(mimeType)) {
    return {
      summary: {
        url,
        mimeType,
        role,
        note,
      },
      providerImage: {
        url,
        mimeType,
      },
    };
  }

  warnings.push({
    code: "reference_image_invalid",
    source: "referenceImages",
    message:
      "A reference image was skipped because it did not include a valid image URL, data URL, or base64 payload with a supported MIME type.",
  });
  return null;
}

function buildLifestylePrompt(summary: LifestylePromptSourceSummary): string {
  const sections = [
    "Create a polished personalized lifestyle image that represents the user's current Loomi context.",
    "The result should feel shareable, warm, specific, and visually grounded rather than abstract.",
    "",
    buildProfileSection(summary),
    buildFocusSection(summary),
    buildRecentInterestSection(summary),
    buildMemorySection(summary),
    buildReferenceSection(summary),
    "Visual direction:",
    "- Compose a natural lifestyle scene with a clear mood, environment, and activity.",
    "- Use symbolic details from the user's work, interests, and memories without rendering private text, chat logs, screenshots, documents, or readable UI.",
    "- Avoid logos, watermarks, exact names in the image, and sensitive personal identifiers.",
    "- Prefer an editorial, high-quality image with balanced lighting and a coherent color palette.",
  ];

  return sections.filter(Boolean).join("\n");
}

function buildProfileSection(summary: LifestylePromptSourceSummary): string {
  const parts: string[] = [];
  if (summary.profile.name) {
    parts.push(`User name for context only: ${summary.profile.name}`);
  }
  if (summary.profile.industries.length > 0) {
    parts.push(`Industries: ${summary.profile.industries.join(", ")}`);
  }
  if (summary.profile.workDescription) {
    parts.push(`Work identity: ${summary.profile.workDescription}`);
  }

  if (parts.length === 0) {
    return "Profile context: not enough explicit profile data; keep the image broadly personal and work-aware.";
  }
  return `Profile context:\n${parts.map((part) => `- ${part}`).join("\n")}`;
}

function buildFocusSection(summary: LifestylePromptSourceSummary): string {
  const lines: string[] = [];
  if (summary.focus.topics.length > 0) {
    lines.push(`Current focus topics: ${summary.focus.topics.join(", ")}`);
  }
  if (summary.focus.people.length > 0) {
    lines.push(
      `People or communities important to the user: ${summary.focus.people.join(
        ", ",
      )}`,
    );
  }

  return lines.length > 0
    ? `Current focus:\n${lines.map((line) => `- ${line}`).join("\n")}`
    : "Current focus: infer a calm, forward-looking scene without inventing specific projects.";
}

function buildRecentInterestSection(
  summary: LifestylePromptSourceSummary,
): string {
  if (summary.recentInterests.length === 0) {
    return "Recently discussed interests: no recent chat context available.";
  }
  return `Recently discussed interests:\n${summary.recentInterests
    .map((item) => `- ${item}`)
    .join("\n")}`;
}

function buildMemorySection(summary: LifestylePromptSourceSummary): string {
  const lines: string[] = [];
  if (summary.lifeKeywords.length > 0) {
    lines.push(`Life keywords: ${summary.lifeKeywords.join(", ")}`);
  }
  if (summary.memories.length > 0) {
    lines.push(
      `Recent memory signals:\n${summary.memories
        .map((memory) => `  - ${memory}`)
        .join("\n")}`,
    );
  }

  return lines.length > 0
    ? `Life context:\n${lines.map((line) => `- ${line}`).join("\n")}`
    : "Life context: use a tasteful everyday setting and avoid making up personal facts.";
}

function buildReferenceSection(summary: LifestylePromptSourceSummary): string {
  if (summary.referenceImages.length === 0) {
    return "Reference images: none provided.";
  }

  const references = summary.referenceImages.map((image, index) => {
    const note = image.note ? `; note: ${image.note}` : "";
    return `- Reference ${index + 1}: ${image.role} reference, ${
      image.mimeType ?? "image"
    }${note}`;
  });
  return [
    "Reference images:",
    ...references,
    "Use these references only when the selected provider supports image input; otherwise follow the text prompt.",
  ].join("\n");
}

function extractMessageSnippets(messages: DBMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => extractTextFromParts(message.parts))
    .filter((text): text is string => Boolean(text))
    .map((text) => clipText(text, 160))
    .filter((text): text is string => Boolean(text));
}

function extractTextFromParts(parts: unknown): string | null {
  const parsed = parseJsonField(parts);
  if (typeof parsed === "string") return normalizeText(parsed);
  if (!Array.isArray(parsed)) return null;

  const text = parsed
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join(" ");
  return normalizeText(text);
}

function extractInsightLabels(insights: Insight[]): string[] {
  return insights
    .map((item) =>
      clipText(
        normalizeText(
          [item.title, item.description].filter(Boolean).join(": "),
        ),
        160,
      ),
    )
    .filter((item): item is string => Boolean(item));
}

function extractInsightKeywords(insight: Insight): string[] {
  return [
    ...normalizeStringList(insight.topKeywords),
    ...normalizeStringList(insight.topEntities),
    ...normalizeStringList(insight.people),
    ...normalizeStringList(insight.groups),
  ];
}

function summarizeMemories(insights: Insight[]): string[] {
  return insights
    .filter(isMemoryLikeInsight)
    .map((item) =>
      clipText(
        normalizeText(
          [item.title, item.description].filter(Boolean).join(": "),
        ),
        180,
      ),
    )
    .filter((item): item is string => Boolean(item));
}

function isMemoryLikeInsight(insight: Insight): boolean {
  const label = `${insight.taskLabel ?? ""} ${insight.categories ?? ""} ${
    insight.learning ?? ""
  }`.toLowerCase();
  return (
    label.includes("chronicle") ||
    label.includes("memory") ||
    label.includes("screenshotpath") ||
    label.includes("audiopath")
  );
}

function dedupeInsights(insights: Insight[]): Insight[] {
  const seen = new Set<string>();
  return insights.filter((item) => {
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeStringList(
  value: unknown,
  limit = 10,
  itemLimit = 120,
): string[] {
  const parsed = parseJsonField(value);
  if (!Array.isArray(parsed)) return [];
  return dedupeStrings(
    parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => clipText(item, itemLimit))
      .filter((item): item is string => Boolean(item)),
  ).slice(0, limit);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeReferenceRole(
  role: LifestyleReferenceImageInput["role"],
): LifestyleReferenceImageRole {
  return role === "subject" ? "subject" : "style";
}

function normalizeMimeType(value: string | null | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized ? normalized.toLowerCase() : null;
}

function isImageMimeType(value: string | null | undefined): value is string {
  return Boolean(value && IMAGE_MIME_TYPES.has(value.toLowerCase()));
}

function parseDataUrl(
  value: string,
): { mimeType: string; b64Json: string } | null {
  const match = value.trim().match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    b64Json: match[2],
  };
}

function stripDataUrlPrefix(value: string): string {
  const trimmed = value.trim();
  const parsed = parseDataUrl(trimmed);
  return parsed?.b64Json ?? trimmed;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function clipText(value: string | null, maxLength: number): string | null {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === code;
}
