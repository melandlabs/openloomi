import { auth } from "@/app/(auth)/auth";
import { generateProjectInsights } from "@/lib/ai/subagents/insights";
import type { DetailData } from "@/lib/ai/subagents/insights";
import type { Insight } from "@/lib/db/schema";
import { getInsightByIdForUser, updateInsightById } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { generateInsightPayload } from "@/lib/insights/transform";
import type { GeneratedInsightPayload } from "@/lib/insights/types";
import { setAIUserContext } from "@/lib/ai";

type UnderstandSource = "gmail" | "rss";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id } = await params;

  // Parse request body to get cloudAuthToken
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // Ignore JSON parsing errors, continue processing
  }

  // Set AI user context with cloud auth token for proper authentication in local mode
  setAIUserContext({
    id: session.user.id,
    email: session.user.email || "",
    name: session.user.name || null,
    type: session.user.type,
    token: body.cloudAuthToken,
  });
  try {
    const record = await getInsightByIdForUser({
      userId: session.user.id,
      insightId: id,
    });

    if (!record) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    const { insight: insightRecord, bot } = record;
    const sourceType = resolveUnderstandSource(insightRecord);
    if (!sourceType) {
      return new AppError(
        "bad_request:insight",
        "Understanding is only available for Gmail or RSS items.",
      ).toResponse();
    }

    const messagePayload = buildUnderstandMessages(insightRecord, sourceType);
    if (messagePayload.length === 0) {
      return new AppError(
        "bad_request:insight",
        "Unable to locate content for this insight.",
      ).toResponse();
    }

    try {
      const customPrompt = `${
        sourceType === "gmail"
          ? "Focus on deeply understanding this Gmail message, identify intent, commitments, and next actions. Return a structured insight."
          : "Summarize this RSS article into a concise insight that captures the core message and why it matters."
      }`;

      const { insights } = await generateProjectInsights(
        session.user.id,
        JSON.stringify(messagePayload),
        JSON.stringify([]),
        sourceType,
        {
          customPrompt,
        },
      );

      const normalized =
        Array.isArray(insights?.insights) && insights.insights.length > 0
          ? insights.insights.map((entry) => generateInsightPayload(entry))
          : [];

      if (normalized.length === 0) {
        throw new AppError(
          "bad_request:insight",
          "Model did not return a valid understanding.",
        );
      }

      const generatedPayload = normalized[normalized.length - 1];

      const mergedPayload = mergeWithExistingInsight(
        generatedPayload,
        insightRecord,
      );
      const updatedInsight = await updateInsightById({
        insightId: insightRecord.id,
        botId: bot.id,
        payload: mergedPayload,
      });

      return Response.json(
        {
          insight: updatedInsight,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof AppError) {
        return error.toResponse();
      }
      console.error("[Insight Understand] Failed:", error);
      return new AppError(
        "bad_request:insight",
        "Failed to generate understanding.",
      ).toResponse();
    }
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[Insight Understand] Unexpected failure:", error);
    return new AppError(
      "bad_request:insight",
      "Failed to process understanding request.",
    ).toResponse();
  }
}

function resolveUnderstandSource(
  insightRecord: Insight,
): UnderstandSource | null {
  const detailPlatform =
    insightRecord.details?.[0]?.platform?.toLowerCase() ??
    insightRecord.platform?.toLowerCase() ??
    "";
  if (detailPlatform === "gmail") {
    return "gmail";
  }
  if (insightRecord.taskLabel === "rss_feed" || detailPlatform === "rss") {
    return "rss";
  }
  return null;
}

function buildUnderstandMessages(
  insightRecord: Insight,
  platform: UnderstandSource,
) {
  const detail = insightRecord.details?.[0] ?? null;
  const fallbackTime = insightRecord.time
    ? Math.floor(new Date(insightRecord.time).getTime() / 1000)
    : undefined;

  if (!detail) {
    return [
      {
        platform,
        subject: insightRecord.title,
        content: insightRecord.description,
        people: insightRecord.people ?? [],
        time: fallbackTime,
      },
    ];
  }

  return [
    {
      platform,
      subject: extractSubject(detail, insightRecord.title),
      content: detail.content ?? insightRecord.description,
      person: detail.person ?? insightRecord.people?.[0] ?? null,
      channel: detail.channel ?? null,
      time: detail.time ?? fallbackTime ?? null,
      attachments: detail.attachments ?? [],
    },
  ];
}

function extractSubject(detail: DetailData, fallback: string) {
  if (detail.content) {
    const match = detail.content.match(/^Subject:\s*(.+)$/m);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return fallback;
}

function mergeWithExistingInsight(
  generated: GeneratedInsightPayload,
  existing: Insight,
): GeneratedInsightPayload {
  const mergedGroups = Array.from(
    new Set([...(generated.groups ?? []), ...(existing.groups ?? [])]),
  );
  const mergedPeople = Array.from(
    new Set([...(generated.people ?? []), ...(existing.people ?? [])]),
  );
  return {
    ...generated,
    dedupeKey: existing.dedupeKey ?? generated.dedupeKey ?? null,
    taskLabel: existing.taskLabel,
    platform: existing.platform ?? generated.platform ?? null,
    account: existing.account ?? generated.account ?? null,
    groups: mergedGroups,
    people: mergedPeople,
    time: existing.time ?? generated.time ?? new Date(),
    details:
      existing.details && existing.details.length > 0
        ? existing.details
        : (generated.details ?? null),
    // Preserve user action related fields
    isFavorited: existing.isFavorited ?? false,
    favoritedAt: existing.favoritedAt ?? null,
    isArchived: existing.isArchived ?? false,
    archivedAt: existing.archivedAt ?? null,
    categories: existing.categories ?? undefined,
    myTasks: existing.myTasks ?? null,
    waitingForMe: existing.waitingForMe ?? null,
    waitingForOthers: existing.waitingForOthers ?? null,
  };
}
