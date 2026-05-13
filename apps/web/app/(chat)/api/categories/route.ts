import { auth } from "@/app/(auth)/auth";
import {
  getUserCategories,
  createUserCategory,
  updateUserCategoriesSortOrder,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  dbCategoryToApiCategory,
  type CategoryCreatePayload,
  getDefaultCategoryTemplates,
  getDefaultCategoryTemplateByName,
} from "@/lib/types/categories";

/**
 * Request body validation schema for creating category
 */
const createCategorySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
  templateName: z.string().optional(),
});

/**
 * Request body validation schema for batch updating sort order
 */
const sortOrderSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().uuid(),
      sortOrder: z.number().int(),
    }),
  ),
});

/**
 * GET /api/categories
 * Get all user categories (auto-populates templates for new users)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  try {
    let categories = await getUserCategories(session.user.id);

    // Auto-populate all template categories for new users
    if (categories.length === 0) {
      const templates = getDefaultCategoryTemplates();
      await Promise.all(
        templates.map((tpl, index) =>
          createUserCategory(session.user.id, {
            name: tpl.name,
            description: tpl.description,
            isActive: true,
            sortOrder: index,
          }),
        ),
      );
      categories = await getUserCategories(session.user.id);
    }

    return NextResponse.json({
      categories: categories.map(dbCategoryToApiCategory),
    });
  } catch (error) {
    console.error("[Categories] Failed to get categories", error);
    return new AppError(
      "offline:category",
      "Failed to get categories",
    ).toResponse();
  }
}

/**
 * POST /api/categories
 * Create new category (supports creating from template)
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  try {
    const body = await request.json();
    const validated = createCategorySchema.parse(body);

    let categoryData: CategoryCreatePayload;

    // If template name is specified, create from template
    if (validated.templateName) {
      const template = getDefaultCategoryTemplateByName(validated.templateName);
      if (!template) {
        return new AppError(
          "bad_request:category",
          `Template "${validated.templateName}" not found`,
        ).toResponse();
      }

      categoryData = {
        name: validated.name || template.name,
        description: validated.description ?? template.description,
        isActive: validated.isActive ?? true,
        sortOrder: validated.sortOrder ?? 0,
      };
    } else {
      // Create blank category
      if (!validated.name) {
        return new AppError(
          "bad_request:category",
          "Category name is required",
        ).toResponse();
      }

      categoryData = {
        name: validated.name,
        description: validated.description ?? null,
        isActive: validated.isActive ?? true,
        sortOrder: validated.sortOrder ?? 0,
      };
    }

    const newCategory = await createUserCategory(session.user.id, categoryData);
    return NextResponse.json(
      { category: dbCategoryToApiCategory(newCategory) },
      { status: 201 },
    );
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
    console.error("[Categories] Failed to create category", error);
    return new AppError(
      "offline:category",
      `Failed to create category, ${error}`,
    ).toResponse();
  }
}

/**
 * PUT /api/categories
 * Batch update category sort order
 */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:category").toResponse();
  }

  try {
    const body = await request.json();
    const validated = sortOrderSchema.parse(body);

    await updateUserCategoriesSortOrder(session.user.id, validated.categories);

    return NextResponse.json({ success: true });
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
    console.error("[Categories] Failed to update sort order", error);
    return new AppError(
      "offline:category",
      "Failed to update sort order",
    ).toResponse();
  }
}
