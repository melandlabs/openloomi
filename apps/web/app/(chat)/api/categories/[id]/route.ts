import { auth } from "@/app/(auth)/auth";
import { updateUserCategory, deleteUserCategory } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbCategoryToApiCategory } from "@/lib/types/categories";
import type { CategoryUpdatePayload } from "@/lib/types/categories";

/**
 * Request body validation schema for updating category
 */
const updateCategorySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * PUT /api/categories/:id
 * Update category
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  const { id: categoryId } = await params;

  try {
    const body = await request.json();
    const validated = updateCategorySchema.parse(body);

    const updates: CategoryUpdatePayload = {};
    if (validated.name !== undefined) updates.name = validated.name;
    if (validated.description !== undefined)
      updates.description = validated.description;
    if (validated.isActive !== undefined) updates.isActive = validated.isActive;
    if (validated.sortOrder !== undefined)
      updates.sortOrder = validated.sortOrder;

    const updated = await updateUserCategory(
      categoryId,
      session.user.id,
      updates,
    );

    return NextResponse.json({
      category: dbCategoryToApiCategory(updated),
    });
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
    console.error("[Categories] Failed to update category", error);
    return new AppError(
      "offline:category",
      "Failed to update category",
    ).toResponse();
  }
}

/**
 * DELETE /api/categories/:id
 * Delete category
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  const { id: categoryId } = await params;

  try {
    await deleteUserCategory(categoryId, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[Categories] Failed to delete category", error);
    return new AppError(
      "offline:category",
      "Failed to delete category",
    ).toResponse();
  }
}
