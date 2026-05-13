import { createHash } from "node:crypto";

import {
  getIntegrationAccountById,
  updateIntegrationAccount,
} from "@/lib/db/queries";
import type { Bot } from "@/lib/db/schema";
import { isTelegramAuthIssue } from "@openloomi/shared/errors";

function hashSessionKey(botId: string, sessionKey?: string | null) {
  const raw = sessionKey && sessionKey.trim().length > 0 ? sessionKey : botId;
  return createHash("sha256").update(`${botId}:${raw}`).digest("hex");
}

function shouldHandleInvalidAuth(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  return isTelegramAuthIssue(message);
}

export async function handleTelegramAuthFailure({
  bot,
  userId,
  sessionKey,
  error,
}: {
  bot: Bot;
  userId: string;
  sessionKey?: string | null;
  error: unknown;
}) {
  if (!shouldHandleInvalidAuth(error)) {
    return;
  }

  const hashedSession = hashSessionKey(bot.id, sessionKey);
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");

  console.warn(
    `[Telegram] Invalid session detected for bot ${bot.id} (hash=${hashedSession})`,
    message,
  );

  if (!bot.platformAccountId) {
    return;
  }

  const account = await getIntegrationAccountById({
    userId,
    platformAccountId: bot.platformAccountId,
  });

  if (!account) {
    return;
  }

  const rawAccountMeta = account.metadata;
  const metadata =
    typeof rawAccountMeta === "string"
      ? (JSON.parse(rawAccountMeta) as Record<string, unknown>)
      : ((rawAccountMeta as Record<string, unknown>) ?? Object.create(null));

  const telegramLastError = {
    message,
    at: new Date().toISOString(),
  };

  /** Merge new error into metadata; if metadata has too many properties causing enumeration error, only update telegramLastError to avoid RangeError */
  let nextMetadata: Record<string, unknown>;
  try {
    nextMetadata = { ...metadata, telegramLastError };
  } catch (e) {
    if (
      e instanceof RangeError &&
      /too many properties to enumerate/i.test(e.message)
    ) {
      nextMetadata = { telegramLastError };
      console.warn(
        "[Telegram] metadata has too many properties, only updating telegramLastError, other fields ignored",
      );
    } else {
      throw e;
    }
  }

  await updateIntegrationAccount({
    userId,
    platformAccountId: account.id,
    status: "paused",
    metadata: nextMetadata,
  });
}
