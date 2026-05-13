import { type BotWithAccount, decryptPayload } from "../db/queries";
import { AppError } from "@openloomi/shared/errors";
import type { HubspotCredentials } from "@openloomi/integrations/hubspot";

export type BotAdapter =
  | "slack"
  | "telegram"
  | "discord"
  | "whatsapp"
  | "gmail"
  | "outlook"
  | "google_calendar"
  | "linkedin"
  | "instagram"
  | "twitter"
  | "teams"
  | "outlook_calendar"
  | "facebook_messenger"
  | "google_drive"
  | "google_docs"
  | "hubspot"
  | "rss"
  | "feishu"
  | "dingtalk"
  | "qqbot"
  | "weixin";

type DecryptedPayloads = {
  slack: { accessToken: string };
  discord: { accessToken: string; guildId: string };
  telegram: { sessionKey: string };
  whatsapp: { sessionKey: string };
  gmail: { email: string; appPassword: string };
  outlook: {
    email: string;
    appPassword: string;
    imapHost?: string;
    imapPort?: number;
    smtpHost?: string;
    smtpPort?: number;
  };
  google_calendar: {
    accessToken?: string | null;
    refreshToken?: string | null;
    scope?: string | null;
    tokenType?: string | null;
    expiryDate?: number | null;
    calendarIds?: string[] | null;
    timeZone?: string | null;
  };
  linkedin: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
  };
  instagram: {
    accessToken: string;
    pageId: string;
    igBusinessId: string;
    username?: string | null;
    pageName?: string | null;
    expiresAt?: number | null;
  };
  twitter: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
    userId?: string | null;
    username?: string | null;
  };
  facebook_messenger: {
    pageId: string;
    pageAccessToken: string;
    pageName?: string | null;
    appId?: string | null;
    appSecret?: string | null;
    verifyToken?: string | null;
  };
  teams: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    scope?: string | null;
    tokenType?: string | null;
    tenantId?: string | null;
    userId?: string | null;
    userPrincipalName?: string | null;
    displayName?: string | null;
  };
  outlook_calendar: {
    accessToken?: string | null;
    refreshToken?: string | null;
    scope?: string | null;
    tokenType?: string | null;
    expiresAt?: number | null;
  };
  google_drive: { accessToken: string };
  google_docs: {
    accessToken?: string | null;
    refreshToken?: string | null;
    scope?: string | null;
    tokenType?: string | null;
    expiryDate?: number | null;
  };
  hubspot: HubspotCredentials;
  rss: never;
  feishu: { appId: string; appSecret: string; domain?: "feishu" | "lark" };
  dingtalk: { clientId: string; clientSecret: string };
  qqbot: { appId: string; appSecret: string };
  /** ilink_bot_token obtained after OpenClaw QR code login */
  weixin: { ilinkToken: string; baseUrl?: string; routeTag?: string };
};

type AdapterConfigs = {
  slack: { SLACK_USER_TOKEN: string };
  telegram: { TG_SESSION: string };
  discord: { DISCORD_GUILD_ID: string };
  whatsapp: { WA_CLIENT_ID: string; WA_SESSION: string };
  gmail: {
    GOOGLE_GMAIL_ADDRESS: string;
  };
  outlook: {
    OUTLOOK_EMAIL_ADDRESS?: string;
    IMAP_HOST?: string;
    IMAP_PORT?: number;
    SMTP_HOST?: string;
    SMTP_PORT?: number;
  };
  facebook_messenger: {
    FB_PAGE_ID?: string;
    FB_PAGE_ACCESS_TOKEN?: string;
    FB_APP_ID?: string;
    FB_APP_SECRET?: string;
    FB_VERIFY_TOKEN?: string;
  };
  google_calendar: {
    calendarIds?: string[];
    timeZone?: string | null;
  };
  linkedin: {};
  instagram: {};
  twitter: {};
  teams: {};
  outlook_calendar: {};
  google_drive: {};
  google_docs: {};
  hubspot: {};
  rss: {};
  feishu: { appId?: string; appSecret?: string; domain?: "feishu" | "lark" };
  dingtalk: { clientId?: string; clientSecret?: string };
  qqbot: { appId?: string; appSecret?: string };
  weixin: { ilinkToken?: string; baseUrl?: string; routeTag?: string };
};

