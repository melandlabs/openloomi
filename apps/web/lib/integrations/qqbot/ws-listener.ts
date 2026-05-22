/**
 * QQ Bot WebSocket long connection listener (Bot mode, reference qqbot and Feishu)
 * One connection per integration account, receives C2C / group @ messages and forwards to handler
 */
import WebSocket from "ws";
import {
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
  bulkUpsertContacts,
} from "@/lib/db/queries";
import type { IntegrationAccountWithBot } from "@/lib/db/queries";
import { handleQQInboundMessage } from "./handler";

const DEBUG = process.env.DEBUG_QQBOT === "true";
const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_API_BASE = "https://api.sgroup.qq.com";
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const MAX_RECONNECT_ATTEMPTS = 50;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 5000;
const processedMessageIds = new Map<string, number>();

type QQCredentials = { appId?: string; appSecret?: string };

interface QQConnection {
  accountId: string;
  userId: string;
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number];
  ws: WebSocket | null;
  appId: string;
  appSecret: string;
  authToken?: string;
  /** Most recent seq received, used for heartbeat */
  lastSeq: number | null;
  /** access_token, used for IDENTIFY/RESUME after HELLO */
  accessToken?: string;
  /** Heartbeat timer */
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const connections = new Map<string, QQConnection>();

function pruneProcessedIds(): void {
  const now = Date.now();
  for (const [key, ts] of processedMessageIds.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedMessageIds.delete(key);
  }
  // Enforce max size to prevent unbounded memory growth
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

async function getAccessToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  const resp = await fetch(QQ_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
  });
  const json = (await resp.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    message?: string;
  } | null;
  if (!resp.ok || !json?.access_token) {
    throw new Error(json?.message ?? `HTTP ${resp.status}`);
  }
  return json.access_token;
}

async function getGatewayUrl(accessToken: string): Promise<string> {
  const resp = await fetch(`${QQ_API_BASE}/gateway`, {
    headers: { Authorization: `QQBot ${accessToken}` },
  });
  const json = (await resp.json().catch(() => null)) as { url?: string } | null;
  if (!resp.ok || !json?.url) {
    throw new Error("Failed to get QQ Gateway URL");
  }
  return json.url;
}

/** Parse C2C message event d */
function parseC2CMessage(d: any): {
  openid: string;
  content: string;
  messageId: string;
} | null {
  const author = d?.author;
  const openid = author?.user_openid ?? author?.open_id ?? d?.openid;
  const content =
    typeof d?.content === "string"
      ? d.content
      : String(d?.content ?? "").trim();
  const messageId = d?.id ?? d?.message_id ?? "";
  if (!openid || !messageId) return null;
  return { openid, content, messageId };
}

/** Parse group @ message event d */
function parseGroupMessage(d: any): {
  groupOpenid: string;
  senderId: string;
  content: string;
  messageId: string;
} | null {
  const groupOpenid = d?.group_openid ?? d?.group_id;
  const author = d?.author;
  const senderId =
    author?.member_openid ?? author?.user_openid ?? author?.open_id ?? "";
  const content =
    typeof d?.content === "string"
      ? d.content
      : String(d?.content ?? "").trim();
  const messageId = d?.id ?? d?.message_id ?? "";
  if (!groupOpenid || !messageId) return null;
  return { groupOpenid, senderId, content, messageId };
}

/**
 * Start WebSocket connection for a single QQ integration account
 */
