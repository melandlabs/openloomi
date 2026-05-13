/**
 * WeChat iLink long-polling listener (thin wrapper)
 *
 * This module wires the packages/integrations/weixin ws-listener (protocol-level)
 * to the web's handler (AI runtime glue).
 *
 * Protocol-level code lives in packages, web-specific glue lives here.
 */

import type { IntegrationAccountWithBot } from "@/lib/db/queries";
import {
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import {
  startWeixinConnection as startWeixinConnection_,
  stopWeixinConnection as stopWeixinConnection_,
} from "@openloomi/integrations/weixin";
import type { InboundMessageHandler } from "@openloomi/integrations/core";
import { handleWeixinInboundMessage } from "./handler";

const DEBUG = process.env.DEBUG_WEIXIN === "true";

// In-memory cache of accounts by ID for the handler callback
const accountCache = new Map<string, IntegrationAccountWithBot>();

/**
 * Create an InboundMessageHandler callback that wires the packages listener
 * to the web's handleWeixinInboundMessage (AI runtime glue).
 */
function createOnMessageHandler(): InboundMessageHandler {
  return async (event) => {
    const { accountId, message } = event;
    const raw = message.raw as {
      mediaHints?: string[];
      images?: Array<{ data: string; mimeType: string }>;
      fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
      contextToken: string;
      userId: string;
    };

    // Look up account from cache
    const account = accountCache.get(accountId);
    if (!account) {
      console.error("[Weixin] Account not found in cache:", accountId);
      return;
    }

    await handleWeixinInboundMessage(
      account,
      {
        fromUserId: message.senderId,
        messageId: message.msgId,
        text: message.text,
        mediaHints: raw?.mediaHints,
        images: raw?.images,
        fileAttachments: raw?.fileAttachments,
        contextToken: raw?.contextToken ?? "",
      },
      {},
    );
  };
}

/**
 * Start a WeChat connection for an account (with account caching)
 */
export async function startWeixinConnection(
  account: IntegrationAccountWithBot,
  authToken?: string,
): Promise<void> {
  // Cache the account for the handler callback
  accountCache.set(account.id, account);

  const raw = loadIntegrationCredentials<{
    ilinkToken?: string;
    baseUrl?: string;
    routeTag?: string;
  }>(account);
  const ilinkToken = raw?.ilinkToken?.trim();
  if (!ilinkToken) {
    if (DEBUG)
      console.warn("[Weixin] Account %s missing ilinkToken", account.id);
    return;
  }

  const credentials = {
    ilinkToken,
    baseUrl: raw?.baseUrl?.trim() || undefined,
    routeTag: raw?.routeTag?.trim() || undefined,
  };

  const onMessage = createOnMessageHandler();
  await startWeixinConnection_(
    account.id,
    account.userId,
    credentials,
    onMessage,
  );
}

/**
 * Stop a WeChat connection
 */
export function stopWeixinConnection(accountId: string): void {
  accountCache.delete(accountId);
  stopWeixinConnection_(accountId);
}

/**
 * Start WeChat listeners for all accounts of a user
 */
export async function startWeixinListenersForUser(
  userId: string,
  authToken?: string,
): Promise<void> {
  const accounts = await getIntegrationAccountsByUserId({ userId });
  const list = accounts.filter((a) => a.platform === "weixin");
  for (const account of list) {
    await startWeixinConnection(account, authToken);
  }
}

/**
 * Start all WeChat listeners (for server initialization)
 */
export async function startAllWeixinListeners(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { integrationAccounts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ userId: integrationAccounts.userId })
    .from(integrationAccounts)
    .where(eq(integrationAccounts.platform, "weixin"));

  const userIdList = rows
    .map((r: { userId: string | null }) => r.userId)
    .filter(
      (id: string | null): id is string =>
        typeof id === "string" && id.length > 0,
    );
  const uniqueIds = Array.from(new Set<string>(userIdList));
  for (const userId of uniqueIds) {
    await startWeixinListenersForUser(userId);
  }
  if (DEBUG)
    console.log("[Weixin] Started %s long polling connections", rows.length);
}