type AccessTokenType<T extends BotAdapter> = T extends "slack"
  ? string
  : T extends "telegram"
    ? string
    : T extends "whatsapp"
      ? string
      : T extends "discord"
        ? { guildId: string; accessToken: string }
        : T extends "gmail"
          ? { email: string; appPassword: string } | DecryptedPayloads["gmail"]
          : T extends "outlook"
            ?
                | { email: string; appPassword: string }
                | DecryptedPayloads["outlook"]
            : T extends "google_calendar"
              ? DecryptedPayloads["google_calendar"]
              : T extends "linkedin"
                ? DecryptedPayloads["linkedin"]
                : T extends "instagram"
                  ? DecryptedPayloads["instagram"]
                  : T extends "twitter"
                    ? DecryptedPayloads["twitter"]
                    : T extends "facebook_messenger"
                      ? DecryptedPayloads["facebook_messenger"] | undefined
                      : T extends "teams"
                        ?
                            | DecryptedPayloads["teams"]
                            | {
                                accessToken: string;
                                refreshToken?: string | null;
                                expiresAt?: number | null;
                                scope?: string | null;
                                tokenType?: string | null;
                                tenantId?: string | null;
                                userId?: string | null;
                                userPrincipalName?: string | null;
                                displayName?: string | null;
                              }
                        : T extends "google_drive"
                          ? string | undefined
                          : T extends "google_docs"
                            ?
                                | {
                                    accessToken?: string | null;
                                    refreshToken?: string | null;
                                    scope?: string | null;
                                    tokenType?: string | null;
                                    expiryDate?: number | null;
                                  }
                                | undefined
                            : T extends "outlook_calendar"
                              ?
                                  | {
                                      accessToken?: string | null;
                                      refreshToken?: string | null;
                                      scope?: string | null;
                                      tokenType?: string | null;
                                      expiresAt?: number | null;
                                    }
                                  | undefined
                              : T extends "hubspot"
                                ? DecryptedPayloads["hubspot"] | undefined
                                : T extends "rss"
                                  ? undefined
                                  : T extends "feishu"
                                    ? DecryptedPayloads["feishu"]
                                    : T extends "dingtalk"
                                      ? DecryptedPayloads["dingtalk"]
                                      : T extends "qqbot"
                                        ? DecryptedPayloads["qqbot"]
                                        : T extends "weixin"
                                          ? DecryptedPayloads["weixin"]
                                          : never;

