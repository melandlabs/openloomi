import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { NextResponse } from "next/server";
import { getDefaultCategoryTemplates } from "@/lib/types/categories";

/**
 * GET /api/categories/templates
 * Get preset category template list
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  try {
    const templates = getDefaultCategoryTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("[Categories] Failed to get templates", error);
    return new AppError(
      "offline:category",
      "Failed to get templates",
    ).toResponse();
  }
}
