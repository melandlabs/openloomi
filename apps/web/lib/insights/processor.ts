import pLimit from "p-limit";
import {
  upsertInsightsByBotId,
  type BotWithAccount,
  bulkUpsertContacts,
  getRssSubscriptionsByUser,
  getStoredInsightsByBotIdAndGroups,
  getUserCategories,
  insertRssItems,
  insertInsightRecords,
  markRssItemsProcessed,
  updateRssSubscription,
  recordInsightFailure,
  clearInsightFailure,
  markGroupRetrying,
  getUserContacts,
  listDingTalkInsightChatIdsForBot,
  listDingTalkInsightMessagesForInsights,
  normalizeContactMetaList,
  upsertContact,
} from "../db/queries";
import { SlackAdapter } from "../integrations/slack";
import { DiscordAdapter } from "../integrations/discord";
import {
  generateProjectInsights,
  buildCategoriesPrompt,
  type InsightData,
} from "../ai/subagents/insights";
import { AppError } from "@openloomi/shared/errors";
import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";
import { TelegramAdapter } from "@openloomi/integrations/telegram";
import { FacebookMessengerAdapter } from "@openloomi/integrations/facebook-messenger";
import type { InsertRssItem } from "@openloomi/rss";
import { maxChunkSummaryCount } from "@/lib/env/constants";
import {
  deleteInsightsSession,
  setInsightsSession,
  getInsightsSession,
  tryAcquireInsightLock,
} from "../session/context";
import { EmailAdapter } from "../integrations/email";
import {
  WhatsAppAdapter,
  activeAdapters,
  type WhatsAppDialogInfo,
} from "../integrations/whatsapp";
import { whatsappClientRegistry } from "@/lib/integrations/whatsapp/client-registry";
import { telegramClientRegistry } from "@/lib/integrations/telegram/client-registry";
import { handleTelegramAuthFailure } from "@/lib/integrations/telegram/session";
import { fileIngester } from "../integrations/providers/file-ingester";
import {
  getIntegrationAccountByBotId,
  loadIntegrationCredentials,
  updateIntegrationAccount,
} from "@/lib/db/queries";
import { TeamsAdapter } from "../integrations/teams";
import {
  generateInsightPayload,
  type GeneratedInsightPayload,
} from "@/lib/insights/transform";
import { LinkedInAdapter } from "@openloomi/integrations/linkedin";
import { InstagramAdapter } from "@openloomi/integrations/instagram";
import { GoogleCalendarAdapter } from "@openloomi/integrations/calendar";
import {
  HubspotClient,
  type HubspotDeal,
} from "@openloomi/integrations/hubspot";
import { setAIUserContext, clearAIUserContext } from "@/lib/ai";
import {
  OutlookCalendarAdapter,
  type OutlookCalendarEvent,
} from "@openloomi/integrations/calendar";
import { IMessageAdapter, parseIMessageChatId } from "../integrations/imessage";
import type { Platform } from "@openloomi/integrations/channels/sources/types";
import { getBotCredentials } from "@/lib/bots/token";
import {
  buildInsightRecord,
  fetchFeed,
  getCachedRssBotId,
} from "@/lib/bots/rss";
import { buildRssItemInserts } from "@openloomi/rss";
import {
  listRecentDocuments,
  type GoogleDocSummary,
} from "@openloomi/integrations/google-docs";
import {
  extractRawMessages,
  type RawMessageData,
} from "@openloomi/indexeddb/extractor";
import { shouldSkipGmailEmail } from "../integrations/email/classifier";
import { FeishuAdapter } from "@openloomi/integrations/feishu";

import {
  DEFAULT_CATEGORIES,
  EMAIL_TASK_LABEL,
  MAX_EMAIL_INSIGHTS,
  CALENDAR_TASK_LABEL,
  CALENDAR_UPCOMING_WINDOW_MS,
  DEFAULT_GROUP_CONCURRENCY,
  MAX_GROUP_CONCURRENCY,
  MIN_GROUP_CONCURRENCY,
  DEBUG,
} from "./constants";
import type {
  SummaryUserContext,
  RefreshOptions,
  DisconnectableAdapter,
} from "./bot-types";
import { normalizeMessagesInput, groupMessagesByChannel } from "./grouping";
import { mergeTimelines } from "./timeline";
import {
  buildEmailInsightPayload,
  groupEmailsBySender,
  extractHistoricalEmailsBySender,
  buildMergedEmailInsightPayload,
} from "./email";
import {
  buildHubspotInsightPayload,
  normalizeHubId,
  buildGoogleDocInsight,
  buildOutlookCalendarInsight,
} from "./calendar";

function botNeedsOldInsights(bot: BotWithAccount): boolean {
  return bot.adapter !== "rss" && bot.adapter !== "hubspot";
}

function mapInsightPayload(
  bot: BotWithAccount,
  items: InsightData[] | undefined,
  fixedGroupName?: string,
  validCategories?: string[],
): GeneratedInsightPayload[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items.map((item) =>
    generateInsightPayload(item, bot, fixedGroupName, validCategories),
  );
}

function parseInsightHistoryData(data: InsightData[] | string): InsightData[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (typeof data !== "string" || data.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? (parsed as InsightData[]) : [];
  } catch (error) {
    console.warn("[Gmail] Failed to parse historical insights:", error);
    return [];
  }
}