export async function getBotCredentials<T extends BotAdapter>(
  adapter: T,
  bot: BotWithAccount,
): Promise<AccessTokenType<T>> {
  let payload: DecryptedPayloads[T] | undefined;
  try {
    payload = bot.platformAccount?.credentialsEncrypted
      ? ((await decryptPayload(
          bot.platformAccount.credentialsEncrypted,
        )) as DecryptedPayloads[T])
      : undefined;
  } catch (error) {
    payload = undefined;
  }

  if (!payload) {
    console.warn(`[Bot ${bot.id}] No encrypted authorization information.`);
  }

  switch (bot.adapter) {
    case "slack": {
      const slackPayload = payload as DecryptedPayloads["slack"];
      const slackConfig = bot.adapterConfig as AdapterConfigs["slack"];
      return (slackPayload?.accessToken ??
        slackConfig.SLACK_USER_TOKEN) as AccessTokenType<T>;
    }

    case "telegram": {
      const tgPayload = payload as DecryptedPayloads["telegram"];
      const tgConfig = bot.adapterConfig as AdapterConfigs["telegram"];
      return (tgPayload?.sessionKey ??
        tgConfig.TG_SESSION) as AccessTokenType<T>;
    }

    case "discord": {
      const discordPayload = payload as DecryptedPayloads["discord"];
      const discordConfig = bot.adapterConfig as AdapterConfigs["discord"];
      return {
        accessToken:
          discordPayload?.accessToken ?? process.env.DISCORD_BOT_TOKEN ?? "",
        guildId: discordPayload?.guildId ?? discordConfig.DISCORD_GUILD_ID,
      } as AccessTokenType<T>;
    }

    case "whatsapp": {
      const waPayload = payload as DecryptedPayloads["whatsapp"];
      const waConfig = bot.adapterConfig as AdapterConfigs["whatsapp"];
      return (waPayload?.sessionKey ??
        waConfig.WA_CLIENT_ID ??
        waConfig.WA_SESSION) as AccessTokenType<T>;
    }

    case "gmail": {
      const gmailPayload = payload as DecryptedPayloads["gmail"];
      if (!gmailPayload?.email || !gmailPayload?.appPassword) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing encrypted gmail credentials. Please re-authenticate.`,
        );
      }
      return {
        email: gmailPayload.email,
        appPassword: gmailPayload.appPassword,
      } as AccessTokenType<T>;
    }

    case "teams": {
      const teamsPayload = payload as DecryptedPayloads["teams"];
      return teamsPayload as AccessTokenType<T>;
    }

    case "outlook_calendar": {
      const outlookCalPayload =
        payload as DecryptedPayloads["outlook_calendar"];
      return outlookCalPayload as AccessTokenType<T>;
    }

    case "outlook": {
      const outlookPayload = payload as DecryptedPayloads["outlook"];
      const outlookConfig = bot.adapterConfig as AdapterConfigs["outlook"];
      if (!outlookPayload?.email || !outlookPayload?.appPassword) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing encrypted outlook credentials. Please re-authenticate.`,
        );
      }
      return {
        email: outlookPayload.email,
        appPassword: outlookPayload.appPassword,
        imapHost: outlookConfig.IMAP_HOST ?? "outlook.office365.com",
        imapPort: outlookConfig.IMAP_PORT ?? 993,
        smtpHost: outlookConfig.SMTP_HOST ?? "smtp.office365.com",
        smtpPort: outlookConfig.SMTP_PORT ?? 587,
      } as AccessTokenType<T>;
    }
    case "google_calendar": {
      const calendarPayload = payload as DecryptedPayloads["google_calendar"];
      const calendarConfig =
        bot.adapterConfig as AdapterConfigs["google_calendar"];
      return {
        accessToken: calendarPayload?.accessToken ?? undefined,
        refreshToken: calendarPayload?.refreshToken ?? undefined,
        scope: calendarPayload?.scope ?? undefined,
        tokenType: calendarPayload?.tokenType ?? undefined,
        expiryDate: calendarPayload?.expiryDate ?? undefined,
        calendarIds:
          calendarPayload?.calendarIds ??
          calendarConfig.calendarIds ??
          undefined,
        timeZone: calendarPayload?.timeZone ?? calendarConfig.timeZone ?? null,
      } as AccessTokenType<T>;
    }
    case "linkedin": {
      const linkedinPayload = payload as DecryptedPayloads["linkedin"];
      return {
        accessToken: linkedinPayload?.accessToken ?? null,
        refreshToken: linkedinPayload?.refreshToken ?? null,
        expiresAt: linkedinPayload?.expiresAt ?? null,
      } as AccessTokenType<T>;
    }
    case "instagram": {
      const instagramPayload = payload as DecryptedPayloads["instagram"];
      return {
        accessToken: instagramPayload?.accessToken ?? "",
        pageId: instagramPayload?.pageId ?? "",
        igBusinessId: instagramPayload?.igBusinessId ?? "",
        username: instagramPayload?.username ?? null,
        pageName: instagramPayload?.pageName ?? null,
        expiresAt: instagramPayload?.expiresAt ?? null,
      } as AccessTokenType<T>;
    }
    case "twitter": {
      const twitterPayload = payload as DecryptedPayloads["twitter"];
      return {
        accessToken: twitterPayload?.accessToken ?? null,
        refreshToken: twitterPayload?.refreshToken ?? null,
        expiresAt: twitterPayload?.expiresAt ?? null,
        userId: twitterPayload?.userId ?? null,
        username: twitterPayload?.username ?? null,
      } as AccessTokenType<T>;
    }

    case "facebook_messenger": {
      const messengerPayload =
        payload as DecryptedPayloads["facebook_messenger"];
      const messengerConfig =
        bot.adapterConfig as AdapterConfigs["facebook_messenger"];
      return (messengerPayload ?? {
        pageId: messengerConfig.FB_PAGE_ID ?? "",
        pageAccessToken: messengerConfig.FB_PAGE_ACCESS_TOKEN ?? "",
        pageName: undefined,
        appId: messengerConfig.FB_APP_ID,
        appSecret: messengerConfig.FB_APP_SECRET,
        verifyToken: messengerConfig.FB_VERIFY_TOKEN,
      }) as AccessTokenType<T>;
    }

    case "google_drive": {
      const drivePayload = payload as DecryptedPayloads["google_drive"];
      return drivePayload?.accessToken as AccessTokenType<T>;
    }

    case "google_docs": {
      const docsPayload = payload as DecryptedPayloads["google_docs"];
      return docsPayload as AccessTokenType<T>;
    }

    case "hubspot": {
      const hubspotPayload = payload as DecryptedPayloads["hubspot"];
      return hubspotPayload as AccessTokenType<T>;
    }

    case "rss":
      return undefined as AccessTokenType<T>;

    case "feishu": {
      const feishuPayload = payload as DecryptedPayloads["feishu"];
      const feishuConfig = bot.adapterConfig as AdapterConfigs["feishu"];
      if (!feishuPayload?.appId || !feishuPayload?.appSecret) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing Feishu app_id or app_secret. Please re-authorize.`,
        );
      }
      return {
        appId: feishuPayload.appId ?? feishuConfig?.appId ?? "",
        appSecret: feishuPayload.appSecret ?? feishuConfig?.appSecret ?? "",
        domain: feishuPayload.domain ?? feishuConfig?.domain,
      } as AccessTokenType<T>;
    }

    case "dingtalk": {
      const dingPayload = payload as DecryptedPayloads["dingtalk"];
      const dingConfig = bot.adapterConfig as AdapterConfigs["dingtalk"];
      if (!dingPayload?.clientId || !dingPayload?.clientSecret) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing DingTalk Client ID or Client Secret, please re-authorize.`,
        );
      }
      return {
        clientId: dingPayload.clientId ?? dingConfig?.clientId ?? "",
        clientSecret:
          dingPayload.clientSecret ?? dingConfig?.clientSecret ?? "",
      } as AccessTokenType<T>;
    }

    case "qqbot": {
      const qqbotPayload = payload as DecryptedPayloads["qqbot"];
      const qqbotConfig = bot.adapterConfig as AdapterConfigs["qqbot"];
      if (!qqbotPayload?.appId || !qqbotPayload?.appSecret) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing QQ Bot AppID or AppSecret, please re-authorize.`,
        );
      }
      return {
        appId: qqbotPayload.appId ?? qqbotConfig?.appId ?? "",
        appSecret: qqbotPayload.appSecret ?? qqbotConfig?.appSecret ?? "",
      } as AccessTokenType<T>;
    }

    case "weixin": {
      const wxPayload = payload as DecryptedPayloads["weixin"];
      const wxConfig = bot.adapterConfig as AdapterConfigs["weixin"];
      const ilinkToken = wxPayload?.ilinkToken ?? wxConfig?.ilinkToken;
      if (!ilinkToken?.trim()) {
        throw new AppError(
          "unauthorized:bot",
          `[Bot ${bot.id}] Missing WeChat iLink Token, please re-authorize.`,
        );
      }
      return {
        ilinkToken: ilinkToken.trim(),
        baseUrl: wxPayload?.baseUrl ?? wxConfig?.baseUrl,
        routeTag: wxPayload?.routeTag ?? wxConfig?.routeTag,
      } as AccessTokenType<T>;
    }

    default: {
      throw new AppError(
        "bad_request:bot",
        `Unknown bot adapter ${bot.adapter}`,
      );
    }
  }
}
