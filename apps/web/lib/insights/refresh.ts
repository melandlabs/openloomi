import { auth } from "@/app/(auth)/auth";
import {
  upsertInsightsByBotId,
  getBotWithAccountById,
  getUserInsightSettings,
  getStoredInsightsByBotId,
  updateBot,
  getFailedGroupsToRetry,
} from "../db/queries";
import type { BotWithAccount } from "../db/queries";
import {
  timeBeforeHours,
  timeBeforeMinutes,
} from "@openloomi/integrations/channels/sources/types";
import { userInsightSettingsToPrompt } from "./settings";
import { deduplicateInsightsByGroup } from "./timeline";
import { getInsightsByBotId } from "./processor";
import type {
  SummaryUserContext,
  RefreshOptions,
  RefreshResult,
} from "./bot-types";

async function resolveUserContext(
  provided?: SummaryUserContext,
): Promise<SummaryUserContext | null> {
  if (provided) {
    return provided;
  }
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return {
    id: session.user.id,
    type: session.user.type,
    slackToken: session.user.slackToken,
    name: session.user.name,
    email: session.user.email,
  };
}

function botNeedsOldInsights(bot: BotWithAccount): boolean {
  return bot.adapter !== "rss" && bot.adapter !== "hubspot";
}

export async function refreshActiveBotInsight(
  id: string,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: false };
  let botId: string | undefined;

  try {
    const bot = await getBotWithAccountById({ id });
    if (!bot) {
      return result;
    }

    botId = bot.id;

    // Skip pulling messages for manual or character bots
    if (bot.adapter === "manual" || bot.adapter === "character") {
      console.log(
        `[Bot ${bot.id}] is a ${bot.adapter} bot, skipping message pulling`,
      );
      return result;
    }

    // Skip insight processing for weixin and x/twitter that do not support message insights
    if (
      bot.adapter === "weixin" ||
      bot.adapter === "x" ||
      bot.adapter === "twitter"
    ) {
      return result;
    }

    const userContext = await resolveUserContext(options.user);
    if (!userContext) {
      return result;
    }
    const actualUserId = bot.userId ?? userContext.id;
    const mergedContext: SummaryUserContext = {
      ...userContext,
      id: actualUserId,
    };
    const userType = mergedContext.type;

    const settings = await getUserInsightSettings(bot.userId);
    const rawMeta = bot.platformAccount?.metadata;
    const metaStr =
      typeof rawMeta === "string" ? rawMeta : JSON.stringify(rawMeta, null, 2);
    const platformAccountPrompt = rawMeta
      ? `My personal info on ${bot.adapter} platform is ${metaStr}`
      : "";
    const customPrompt =
      (settings ? userInsightSettingsToPrompt(settings) : "") +
      platformAccountPrompt;

    // Get old summaries from the last 1 day
    const historicalInsightsDays = 30;
    const { insights: oldInsights } = await getStoredInsightsByBotId({
      id,
      days: historicalInsightsDays,
    });
    // Calculate the start Unix timestamp for fetching new summaries (in seconds)
    const intervalMinutes = settings ? settings.refreshIntervalMinutes : 60;
    let since: number = timeBeforeMinutes(intervalMinutes);
    let isFirstLanding = false;
    let sinceHour = 1;
    const sinceMaxHour = 24;

    // Determine if this is a single group refresh
    const isSingleGroupRefresh = options?.groups && options.groups.length > 0;

    if (Array.isArray(oldInsights) && oldInsights.length > 0) {
      if (isSingleGroupRefresh) {
        // Single group refresh: only consider insights from that group
        const relevantInsights = oldInsights.filter((insight) =>
          options.groups?.some((g) => insight.groups?.includes(g)),
        );

        if (relevantInsights.length > 0) {
          // Find the latest old summary
          const latestSummary = relevantInsights.reduce((latest, current) => {
            if (!latest?.time) return current;
            if (!current?.time) return latest;
            return new Date(current.time) > new Date(latest.time)
              ? current
              : latest;
          }, relevantInsights[0]);

          if (latestSummary?.time) {
            // Calculate second-level timestamp of the latest old summary (floor, note: need to add 1s for floor)
            since =
              Math.floor(new Date(latestSummary.time).getTime() / 1000) + 1;
            console.info(
              `[Bot ${id}] [${bot.adapter}] Single group refresh, fetching new summaries after ${new Date(since * 1000).toLocaleString()}`,
            );
          }
        }

        // If no related insights found, use default since
        if (
          !oldInsights.some(
            (i) => i.time && options.groups?.some((g) => i.groups?.includes(g)),
          )
        ) {
          since = timeBeforeHours(sinceMaxHour) + 1;
          console.warn(
            `[Bot ${id}] No old summary for this group, fetching new summaries after ${new Date(since * 1000).toLocaleString()}`,
          );
        }
      } else {
        // Full refresh: use the last full refresh time, not the latest insight time of individual groups
        // Read last full refresh time from bot's adapterConfig
        const adapterConfig = bot.adapterConfig as Record<
          string,
          unknown
        > | null;
        const lastBatchRefreshTime = adapterConfig?.lastBatchRefreshTime as
          | string
          | undefined;

        if (lastBatchRefreshTime) {
          // Use last full refresh time
          since =
            Math.floor(new Date(lastBatchRefreshTime).getTime() / 1000) + 1;
          console.info(
            `[Bot ${id}] [${bot.adapter}] Full refresh, using last full refresh time ${new Date(lastBatchRefreshTime).toLocaleString()}, fetching new summaries after ${new Date(since * 1000).toLocaleString()}`,
          );
        } else {
          // First full refresh, use default refresh interval
          console.info(
            `[Bot ${id}] [${bot.adapter}] First full refresh, using refresh interval ${intervalMinutes} minutes, fetching new summaries after ${new Date(since * 1000).toLocaleString()}`,
          );
        }
      }
    } else {
      // No old summary found, fetch data by default
      since =
        (!botNeedsOldInsights(bot)
          ? timeBeforeHours(sinceMaxHour)
          : timeBeforeHours(sinceHour)) + 1;
      isFirstLanding = botNeedsOldInsights(bot);
      console.info(
        `[Bot ${id}] [${bot.adapter}] No old summaries found, defaulting to fetch new summaries after ${new Date(since * 1000).toLocaleString()}`,
      );
    }

    console.log(
      `[Bot ${id}] Refresh mode: ${isSingleGroupRefresh ? `Single group (${options.groups?.join(", ")})` : "Full refresh"}`,
    );

    // Set batch size based on whether it's first landing
    const chunkSize = isFirstLanding
      ? (options.chunkSize ?? 10) // Default 10 for first landing
      : (options.chunkSize ?? 40); // Default 40 for normal cases

    if (isFirstLanding) {
      console.info(
        `[Bot ${id}] [${bot.adapter}] First landing mode, batch size set to: ${chunkSize}`,
      );
    }

    // New: get failed groups that need retry
    const failedGroupsToRetry = await getFailedGroupsToRetry({ botId: id });

    // If there are failed groups, use the earliest processedSince
    if (failedGroupsToRetry.length > 0) {
      const earliestFailureSince = Math.min(
        ...failedGroupsToRetry.map((f) => f.processedSince),
      );
      // If failed group's timestamp is earlier, use it
      if (earliestFailureSince < since) {
        console.log(
          `[Bot ${id}] Detected ${failedGroupsToRetry.length} failed groups, backtracking timestamp from ${new Date(since * 1000).toLocaleString()} to ${new Date(earliestFailureSince * 1000).toLocaleString()}`,
        );
        since = earliestFailureSince;
      }
    }

    if (
      !options.force &&
      Array.isArray(oldInsights) &&
      oldInsights.length > 0
    ) {
      const latestSummary = oldInsights[0];
      if (latestSummary?.time instanceof Date) {
        const latestTimestamp = latestSummary.time.getTime();
        const intervalMs = intervalMinutes * 60 * 1000;
        const intervalAgo = Date.now() - intervalMs;

        const timeDiffMs = Date.now() - latestTimestamp;
        const timeDiffMinutes = Math.floor(timeDiffMs / 60000);

        if (timeDiffMs < 0) {
          // Old summary exists but time is invalid, default to 24 hours ago in seconds (floor, note: need to add 1s for floor)
          since = timeBeforeHours(24) + 1;
        }

        // Skip interval check for single group refresh, allow immediate refresh
        if (
          !isSingleGroupRefresh &&
          timeDiffMs > 0 &&
          latestTimestamp >= intervalAgo
        ) {
          console.info(
            `[Bot ${id}] [${bot.adapter}] Summary is up to date. Latest timestamp (${new Date(latestTimestamp).toLocaleString()}) is within ${intervalMinutes} minutes, actual time since latest: ${timeDiffMinutes} minutes. No refresh needed.`,
          );
          return result;
        }
      } else {
        console.warn(
          `[Bot ${id}] Latest insights have invalid "time" field (not a Date), proceeding to refresh.`,
        );
      }
    }

    const oldInsightsNeedTobeDeleted =
      (botNeedsOldInsights(bot) ? oldInsights : []) ?? [];

    let rawMessages:
      | Awaited<ReturnType<typeof getInsightsByBotId>>["rawMessages"]
      | undefined;
    let payload:
      | Awaited<ReturnType<typeof getInsightsByBotId>>["payload"]
      | undefined;
    let originalMsgCount = 0;
    let locked = false;
    let processedGroups: string[] | undefined;

    try {
      const getInsightsResult = await getInsightsByBotId({
        bot,
        insights: JSON.stringify(oldInsightsNeedTobeDeleted),
        since,
        customPrompt,
        user: mergedContext,
        options: {
          language: settings?.language,
          byGroup: options.byGroup,
          groupConcurrency: options.groupConcurrency,
        },
        chunkSize,
        failedGroupsToRetry,
      });
      rawMessages = getInsightsResult.rawMessages;
      payload = getInsightsResult.payload;
      originalMsgCount = getInsightsResult.originalMsgCount;
      locked = getInsightsResult.locked;
      processedGroups = getInsightsResult.processedGroups;
    } catch (error) {
      console.error(`[Bot ${id}] getInsightsByBotId failed:`, error);
    }

    // Store raw messages for later retrieval
    if (rawMessages) {
      result.rawMessages = rawMessages;
    }

    let newInsights = payload;
    if (!newInsights || newInsights.length === 0) {
      console.info(`[Bot ${id}] Execution completed: no new insights`);
      // Only execute FirstLanding incremental hour logic for channels that need old insights
      if (
        botNeedsOldInsights(bot) &&
        isFirstLanding &&
        oldInsightsNeedTobeDeleted &&
        originalMsgCount === 0 &&
        !locked
      ) {
        while (sinceHour < sinceMaxHour) {
          sinceHour++;
          since = timeBeforeHours(sinceHour) + 1;
          const {
            payload,
            originalMsgCount,
            locked,
            rawMessages: retryRawMessages,
          } = await getInsightsByBotId({
            bot,
            insights: JSON.stringify(oldInsightsNeedTobeDeleted),
            since,
            customPrompt,
            user: mergedContext,
            options: {
              language: settings?.language,
            },
            chunkSize,
          });
          newInsights = payload;
          if (originalMsgCount > 0 && !locked) {
            // Store raw messages from retry
            if (retryRawMessages) {
              result.rawMessages = retryRawMessages;
            }
            break;
          }
        }
      }
      if (!newInsights || newInsights.length === 0) {
        return result;
      }
    }
    if (!Array.isArray(newInsights)) {
      console.error(
        `[Bot ${id}] Expected insights array but received string, skipping append`,
      );
      return result;
    }

    // If no new insights were generated, return directly
    if (!newInsights || newInsights.length === 0) {
      console.warn(`[Bot ${id}] No new insights generated`);
      return result;
    }

    // Before upsert, deduplicate newInsights by group
    // Ensure only the latest insight is kept per group
    const deduplicatedNewInsights = deduplicateInsightsByGroup(newInsights);
    if (deduplicatedNewInsights.length < newInsights.length) {
      console.log(
        `[Bot ${id}] Deduplication: ${newInsights.length} -> ${deduplicatedNewInsights.length} insights`,
      );
    }

    // Use upsert to update existing insights (based on dedupeKey match, preserve ID)
    // This way favorite and pin states are preserved
    await upsertInsightsByBotId({
      id,
      insights: deduplicatedNewInsights,
    });

    console.info(
      `[Bot ${id}] Execution completed Insights (+ ${newInsights.length})`,
    );

    // Mark as refreshed
    result.refreshed = true;

    // If full refresh succeeds, update lastBatchRefreshTime
    if (!isSingleGroupRefresh) {
      try {
        // Get bot's current adapterConfig
        const currentBot = await getBotWithAccountById({ id });
        if (currentBot) {
          const adapterConfig =
            (currentBot.adapterConfig as Record<string, unknown>) || {};
          // Update lastBatchRefreshTime in adapterConfig
          await updateBot(id, {
            adapterConfig: {
              ...adapterConfig,
              lastBatchRefreshTime: new Date().toISOString(),
            },
          });
          console.log(
            `[Bot ${id}] Updated full refresh time: ${new Date().toISOString()}`,
          );
        }
      } catch (error) {
        console.error(
          `[Bot ${id}] Failed to update lastBatchRefreshTime:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error(`[Bot ${id}] Execution error:`, error);
    throw error;
  }
  return result;
}
