import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { bot, insight } from "@/lib/db/schema";
import { recordInsightView } from "@/lib/insights/weight-adjustment";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VIEW_SOURCES = new Set(["list", "detail", "search", "favorite"]);
type ViewSource = "list" | "detail" | "search" | "favorite";

function normalizeViewSource(value: unknown): ViewSource {
  if (typeof value === "string" && VIEW_SOURCES.has(value)) {
    return value as ViewSource;
  }
  return "detail";
}

function normalizeViewContext(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

async function parsePayload(request: Request): Promise<{
  viewSource: ViewSource;
  viewContext: Record<string, unknown> | null;
}> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { viewSource: "detail", viewContext: null };
  }

  try {
    const body = await request.json();
    return {
      viewSource: normalizeViewSource(body?.viewSource),
      viewContext: normalizeViewContext(body?.viewContext),
    };
  } catch {
    return { viewSource: "detail", viewContext: null };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "Insight ID is required" },
      { status: 400 },
    );
  }

  try {
    const ownedInsight = await db
      .select({ id: insight.id })
      .from(insight)
      .innerJoin(bot, eq(insight.botId, bot.id))
      .where(and(eq(insight.id, id), eq(bot.userId, session.user.id)))
      .limit(1);

    if (ownedInsight.length === 0) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    const { viewSource, viewContext } = await parsePayload(request);
    await recordInsightView(id, session.user.id, viewSource, viewContext, db);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[InsightView] Failed to record insight view:", error);
    return NextResponse.json(
      { error: "Failed to record insight view" },
      { status: 500 },
    );
  }
}
