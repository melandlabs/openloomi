import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getIntegrationAccountByPlatform } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { pullNotionPages, type NotionMetadata } from "@/lib/files/notion";

const requestSchema = z.object({
  pageIds: z.array(z.string().min(1)).optional(),
  databaseIds: z.array(z.string().min(1)).optional(),
  limitPerDatabase: z.number().int().positive().max(100).optional(),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const account = await getIntegrationAccountByPlatform({
    userId: session.user.id,
    platform: "notion",
  });

  if (!account) {
    return NextResponse.json(
      { error: "Notion is not connected." },
      { status: 404 },
    );
  }

  const metadata = (account.metadata as NotionMetadata | null) ?? {};
  const pageIds =
    parsed.data.pageIds ??
    metadata.syncSources?.pages?.filter((id) => typeof id === "string") ??
    [];
  const databaseIds =
    parsed.data.databaseIds ??
    metadata.syncSources?.databases?.filter((id) => typeof id === "string") ??
    [];

  if (pageIds.length === 0 && databaseIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide pageIds or databaseIds, or configure syncSources in Notion settings first.",
      },
      { status: 400 },
    );
  }

  try {
    const { pages } = await pullNotionPages({
      userId: session.user.id,
      pageIds,
      databaseIds,
      limitPerDatabase: parsed.data.limitPerDatabase ?? 10,
    });

    return NextResponse.json(
      {
        pages,
        count: pages.length,
        sources: {
          pageIds,
          databaseIds,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[notion] Pull failed", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return NextResponse.json(
      { error: "Failed to pull Notion content." },
      { status: 500 },
    );
  }
}
