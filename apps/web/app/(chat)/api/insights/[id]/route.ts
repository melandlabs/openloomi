import { auth } from "@/app/(auth)/auth";
import { refreshActiveBotInsight } from "@/lib/insights";
import {
  botExists,
  deleteInsightsByIds,
  getBotsByUserId,
  getInsightByIdForUser,
  updateInsightById,
} from "@/lib/db/queries";
import { AppError } from "@alloomi/shared/errors";
import timeout from "p-timeout";
import { insight } from "@/lib/db/schema";
import { db } from "@/lib/db/queries";
import { eq } from "drizzle-orm";
import { extractCloudAuthToken } from "@/lib/ai/request-context";

// ------------------------------
// Concurrency control configuration (adapted for 8c16g machine)
// ------------------------------
const activeTasks = new Map<string, Promise<void>>();
const MAX_GLOBAL_CONCURRENT = 12; // Recommended value for 8-core 16GB machine
let currentGlobalTasks = 0;
const waitQueue: Array<() => void> = [];

async function acquireGlobalSlot(botId: string) {
  if (currentGlobalTasks < MAX_GLOBAL_CONCURRENT) {
    currentGlobalTasks++;
    return;
  }

  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      currentGlobalTasks++;
      resolve();
    });
  });
}

function releaseGlobalSlot(botId: string) {
  currentGlobalTasks = Math.max(0, currentGlobalTasks - 1);
  const next = waitQueue.shift();
  if (next) {
    console.log(`[Queue] Trigger queued task (remaining: ${waitQueue.length})`);
    next();
  }
}

/**
 * Task executor with concurrency control and deduplication prevention
 */
