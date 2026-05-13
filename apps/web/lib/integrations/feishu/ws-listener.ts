/**
 * Feishu WebSocket Long Connection Listener (Bot Mode, based on OpenClaw)
 *
 * Unlike Telegram/iMessage "self-message mode": Feishu uses **bot mode**.
 * - User chats with "Feishu app/bot"; openloomi listens to messages received by the bot and replies as the bot.
 * - One im.message.receive_v1 = one user message sent to the bot; processes only this message, no session history.
 * - Filtering: only processes sender_type=user (user to bot); ignores sender_type=app (bot's own messages to avoid treating its own replies as new messages).
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  bulkUpsertContacts,
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import { getCloudAuthToken } from "@/lib/auth/token-manager";
import { handleFeishuInboundMessage } from "./handler";

const DEBUG = process.env.DEBUG_FEISHU === "true";

type FeishuCredentials = {
  appId?: string;
  appSecret?: string;
  domain?: "feishu" | "lark";
};

/**
 * Get the open_id of the current app's bot (used for group chat @ mention detection).
 * Note: feishuOpenId in integration metadata comes from registration flow user_info, which is the scanned user rather than the bot, and cannot be used for this purpose.
 */
async function fetchFeishuBotOpenId(params: {
  appId: string;
  appSecret: string;
  domain: "feishu" | "lark";
}): Promise<string | null> {
  const openApisBase =
    params.domain === "lark"
      ? "https://open.larksuite.com/open-apis"
      : "https://open.feishu.cn/open-apis";
  const timeoutMs = 12_000;
  try {
    const tokenResp = await fetch(
      `${openApisBase}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          app_id: params.appId,
          app_secret: params.appSecret,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const tokenJson = (await tokenResp.json().catch(() => null)) as {
      tenant_access_token?: string;
      code?: number;
      msg?: string;
    } | null;
    if (!tokenResp.ok || !tokenJson?.tenant_access_token) {
      console.warn(
        "[Feishu] Failed to get tenant_access_token, cannot pull bot open_id:",
        tokenJson?.msg ?? `HTTP ${tokenResp.status}`,
      );
      return null;
    }

    const infoResp = await fetch(`${openApisBase}/bot/v3/info`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenJson.tenant_access_token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const infoJson = (await infoResp.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      bot?: { open_id?: string };
    } | null;
    if (!infoResp.ok || infoJson?.code !== 0 || !infoJson?.bot?.open_id) {
      console.warn(
        "[Feishu] bot/v3/info failed, cannot parse bot open_id:",
        infoJson?.msg ?? `HTTP ${infoResp.status}`,
      );
      return null;
    }
    const id = String(infoJson.bot.open_id).trim();
    return id.length > 0 ? id : null;
  } catch (e) {
    console.warn("[Feishu] Failed to pull bot open_id:", e);
    return null;
  }
}

/** Per-connection context (bot backend: each account corresponds to one Feishu app, Tauri uses authToken to call cloud AI) */
interface FeishuConnection {
  accountId: string;
  userId: string;
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number];
  wsClient: Lark.WSClient | null;
  /** Cloud token for bot to call AI in Tauri mode (openloomi user's cloud token) */
  authToken?: string;
  /** Used for fast response within 3 seconds (reaction), etc. */
  appId: string;
  appSecret: string;
  /** Current app bot open_id (from bot/v3/info), used for group chat to only respond to @ mentions of this bot */
  botOpenId: string | null;
}

/** Global: maintain connections by accountId for easy reconnect/destroy */
const connections = new Map<string, FeishuConnection>();

/** Deduplicate processed messages (based on OpenClaw PR #22675: deduplicate before dispatch to avoid duplicate replies from redelivery) key = `${accountId}:${messageId}`, value = processing timestamp */
const processedMessageIds = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_MAX_SIZE = 5000;

function pruneProcessedMessageIds(): void {
  if (processedMessageIds.size <= DEDUP_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, ts] of processedMessageIds.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedMessageIds.delete(key);
  }
  if (processedMessageIds.size > DEDUP_MAX_SIZE) {
    const entries = [...processedMessageIds.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    const toRemove = entries
      .slice(0, Math.floor(entries.length / 2))
      .map((e) => e[0]);
    toRemove.forEach((k) => processedMessageIds.delete(k));
  }
}

/** Logging: print when event is received for troubleshooting "only process current session" and "filter who sent" */
const LOG_FEISHU_EVENT = process.env.DEBUG_FEISHU === "true";

function logEvent(label: string, obj: Record<string, unknown> | unknown): void {
  if (!LOG_FEISHU_EVENT) return;
  try {
    const s =
      typeof obj === "object" && obj !== null
        ? JSON.stringify(obj, null, 0).slice(0, 800)
        : String(obj);
    console.log(`[Feishu] ${label}`, s);
  } catch {
    console.log(`[Feishu] ${label}`, "(serialize error)");
  }
}

/** Reaction request timeout (Feishu requires response within 3 seconds, leaving ~2s for the API call) */
const REACTION_TIMEOUT_MS = 2000;

/**
 * Fast "received" acknowledgment to Feishu after receiving a message (based on nanobot feishu.py)
 * Feishu requires a response within 3 seconds; should be called and awaited immediately after getting message_id to ensure the request is sent.
 */
async function addFeishuReaction(
  appId: string,
  appSecret: string,
  messageId: string,
): Promise<void> {
  const client = new Lark.Client({ appId, appSecret });
  return (client as any).im.v1.messageReaction
    .create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: "THUMBSUP" } },
    })
    .then(() => {
      console.log("[Feishu] Added reaction to message_id=%s", messageId);
    })
    .catch((err: unknown) => {
      console.warn(
        "[Feishu] Failed to add reaction message_id=%s",
        messageId,
        err,
      );
    });
}

/**
 * Parse text from Feishu event payload
 * content is JSON, e.g. {"text":"hello"} or {"text":"","elements":[...]}
 */
function collectReadableStrings(
  value: unknown,
  out: string[],
  keyHint?: string,
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const k = (keyHint ?? "").toLowerCase();
    // Filter obvious metadata fields so quoted/rich-text content stays readable.
    if (
      /(^|_)(id|open_id|user_id|union_id|chat_id|message_id|image_key|file_key)$/.test(
        k,
      )
    ) {
      return;
    }
    const s = value.trim();
    if (s) out.push(s);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReadableStrings(item, out, keyHint);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectReadableStrings(v, out, k);
    }
  }
}

function collectQuoteIds(
  value: unknown,
  out: Set<string>,
  keyHint?: string,
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const k = (keyHint ?? "").toLowerCase();
    if (
      /(quote|reply|root|parent)/.test(k) &&
      /(id|message_id)$/.test(k) &&
      value.trim()
    ) {
      out.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectQuoteIds(item, out, keyHint);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectQuoteIds(v, out, k);
    }
  }
}

function collectImageKeys(
  value: unknown,
  out: Set<string>,
  keyHint?: string,
  inQuotedContext = false,
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const k = (keyHint ?? "").toLowerCase();
    if (!inQuotedContext && /(^|_)image_key$/.test(k) && value.trim()) {
      out.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageKeys(item, out, keyHint, inQuotedContext);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const isQuotedField = /(quote|quoted|reply|root|parent|reference)/i.test(
        k,
      );
      collectImageKeys(v, out, k, inQuotedContext || isQuotedField);
    }
  }
}

function extractContentInfo(content: string): {
  text: string;
  quoteIds: string[];
  imageKeys: string[];
} {
  if (!content?.trim()) return { text: "", quoteIds: [], imageKeys: [] };
  try {
    const obj = JSON.parse(content) as unknown;
    const chunks: string[] = [];
    const quoteIdSet = new Set<string>();
    const imageKeySet = new Set<string>();
    collectReadableStrings(obj, chunks);
    collectQuoteIds(obj, quoteIdSet);
    collectImageKeys(obj, imageKeySet);
    // Preserve order but remove duplicates and keep output bounded.
    const normalized = Array.from(new Set(chunks)).join("\n").trim();
    const quoteIds = [...quoteIdSet];
    const imageKeys = [...imageKeySet];
    const quotePrefix =
      quoteIds.length > 0 ? `[Quote IDs]: ${quoteIds.join(", ")}\n` : "";
    return {
      text: `${quotePrefix}${normalized}`.trim().slice(0, 10_000),
      quoteIds,
      imageKeys,
    };
  } catch {
    return { text: content.trim(), quoteIds: [], imageKeys: [] };
  }
}

function extractImageKeysFromRawContent(raw: string): string[] {
  if (!raw?.trim()) return [];
  const out = new Set<string>();
  const imageKeyRegex = /"image_key"\s*:\s*"([^"]+)"/g;
  const fileKeyRegex = /"file_key"\s*:\s*"([^"]+)"/g;
  for (const regex of [imageKeyRegex, fileKeyRegex]) {
    let m = regex.exec(raw);
    while (m != null) {
      const k = m[1]?.trim();
      if (k) out.add(k);
      m = regex.exec(raw);
    }
  }
  return [...out];
}

/**
 * Start WebSocket connection for a single Feishu account (one bot)
 * @param authToken Cloud auth token passed from frontend in Tauri mode, used for bot to call cloud AI when receiving messages
 */
export async function startFeishuConnection(
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number],
  authToken?: string,
): Promise<void> {
  if (account.platform !== "feishu") return;

  const credentials = loadIntegrationCredentials<FeishuCredentials>(account);
  const appId = credentials?.appId?.trim();
  const appSecret = credentials?.appSecret?.trim();
  const apiDomain: "feishu" | "lark" =
    credentials?.domain === "lark" ? "lark" : "feishu";
  const wsDomain = apiDomain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
  if (!appId || !appSecret) {
    if (DEBUG)
      console.warn(
        `[Feishu] Account ${account.id} missing appId/appSecret, skipping`,
      );
    return;
  }

  const accountId = account.id;
  const existing = connections.get(accountId);
  if (existing) {
    if (authToken?.trim()) {
      existing.authToken = authToken.trim();
      if (DEBUG)
        console.log(
          `[Feishu] Account ${accountId} already connected, authToken updated`,
        );
    } else if (DEBUG) {
      console.log(
        `[Feishu] Account ${accountId} already connected, init did not carry token, use conn and global getCloudAuthToken`,
      );
    }
    if (existing.botOpenId == null || existing.botOpenId === "") {
      existing.botOpenId = await fetchFeishuBotOpenId({
        appId,
        appSecret,
        domain: apiDomain,
      });
      if (existing.botOpenId && DEBUG) {
        console.log(
          `[Feishu] Account ${accountId} completed bot open_id prefix=%s`,
          existing.botOpenId.slice(0, 12),
        );
      }
    }
    return;
  }

  const resolvedBotOpenId = await fetchFeishuBotOpenId({
    appId,
    appSecret,
    domain: apiDomain,
  });
  if (resolvedBotOpenId) {
    console.log(
      "[Feishu] Resolved app bot open_id prefix=%s (used for group @ mention matching)",
      resolvedBotOpenId.slice(0, 12),
    );
  } else {
    console.warn(
      "[Feishu] Failed to get bot open_id, group messages with @ mentions will not be processed (to avoid incorrectly responding to other @ mentions)",
    );
  }

  // SDK requires passing an object of "eventType -> handler function" to register, cannot pass two params (eventType, handler)
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: {
      message?: {
        chat_id?: string;
        message_id?: string;
        content?: string;
        chat_type?: string;
      };
      sender?: {
        sender_id?: { open_id?: string; user_id?: string };
        sender_type?: string;
      };
    }) => {
      // Print event_id and time first when event is received for easy log lookup
      const raw = data as any;
      const eventId = raw?.header?.event_id ?? raw?.event_id ?? "";
      const createTime = raw?.header?.create_time ?? raw?.create_time ?? "";
      const timeStr =
        createTime && !Number.isNaN(Number(createTime))
          ? new Date(Number(createTime)).toISOString()
          : String(createTime) || "(none)";
      console.log(
        "[Feishu] Event received event_id=%s create_time=%s (%s)",
        eventId || "(empty)",
        createTime || "(empty)",
        timeStr,
      );

      const conn = connections.get(accountId);
      if (!conn) return;

      const message = data?.message ?? (data as any).message;
      const messageId = message?.message_id ?? "";

      // Logging: raw structure of received event (to confirm field positions like sender)
      logEvent("Event received - raw data keys and key fields", {
        keys: Object.keys(data as object),
        message: (data as any)?.message,
        sender: (data as any)?.sender,
      });

      const sender = data?.sender ?? (data as any).sender;
      const chatId = message?.chat_id;
      const content = message?.content ?? "";
      const rawChatType =
        message?.chat_type ?? (data as any).message?.chat_type ?? "";
      const rawMsgType =
        (message as any)?.message_type ??
        (message as any)?.msg_type ??
        (data as any)?.message?.message_type ??
        (data as any)?.message?.msg_type ??
        "";
      const chatType: "p2p" | "group" =
        rawChatType === "group" || rawChatType === "topic_group"
          ? "group"
          : "p2p";
      const mentions: unknown =
        (message as any)?.mentions ?? (data as any)?.message?.mentions;
      const messageAny = (message as any) ?? {};
      const rawMessageAny = (data as any)?.message ?? {};
      let parentId: unknown =
        messageAny.parent_id ??
        messageAny.parentId ??
        rawMessageAny.parent_id ??
        rawMessageAny.parentId;
      let rootId: unknown =
        messageAny.root_id ??
        messageAny.rootId ??
        rawMessageAny.root_id ??
        rawMessageAny.rootId;
      // Some SDK payloads may strip typed fields; add a defensive extraction from serialized object.
      if (
        (typeof parentId !== "string" || !parentId.trim()) &&
        (typeof rootId !== "string" || !rootId.trim())
      ) {
        try {
          const serialized = JSON.stringify(rawMessageAny);
          const parentHit = serialized.match(/"parent_id":"([^"]+)"/);
          const rootHit = serialized.match(/"root_id":"([^"]+)"/);
          if (parentHit?.[1]) parentId = parentHit[1];
          if (rootHit?.[1]) rootId = rootHit[1];
        } catch {
          // ignore
        }
      }
      const senderType =
        sender?.sender_type ?? (sender as any)?.sender_type ?? "";
      const openId =
        sender?.sender_id?.open_id ??
        sender?.sender_id?.user_id ??
        (sender as any)?.sender_id?.open_id ??
        "";
      const senderName: string =
        (sender as any)?.sender_name ??
        (sender as any)?.name ??
        (sender as any)?.display_name ??
        "";
      const parsedContent = extractContentInfo(content);
      const quoteIds: string[] = [];
      const quoteIdSeen = new Set<string>();
      const pushQuoteId = (idLike: unknown) => {
        if (typeof idLike !== "string") return;
        const id = idLike.trim();
        if (!id || quoteIdSeen.has(id)) return;
        quoteIdSeen.add(id);
        quoteIds.push(id);
      };
      // Keep deterministic precedence: direct reply first, thread root second.
      pushQuoteId(parentId);
      pushQuoteId(rootId);
      for (const qid of parsedContent.quoteIds) {
        pushQuoteId(qid);
      }
      let imageKeys = parsedContent.imageKeys;
      if (imageKeys.length === 0 && rawMsgType === "image") {
        imageKeys = extractImageKeysFromRawContent(content);
      }
      const text = parsedContent.text;
      if (DEBUG) {
        console.log(
          "[Feishu][DEBUG_PARSE] inbound message_id=%s chat_id=%s parent_id=%s root_id=%s quote_ids=%s image_keys=%s parsed_preview=%s",
          messageId || "(empty)",
          chatId || "(empty)",
          (typeof parentId === "string" && parentId.trim()) || "(none)",
          (typeof rootId === "string" && rootId.trim()) || "(none)",
          quoteIds.join(",") || "(none)",
          imageKeys.join(",") || "(none)",
          text.replace(/\s+/g, " ").slice(0, 180),
        );
      }

      if (!chatId) {
        if (DEBUG) console.warn("[Feishu] Event missing chat_id", data);
        return;
      }

      // Logging: parsed fields for troubleshooting "who sent" filtering
      console.log(
        "[Feishu] Parsed message_id=%s chat_id=%s chat_type=%s sender_type=%s sender_open_id=%s content length=%d content preview=%s",
        messageId,
        chatId,
        rawChatType || "(empty)",
        senderType || "(empty)",
        openId || "(empty)",
        text.length,
        text.slice(0, 80),
      );

      // Bot mode filter: only process "user to bot" messages (sender_type=user); ignore "bot's own messages" (sender_type=app)
      if (senderType === "app") {
        console.log(
          "[Feishu] Filtered: ignoring sender_type=app (bot's own message) message_id=%s",
          messageId,
        );
        return;
      }
      if (senderType !== "user") {
        console.log(
          "[Feishu] Filtered: ignoring sender_type=%s (only process user) message_id=%s",
          senderType || "(empty)",
          messageId,
        );
        return;
      }

      // Group chat: only trigger subsequent processing when message contains @ info (e.g. user @mentions bot in group)
      if (chatType === "group") {
        const mentionList = Array.isArray(mentions) ? mentions : [];
        const botOpenId = (conn.botOpenId ?? "").trim();
        const mentionedOpenIds = mentionList
          .map((item) => {
            const m = item as
              | {
                  id?: {
                    open_id?: string;
                    union_id?: string;
                    user_id?: string;
                  };
                  open_id?: string;
                }
              | undefined;
            if (!m) return "";
            if (typeof m.open_id === "string" && m.open_id.trim())
              return m.open_id.trim();
            const idObj = m.id;
            if (idObj && typeof idObj === "object") {
              if (typeof idObj.open_id === "string" && idObj.open_id.trim())
                return idObj.open_id.trim();
            }
            return "";
          })
          .filter((id): id is string => id.length > 0);
        const isMentioningCurrentBot =
          botOpenId.length > 0 && mentionedOpenIds.includes(botOpenId);

        if (mentionList.length === 0) {
          console.log(
            "[Feishu] Filtered: group message without @ mention, ignoring message_id=%s",
            messageId,
          );
          return;
        }
        if (botOpenId.length === 0) {
          console.warn(
            "[Feishu] Filtered: group message contains @ but bot open_id not yet obtained, ignoring message_id=%s (please ensure bot/v3/info is available)",
            messageId,
          );
          return;
        }
        if (!isMentioningCurrentBot) {
          console.log(
            "[Feishu] Filtered: group message does not @ current bot message_id=%s bot_open_id=%s mention_open_ids=%s",
            messageId,
            botOpenId,
            mentionedOpenIds.join(",") || "(none)",
          );
          return;
        }
      }

      // Send "received" acknowledgment to Feishu as quickly as possible (within 3 seconds), then do filtering and business logic
      if (messageId) {
        await Promise.race([
          addFeishuReaction(conn.appId, conn.appSecret, messageId),
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error("reaction_timeout")),
              REACTION_TIMEOUT_MS,
            ),
          ),
        ]).catch((e) => {
          if ((e as Error)?.message === "reaction_timeout") {
            console.warn(
              "[Feishu] reaction did not complete within %dms, continuing processing",
              REACTION_TIMEOUT_MS,
            );
          }
        });
      }

      // Deduplicate before dispatch (based on OpenClaw): mark as processed only here to avoid duplicate replies from Feishu redelivery or dual events
      const dedupKey = `${accountId}:${messageId}`;
      if (processedMessageIds.has(dedupKey)) {
        console.log(
          "[Feishu] Deduplication: already processed message_id=%s, skipping",
          messageId,
        );
        return;
      }
      processedMessageIds.set(dedupKey, Date.now());
      pruneProcessedMessageIds();

      // Business logic runs in next event loop tick to avoid blocking the event callback return
      const payload = {
        chatId,
        messageId,
        senderId: openId,
        senderName: senderName.trim() || undefined,
        text,
        quoteIds,
        imageKeys,
        chatType,
      } as const;
      // Connection may have been established during server cold start (no token); init writes token to memory, merge here to avoid calling model with empty token briefly after restart
      const effectiveAuthToken =
        conn.authToken?.trim() || getCloudAuthToken()?.trim();
      const auth = { authToken: effectiveAuthToken };
      // Sync Feishu conversation to user contacts table for later session-based history retrieval to generate Insight
      const accountRecord = conn.account;
      const botId = accountRecord.bot?.id;
      if (botId) {
        bulkUpsertContacts([
          {
            userId: accountRecord.userId,
            contactId: chatId,
            contactName: chatId,
            type: chatType,
            botId,
            contactMeta: {
              platform: "feishu",
              chatId,
              chatType,
            },
          },
        ]).catch((err) => {
          console.error(
            "[Feishu] Failed to sync Feishu conversation to user_meta_contacts:",
            err,
          );
        });
      }

      setImmediate(() => {
        handleFeishuInboundMessage(conn.account, payload, auth).catch((err) => {
          console.error(
            "[Feishu] Async inbound message processing failed:",
            err,
          );
        });
      });
    },
  });

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    domain: wsDomain,
    loggerLevel: DEBUG ? Lark.LoggerLevel.debug : Lark.LoggerLevel.info,
  });

  const conn: FeishuConnection = {
    accountId,
    userId: account.userId,
    account,
    wsClient,
    authToken: authToken?.trim() || undefined,
    appId,
    appSecret,
    botOpenId: resolvedBotOpenId,
  };
  connections.set(accountId, conn);

  try {
    console.log(
      "[Feishu] Starting WS listener accountId=%s userId=%s apiDomain=%s appIdPrefix=%s",
      accountId,
      account.userId,
      apiDomain,
      appId.slice(0, 8),
    );
    await wsClient.start({ eventDispatcher });
    console.log(
      "[Feishu] WebSocket connected accountId=%s apiDomain=%s",
      accountId,
      apiDomain,
    );
  } catch (err) {
    console.error(
      `[Feishu] WebSocket connection failed accountId=${accountId} apiDomain=${apiDomain}`,
      err,
    );
    connections.delete(accountId);
  }
}

/**
 * Stop Feishu connection for a single account
 */
export function stopFeishuConnection(accountId: string): void {
  const conn = connections.get(accountId);
  if (!conn) return;
  try {
    if (conn.wsClient && typeof (conn.wsClient as any).stop === "function") {
      (conn.wsClient as any).stop();
    }
  } catch (e) {
    console.warn("[Feishu] stop exception", e);
  }
  connections.delete(accountId);
  if (DEBUG) console.log(`[Feishu] Disconnected accountId=${accountId}`);
}

/**
 * Start connections for all Feishu bots under a given openloomi user (one bot per account, one connection per bot)
 * @param authToken Cloud auth token passed from frontend in Tauri mode, used for bot to call AI
 */
export async function startFeishuListenersForUser(
  userId: string,
  authToken?: string,
): Promise<void> {
  const accounts = await getIntegrationAccountsByUserId({ userId });
  const feishuAccounts = accounts.filter((a) => a.platform === "feishu");
  for (const account of feishuAccounts) {
    await startFeishuConnection(account, authToken);
  }
}

/**
 * Start connections for all existing Feishu accounts (called during service startup)
 */
export async function startAllFeishuListeners(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { integrationAccounts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const feishuRows = await db
    .select({ userId: integrationAccounts.userId })
    .from(integrationAccounts)
    .where(eq(integrationAccounts.platform, "feishu"));

  const userIdList: string[] = feishuRows
    .map((row: { userId: string | null }) => row.userId)
    .filter(
      (id: string | null): id is string =>
        typeof id === "string" && id.length > 0,
    );
  const uniqueUserIds: string[] = Array.from(new Set<string>(userIdList));
  let total = 0;
  for (const userId of uniqueUserIds) {
    await startFeishuListenersForUser(userId);
    const accounts = await getIntegrationAccountsByUserId({ userId });
    total += accounts.filter((a) => a.platform === "feishu").length;
  }
  if (DEBUG)
    console.log(`[Feishu] Started ${total} Feishu WebSocket connections`);
}