async function mergeInsightPayloads(
  existing: GeneratedInsightPayload[],
  incoming: GeneratedInsightPayload[],
  limit: number,
): Promise<GeneratedInsightPayload[]> {
  const merged = new Map<string, GeneratedInsightPayload>();

  // First, add all existing insights
  for (const payload of existing) {
    const key = `${payload.taskLabel}|${payload.title}|${payload.time ? new Date(payload.time).getTime() : 0}`;
    merged.set(key, payload);
  }

  // Then merge or add incoming insights
  for (const payload of incoming) {
    const key = `${payload.taskLabel}|${payload.title}|${payload.time ? new Date(payload.time).getTime() : 0}`;
    const existingPayload = merged.get(key);

    if (existingPayload) {
      // Merge timelines: existing + incoming, deduplicate
      const mergedTimeline = await mergeTimelines(existingPayload, payload);
      merged.set(key, {
        ...payload,
        timeline: mergedTimeline,
      });
    } else {
      merged.set(key, payload);
    }
  }

  const sorted = Array.from(merged.values()).sort(
    (a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime(),
  );
  return sorted.slice(0, Math.max(limit, 1));
}

export async function getInsightsByBotId({
  bot,
  insights,
  since,
  customPrompt,
  user,
  options,
  chunkSize,
  failedGroupsToRetry,
}: {
  bot: BotWithAccount;
  insights: InsightData[] | string;
  since: number;
  customPrompt: string;
  user: SummaryUserContext;
  options?: {
    language?: string;
    byGroup?: boolean;
    groupConcurrency?: number;
    groupRetryMaxAttempts?: number;
    groupRetryDelayMs?: number;
  };
  chunkSize?: number;
  failedGroupsToRetry?: Array<{
    groupName: string;
    processedSince: number;
    failureCount: number;
  }>;
}): Promise<{
  payload: GeneratedInsightPayload[];
  originalMsgCount: number;
  locked: boolean;
  rawMessages?: RawMessageData[];
  processedGroups?: string[];
}> {
  const disableFeishuInsightsFetch = true; // process.env.DISABLE_FEISHU_INSIGHTS_FETCH === "true";
  const botId = bot.id;
  const actualUserId = user.id;
  const userType = user.type;

  if (!(await tryAcquireInsightLock(botId))) {
    console.log(`[Insight] [Bot ${botId}] is locked, return here`);
    return { payload: [], originalMsgCount: 0, locked: true };
  }

  const insightSession = await getInsightsSession(botId);
  if (insightSession) {
    console.log(`[Insight] [Bot ${botId}] is refreshing insights, return here`);
    return { payload: [], originalMsgCount: 0, locked: true };
  }
  await setInsightsSession(botId, { count: 1, status: "initializing" });

  try {
    // Get user custom categories and calculate valid categories list
    const userCategories = await getUserCategories(actualUserId);
    const activeUserCategories = userCategories
      .filter((cat) => cat.isActive)
      .map((cat) => cat.name);
    // Valid categories = user custom + default
    const validCategories = [
      ...new Set([...activeUserCategories, ...DEFAULT_CATEGORIES]),
    ];

    // Filter function: only keep valid categories
    const filterPayloadCategories = (
      payload: GeneratedInsightPayload[],
    ): GeneratedInsightPayload[] => {
      const validSet = new Set(validCategories.map((c) => c.toLowerCase()));
      return payload.map((item) => ({
        ...item,
        categories:
          item.categories && item.categories.length > 0
            ? item.categories.filter((cat) => validSet.has(cat.toLowerCase()))
            : item.categories,
      }));
    };

    // Unified message fetching and summary generation (reuse token settlement logic)
    const generateInsight = async (
      messages: import("./bot-types").InsightInput,
      platform: Platform,
      historyInsightsOverride?: InsightData[],
    ) => {
      const messagesStr =
        typeof messages === "string" ? messages : JSON.stringify(messages);
      const effectiveHistory = historyInsightsOverride ?? insights;
      const insightStr =
        typeof effectiveHistory === "string"
          ? effectiveHistory
          : JSON.stringify(effectiveHistory);

      // Step 3: Call LLM to generate summary
      const basePrompt = `These messages are from ${platform}`;
      const combinedCustomPrompt = customPrompt
        ? `${basePrompt}. ${customPrompt}`.trim()
        : basePrompt;

      // Get user custom categories and build category prompt
      const userCategories = await getUserCategories(actualUserId);
      const activeCategories = userCategories.filter((cat) => cat.isActive);
      const categoriesPrompt = buildCategoriesPrompt(
        activeCategories.map((cat) => ({
          name: cat.name,
          description: cat.description,
        })),
      );

      // Merge systemOverlay: persona enhancement + category configuration
      const combinedSystemOverlay = [categoriesPrompt]
        .filter(Boolean)
        .join("\n\n");

      // Set AI user context for proper billing in proxy mode
      setAIUserContext({
        id: actualUserId,
        email: user.email,
        name: user.name,
        type: userType,
        token: user.token,
      });

      const { insights: data } = await generateProjectInsights(
        actualUserId,
        messagesStr,
        insightStr,
        platform,
        {
          customPrompt: combinedCustomPrompt,
          systemOverlay: combinedSystemOverlay || undefined,
          userProfile: {
            name: user.name,
            email: user.email,
            username:
              platform === "telegram" ||
              platform === "discord" ||
              platform === "slack"
                ? ((
                    bot.platformAccount?.metadata as {
                      username?: string | null;
                      displayName?: string | null;
                    }
                  )?.username ?? null)
                : null,
            displayName:
              platform === "telegram"
                ? ((
                    bot.platformAccount?.metadata as {
                      displayName?: string | null;
                    }
                  )?.displayName ?? null)
                : null,
          },
          language: options?.language,
        },
      );

      return data;
    };

    // Single group Insight processing function (for byGroup mode)
    type GroupInsightResult = {
      groupName: string;
      insights: InsightData[];
      messageCount: number;
      rawMessages?: RawMessageData[];
      error?: Error;
    };

    const processSingleGroupInsight = async (
      groupName: string,
      groupMessages: ExtractedMessageInfo[],
      groupHistoryInsights: InsightData[],
      platformStr: Platform,
      currentSince: number,
    ): Promise<GroupInsightResult> => {
      const maxAttempts = options?.groupRetryMaxAttempts ?? 2;
      const baseDelayMs = options?.groupRetryDelayMs ?? 2000;

      let lastError: Error | null = null;

      const rawMessages = extractRawMessages(
        groupMessages,
        platformStr,
        bot.id,
      );

      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        try {
          const attemptMsg =
            attempt === 0
              ? "Starting processing"
              : `[Retry ${attempt}/${maxAttempts}] Processing`;

          console.log(
            `[Bot ${botId}] ${attemptMsg} group "${groupName}": ${groupMessages.length} messages, ${groupHistoryInsights.length} historical insights`,
          );

          const failedGroup = failedGroupsToRetry?.find(
            (f) => f.groupName === groupName,
          );
          if (failedGroup && attempt === 0) {
            console.log(
              `[Bot ${botId}] Group "${groupName}" is a retry group (failed ${failedGroup.failureCount} times)`,
            );
            await markGroupRetrying({ botId, groupName });
          }

          const insightsData = await generateInsight(
            groupMessages,
            platformStr,
            groupHistoryInsights,
          );

          console.log(
            `[Bot ${botId}] Group "${groupName}" processing completed: generated ${insightsData.insights?.length || 0} insights`,
          );

          if (failedGroup) {
            await clearInsightFailure({ botId, groupName });
            console.log(
              `[Bot ${botId}] Group "${groupName}" retry successful, failure record cleared`,
            );
          }

          return {
            groupName,
            insights: insightsData.insights || [],
            messageCount: groupMessages.length,
            rawMessages,
          };
        } catch (error) {
          lastError = error as Error;
          const errorMessage = (error as Error).message;

          const isRetryableError =
            errorMessage.includes("LLM API structure output failed") ||
            errorMessage.includes("Insights Generation Failed") ||
            errorMessage.includes("AI_APICallError") ||
            errorMessage.includes("ECONNRESET");

          if (!isRetryableError || attempt >= maxAttempts) {
            console.error(
              `[Bot ${botId}] Group "${groupName}" processing failed (cannot retry or max retries reached):`,
              error,
            );

            await recordInsightFailure({
              botId,
              groupName,
              processedSince: currentSince,
              error: lastError,
            });

            return {
              groupName,
              insights: [],
              messageCount: groupMessages.length,
              rawMessages,
              error: lastError,
            };
          }

          const delayMs = Math.pow(2, attempt) * baseDelayMs;
          console.warn(
            `[Bot ${botId}] Group "${groupName}" failed on attempt ${attempt + 1}: ${errorMessage}`,
          );
          console.warn(
            `[Bot ${botId}] Waiting ${delayMs}ms before attempt ${attempt + 2}...`,
          );

          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return {
        groupName,
        insights: [],
        messageCount: groupMessages.length,
        rawMessages,
        error: lastError ?? new Error("Unknown error"),
      };
    };

    // Common group-by-group processing helper (reused across multiple adapters)
    const processMessagesByGroup = async (
      messages: ExtractedMessageInfo[],
      platformStr: Platform,
      since: number,
    ): Promise<{
      payload: GeneratedInsightPayload[];
      originalMsgCount: number;
      rawMessages: RawMessageData[];
      processedGroups: string[];
    }> => {
      let messagesByGroup = groupMessagesByChannel(messages);

      const filterGroups = (options as RefreshOptions | undefined)?.groups;
      if (filterGroups && filterGroups.length > 0) {
        console.log(
          `[Bot ${botId}] Applying group filter: ${filterGroups.join(", ")}`,
        );
        const filteredMap = new Map<string, ExtractedMessageInfo[]>();
        for (const group of filterGroups) {
          if (messagesByGroup.has(group)) {
            const groupMessages = messagesByGroup.get(group);
            if (groupMessages) {
              filteredMap.set(group, groupMessages);
            }
          }
        }
        messagesByGroup = filteredMap;
        console.log(
          `[Bot ${botId}] After filtering, remaining ${messagesByGroup.size} groups`,
        );
      }

      const concurrency = Math.min(
        Math.max(
          options?.groupConcurrency ?? DEFAULT_GROUP_CONCURRENCY,
          MIN_GROUP_CONCURRENCY,
        ),
        MAX_GROUP_CONCURRENCY,
      );
      console.log(
        `[Bot ${botId}] Concurrently processing ${messagesByGroup.size} groups, concurrency: ${concurrency}`,
      );

      const limit = pLimit(concurrency);

      const groupPromises = Array.from(messagesByGroup.entries()).map(
        async ([groupName, groupMessages]) =>
          limit(async () => {
            const { insights: groupHistory } =
              await getStoredInsightsByBotIdAndGroups({
                id: botId,
                groups: [groupName],
                days: 1,
              });

            return processSingleGroupInsight(
              groupName,
              groupMessages,
              groupHistory as InsightData[],
              platformStr,
              since,
            );
          }),
      );

      const groupResults = await Promise.allSettled(groupPromises);

      const insightsWithGroupName: {
        insight: InsightData;
        groupName: string;
      }[] = [];
      const allRawMessages: RawMessageData[] = [];
      let totalMsgCount = 0;
      const failedGroups: string[] = [];

      for (const result of groupResults) {
        if (result.status === "fulfilled") {
          const groupResult = result.value;
          for (const insight of groupResult.insights) {
            insightsWithGroupName.push({
              insight,
              groupName: groupResult.groupName,
            });
          }
          if (groupResult.rawMessages) {
            allRawMessages.push(...groupResult.rawMessages);
          }
          totalMsgCount += groupResult.messageCount;

          if (groupResult.error) {
            failedGroups.push(groupResult.groupName);
          }
        } else {
          console.error(
            `[Bot ${botId}] Group processing failed:`,
            result.reason,
          );
        }
      }

      if (failedGroups.length > 0) {
        console.warn(
          `[Bot ${botId}] Following groups failed to process: ${failedGroups.join(", ")}`,
        );
      }

      console.log(
        `[Bot ${botId}] Processing by group completed: total ${insightsWithGroupName.length} insights, ${totalMsgCount} messages`,
      );

      const processedGroups = Array.from(messagesByGroup.keys());

      const payload = insightsWithGroupName.map(({ insight, groupName }) =>
        generateInsightPayload(insight, bot, groupName),
      );

      return {
        payload,
        originalMsgCount: totalMsgCount,
        rawMessages: allRawMessages,
        processedGroups,
      };
    };

    if (bot.adapter === "slack") {
      console.log(
        `[Bot ${bot.id}] uses Slack platform manager to get insights with the custom prompt ${customPrompt}`,
      );
      const adapter = new SlackAdapter({
        botId: bot.id,
        token: await getBotCredentials("slack", bot),
        ownerUserId: actualUserId,
        ownerUserType: userType,
      });
      await setInsightsSession(botId, {
        count: 1,
        msgCount: 0,
        status: "fetching",
      });
      const messagesChunk = await adapter.getChatsByChunk(
        since,
        "public_channel,private_channel,mpim,im",
        chunkSize,
      );
      const messages = messagesChunk.messages;
      console.log(`[Bot ${bot.id}] found ${messages.length} slack messages`);

      const rawMessages = extractRawMessages(messages, "slack", bot.id);

      const enableByGroup = options?.byGroup ?? true;

      if (messages.length > 0) {
        if (enableByGroup) {
          console.log(`[Bot ${bot.id}] Enabling by-group processing mode`);

          const groupResult = await processMessagesByGroup(
            messages,
            "slack",
            since,
          );

          await setInsightsSession(botId, {
            count: 1,
            msgCount: groupResult.originalMsgCount,
            status: "finished",
          });
          await deleteInsightsSession(botId);

          return {
            payload: groupResult.payload,
            originalMsgCount: groupResult.originalMsgCount,
            locked: false,
            rawMessages: groupResult.rawMessages,
            processedGroups: groupResult.processedGroups,
          };
        }

        await setInsightsSession(botId, {
          count: 1,
          msgCount: messages.length,
          status: "insighting",
        });
        try {
          const data = await generateInsight(messages, "slack");
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messages.length,
            status: "finished",
          });
          await deleteInsightsSession(botId);
          return {
            payload: mapInsightPayload(
              bot,
              data.insights,
              undefined,
              validCategories,
            ),
            originalMsgCount: messages.length,
            locked: false,
            rawMessages,
          };
        } catch (error) {
          console.error(
            `[Bot ${botId}] Non-byGroup slack insight failed:`,
            error,
          );
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: messages.length,
            locked: false,
            rawMessages,
          };
        }
      }
      await deleteInsightsSession(botId);
      return { payload: [], originalMsgCount: 0, locked: false };
    }
    if (bot.adapter === "discord") {
      console.log(
        `[Bot ${bot.id}] uses Discord platform manager to get insights with the custom prompt ${customPrompt}`,
      );
      const credentials = await getBotCredentials("discord", bot);
      const adapter = new DiscordAdapter({
        botId: bot.id,
        token: credentials.accessToken,
        guildId: credentials.guildId,
        ownerUserId: actualUserId,
        ownerUserType: userType,
      });
      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const dialogs = await adapter.getDialogs();
        if (dialogs.length > 0) {
          await bulkUpsertContacts(
            dialogs.map((dialog) => ({
              contactId: dialog.id,
              contactName: dialog.name,
              type: dialog.type,
              userId: actualUserId,
              botId: bot.id,
              contactMeta: null,
            })),
          );
          console.log(
            `[Bot ${bot.id}] [discord] update ${dialogs.length} discord channels`,
          );
        }
        const chunkResult = await adapter.getChatsByChunk(since, chunkSize);
        const { messages } = chunkResult;
        console.log(
          `[Bot ${bot.id}] found ${messages.length} discord messages`,
        );

        const rawMessages = extractRawMessages(messages, "discord", bot.id);

        const enableByGroup = options?.byGroup ?? true;

        if (messages.length > 0) {
          if (enableByGroup) {
            console.log(`[Bot ${bot.id}] Enabling by-group processing mode`);

            const groupResult = await processMessagesByGroup(
              messages,
              "discord",
              since,
            );

            await setInsightsSession(botId, {
              count: 1,
              msgCount: groupResult.originalMsgCount,
              status: "finished",
            });
            await deleteInsightsSession(botId);

            return {
              payload: groupResult.payload,
              originalMsgCount: groupResult.originalMsgCount,
              locked: false,
              rawMessages: groupResult.rawMessages,
              processedGroups: groupResult.processedGroups,
            };
          }

          await setInsightsSession(botId, {
            count: 1,
            msgCount: messages.length,
            status: "insighting",
          });
          const data = await generateInsight(messages, "discord");
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messages.length,
            status: "finished",
          });
          await deleteInsightsSession(botId);
          return {
            payload: mapInsightPayload(
              bot,
              data.insights,
              undefined,
              validCategories,
            ),
            originalMsgCount: messages.length,
            locked: false,
            rawMessages,
          };
        }
        await deleteInsightsSession(botId);
        return { payload: [], originalMsgCount: 0, locked: false };
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        await adapter.kill().catch((killError) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Discord adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "teams") {
      console.log(
        `[Bot ${bot.id}] uses Teams platform manager to get insights with the custom prompt ${customPrompt}`,
      );
      const credentials = await getBotCredentials("teams", bot);
      const adapter = new TeamsAdapter({
        botId: bot.id,
        credentials: credentials ?? { accessToken: "" },
        platformAccountId: bot.platformAccountId ?? undefined,
        accountUserId: bot.userId,
        ownerUserId: actualUserId,
        ownerUserType: userType,
      });
      await setInsightsSession(botId, {
        count: 1,
        msgCount: 0,
        status: "fetching",
      });
      const dialogs = await adapter.getDialogs();
      if (dialogs.length > 0) {
        await bulkUpsertContacts(
          dialogs.map((dialog) => ({
            contactId: dialog.id,
            contactName: dialog.name,
            type: dialog.type,
            userId: actualUserId,
            botId: bot.id,
            contactMeta: dialog.metadata ?? null,
          })),
        );
        console.log(
          `[Bot ${bot.id}] [teams] update ${dialogs.length} teams contacts`,
        );
      }
      const messageChunk = await adapter.getChatsByChunk(since, chunkSize);
      console.log(
        `[Bot ${bot.id}] found ${messageChunk.messages.length} teams messages`,
      );

      const rawMessages = extractRawMessages(
        messageChunk.messages,
        "teams",
        bot.id,
      );

      if (messageChunk.messages.length > 0) {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: messageChunk.messages.length,
          status: "insighting",
        });
        const data = await generateInsight(messageChunk.messages, "teams");
        await setInsightsSession(botId, {
          count: 1,
          msgCount: messageChunk.messages.length,
          status: "finished",
        });
        if (messageChunk.hasMore) {
          dealMessageChunk(
            bot,
            customPrompt,
            JSON.stringify(data.insights),
            adapter,
            messageChunk,
            user,
            "teams",
            since,
            chunkSize,
          );
        } else {
          await deleteInsightsSession(botId);
          return {
            payload: mapInsightPayload(
              bot,
              data.insights,
              undefined,
              validCategories,
            ),
            originalMsgCount: messageChunk.messages.length,
            locked: false,
            rawMessages,
          };
        }
      }
      await deleteInsightsSession(botId);
      return {
        payload: [],
        originalMsgCount: messageChunk.messages.length,
        locked: false,
      };
    } else if (bot.adapter === "telegram") {
      console.log(
        `[Bot ${bot.id}] uses Telegram platform manager to get insights with the custom prompt ${customPrompt}`,
      );

      const credentials = await getBotCredentials("telegram", bot);
      const configuredSession = credentials;
      const configuredBotToken = "";
      const sessionKey =
        typeof configuredSession === "string" ? configuredSession : "";
      const botToken =
        typeof configuredBotToken === "string"
          ? (configuredBotToken as string)
          : undefined;

      const adapter = new TelegramAdapter({
        botId: bot.id,
        botToken,
        session: sessionKey,
        ownerUserId: actualUserId,
        ownerUserType: userType,
        fileIngester,
        clientRegistry: telegramClientRegistry,
      });
      let handedToDealMessageChunk = false;
      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const userContacts = await adapter.getDialogs();
        await bulkUpsertContacts(
          userContacts.map((c) => ({
            contactId: c.id,
            contactName: c.name,
            type: c.type,
            userId: actualUserId,
            botId: bot.id,
            contactMeta: c.metadata ?? null,
          })),
        );
        console.log(
          `[Bot ${bot.id}] [telegram] update ${userContacts.length} contacts`,
        );
        const messageChunk = await adapter.getChatsByChunk(since, chunkSize);
        console.log(
          `[Bot ${bot.id}] found ${messageChunk.messages.length} telegram messages`,
        );

        const rawMessages = extractRawMessages(
          messageChunk.messages,
          "telegram",
          bot.id,
        );

        const enableByGroup = options?.byGroup ?? true;

        if (messageChunk.messages.length > 0) {
          if (enableByGroup) {
            console.log(`[Bot ${bot.id}] Enabling by-group processing mode`);

            const groupResult = await processMessagesByGroup(
              messageChunk.messages,
              "telegram",
              since,
            );

            await setInsightsSession(botId, {
              count: 1,
              msgCount: groupResult.originalMsgCount,
              status: "finished",
            });
            await deleteInsightsSession(botId);

            return {
              payload: groupResult.payload,
              originalMsgCount: groupResult.originalMsgCount,
              locked: false,
              rawMessages: groupResult.rawMessages,
              processedGroups: groupResult.processedGroups,
            };
          }

          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "insighting",
          });
          const data = await generateInsight(messageChunk.messages, "telegram");
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "finished",
          });
          if (messageChunk.hasMore) {
            handedToDealMessageChunk = true;
            dealMessageChunk(
              bot,
              customPrompt,
              JSON.stringify(data.insights),
              adapter,
              messageChunk,
              user,
              "telegram",
              since,
              chunkSize,
            );
          } else {
            await deleteInsightsSession(botId);
            return {
              payload: mapInsightPayload(
                bot,
                data.insights,
                undefined,
                validCategories,
              ),
              originalMsgCount: messageChunk.messages.length,
              locked: false,
              rawMessages,
            };
          }
        }
        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: messageChunk.messages.length,
          locked: false,
        };
      } catch (error) {
        await handleTelegramAuthFailure({
          bot,
          userId: actualUserId,
          sessionKey,
          error,
        });
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        if (
          !handedToDealMessageChunk &&
          adapter.client &&
          typeof adapter.client === "object" &&
          adapter.client !== null &&
          "connected" in adapter.client &&
          typeof adapter.client.connected === "boolean" &&
          adapter.client.connected &&
          "disconnect" in adapter.client &&
          typeof adapter.client.disconnect === "function"
        ) {
          try {
            await (
              adapter.client as { disconnect: () => Promise<void> }
            ).disconnect();
          } catch (e) {
            console.error(
              `[Bot ${bot.id}] Failed to disconnect Telegram adapter:`,
              e,
            );
          }
        }
      }
    } else if (bot.adapter === "whatsapp") {
      console.log(
        `[Bot ${bot.id}] uses WhatsApp platform manager to get insights with the custom prompt ${customPrompt}`,
      );
      const accountRecord = await getIntegrationAccountByBotId({
        botId: bot.id,
      });
      const accountId = accountRecord?.id;

      let reusedSocket =
        (accountId ? activeAdapters.get(accountId)?.sock : undefined) ||
        (accountId ? whatsappClientRegistry.get(accountId) : undefined);

      if (!reusedSocket && accountId) {
        const pendingAdapter = activeAdapters.get(accountId);
        if (
          pendingAdapter?.sock === undefined &&
          pendingAdapter?.pendingInitialization
        ) {
          console.log(
            `[Bot ${bot.id}] activeAdapters has adapter for accountId=${accountId} but socket not ready yet, awaiting its initialization`,
          );
          await pendingAdapter.pendingInitialization;
          reusedSocket = pendingAdapter.sock ?? undefined;
          console.log(
            `[Bot ${bot.id}] Awaited pending socket for accountId=${accountId}: ${!!reusedSocket}`,
          );
        }
      }

      const accountSessionKey = (
        accountRecord?.metadata as Record<string, unknown>
      )?.sessionKey as string | undefined;
      const accountCredentials = loadIntegrationCredentials<{
        sessionKey?: string;
      }>(accountRecord);
      const sk = accountSessionKey ?? accountCredentials?.sessionKey;

      if (!reusedSocket) {
        console.log(
          `[Bot ${bot.id}] No reusable WhatsApp socket found for accountId=${accountId}, skipping`,
        );
        await deleteInsightsSession(botId);
        return { payload: [], originalMsgCount: 0, locked: false };
      }

      let adapter: InstanceType<typeof WhatsAppAdapter>;
      let socketWasReused = false;

      adapter = new WhatsAppAdapter({ botId: accountId, sessionKey: sk });
      adapter.attachToSocket(reusedSocket);
      socketWasReused = true;

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const dialogs = await adapter.getDialogs();
        if (dialogs.length > 0) {
          await bulkUpsertContacts(
            dialogs.map((dialog: WhatsAppDialogInfo) => ({
              contactId: dialog.id,
              contactName: dialog.name,
              type: dialog.type,
              userId: actualUserId,
              botId: bot.id,
              contactMeta: null,
            })),
          );
          if (DEBUG)
            console.log(
              `[Bot ${bot.id}] [whatsapp] update ${dialogs.length} whatsapp contacts`,
            );
        }

        const messageChunk = await adapter.getChatsByChunk(since, chunkSize);
        console.log(
          `[Bot ${bot.id}] found ${messageChunk.messages.length} whatsapp messages`,
        );

        const rawMessages = extractRawMessages(
          messageChunk.messages,
          "whatsapp",
          bot.id,
        );

        const enableByGroup = options?.byGroup ?? true;

        if (messageChunk.messages.length > 0) {
          if (enableByGroup) {
            console.log(`[Bot ${bot.id}] Enabling by-group processing mode`);

            const groupResult = await processMessagesByGroup(
              messageChunk.messages,
              "whatsapp",
              since,
            );

            await setInsightsSession(botId, {
              count: 1,
              msgCount: groupResult.originalMsgCount,
              status: "finished",
            });
            await deleteInsightsSession(botId);

            return {
              payload: groupResult.payload,
              originalMsgCount: groupResult.originalMsgCount,
              locked: false,
              rawMessages: groupResult.rawMessages,
              processedGroups: groupResult.processedGroups,
            };
          }

          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "insighting",
          });
          const data = await generateInsight(messageChunk.messages, "whatsapp");
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "finished",
          });
          if (messageChunk.hasMore) {
            dealMessageChunk(
              bot,
              customPrompt,
              JSON.stringify(data.insights),
              adapter,
              messageChunk,
              user,
              "whatsapp",
              since,
              chunkSize,
            );
          } else {
            await deleteInsightsSession(botId);
            return {
              payload: mapInsightPayload(
                bot,
                data.insights,
                undefined,
                validCategories,
              ),
              originalMsgCount: messageChunk.messages.length,
              locked: false,
              rawMessages,
            };
          }
        }
        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: messageChunk.messages.length,
          locked: false,
        };
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        if (!socketWasReused) {
          await adapter.kill();
        }
      }
    } else if (bot.adapter === "facebook_messenger") {
      console.log(
        `[Bot ${bot.id}] uses Facebook Messenger platform manager to get insights with the custom prompt ${customPrompt}`,
      );
      const credentials = await getBotCredentials("facebook_messenger", bot);
      if (!credentials?.pageAccessToken || !credentials.pageId) {
        throw new AppError(
          "bad_request:bot",
          "Facebook Messenger credentials are missing",
        );
      }
      const adapter = new FacebookMessengerAdapter({
        botId: bot.id,
        pageAccessToken: credentials.pageAccessToken,
        pageId: credentials.pageId,
        pageName:
          credentials.pageName ??
          bot.platformAccount?.displayName ??
          bot.platformAccount?.externalId,
      });
      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const dialogs = await adapter.getDialogs();
        if (dialogs.length > 0) {
          await bulkUpsertContacts(
            dialogs.map((dialog) => ({
              contactId: dialog.id,
              contactName: dialog.name,
              type: dialog.type,
              userId: actualUserId,
              botId: bot.id,
              contactMeta: dialog.metadata ?? null,
            })),
          );
          console.log(
            `[Bot ${bot.id}] [facebook_messenger] update ${dialogs.length} messenger contacts`,
          );
        }

        const messageChunk = await adapter.getChatsByChunk(since, chunkSize);
        console.log(
          `[Bot ${bot.id}] found ${messageChunk.messages.length} messenger messages`,
        );

        if (messageChunk.messages.length > 0) {
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "insighting",
          });
          const data = await generateInsight(
            messageChunk.messages,
            "facebook_messenger",
          );
          await setInsightsSession(botId, {
            count: 1,
            msgCount: messageChunk.messages.length,
            status: "finished",
          });
          if (messageChunk.hasMore) {
            dealMessageChunk(
              bot,
              customPrompt,
              JSON.stringify(data.insights),
              adapter,
              messageChunk,
              user,
              "facebook_messenger",
              since,
              chunkSize,
            );
          } else {
            await deleteInsightsSession(botId);
            return {
              payload: mapInsightPayload(
                bot,
                data.insights,
                undefined,
                validCategories,
              ),
              originalMsgCount: messageChunk.messages.length,
              locked: false,
            };
          }
        }
        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: messageChunk.messages.length,
          locked: false,
        };
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        await adapter.kill().catch((killError) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Facebook Messenger adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "gmail") {
      console.log(
        `[Bot ${bot.id}] uses Gmail platform manager to ingest emails without auto insights`,
      );
      const credentials = await getBotCredentials("gmail", bot);

      const isOAuthCredentials =
        credentials &&
        "refreshToken" in credentials &&
        credentials.refreshToken;

      if (isOAuthCredentials) {
        const { GmailOAuthAdapter } = await import("../integrations/gmail");
        const gmailAdapter = new GmailOAuthAdapter({
          bot,
          credentials:
            credentials as import("../integrations/gmail").GmailStoredCredentials,
          ownerUserId: actualUserId,
          ownerUserType: userType,
        });

        try {
          const historyRecords = parseInsightHistoryData(insights);
          const historicalPayloads = mapInsightPayload(
            bot,
            historyRecords,
            undefined,
            validCategories,
          );
          const allEmails = await gmailAdapter.getEmailsByTime(since);
          console.log(
            `[Bot ${bot.id}] [gmail] found ${allEmails.length} gmail emails via OAuth`,
          );

          const rawMessages = extractRawMessages(allEmails, "gmail", bot.id);

          await bulkUpsertContacts(
            allEmails.map((e) => ({
              contactId: e.from.email,
              contactName: e.from.name,
              type: "email",
              userId: actualUserId,
              botId: bot.id,
              contactMeta: null,
            })),
          );

          const accountMetadata = bot.platformAccount?.metadata as
            | { email?: string }
            | undefined
            | null;
          const accountEmail = accountMetadata?.email ?? null;

          const historicalEmailsBySender =
            extractHistoricalEmailsBySender(historicalPayloads);

          const filteredEmails = allEmails.filter(
            (e) => !shouldSkipGmailEmail(e),
          );
          console.log(
            `[Bot ${bot.id}] [gmail] filtered ${allEmails.length - filteredEmails.length} low-value emails, ${filteredEmails.length} remaining`,
          );

          const emailGroups = groupEmailsBySender(filteredEmails);
          const emailPayloads: GeneratedInsightPayload[] = [];

          for (const [senderEmail, emails] of emailGroups.entries()) {
            const historicalDetails = historicalEmailsBySender.get(senderEmail);
            const totalEmails =
              emails.length + (historicalDetails?.length ?? 0);

            if (totalEmails === 1) {
              emailPayloads.push(
                buildEmailInsightPayload({
                  email: emails[0],
                  accountEmail,
                }),
              );
            } else {
              emailPayloads.push(
                buildMergedEmailInsightPayload({
                  emails,
                  accountEmail,
                  historicalDetails,
                }),
              );
            }
          }

          const nonEmailHistoricalPayloads = historicalPayloads.filter(
            (p) => p.taskLabel !== EMAIL_TASK_LABEL,
          );

          const mergedPayloads = await mergeInsightPayloads(
            nonEmailHistoricalPayloads,
            emailPayloads,
            MAX_EMAIL_INSIGHTS,
          );

          await deleteInsightsSession(botId);
          return {
            payload: mergedPayloads,
            originalMsgCount: mergedPayloads.length,
            locked: false,
            rawMessages,
          };
        } catch (error) {
          console.error(
            `[Bot ${bot.id}] [gmail] failed to build email insights with OAuth:`,
            error,
          );
          throw error;
        } finally {
          await deleteInsightsSession(botId);
        }
      } else {
        console.log(
          `[Bot ${bot.id}] using Email Adapter (App Password) for insights`,
        );
        const adapter = new EmailAdapter({
          botId: bot.id,
          emailAddress: credentials.email,
          appPassword: credentials.appPassword,
          ownerUserId: actualUserId,
          ownerUserType: userType,
        });

        try {
          const historyRecords = parseInsightHistoryData(insights);
          const historicalPayloads = mapInsightPayload(
            bot,
            historyRecords,
            undefined,
            validCategories,
          );
          const allEmails = await adapter.getEmailsByTime(
            new Date(since * 1000),
          );
          console.log(
            `[Bot ${bot.id}] [gmail] found ${allEmails.length} gmail emails`,
          );

          const rawMessages = extractRawMessages(allEmails, "gmail", bot.id);

          await bulkUpsertContacts(
            allEmails.map((e) => ({
              contactId: e.from.email,
              contactName: e.from.name,
              type: "email",
              userId: actualUserId,
              botId: bot.id,
              contactMeta: null,
            })),
          );

          const accountMetadata = bot.platformAccount?.metadata as
            | { email?: string }
            | undefined
            | null;
          const accountEmail =
            accountMetadata?.email ?? credentials.email ?? null;

          const historicalEmailsBySender =
            extractHistoricalEmailsBySender(historicalPayloads);

          const filteredEmails = allEmails.filter(
            (e) => !shouldSkipGmailEmail(e),
          );
          console.log(
            `[Bot ${bot.id}] [gmail] filtered ${allEmails.length - filteredEmails.length} low-value emails, ${filteredEmails.length} remaining`,
          );

          const emailGroups = groupEmailsBySender(filteredEmails);
          const emailPayloads: GeneratedInsightPayload[] = [];

          for (const [senderEmail, emails] of emailGroups.entries()) {
            const historicalDetails = historicalEmailsBySender.get(senderEmail);
            const totalEmails =
              emails.length + (historicalDetails?.length ?? 0);

            if (totalEmails === 1) {
              emailPayloads.push(
                buildEmailInsightPayload({
                  email: emails[0],
                  accountEmail,
                }),
              );
            } else {
              emailPayloads.push(
                buildMergedEmailInsightPayload({
                  emails,
                  accountEmail,
                  historicalDetails,
                }),
              );
            }
          }

          const nonEmailHistoricalPayloads = historicalPayloads.filter(
            (p) => p.taskLabel !== EMAIL_TASK_LABEL,
          );

          const mergedPayloads = await mergeInsightPayloads(
            nonEmailHistoricalPayloads,
            emailPayloads,
            MAX_EMAIL_INSIGHTS,
          );
          await deleteInsightsSession(botId);
          return {
            payload: mergedPayloads,
            originalMsgCount: mergedPayloads.length,
            locked: false,
            rawMessages,
          };
        } catch (error) {
          console.error(
            `[Bot ${bot.id}] [gmail] failed to build email insights:`,
            error,
          );
          throw error;
        } finally {
          await deleteInsightsSession(botId);
          await adapter.client.logout();
        }
      }
    } else if (bot.adapter === "outlook") {
      console.log(
        `[Bot ${bot.id}] uses Outlook platform manager to ingest emails without auto insights`,
      );
      const credentials = (await getBotCredentials("outlook", bot)) as {
        email?: string;
        appPassword?: string;
        imapHost?: string;
        imapPort?: number;
        smtpHost?: string;
        smtpPort?: number;
      };
      const adapter = new EmailAdapter({
        botId: bot.id,
        emailAddress: credentials.email,
        appPassword: credentials.appPassword,
        ownerUserId: actualUserId,
        ownerUserType: userType,
        imap: {
          host: credentials.imapHost ?? "outlook.office365.com",
          port: credentials.imapPort ?? 993,
          secure: true,
        },
        smtp: {
          host: credentials.smtpHost ?? "smtp.office365.com",
          port: credentials.smtpPort ?? 587,
          secure: false,
        },
      });

      try {
        const historyRecords = parseInsightHistoryData(insights);
        const historicalPayloads = mapInsightPayload(bot, historyRecords);
        const allEmails = await adapter.getEmailsByTime(new Date(since * 1000));
        console.log(
          `[Bot ${bot.id}] [outlook] found ${allEmails.length} outlook emails`,
        );

        const rawMessages = extractRawMessages(allEmails, "outlook", bot.id);

        await bulkUpsertContacts(
          allEmails.map((e) => ({
            contactId: e.from.email,
            contactName: e.from.name,
            type: "email",
            userId: actualUserId,
            botId: bot.id,
            contactMeta: null,
          })),
        );

        const accountMetadata = bot.platformAccount?.metadata as
          | { email?: string }
          | undefined
          | null;
        const accountEmail =
          accountMetadata?.email ?? credentials.email ?? null;

        const historicalEmailsBySender =
          extractHistoricalEmailsBySender(historicalPayloads);

        const emailGroups = groupEmailsBySender(allEmails);
        const emailPayloads: GeneratedInsightPayload[] = [];

        for (const [senderEmail, emails] of emailGroups.entries()) {
          const historicalDetails = historicalEmailsBySender.get(senderEmail);
          const totalEmails = emails.length + (historicalDetails?.length ?? 0);

          if (totalEmails === 1) {
            emailPayloads.push(
              buildEmailInsightPayload({
                email: emails[0],
                accountEmail,
              }),
            );
          } else {
            emailPayloads.push(
              buildMergedEmailInsightPayload({
                emails,
                accountEmail,
                historicalDetails,
              }),
            );
          }
        }

        const nonEmailHistoricalPayloads = historicalPayloads.filter(
          (p) => p.taskLabel !== EMAIL_TASK_LABEL,
        );

        const mergedPayloads = await mergeInsightPayloads(
          nonEmailHistoricalPayloads,
          emailPayloads,
          MAX_EMAIL_INSIGHTS,
        );
        await deleteInsightsSession(botId);
        return {
          payload: mergedPayloads,
          originalMsgCount: mergedPayloads.length,
          locked: false,
          rawMessages,
        };
      } catch (error) {
        console.error(
          `[Bot ${bot.id}] [outlook] failed to build email insights:`,
          error,
        );
        throw error;
      } finally {
        await deleteInsightsSession(botId);
        await adapter.client.logout();
      }
    } else if (bot.adapter === "hubspot") {
      const credentials = (await getBotCredentials("hubspot", bot)) as
        | {
            accessToken: string;
            refreshToken?: string | null;
            expiresAt?: number | null;
            tokenType?: string | null;
            scope?: string | null;
            hubId?: number | null;
            hubDomain?: string | null;
            userEmail?: string | null;
            userId?: string | null;
          }
        | undefined;

      if (!credentials?.accessToken) {
        throw new AppError(
          "unauthorized:api",
          "HubSpot access token missing. Please reconnect HubSpot.",
        );
      }

      const accountMetadata = (bot.platformAccount?.metadata ?? {}) as {
        hubId?: number | string | null;
        hubDomain?: string | null;
        userEmail?: string | null;
      };

      const client = new HubspotClient({
        credentials: {
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken ?? null,
          expiresAt: credentials.expiresAt ?? null,
          tokenType: credentials.tokenType ?? null,
          scope: credentials.scope ?? null,
          hubId:
            normalizeHubId(credentials.hubId) ??
            normalizeHubId(accountMetadata.hubId),
          hubDomain: credentials.hubDomain ?? accountMetadata.hubDomain ?? null,
          userEmail: credentials.userEmail ?? accountMetadata.userEmail ?? null,
          userId: credentials.userId ?? null,
        },
        userId: actualUserId,
        platformAccountId: bot.platformAccount?.id ?? null,
        onPersistCredentials: async ({ credentials, metadata }) => {
          if (!bot.platformAccount?.id) return;
          await updateIntegrationAccount({
            userId: actualUserId,
            platformAccountId: bot.platformAccount.id,
            credentials,
            metadata,
          });
        },
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const deals = await client.fetchRecentDeals({
          sinceMs: since * 1000,
          maxPages: 3,
        });
        const stageLookup = await client.getStageLookup();
        const portalId = client.portalId;
        const accountLabel =
          accountMetadata.hubDomain ??
          (portalId ? `Portal ${portalId}` : null) ??
          accountMetadata.userEmail ??
          null;
        const payloads: GeneratedInsightPayload[] = deals.map((deal) =>
          buildHubspotInsightPayload(
            deal as HubspotDeal,
            stageLookup,
            portalId,
            accountLabel,
          ),
        );
        await deleteInsightsSession(botId);
        return {
          payload: payloads,
          originalMsgCount: deals.length,
          locked: false,
        };
      } catch (error) {
        await deleteInsightsSession(botId);
        throw error;
      }
    } else if (bot.adapter === "google_calendar") {
      console.log(
        `[Bot ${bot.id}] uses Google Calendar manager to ingest events`,
      );
      const credentials = (await getBotCredentials("google_calendar", bot)) as {
        accessToken?: string | null;
        refreshToken?: string | null;
        scope?: string | null;
        tokenType?: string | null;
        expiryDate?: number | null;
        calendarIds?: string[] | null;
        timeZone?: string | null;
      };

      if (!credentials?.refreshToken) {
        throw new AppError(
          "bad_request:bot",
          "Google Calendar is missing a refresh token. Please reconnect.",
        );
      }

      const accountMetadata = (bot.platformAccount?.metadata ?? {}) as {
        calendarIds?: string[];
        feedEnabled?: boolean;
        timeZone?: string | null;
        email?: string | null;
      };
      const feedEnabled = accountMetadata.feedEnabled ?? true;
      if (!feedEnabled) {
        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: 0,
          locked: false,
        };
      }

      const adapter = new GoogleCalendarAdapter({
        bot,
        credentials: {
          accessToken: credentials.accessToken ?? null,
          refreshToken: credentials.refreshToken ?? null,
          scope: credentials.scope ?? null,
          tokenType: credentials.tokenType ?? null,
          expiryDate: credentials.expiryDate ?? null,
        },
        calendarIds: credentials.calendarIds ??
          accountMetadata.calendarIds ?? ["primary"],
        timeZone: accountMetadata.timeZone ?? credentials.timeZone ?? null,
      });

      try {
        const sinceDate = new Date(since * 1000);
        const upcomingWindow = new Date(
          Date.now() + CALENDAR_UPCOMING_WINDOW_MS,
        );
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        const events = await adapter.listEventsByTime({
          since: sinceDate,
          until: upcomingWindow,
          maxResults: 200,
        });
        const nowMs = Date.now();

        const payloads: GeneratedInsightPayload[] = [];
        for (const event of events) {
          const startMs = event.start.dateTime.getTime();
          const updatedMs = event.updated?.getTime() ?? startMs;
          const organizer =
            event.organizer?.displayName ??
            event.organizer?.email ??
            accountMetadata.email ??
            "Organizer";
          const attendeeNames = event.attendees
            .map((attendee) => attendee.displayName ?? attendee.email ?? "")
            .filter(Boolean);
          const attendeeLine =
            attendeeNames.length > 0
              ? `Attendees: ${attendeeNames.slice(0, 6).join(", ")}`
              : null;
          const timeZone = event.start.timeZone ?? accountMetadata.timeZone;
          const startText = new Date(startMs).toLocaleString("en-US", {
            timeZone: timeZone ?? undefined,
          });
          const locationText =
            event.location ??
            event.conferenceLink ??
            event.link ??
            "No location provided";

          const baseInsight: Pick<
            GeneratedInsightPayload,
            | "taskLabel"
            | "platform"
            | "account"
            | "groups"
            | "people"
            | "sources"
            | "details"
          > = {
            taskLabel: CALENDAR_TASK_LABEL,
            platform: "google_calendar",
            account: accountMetadata.email ?? null,
            groups: ["calendar"],
            people:
              attendeeNames.length > 0 ? attendeeNames.slice(0, 6) : undefined,
            sources: event.link
              ? [
                  {
                    platform: "google_calendar",
                    snippet: event.summary ?? "Calendar event",
                    link: event.link,
                  },
                ]
              : null,
            details: [
              {
                time: Math.floor(startMs / 1000),
                person: organizer,
                platform: "google_calendar",
                channel: locationText,
                content: [
                  event.summary ?? "New calendar event",
                  `When: ${startText}`,
                  locationText ? `Where: ${locationText}` : null,
                  attendeeLine,
                ]
                  .filter(Boolean)
                  .join(" · "),
              },
            ],
          };

          if (updatedMs >= since * 1000) {
            payloads.push({
              ...baseInsight,
              dedupeKey: `gcal:${event.calendarId}:${event.id}:scheduled`,
              title: event.summary ?? "New event scheduled",
              description: `Scheduled for ${startText}${locationText ? ` · ${locationText}` : ""}`,
              importance: "medium",
              urgency: "medium",
              time: updatedMs,
              nextActions: [
                {
                  action: "Add attendees",
                  reason: "Invite missing participants",
                },
                {
                  action: "Share agenda or materials",
                  reason: "Send prep notes before the meeting",
                },
              ],
            });
          }

          if (startMs >= nowMs && startMs <= upcomingWindow.getTime()) {
            payloads.push({
              ...baseInsight,
              dedupeKey: `gcal:${event.calendarId}:${event.id}:upcoming:${startMs}`,
              title: `Upcoming: ${event.summary ?? "Meeting"}`,
              description: `Starts at ${startText}${locationText ? ` · ${locationText}` : ""}`,
              importance: "high",
              urgency:
                startMs - nowMs <= 2 * 60 * 60 * 1000 ? "high" : "medium",
              time: startMs,
              nextActions: [
                {
                  action: "Reschedule",
                  reason: "Suggest a better time if this slot conflicts",
                },
                {
                  action: "Add attendees",
                  reason: "Loop in teammates or stakeholders",
                },
                {
                  action: "Cancel / decline",
                  reason: "Free up time if this is no longer needed",
                },
              ],
            });
          }
        }

        await deleteInsightsSession(botId);
        return {
          payload: payloads.slice(0, 200),
          originalMsgCount: payloads.length,
          locked: false,
        };
      } catch (error) {
        console.error(
          `[Bot ${bot.id}] [google_calendar] failed to build calendar insights:`,
          error,
        );
        throw error;
      }
    } else if (bot.adapter === "google_docs") {
      console.log(`[Bot ${bot.id}] uses Google Docs to track changes`);
      const credentials = (await getBotCredentials("google_docs", bot)) as
        | {
            accessToken?: string | null;
            refreshToken?: string | null;
            scope?: string | null;
            tokenType?: string | null;
            expiryDate?: number | null;
          }
        | undefined;

      if (!credentials?.refreshToken) {
        throw new AppError(
          "bad_request:bot",
          "Google Docs is missing a refresh token. Please reconnect.",
        );
      }

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        const docs = await listRecentDocuments({
          userId: actualUserId,
          sinceMs: since * 1000,
          limit: 50,
        });

        const accountEmail =
          (bot.platformAccount?.metadata as { email?: string | null })?.email ??
          null;

        const payloads = docs.map((doc) =>
          buildGoogleDocInsight(doc as GoogleDocSummary, accountEmail),
        );

        await deleteInsightsSession(botId);
        return {
          payload: payloads.slice(0, 100),
          originalMsgCount: docs.length,
          locked: false,
        };
      } catch (error) {
        await deleteInsightsSession(botId);
        throw error;
      }
    } else if (bot.adapter === "outlook_calendar") {
      console.log(
        `[Bot ${bot.id}] uses Outlook Calendar manager to ingest events`,
      );
      const credentials = (await getBotCredentials("outlook_calendar", bot)) as
        | {
            accessToken?: string | null;
            refreshToken?: string | null;
            scope?: string | null;
            tokenType?: string | null;
            expiresAt?: number | null;
          }
        | undefined;

      if (!credentials?.refreshToken) {
        throw new AppError(
          "bad_request:bot",
          "Outlook Calendar is missing a refresh token. Please reconnect.",
        );
      }

      const accountMetadata = (bot.platformAccount?.metadata ?? {}) as {
        email?: string | null;
      };
      const adapter = new OutlookCalendarAdapter({
        bot,
        credentials: {
          accessToken: credentials.accessToken ?? null,
          refreshToken: credentials.refreshToken ?? null,
          scope: credentials.scope ?? null,
          tokenType: credentials.tokenType ?? null,
          expiresAt: credentials.expiresAt ?? null,
        },
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        const sinceDate = new Date(since * 1000);
        const events = await adapter.listEvents({
          since: sinceDate,
          until: new Date(Date.now() + CALENDAR_UPCOMING_WINDOW_MS),
          maxResults: 200,
        });

        const payloads = events.map((event) =>
          buildOutlookCalendarInsight(
            event as OutlookCalendarEvent,
            accountMetadata.email ?? null,
          ),
        );

        await deleteInsightsSession(botId);
        return {
          payload: payloads.slice(0, 200),
          originalMsgCount: events.length,
          locked: false,
        };
      } catch (error) {
        await deleteInsightsSession(botId);
        throw error;
      }
    } else if (bot.adapter === "linkedin") {
      console.log(
        `[Bot ${bot.id}] uses LinkedIn manager to ingest conversations`,
      );
      const credentials = (await getBotCredentials("linkedin", bot)) as {
        accessToken?: string | null;
        refreshToken?: string | null;
        expiresAt?: number | null;
      };
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new AppError(
          "bad_request:bot",
          "LinkedIn integration is not configured.",
        );
      }

      const adapter = new LinkedInAdapter({
        botId: bot.id,
        credentials,
        clientId,
        clientSecret,
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const messages = await adapter.getMessagesByTime(since, "linkedin");
        console.log(
          `[Bot ${bot.id}] found ${messages.length} linkedin messages`,
        );

        const rawMessages = extractRawMessages(messages, "linkedin", bot.id);

        if (messages.length === 0) {
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
          };
        }

        const data = await generateInsight(messages, "linkedin");
        await deleteInsightsSession(botId);
        return {
          payload: mapInsightPayload(
            bot,
            data.insights,
            undefined,
            validCategories,
          ),
          originalMsgCount: messages.length,
          locked: false,
          rawMessages,
        };
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        await deleteInsightsSession(botId);
      }
    } else if (bot.adapter === "instagram") {
      console.log(
        `[Bot ${bot.id}] uses Instagram manager to ingest conversations`,
      );
      const credentials = (await getBotCredentials("instagram", bot)) as {
        accessToken: string;
        pageId: string;
        igBusinessId: string;
        username?: string | null;
        pageName?: string | null;
        expiresAt?: number | null;
      };

      if (!credentials.accessToken || !credentials.igBusinessId) {
        throw new AppError(
          "bad_request:bot",
          "Instagram credentials are missing. Please reconnect.",
        );
      }

      const adapter = new InstagramAdapter({
        botId: bot.id,
        accessToken: credentials.accessToken,
        igBusinessId: credentials.igBusinessId,
        pageId: credentials.pageId,
        username: credentials.username ?? credentials.pageName,
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });
        const messages = await adapter.getMessagesByTime(since);
        console.log(
          `[Bot ${bot.id}] found ${messages.length} instagram messages`,
        );

        const rawMessages = extractRawMessages(messages, "instagram", bot.id);

        if (messages.length === 0) {
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
          };
        }

        const data = await generateInsight(messages, "instagram");
        await deleteInsightsSession(botId);
        return {
          payload: mapInsightPayload(
            bot,
            data.insights,
            undefined,
            validCategories,
          ),
          originalMsgCount: messages.length,
          locked: false,
          rawMessages,
        };
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        await deleteInsightsSession(botId);
      }
    } else if (bot.adapter === "twitter") {
      console.log(`[Bot ${bot.id}] X manager disabled, skipping DM ingestion`);
      return {
        payload: [],
        originalMsgCount: 0,
        locked: false,
      };
    } else if (bot.adapter === "rss") {
      const subscriptions = await getRssSubscriptionsByUser({
        userId: actualUserId,
      });
      console.log(
        `[Bot ${bot.id}] RSS insights subscriptions ${subscriptions.length}`,
      );
      let resultCount = 0;
      const rawMessages: any[] = [];

      for (const subscription of subscriptions) {
        try {
          const feedResult = await fetchFeed(subscription);
          if (feedResult.skipped) {
            await updateRssSubscription({
              userId: subscription.userId,
              subscriptionId: subscription.id,
              lastFetchedAt: new Date(),
              etag: feedResult.etag ?? undefined,
              lastModified: feedResult.lastModified ?? undefined,
              lastErrorCode: null,
              lastErrorMessage: null,
            });
            continue;
          }

          const inserts = buildRssItemInserts({
            subscription,
            items: feedResult.items,
            feedTitle: feedResult.feedTitle,
          });

          const insertResults = await insertRssItems(
            inserts as InsertRssItem[],
          );
          resultCount += insertResults.length;
          if (insertResults.length > 0) {
            const botId = await getCachedRssBotId(subscription.userId);
            const insertContext = new Map(
              inserts.map((item) => [item.guidHash, item]),
            );
            const contexts = insertResults
              .map((row) => {
                const data = insertContext.get(row.guidHash);
                if (!data) return null;
                return { id: row.id, data };
              })
              .filter(
                (context): context is { id: string; data: InsertRssItem } =>
                  Boolean(context),
              );

            if (contexts.length > 0) {
              const insightEntries = contexts.map(({ data }) =>
                buildInsightRecord({
                  botId,
                  subscription,
                  item: data,
                }),
              );

              const insightIds = await insertInsightRecords(insightEntries);

              const processedPayload = contexts.map((context, index) => ({
                id: context.id,
                metadata: {
                  ...((context.data.metadata as Record<string, unknown>) ?? {}),
                  insightId: insightIds[index],
                },
              }));
              await markRssItemsProcessed(processedPayload);

              const { extractRawMessages: extractRawMessagesLocal } =
                await import("@openloomi/indexeddb/extractor");
              const extractedMessages = extractRawMessagesLocal(
                feedResult.items,
                "rss",
                bot.id,
                feedResult.feedTitle || undefined,
              );
              rawMessages.push(...extractedMessages);
            }
          }

          await updateRssSubscription({
            userId: subscription.userId,
            subscriptionId: subscription.id,
            lastFetchedAt: new Date(),
            etag: feedResult.etag ?? undefined,
            lastModified: feedResult.lastModified ?? undefined,
            title:
              !subscription.title && feedResult.feedTitle
                ? feedResult.feedTitle
                : undefined,
            lastErrorCode: null,
            lastErrorMessage: null,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const isAbort = error instanceof Error && error.name === "AbortError";
          const statusMatch = errMsg.match(/status (\d+)/i);
          const lastErrorCode = isAbort
            ? "timeout"
            : statusMatch
              ? statusMatch[1]
              : "error";
          await updateRssSubscription({
            userId: subscription.userId,
            subscriptionId: subscription.id,
            lastFetchedAt: new Date(),
            lastErrorCode,
            lastErrorMessage: errMsg,
          }).catch(() => undefined);
          console.error(
            `RSS fetch error for ${subscription.sourceUrl}: ${errMsg}`,
          );
          continue;
        }
      }
      await deleteInsightsSession(botId);
      return {
        payload: [],
        originalMsgCount: resultCount,
        locked: false,
        rawMessages,
      };
    } else if (bot.adapter === "imessage") {
      console.log(
        `[Bot ${bot.id}] uses iMessage platform manager to get insights with the custom prompt ${customPrompt}`,
      );

      const adapter = new IMessageAdapter({
        botId: bot.id,
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        const dialogs = await adapter.getDialogs();
        if (dialogs.length > 0) {
          await bulkUpsertContacts(
            dialogs.map((dialog) => {
              const parsed = parseIMessageChatId(dialog.id);
              return {
                contactId: dialog.id,
                contactName: dialog.name,
                type: dialog.type,
                userId: actualUserId,
                botId: bot.id,
                contactMeta: {
                  platform: "imessage",
                  displayName: dialog.name,
                  phoneNumber: parsed.phoneNumber,
                  email: parsed.email,
                  chatId: dialog.id,
                },
              };
            }),
          );
        }

        const chunkResult = await adapter.getChatsByChunk(since, chunkSize);
        const { messages } = chunkResult;

        const { mergeIMessageMessagesBySender } = await import("./grouping");
        const mergedMessages = mergeIMessageMessagesBySender(messages);

        const rawMessages = extractRawMessages(
          mergedMessages,
          "imessage",
          bot.id,
        );

        const enableByGroup = options?.byGroup ?? true;

        if (mergedMessages.length > 0) {
          if (enableByGroup) {
            console.log(`[Bot ${bot.id}] Enabling by-group processing mode`);

            const groupResult = await processMessagesByGroup(
              mergedMessages,
              "imessage",
              since,
            );

            await deleteInsightsSession(botId);
            return {
              payload: groupResult.payload,
              originalMsgCount: messages.length,
              locked: false,
              rawMessages,
              processedGroups: groupResult.processedGroups,
            };
          }

          const data = await generateInsight(messages, "imessage");
          await deleteInsightsSession(botId);
          return {
            payload: mapInsightPayload(
              bot,
              data.insights,
              undefined,
              validCategories,
            ),
            originalMsgCount: messages.length,
            locked: false,
            rawMessages,
          };
        }

        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: 0,
          locked: false,
          rawMessages: [],
        };
      } catch (error) {
        console.error(
          `[Bot ${bot.id}] [imessage] Failed to fetch messages:`,
          error,
        );
        throw error;
      } finally {
        await adapter.kill();
        await deleteInsightsSession(botId);
      }
    } else if (bot.adapter === "feishu") {
      if (disableFeishuInsightsFetch) {
        console.warn(
          `[Bot ${bot.id}] Skipping Feishu/Lark insights fetch because DISABLE_FEISHU_INSIGHTS_FETCH=true`,
        );
        await deleteInsightsSession(botId);
        return {
          payload: [],
          originalMsgCount: 0,
          locked: false,
          rawMessages: [],
        };
      }
      console.log(
        `[Bot ${bot.id}] uses Feishu platform manager to ingest messages for insights`,
      );

      const credentials = await getBotCredentials("feishu", bot);
      const adapter = new FeishuAdapter({
        botId: bot.id,
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        domain: credentials.domain,
      });

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        let chatsForAdapter = (await adapter.listChatsForInsights()).map(
          (chat) => ({
            chatId: chat.chatId,
            chatName: chat.chatName,
            chatType: chat.chatType,
          }),
        );

        if (chatsForAdapter.length === 0) {
          const allContacts = normalizeContactMetaList(
            await getUserContacts(actualUserId),
          );
          const feishuChats = allContacts.filter((c) => {
            const meta = c.contactMeta as
              | {
                  platform?: string;
                  chatId?: string;
                  chatType?: string;
                }
              | null
              | undefined;
            return (
              c.botId === bot.id &&
              typeof c.contactId === "string" &&
              meta?.platform === "feishu"
            );
          });

          chatsForAdapter = feishuChats.map((c) => {
            const meta = c.contactMeta as
              | {
                  chatType?: string;
                }
              | null
              | undefined;
            const chatTypeRaw = meta?.chatType ?? c.type ?? "unknown";
            const chatType =
              chatTypeRaw === "group"
                ? "group"
                : chatTypeRaw === "p2p"
                  ? "p2p"
                  : "unknown";
            return {
              chatId: c.contactId,
              chatName: c.contactName,
              chatType,
            };
          });
        }

        const nameLimiter = pLimit(5);
        await Promise.all(
          chatsForAdapter.map((chat) =>
            nameLimiter(async () => {
              const resolvedName =
                !chat.chatName || chat.chatName === chat.chatId
                  ? await adapter.getChatNameById(chat.chatId)
                  : null;
              const contactName = (resolvedName ?? chat.chatName ?? chat.chatId)
                .trim()
                .slice(0, 256);

              console.log(
                "[Contacts][Feishu] upsert contact",
                JSON.stringify(
                  {
                    userId: actualUserId,
                    botId: bot.id,
                    contactId: chat.chatId,
                    contactName,
                    chatType: chat.chatType,
                  },
                  null,
                  0,
                ),
              );

              await upsertContact({
                userId: actualUserId,
                contactId: chat.chatId,
                contactName,
                type: chat.chatType,
                botId: bot.id,
                contactMeta: {
                  platform: "feishu",
                  chatId: chat.chatId,
                  chatType: chat.chatType,
                  chatName: contactName,
                },
              });
            }),
          ),
        );

        if (chatsForAdapter.length === 0) {
          console.log(
            `[Bot ${bot.id}] No Feishu chats found from API or contacts, skipping insights refresh`,
          );
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
            rawMessages: [],
          };
        }

        const messages = await adapter.getMessagesByChats({
          chats: chatsForAdapter,
          since,
          maxMessagesPerChat: chunkSize ?? 40,
        });

        console.log(`[Bot ${bot.id}] found ${messages.length} feishu messages`);

        const rawMessages = extractRawMessages(messages, "feishu", bot.id);

        if (messages.length === 0) {
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
            rawMessages,
          };
        }

        await setInsightsSession(botId, {
          count: 1,
          msgCount: messages.length,
          status: "insighting",
        });

        const data = await generateInsight(messages, "feishu");

        await setInsightsSession(botId, {
          count: 1,
          msgCount: messages.length,
          status: "finished",
        });

        await deleteInsightsSession(botId);
        return {
          payload: mapInsightPayload(
            bot,
            data.insights,
            undefined,
            validCategories,
          ),
          originalMsgCount: messages.length,
          locked: false,
          rawMessages,
        };
      } catch (error) {
        console.error(
          `[Bot ${bot.id}] [feishu] Failed to fetch messages:`,
          error,
        );
        throw error;
      } finally {
        await adapter.kill();
      }
    } else if (bot.adapter === "dingtalk") {
      console.log(
        `[Bot ${bot.id}] uses DingTalk cached inbound messages for insights`,
      );

      try {
        await setInsightsSession(botId, {
          count: 1,
          msgCount: 0,
          status: "fetching",
        });

        const maxPerChat = chunkSize ?? 40;

        const allContacts = normalizeContactMetaList(
          await getUserContacts(actualUserId),
        );
        const dingContacts = allContacts.filter((c) => {
          const meta = c.contactMeta as
            | {
                platform?: string;
                chatId?: string;
                chatType?: string;
              }
            | null
            | undefined;
          return (
            c.botId === bot.id &&
            typeof c.contactId === "string" &&
            meta?.platform === "dingtalk"
          );
        });

        const chatMap = new Map<
          string,
          { chatName: string; chatType: "p2p" | "group" | "unknown" }
        >();

        for (const c of dingContacts) {
          const meta = c.contactMeta as
            | { chatType?: string }
            | null
            | undefined;
          const rawType =
            meta?.chatType ?? (c.type === "group" ? "group" : "private");
          const chatType: "p2p" | "group" | "unknown" =
            rawType === "group" ? "group" : "p2p";
          chatMap.set(c.contactId, {
            chatName: (c.contactName || c.contactId).trim().slice(0, 256),
            chatType,
          });
        }

        const fromStore = await listDingTalkInsightChatIdsForBot({
          userId: actualUserId,
          botId: bot.id,
        });
        for (const cid of fromStore) {
          if (chatMap.has(cid)) continue;
          const isGroup = cid.startsWith("group:");
          chatMap.set(cid, {
            chatName: cid.slice(0, 256),
            chatType: isGroup ? "group" : "p2p",
          });
        }

        const chatsForAdapter = [...chatMap.entries()].map(([chatId, v]) => ({
          chatId,
          chatName: v.chatName,
          chatType: v.chatType,
        }));

        const contactLimiter = pLimit(5);
        await Promise.all(
          chatsForAdapter.map((chat) =>
            contactLimiter(async () => {
              await upsertContact({
                userId: actualUserId,
                contactId: chat.chatId,
                contactName: chat.chatName,
                type: chat.chatType === "group" ? "group" : "p2p",
                botId: bot.id,
                contactMeta: {
                  platform: "dingtalk",
                  chatId: chat.chatId,
                  chatType: chat.chatType,
                  chatName: chat.chatName,
                },
              });
            }),
          ),
        );

        if (chatsForAdapter.length === 0) {
          console.log(
            `[Bot ${bot.id}] No DingTalk chats in contacts or cache, skipping insights refresh`,
          );
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
            rawMessages: [],
          };
        }

        const stored = await listDingTalkInsightMessagesForInsights({
          userId: actualUserId,
          botId: bot.id,
          chatIds: chatsForAdapter.map((c) => c.chatId),
          sinceSec: since,
          maxPerChat,
        });

        const nameByChatId = new Map(
          chatsForAdapter.map((c) => [c.chatId, c.chatName]),
        );

        const messages: ExtractedMessageInfo[] = stored.map((row) => ({
          id: row.msgId,
          chatType: row.chatId.startsWith("group:") ? "group" : "private",
          chatName: nameByChatId.get(row.chatId) ?? row.chatId,
          sender: row.senderName?.trim() || row.senderId || "unknown",
          text: row.text,
          timestamp: row.tsSec,
        }));

        console.log(
          `[Bot ${bot.id}] found ${messages.length} dingtalk cached messages`,
        );

        const rawMessages = extractRawMessages(messages, "dingtalk", bot.id);

        if (messages.length === 0) {
          await deleteInsightsSession(botId);
          return {
            payload: [],
            originalMsgCount: 0,
            locked: false,
            rawMessages,
          };
        }

        await setInsightsSession(botId, {
          count: 1,
          msgCount: messages.length,
          status: "insighting",
        });

        const data = await generateInsight(messages, "dingtalk");

        await setInsightsSession(botId, {
          count: 1,
          msgCount: messages.length,
          status: "finished",
        });

        await deleteInsightsSession(botId);
        return {
          payload: mapInsightPayload(
            bot,
            data.insights,
            undefined,
            validCategories,
          ),
          originalMsgCount: messages.length,
          locked: false,
          rawMessages,
        };
      } catch (error) {
        console.error(
          `[Bot ${bot.id}] [dingtalk] Failed to fetch messages:`,
          error,
        );
        throw error;
      }
    } else if (bot.adapter === "qqbot") {
      await deleteInsightsSession(botId);
      return {
        payload: [],
        originalMsgCount: 0,
        locked: false,
        rawMessages: [],
      };
    } else if (bot.adapter === "weixin") {
      await deleteInsightsSession(botId);
      return {
        payload: [],
        originalMsgCount: 0,
        locked: false,
        rawMessages: [],
      };
    } else {
      throw new AppError(
        "bad_request:insight",
        `Failed to get insights by the bot id with the unknown adapter ${bot.adapter}`,
      );
    }
  } catch (error) {
    console.error(`[Bot ${bot.id}] Failed to generate summary:`, error);
    await deleteInsightsSession(botId);
    throw error;
  }
}