async function runWithConcurrencyControl<T = void>(
  botId: string,
  task: () => Promise<T>,
  timeoutMs = 55000, // Timeout (55 seconds, per-bot limit)
): Promise<T> {
  const existingTask = activeTasks.get(botId) as Promise<T> | undefined;
  if (existingTask) {
    console.log(`[Bot ${botId}] Task already running, ignoring duplicate call`);
    return existingTask;
  }

  let slotAcquired = false;
  const wrappedTask = async (): Promise<T> => {
    try {
      await acquireGlobalSlot(botId);
      slotAcquired = true;

      return await timeout(task(), {
        milliseconds: timeoutMs,
        message: `[Bot ${botId}] Insight processing timeout`,
      });
    } catch (error) {
      console.error(`[Bot ${botId}] Execution failed:`, error);
      if (!`${error}`.includes("TimeoutError")) {
        throw error;
      }
      throw error;
    } finally {
      activeTasks.delete(botId);
      if (slotAcquired) {
        releaseGlobalSlot(botId);
      }
    }
  };

  const taskPromise = wrappedTask();
  activeTasks.set(botId, taskPromise as Promise<void>);

  return taskPromise;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id } = await params;
  const userId = session.user.id;

  // Check if this is a request to get a single insight (via query parameter ?fetch=true)
  const url = new URL(request.url);
  const fetchInsight = url.searchParams.get("fetch") === "true";

  if (fetchInsight && id !== "all") {
    try {
      // Try to get insight
      const result = await db
        .select()
        .from(insight)
        .where(eq(insight.id, id))
        .limit(1);

      if (result.length === 0) {
        return new AppError(
          "not_found:insight",
          "Insight not found",
        ).toResponse();
      }

      const insightData = result[0];

      // User is authenticated, they can access their own insights
      return Response.json({ insight: insightData }, { status: 200 });
    } catch (error) {
      console.error("[Insight API] Failed to get insight:", error);
      return new AppError(
        "bad_request:database",
        `Failed to get insight. ${error instanceof Error ? error.message : String(error)}`,
      ).toResponse();
    }
  }

  // Below is the original refresh bot logic
  try {
    let targetBotIds: string[];

    if (id === "all") {
      const bots = await getBotsByUserId({
        id: userId,
        limit: null,
        startingAfter: null,
        endingBefore: null,
        onlyEnable: false,
      });
      if (bots.bots.length === 0) {
        return Response.json([], { status: 200 });
      }
      targetBotIds = bots.bots.map((b) => b.id);
    } else {
      const botRecord = await botExists({ id, userId });
      if (!botRecord) {
        console.error(`Bot ${id} does not belong to user ${userId}`);
        return new AppError("forbidden:bot").toResponse();
      }
      targetBotIds = [id];
    }

    // Collect results of all tasks (including success and failure)
    // Extract cloud auth token from request
    const cloudAuthToken = extractCloudAuthToken(request);

    const userContext = {
      id: userId,
      type: session.user.type,
      slackToken: session.user.slackToken,
      name: session.user.name,
      email: session.user.email,
      token: cloudAuthToken, // Pass cloud auth token for AI Provider authentication
    };

    const refreshPromises = targetBotIds.map((botId) => {
      return runWithConcurrencyControl(botId, async () => {
        const result = await refreshActiveBotInsight(botId, {
          user: userContext,
        });
        return { botId, ...result };
      }).catch((error) => ({
        botId,
        refreshed: false,
        rawMessages: undefined,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })) as Promise<{
        botId: string;
        refreshed: boolean;
        rawMessages?: any[];
        success?: boolean;
        error?: string;
      }>;
    });

    const results = await Promise.all(refreshPromises);

    const successful = results.filter(
      (r) => r === undefined || (r as any).success !== false,
    );
    const failures = results.filter(
      (r) => r !== undefined && (r as any).success === false,
    ) as Array<{
      botId: string;
      error: string;
    }>;

    // Collect all raw messages from successful refreshes
    const allRawMessages: any[] = [];
    results.forEach((result: any) => {
      if (result?.rawMessages && Array.isArray(result.rawMessages)) {
        allRawMessages.push(...result.rawMessages);
      }
    });

    const apiResult = {
      successful: successful.length,
      failed: failures.length,
      errors:
        failures.length > 0
          ? failures.map((f) => ({
              botId: f.botId,
              error: f.error,
            }))
          : undefined,
      rawMessages: allRawMessages.length > 0 ? allRawMessages : undefined,
    };
    return Response.json(apiResult, { status: 200 });
  } catch (error) {
    console.error("[Insights] Failed：", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Verify user identity
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const { id } = await params;

    if (!id) {
      return new AppError(
        "bad_request:insight",
        "Summary ID is required",
      ).toResponse();
    }

    // Verify ownership before deleting
    const insightResult = await getInsightByIdForUser({
      userId: session.user.id,
      insightId: id,
    });

    if (!insightResult) {
      return new AppError("not_found:insight", "Insight not found").toResponse();
    }

    // Call delete function (using array form, consistent with existing function interface)
    await deleteInsightsByIds({ ids: [id] });

    // Return success response
    return Response.json(
      { message: "Insights deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Delete failed:", error);

    // Handle known error types
    if (error instanceof AppError) {
      return error.toResponse();
    }

    // Handle unknown errors
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { updates } = body;

    if (!updates || typeof updates !== "object") {
      return Response.json(
        { error: "updates object is required" },
        { status: 400 },
      );
    }

    // Get the insight and verify access
    const insightResult = await getInsightByIdForUser({
      userId: session.user.id,
      insightId: id,
    });

    if (!insightResult) {
      return new AppError("not_found:insight", "Insight not found").toResponse();
    }

    const { insight: existingInsight, bot } = insightResult;

    // Normalize importance and urgency
    const normalizeImportance = (val?: string) => {
      if (val === "Important") return "Important";
      if (val === "Not Important") return "Not Important";
      return "General";
    };

    const normalizeUrgency = (val?: string) => {
      if (val === "As soon as possible") return "ASAP";
      if (val === "Within 24 hours") return "24h";
      if (val === "Not urgent") return "Not urgent";
      return "General";
    };

    // Normalize task format
    const normalizeTask = (t: any) => {
      if (typeof t === "string") {
        return { text: t, completed: false };
      }
      return {
        text: t.text || "",
        completed: t.completed ?? false,
        deadline: t.deadline,
        owner: t.owner,
      };
    };

    // Build the full payload with incremental updates
    const fullPayload: any = {
      dedupeKey: existingInsight.dedupeKey ?? null,
      taskLabel: existingInsight.taskLabel,
      title: updates.title || existingInsight.title,
      description: updates.description || existingInsight.description,
      importance: updates.importance
        ? normalizeImportance(updates.importance)
        : existingInsight.importance,
      urgency: updates.urgency
        ? normalizeUrgency(updates.urgency)
        : existingInsight.urgency,
      platform: existingInsight.platform ?? null,
      account: existingInsight.account ?? null,
      groups: existingInsight.groups ?? [],
      people: existingInsight.people ?? [],
      time: existingInsight.time,
      // Incremental update: append new items to existing array
      details: updates.details
        ? [
            ...(existingInsight.details || []),
            ...updates.details.map((d: any) => ({
              ...d,
              time: d.time ?? Date.now(),
            })),
          ]
        : existingInsight.details,
      timeline: updates.timeline
        ? [
            ...(existingInsight.timeline || []),
            ...updates.timeline.map((t: any) => ({
              ...t,
              time: Date.now(),
            })),
          ]
        : existingInsight.timeline,
      insights: updates.insights
        ? [...(existingInsight.insights || []), ...updates.insights]
        : existingInsight.insights,
      trendDirection: existingInsight.trendDirection ?? null,
      trendConfidence: existingInsight.trendConfidence
        ? Number.parseFloat(existingInsight.trendConfidence.toString())
        : null,
      sentiment: existingInsight.sentiment ?? null,
      sentimentConfidence: existingInsight.sentimentConfidence
        ? Number.parseFloat(existingInsight.sentimentConfidence.toString())
        : null,
      intent: existingInsight.intent ?? null,
      trend: existingInsight.trend ?? null,
      issueStatus: existingInsight.issueStatus ?? null,
      communityTrend: existingInsight.communityTrend ?? null,
      duplicateFlag: existingInsight.duplicateFlag ?? null,
      impactLevel: existingInsight.impactLevel ?? null,
      resolutionHint: existingInsight.resolutionHint ?? null,
      topKeywords: existingInsight.topKeywords ?? [],
      topEntities: existingInsight.topEntities ?? [],
      topVoices: existingInsight.topVoices,
      sources: existingInsight.sources,
      sourceConcentration: existingInsight.sourceConcentration ?? null,
      buyerSignals: existingInsight.buyerSignals ?? [],
      stakeholders: existingInsight.stakeholders,
      contractStatus: existingInsight.contractStatus ?? null,
      signalType: existingInsight.signalType ?? null,
      confidence: existingInsight.confidence
        ? Number.parseFloat(existingInsight.confidence.toString())
        : null,
      scope: existingInsight.scope ?? null,
      nextActions: existingInsight.nextActions,
      followUps: existingInsight.followUps,
      actionRequired: updates.actionRequired ?? existingInsight.actionRequired ?? null,
      actionRequiredDetails: existingInsight.actionRequiredDetails,
      myTasks: updates.myTasks
        ? updates.myTasks
            .map(normalizeTask)
            .filter((task: any) => task.text.length > 0)
            .map((task: any) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }))
        : existingInsight.myTasks,
      waitingForMe: updates.waitingForMe
        ? updates.waitingForMe
            .map(normalizeTask)
            .filter((task: any) => task.text.length > 0)
            .map((task: any) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }))
        : existingInsight.waitingForMe,
      waitingForOthers: updates.waitingForOthers
        ? updates.waitingForOthers
            .map(normalizeTask)
            .filter((task: any) => task.text.length > 0)
            .map((task: any) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }))
        : existingInsight.waitingForOthers,
      clarifyNeeded: existingInsight.clarifyNeeded ?? null,
      categories: updates.categories ?? existingInsight.categories ?? [],
      learning: existingInsight.learning ?? null,
      experimentIdeas: existingInsight.experimentIdeas,
      executiveSummary: existingInsight.executiveSummary ?? null,
    };

    // Update the insight
    await updateInsightById({
      insightId: id,
      botId: bot.id,
      payload: fullPayload,
    });

    return Response.json(
      { message: "Insight updated successfully", id },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Update failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