export async function startQQConnection(
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number],
  authToken?: string,
): Promise<void> {
  if (account.platform !== "qqbot") return;

  const credentials = loadIntegrationCredentials<QQCredentials>(account);
  const appId = credentials?.appId?.trim();
  const appSecret = credentials?.appSecret?.trim();
  if (!appId || !appSecret) {
    if (DEBUG)
      console.warn("[QQBot] Account %s missing appId/appSecret", account.id);
    return;
  }

  const accountId = account.id;
  const existing = connections.get(accountId);
  if (existing) {
    if (authToken?.trim()) existing.authToken = authToken.trim();
    if (DEBUG) console.log("[QQBot] Account %s already connecting", accountId);
    return;
  }

  const conn: QQConnection = {
    accountId,
    userId: account.userId,
    account,
    ws: null,
    appId,
    appSecret,
    authToken: authToken?.trim(),
    lastSeq: null,
    accessToken: undefined,
    heartbeatInterval: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
  };
  connections.set(accountId, conn);

  async function connect(): Promise<void> {
    if (
      conn.ws &&
      (conn.ws.readyState === WebSocket.OPEN ||
        conn.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const token = await getAccessToken(conn.appId, conn.appSecret);
      conn.accessToken = token;
      const gatewayUrl = await getGatewayUrl(token);
      if (DEBUG)
        console.log("[QQBot] Connecting to Gateway accountId=%s", accountId);

      const ws = new WebSocket(gatewayUrl);
      conn.ws = ws;

      ws.on("open", () => {
        conn.reconnectAttempts = 0;
        if (DEBUG)
          console.log("[QQBot] WebSocket connected accountId=%s", accountId);
      });

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        const raw = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : String(data);
        let payload: { op?: number; t?: string; d?: any; s?: number };
        try {
          payload = JSON.parse(raw) as {
            op?: number;
            t?: string;
            d?: any;
            s?: number;
          };
        } catch {
          return;
        }

        const op = payload.op;
        const t = payload.t;
        const d = payload.d;

        // Record seq (used for heartbeat and optional resume)
        if (typeof payload.s === "number") {
          conn.lastSeq = payload.s;
        }

        // op 10 = HELLO, includes heartbeat interval, need to send IDENTIFY here and start heartbeat
        if (op === 10) {
          const interval = d?.heartbeat_interval;
          if (typeof interval === "number") {
            if (conn.heartbeatInterval) {
              clearInterval(conn.heartbeatInterval);
            }
            conn.heartbeatInterval = setInterval(() => {
              if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(
                  JSON.stringify({ op: 1, d: conn.lastSeq ?? null }),
                );
                if (DEBUG) {
                  console.log(
                    "[QQBot] Heartbeat sent accountId=%s seq=%s",
                    accountId,
                    conn.lastSeq,
                  );
                }
              }
            }, interval);
          }

          // Send IDENTIFY (simplified version, no multi-level intents fallback)
          const accessToken = conn.accessToken;
          if (accessToken) {
            // FULL permissions: guild + DM + group (consistent with qqbot INTENT_LEVELS.full)
            const intents =
              (1 << 30) | // PUBLIC_GUILD_MESSAGES
              (1 << 12) | // DIRECT_MESSAGE
              (1 << 25); // GROUP_AND_C2C
            if (DEBUG) {
              console.log(
                "[QQBot] Sending IDENTIFY accountId=%s intents=%s",
                accountId,
                intents,
              );
            }
            ws.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: `QQBot ${accessToken}`,
                  intents,
                  shard: [0, 1],
                },
              }),
            );
          }
          return;
        }

        // op 0 = dispatch (event)
        if (op !== 0 || !t) return;

        // READY etc. can be ignored
        if (t === "READY") {
          if (DEBUG) console.log("[QQBot] READY accountId=%s", accountId);
          return;
        }

        if (t === "C2C_MESSAGE_CREATE") {
          const parsed = parseC2CMessage(d);
          if (!parsed) return;
          const { openid, content, messageId } = parsed;
          const dedupKey = `${accountId}:${messageId}`;
          if (processedMessageIds.has(dedupKey)) return;
          processedMessageIds.set(dedupKey, Date.now());
          pruneProcessedIds();

          const acc = conn.account as IntegrationAccountWithBot;
          if (!acc.bot) return;
          bulkUpsertContacts([
            {
              userId: acc.userId,
              contactId: openid,
              contactName: openid,
              type: "private",
              botId: acc.bot.id,
              contactMeta: { platform: "qqbot", chatType: "c2c", openid },
            },
          ]).catch((err) =>
            console.error("[QQBot] bulkUpsertContacts failed", err),
          );

          setImmediate(() => {
            handleQQInboundMessage(
              acc,
              {
                openid,
                messageId,
                content,
                chatType: "c2c",
                senderId: openid,
              },
              { authToken: conn.authToken },
            ).catch((err) =>
              console.error("[QQBot] Failed to process C2C message", err),
            );
          });
          return;
        }

        if (t === "GROUP_AT_MESSAGE_CREATE") {
          const parsed = parseGroupMessage(d);
          if (!parsed) return;
          const { groupOpenid, senderId, content, messageId } = parsed;
          const dedupKey = `${accountId}:${messageId}`;
          if (processedMessageIds.has(dedupKey)) return;
          processedMessageIds.set(dedupKey, Date.now());
          pruneProcessedIds();

          const acc = conn.account as IntegrationAccountWithBot;
          if (!acc.bot) return;
          bulkUpsertContacts([
            {
              userId: acc.userId,
              contactId: groupOpenid,
              contactName: groupOpenid,
              type: "group",
              botId: acc.bot.id,
              contactMeta: {
                platform: "qqbot",
                chatType: "group",
                groupOpenid,
              },
            },
          ]).catch((err) =>
            console.error("[QQBot] bulkUpsertContacts failed", err),
          );

          setImmediate(() => {
            handleQQInboundMessage(
              acc,
              {
                groupOpenid,
                messageId,
                content,
                chatType: "group",
                senderId,
              },
              { authToken: conn.authToken },
            ).catch((err) =>
              console.error("[QQBot] Failed to process group message", err),
            );
          });
        }
      });

      ws.on("error", (err) => {
        console.error("[QQBot] WebSocket error accountId=%s", accountId, err);
      });

      ws.on("close", () => {
        conn.ws = null;
        if (conn.heartbeatInterval) {
          clearInterval(conn.heartbeatInterval);
          conn.heartbeatInterval = null;
        }
        if (conn.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(
            "[QQBot] Max reconnection attempts reached accountId=%s",
            accountId,
          );
          connections.delete(accountId);
          return;
        }
        const delay =
          RECONNECT_DELAYS[
            Math.min(conn.reconnectAttempts, RECONNECT_DELAYS.length - 1)
          ];
        conn.reconnectAttempts += 1;
        conn.reconnectTimer = setTimeout(() => {
          conn.reconnectTimer = null;
          connect();
        }, delay);
      });
    } catch (err) {
      console.error("[QQBot] Connection failed accountId=%s", accountId, err);
      conn.ws = null;
      const delay =
        RECONNECT_DELAYS[
          Math.min(conn.reconnectAttempts, RECONNECT_DELAYS.length - 1)
        ];
      conn.reconnectAttempts += 1;
      conn.reconnectTimer = setTimeout(() => {
        conn.reconnectTimer = null;
        connect();
      }, delay);
    }
  }

  await connect();
}

