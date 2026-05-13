import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { listIntegrationCatalogEntries } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawCategory = searchParams.get("category");
  const categories = rawCategory
    ? rawCategory
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : undefined;

  try {
    const entries = await listIntegrationCatalogEntries({
      category: categories && categories.length > 0 ? categories : undefined,
    });

    return NextResponse.json({ entries }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }

    console.error("[IntegrationCatalog] Failed to list entries", error);
    return NextResponse.json(
      { error: "Failed to load integration catalog" },
      { status: 500 },
    );
  }
}
