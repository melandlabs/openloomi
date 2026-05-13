import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  createRssSubscription,
  getIntegrationCatalogEntryBySlug,
  getRssSubscriptionsByUser,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

const CreateRssSubscriptionSchema = z
  .object({
    sourceUrl: z.url().optional(),
    title: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    catalogSlug: z.string().min(1).optional(),
  })
  .refine(
    (value) => Boolean(value.sourceUrl || value.catalogSlug),
    "Either sourceUrl or catalogSlug is required.",
  );

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const subscriptions = await getRssSubscriptionsByUser({
      userId: session.user.id,
    });
    return NextResponse.json({ subscriptions }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[RssSubscriptions] Failed to list subscriptions", error);
    return NextResponse.json(
      { error: "Failed to load RSS subscriptions" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = CreateRssSubscriptionSchema.parse(await request.json());

    let resolvedUrl = payload.sourceUrl?.trim() ?? "";
    let resolvedTitle = payload.title ?? null;
    let resolvedCategory = payload.category ?? null;
    let catalogId: string | null = null;
    let sourceType = payload.catalogSlug ? "catalog" : "custom";

    if (payload.catalogSlug) {
      const catalogEntry = await getIntegrationCatalogEntryBySlug({
        slug: payload.catalogSlug,
      });
      if (!catalogEntry) {
        return NextResponse.json(
          { error: "Catalog entry not found" },
          { status: 404 },
        );
      }
      catalogId = catalogEntry.id;
      resolvedUrl = catalogEntry.url;
      resolvedTitle = resolvedTitle ?? catalogEntry.title;
      resolvedCategory = resolvedCategory ?? catalogEntry.category;
      sourceType = "catalog";
    }

    if (!resolvedUrl) {
      return NextResponse.json(
        { error: "RSS feed URL is required" },
        { status: 400 },
      );
    }

    const subscription = await createRssSubscription({
      userId: session.user.id,
      sourceUrl: resolvedUrl,
      title: resolvedTitle,
      category: resolvedCategory,
      status: "active",
      sourceType,
      catalogId,
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((item) => item.message).join(", ") },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[RssSubscriptions] Failed to create subscription", error);
    return NextResponse.json(
      { error: "Failed to create RSS subscription" },
      { status: 500 },
    );
  }
}
