// app/api/bot/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  createBot,
  getBotById,
  deleteBotById,
  getBotsByUserId,
  deleteAllBotsByUserId,
  deleteBotByEmailAndAdapter,
  deleteBotsByAdapter,
} from "@/lib/db/queries";
import type { IntegrationId } from "@/lib/integrations/client";
import { AppError } from "@openloomi/shared/errors";
import { BotRequestSchema } from "./schema";

/**
 * POST /api/bot
 * Create a new bot
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = BotRequestSchema.parse(body);

    const botUuid = await createBot({
      ...validatedData,
      adapterConfig: validatedData.adapterConfig ?? {},
      userId: session.user.id,
    });
    console.log("Create bot", botUuid, session.user.id);
    return NextResponse.json({ uuid: botUuid }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => e.message).join(", ") },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message, cause: error.cause },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create bot. ${error}` },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const deleteAll = searchParams.get("all") === "true";
  const email = searchParams.get("email");
  const adapter = searchParams.get("adapter");

  // Verify user identity
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:bot").toResponse();
  }

  // Scenario 1: Delete bot by email and adapter type (for cleanup during logout)
  if (email && adapter) {
    try {
      const result = await deleteBotByEmailAndAdapter({
        email,
        adapter,
        userId: session.user.id,
      });

      return NextResponse.json(
        {
          success: true,
          count: result.count,
          deletedIds: result.deletedIds,
          message: `Deleted ${result.count} bots associated with ${email}`,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof AppError) {
        return error.toResponse();
      }
      return new AppError(
        "bad_request:api",
        `Failed to delete bots for email ${email}. ${error}`,
      ).toResponse();
    }
  }

  if (adapter && !email) {
    const supportedAdapters: IntegrationId[] = [
      "telegram",
      "whatsapp",
      "slack",
      "discord",
      "gmail",
      "outlook",
      "linkedin",
      "google_calendar",
      "teams",
      "facebook_messenger",
      "hubspot",
      "google_docs",
    ];
    if (!supportedAdapters.includes(adapter as IntegrationId)) {
      return new AppError(
        "bad_request:api",
        `Unsupported adapter ${adapter}`,
      ).toResponse();
    }
    try {
      const result = await deleteBotsByAdapter({
        adapter: adapter as IntegrationId,
        userId: session.user.id,
      });

      return NextResponse.json(
        {
          success: true,
          message: `Successfully deleted ${result.count} bots for adapter ${adapter}`,
          deletedIds: result.deletedIds,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof AppError) {
        return error.toResponse();
      }
      return new AppError(
        "bad_request:api",
        `Failed to delete bots for adapter ${adapter}. ${error}`,
      ).toResponse();
    }
  }

  // Scenario 2: Delete all user bots
  if (deleteAll) {
    try {
      const result = await deleteAllBotsByUserId({
        id: session.user.id,
      });
      return NextResponse.json(
        {
          success: true,
          message: `Successfully deleted ${result.count} bots`,
          deletedIds: result.deletedIds,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof AppError) {
        return error.toResponse();
      }
      return new AppError(
        "bad_request:api",
        `Failed to delete all bots. ${error}`,
      ).toResponse();
    }
  }

  // Scenario 3: Delete single bot
  if (id) {
    try {
      // First verify bot exists and belongs to current user
      const bot = await getBotById({ id });
      if (bot.userId !== session.user.id) {
        return new AppError(
          "forbidden:bot",
          "You don't have permission to delete this bot",
        ).toResponse();
      }

      const deletedBot = await deleteBotById({ id });
      return NextResponse.json(
        {
          success: true,
          deletedId: id,
          bot: deletedBot,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof AppError) {
        return error.toResponse();
      }
      return new AppError(
        "bad_request:api",
        `Failed to delete bot ${id}. ${error}`,
      ).toResponse();
    }
  }

  // Invalid request (missing required parameters)
  return new AppError(
    "bad_request:api",
    "Invalid request. Please provide either 'id', 'all=true', or 'email' and 'adapter' parameters.",
  ).toResponse();
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:bot").toResponse();
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit")) || 20;
    const startingAfter = searchParams.get("startingAfter");
    const endingBefore = searchParams.get("endingBefore");

    const { bots, hasMore } = await getBotsByUserId({
      id: session.user.id,
      limit,
      startingAfter,
      endingBefore,
      onlyEnable: true,
    });

    return Response.json({ bots, hasMore }, { status: 200 });
  } catch (error) {
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