export async function dealMessageChunk(
  bot: BotWithAccount,
  customPrompt: string,
  inputInsights: string,
  adapter: DisconnectableAdapter,
  messageChunk: {
    messages: unknown[];
    hasMore: boolean;
  },
  user: SummaryUserContext,
  platform: Platform,
  since: number,
  chunkSize?: number,
) {
  if (!messageChunk.hasMore) {
    return;
  }
  let chunk = messageChunk;
  let loopCounter = 1;
  let insights = inputInsights;
  let oldInsightIds: string[] = [];
  let newInsightIds: string[] = [];

  const userId = user.id;
  const userType = user.type;
  const botId = bot.id;

  try {
    while (chunk.hasMore) {
      loopCounter += 1;
      if (loopCounter >= maxChunkSummaryCount) {
        break;
      }

      const s = await getInsightsSession(botId);
      await setInsightsSession(botId, {
        count: loopCounter,
        msgCount: s?.msgCount ?? 0,
        status: "fetching",
      });

      chunk = await adapter.getChatsByChunk(since, chunkSize);
      const messages = chunk.messages;
      if (messages.length > 0) {
        await setInsightsSession(botId, {
          count: loopCounter,
          msgCount: (s?.msgCount ?? 0) + messages.length,
          status: "insighting",
        });
        const messageArray = normalizeMessagesInput(messages);
        const basePrompt = `These messages are from ${platform}`;
        const combinedCustomPrompt = customPrompt
          ? `${basePrompt}. ${customPrompt}`
          : basePrompt;

        const userCategories = await getUserCategories(userId);
        const activeCategories = userCategories.filter((cat) => cat.isActive);
        const categoriesPrompt = buildCategoriesPrompt(
          activeCategories.map((cat) => ({
            name: cat.name,
            description: cat.description,
          })),
        );

        const combinedSystemOverlay = [categoriesPrompt]
          .filter(Boolean)
          .join("\n\n");

        setAIUserContext({
          id: userId,
          email: user.email || "",
          name: user.name || null,
          type: userType,
          token: user.token,
        });

        const {
          insights: data,
          inputTokens,
          outputTokens,
        } = await generateProjectInsights(
          userId,
          JSON.stringify(messageArray),
          insights,
          platform,
          {
            customPrompt: combinedCustomPrompt,
            systemOverlay: combinedSystemOverlay || undefined,
          },
        );

        await setInsightsSession(botId, {
          count: loopCounter,
          msgCount: (s?.msgCount ?? 0) + messages.length,
          status: "finished",
        });

        const mappedSummaries = mapInsightPayload(bot, data.insights);

        newInsightIds = await upsertInsightsByBotId({
          id: botId,
          insights: mappedSummaries,
        });

        oldInsightIds = newInsightIds;
        insights = JSON.stringify(mappedSummaries);
      } else {
        break;
      }
    }
    await deleteInsightsSession(botId);
    console.log(`[Bot ${botId}] Multi-round Insights completed`);
  } catch (error) {
    console.error(`[Bot ${botId}] Loop summary generation failed:`, error);
  } finally {
    await deleteInsightsSession(botId);
    clearAIUserContext();
    try {
      if (adapter.kill) {
        await adapter.kill();
      } else if (adapter.disconnect) {
        await adapter.disconnect();
      } else if (
        adapter.client &&
        typeof adapter.client === "object" &&
        adapter.client !== null &&
        "connected" in adapter.client &&
        typeof adapter.client.connected === "boolean" &&
        adapter.client.connected &&
        "disconnect" in adapter.client &&
        typeof adapter.client.disconnect === "function"
      ) {
        await (
          adapter.client as { disconnect: () => Promise<void> }
        ).disconnect();
      }
    } catch (e) {
      console.error(`[Bot ${botId}] Failed to disconnect adapter:`, e);
    }
  }
}