export function stopQQConnection(accountId: string): void {
  const conn = connections.get(accountId);
  if (!conn) return;
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.ws) {
    conn.ws.removeAllListeners();
    conn.ws.close();
    conn.ws = null;
  }
  if (conn.heartbeatInterval) {
    clearInterval(conn.heartbeatInterval);
    conn.heartbeatInterval = null;
  }
  connections.delete(accountId);
  if (DEBUG) console.log("[QQBot] Disconnected accountId=%s", accountId);
}

export async function startQQListenersForUser(
  userId: string,
  authToken?: string,
): Promise<void> {
  const accounts = await getIntegrationAccountsByUserId({ userId });
  const qqAccounts = accounts.filter((a) => a.platform === "qqbot");
  for (const account of qqAccounts) {
    await startQQConnection(account, authToken);
  }
}

export async function startAllQQListeners(authToken?: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const { integrationAccounts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ userId: integrationAccounts.userId })
    .from(integrationAccounts)
    .where(eq(integrationAccounts.platform, "qqbot"));

  const userIdList = rows
    .map((r: { userId: string | null }) => r.userId)
    .filter(
      (id: string | null): id is string =>
        typeof id === "string" && id.length > 0,
    );
  const uniqueIds = Array.from(new Set<string>(userIdList));
  for (const userId of uniqueIds) {
    await startQQListenersForUser(userId, authToken);
  }
  if (DEBUG)
    console.log("[QQBot] Started %s QQ WebSocket connections", rows.length);
}
