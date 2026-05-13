import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  createBot,
  getIntegrationAccountsByUserId,
  upsertIntegrationAccount,
  updateBot,
  weixinBotHasValidContextToken,
  type IntegrationAccountWithBot,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { IntegrationAccountPayloadSchema } from "./schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accounts = await getIntegrationAccountsByUserId({
      userId: session.user.id,
    });

    // For WeChat accounts, check if they have valid context tokens
    const enhancedAccounts = await Promise.all(
      accounts.map(async (account: IntegrationAccountWithBot) => {
        const baseAccount = {
          id: account.id,
          platform: account.platform,
          externalId: account.externalId,
          displayName: account.displayName,
          status: account.status,
          metadata: account.metadata ?? null,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          bot: account.bot
            ? {
                id: account.bot.id,
                name: account.bot.name,
                description: account.bot.description,
                adapter: account.bot.adapter,
                enable: account.bot.enable,
                createdAt: account.bot.createdAt,
                updatedAt: account.bot.updatedAt,
              }
            : null,
        };

        // For WeChat, check if bot has valid context token
        if (account.platform === "weixin" && account.bot?.id) {
          const hasValidContextToken = await weixinBotHasValidContextToken(
            session.user.id,
            account.bot.id,
          );
          (baseAccount as any).hasValidContextToken = hasValidContextToken;
        }

        return baseAccount;
      }),
    );

    return NextResponse.json(
      {
        accounts: enhancedAccounts,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[IntegrationAccounts] Failed to list accounts", error);
    return NextResponse.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "Failed to load integration accounts",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user;

  try {
    const body = await request.json();
    const payload = IntegrationAccountPayloadSchema.parse(body);

    const account = await upsertIntegrationAccount({
      userId: user.id,
      platform: payload.platform,
      externalId: payload.externalId,
      displayName: payload.displayName,
      credentials: payload.credentials,
      metadata: payload.metadata ?? null,
      status: payload.status,
    });

    const botPayload = payload.bot;

    let botId: string | null = null;
    if (botPayload) {
      const existingAccounts = await getIntegrationAccountsByUserId({
        userId: user.id,
      });
      const associatedBot = existingAccounts.find(
        (item) => item.id === account.id,
      )?.bot;

      if (associatedBot) {
        await updateBot(associatedBot.id, {
          name: botPayload.name,
          description: botPayload.description,
          adapter: botPayload.adapter,
          adapterConfig: botPayload.adapterConfig ?? {},
          enable: botPayload.enable ?? associatedBot.enable,
        });
        botId = associatedBot.id;
      } else {
        botId = await createBot({
          name: botPayload.name,
          description: botPayload.description,
          adapter: botPayload.adapter,
          adapterConfig: botPayload.adapterConfig ?? {},
          enable: botPayload.enable ?? true,
          userId: user.id,
          platformAccountId: account.id,
        });
      }
    }

    return NextResponse.json(
      {
        account: {
          id: account.id,
          platform: account.platform,
          externalId: account.externalId,
          displayName: account.displayName,
          status: account.status,
          metadata: account.metadata ?? null,
          botId,
        },
      },
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
      return NextResponse.json(
        { error: error.message, cause: error.cause },
        { status: 400 },
      );
    }

    console.error("[IntegrationAccounts] Failed to create account", error);
    return NextResponse.json(
      { error: "Failed to create integration account" },
      { status: 500 },
    );
  }
}
