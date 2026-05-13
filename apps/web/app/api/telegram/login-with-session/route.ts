import { NextResponse } from "next/server";
import {
  convertTdataToStringSession,
  validateTdataDirectory,
  extractAccountInfo,
} from "@openloomi/integrations/telegram/tdata-converter";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { auth } from "@/app/(auth)/auth";
import { upsertIntegrationAccount, createBot } from "@/lib/db/queries";
import {
  getTgUserNameString,
  type TgUserInfo,
} from "@openloomi/integrations/channels/sources/types";

/**
 * Login using Telegram Desktop session
 *
 * Accept Telegram Desktop data directory path,
 * Convert to GramJS StringSession and complete login
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tdataPath } = await request.json();

    if (!tdataPath) {
      return NextResponse.json(
        { error: "tdataPath is required" },
        { status: 400 },
      );
    }

    console.log(
      "[Auth] Logging in with Telegram Desktop session from:",
      tdataPath,
    );

    // Validate tdata directory
    const validation = validateTdataDirectory(tdataPath);
    if (!validation.valid) {
      console.error("[Auth] Invalid tdata directory:", validation.error);
      return NextResponse.json(
        {
          error: `Invalid Telegram Desktop data directory: ${validation.error}`,
        },
        { status: 400 },
      );
    }

    // Extract account info (if available)
    const accountInfo = extractAccountInfo(tdataPath);
    if (accountInfo) {
      console.log("[Auth] Found account info:", accountInfo);
    }

    // Convert tdata to StringSession
    let sessionString: string;
    try {
      sessionString = await convertTdataToStringSession(tdataPath);
      console.log("[Auth] Successfully converted tdata to StringSession");
    } catch (error) {
      console.error("[Auth] Failed to convert tdata:", error);
      // The error message from tdata-converter is already user-friendly
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to read Telegram Desktop session";

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // 1. Create a TelegramClient with the StringSession
    const stringSession = new StringSession(sessionString);
    const appId = Number(process.env.TG_APP_ID ?? "0");
    const appHash = process.env.TG_APP_HASH ?? "";

    if (!appId || !appHash) {
      console.error("[Auth] Missing TG_APP_ID or TG_APP_HASH");
      return NextResponse.json(
        { error: "Telegram API credentials not configured" },
        { status: 500 },
      );
    }

    const tgClient = new TelegramClient(stringSession, appId, appHash, {
      connectionRetries: 10,
      timeout: 60,
      requestRetries: 5,
      floodSleepThreshold: 60,
    });

    try {
      // 2. Verify the session is valid by connecting to Telegram
      console.log("[Auth] Connecting to Telegram to verify session...");
      await tgClient.connect();

      // 3. Get user information from Telegram
      const me = await tgClient.getMe();
      console.log("[Auth] Successfully retrieved user info:", {
        id: me.id.toString(),
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username,
      });

      // Prepare user info and ID
      const userId = me.id.toJSNumber();
      const userInfo: TgUserInfo = {
        userName: me.username ?? undefined,
        firstName: me.firstName ?? undefined,
        lastName: me.lastName ?? undefined,
      };

      // Prepare display name
      const displayName = getTgUserNameString(userInfo);

      // Prepare metadata
      const metadata = {
        userId: userId ?? null,
        userName: userInfo.userName ?? null,
        firstName: userInfo.firstName ?? null,
        lastName: userInfo.lastName ?? null,
        telegramLastError: null,
      };

      // Prepare credentials
      const credentials = {
        sessionKey: sessionString,
        user: userInfo,
        userId: userId ?? null,
      };

      // 4. Create a login session in the database
      console.log("[Auth] Creating integration account...");
      const integrationAccount = await upsertIntegrationAccount({
        userId: session.user.id,
        platform: "telegram",
        externalId: String(userId ?? ""),
        displayName: displayName || "Telegram account",
        credentials,
        metadata,
        status: "active",
      });

      // Create bot for this integration
      const botId = await createBot({
        name: `Telegram · ${displayName}`,
        description: "Imported from Telegram Desktop session",
        adapter: "telegram",
        adapterConfig: {},
        enable: true,
        userId: session.user.id,
        platformAccountId: integrationAccount.id,
      });

      console.log("[Auth] Successfully created integration account and bot:", {
        accountId: integrationAccount.id,
        botId,
      });

      // Disconnect the client after setup
      await tgClient.disconnect();

      return NextResponse.json({
        success: true,
        accountId: integrationAccount.id,
        botId,
        // Data needed by frontend completeTelegramAuth
        sessionKey: sessionString,
        userInfo: {
          ...userInfo,
          id: userId,
        },
        userId,
        message: "Telegram session imported successfully",
      });
    } catch (tgError) {
      console.error("[Auth] Telegram client error:", tgError);

      // Ensure we disconnect even if there's an error
      try {
        await tgClient.disconnect();
      } catch (disconnectError) {
        console.error("[Auth] Error disconnecting client:", disconnectError);
      }

      const errorMessage =
        tgError instanceof Error
          ? tgError.message
          : "Telegram connection failed";

      // Provide more specific error messages
      if (errorMessage.includes("AUTH_KEY_DUPLICATED")) {
        return NextResponse.json(
          { error: "This session is already being used by another device" },
          { status: 400 },
        );
      }

      if (errorMessage.includes("AUTH_KEY_INVALID")) {
        return NextResponse.json(
          { error: "The session is invalid or has expired" },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { error: `Failed to verify Telegram session: ${errorMessage}` },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("[Auth] Session login error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to login with session",
      },
      { status: 500 },
    );
  }
}
