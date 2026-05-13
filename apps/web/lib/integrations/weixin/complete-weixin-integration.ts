/**
 * Write integration account + bot after QR scan success (aligned with POST /api/integrations behavior)
 */
import {
  upsertIntegrationAccount,
  createBot,
  updateBot,
  getIntegrationAccountsByUserId,
} from "@/lib/db/queries";

export async function completeWeixinIntegrationAfterQr(params: {
  userId: string;
  userType: string;
  ilinkBotId: string;
  ilinkToken: string;
  baseUrl?: string;
  routeTag?: string;
  displayName: string;
  weixinUserId?: string;
}): Promise<{ accountId: string; botId: string | null }> {
  const externalId = params.ilinkBotId;
  const credentials: Record<string, unknown> = {
    ilinkToken: params.ilinkToken,
  };
  if (params.baseUrl?.trim()) credentials.baseUrl = params.baseUrl.trim();
  if (params.routeTag?.trim()) credentials.routeTag = params.routeTag.trim();

  const metadata: Record<string, unknown> = {};
  if (params.weixinUserId?.trim()) {
    metadata.weixinIlinkUserId = params.weixinUserId.trim();
  }

  const account = await upsertIntegrationAccount({
    userId: params.userId,
    platform: "weixin",
    externalId,
    displayName: params.displayName,
    credentials,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    status: "active",
  });

  const botDescription = "Chat with openloomi via Weixin (iLink)";

  const existingAccounts = await getIntegrationAccountsByUserId({
    userId: params.userId,
  });
  const associatedBot = existingAccounts.find(
    (item) => item.id === account.id,
  )?.bot;

  let botId: string | null = null;
  if (associatedBot) {
    await updateBot(associatedBot.id, {
      name: params.displayName,
      description: botDescription,
      adapter: "weixin",
      adapterConfig: {},
      enable: associatedBot.enable,
    });
    botId = associatedBot.id;
  } else {
    botId = await createBot({
      name: params.displayName,
      description: botDescription,
      adapter: "weixin",
      adapterConfig: {},
      enable: true,
      userId: params.userId,
      platformAccountId: account.id,
    });
  }

  return { accountId: account.id, botId };
}
