/**
 * Feishu (Lark) Conversation Store
 *
 * Session file per chat: ~/.alloomi/data/memory/{domain}-sessions/{userId}__{chatType}__{chatId}.json
 * Used to persist merged API history + local turns; context is trimmed by character budget for the model.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getAppMemoryDir(): string {
  return join(homedir(), ".alloomi", "data", "memory");
}

type FeishuDomain = "feishu" | "lark";
type ChatType = "p2p" | "group";

export type RuntimeConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

interface StoredMessage {
  messageId?: string;
  role: "user" | "assistant";
  content: string;
  /** Unix ms */
  timestamp: number;
  senderId?: string;
  senderName?: string;
  quoteIds?: string[];
  imageKeys?: string[];
}

interface SessionFile {
  version: 1;
  platform: "feishu";
  domain: FeishuDomain;
  ownerUserId: string;
  chatId: string;
  chatType: ChatType;
  updatedAt: number;
  messages: StoredMessage[];
}

export type QuotedMessage = {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  senderId?: string;
  senderName?: string;
  imageKeys?: string[];
};

const MAX_MESSAGES_PER_SESSION = 5000;
/** 群聊会话文件最多保留时长（与拉取窗口一致时可再裁剪） */
const RETENTION_MS = 4 * 24 * 60 * 60 * 1000;

function charCountUnicode(s: string): number {
  return [...s].length;
}

/** 从时间正序的消息列表尾部取子串，使总字数（Unicode 码点）不超过 maxChars */
export function trimHistoryByCharBudget(
  messages: RuntimeConversationMessage[],
  maxChars: number,
): RuntimeConversationMessage[] {
  if (maxChars <= 0 || messages.length === 0) return [];
  const out: RuntimeConversationMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const add = charCountUnicode(m.content);
    if (used + add > maxChars) break;
    out.push(m);
    used += add;
  }
  return out.reverse();
}

class FeishuConversationStore {
  private static writeQueues = new Map<string, Promise<void>>();
  private readonly memoryDir: string;
  private readonly domain: FeishuDomain;
  private readonly sessionsDir: string;
  private readonly sessionScope: string;

  constructor(
    domain: FeishuDomain = "feishu",
    memoryDir?: string,
    sessionScope?: string,
  ) {
    this.domain = domain;
    this.memoryDir = memoryDir ?? getAppMemoryDir();
    this.sessionsDir = join(this.memoryDir, "channels", this.domain);
    this.sessionScope =
      sessionScope && sessionScope.trim().length > 0
        ? sessionScope.trim()
        : "default";
    this.ensureSessionsDir();
  }

  /** 本地已存消息的最新时间戳（秒），无则 null */
  getLatestStoredTimestampSec(
    userId: string,
    chatId: string,
    chatType: ChatType,
  ): number | null {
    const session = this.readSession(userId, chatType, chatId);
    if (!session?.messages.length) return null;
    let maxSec = 0;
    for (const m of session.messages) {
      maxSec = Math.max(maxSec, Math.floor(m.timestamp / 1000));
    }
    return maxSec > 0 ? maxSec : null;
  }

  /**
   * 合并远端拉取的消息（按 messageId 去重），并裁剪早于 retainNotBeforeMs 的记录
   */
  async mergePulledMessages(params: {
    userId: string;
    chatId: string;
    chatType: ChatType;
    items: Array<{
      messageId: string;
      timestampSec: number;
      senderId: string;
      senderName?: string;
      role: "user" | "assistant";
      content: string;
      quoteIds?: string[];
      imageKeys?: string[];
    }>;
    retainNotBeforeMs: number;
  }): Promise<void> {
    if (params.items.length === 0) return;
    await this.withWriteLock(
      this.getSessionFilePath(params.userId, params.chatType, params.chatId),
      async () => {
        const session =
          this.readSession(params.userId, params.chatType, params.chatId) ??
          this.createEmptySession(
            params.userId,
            params.chatId,
            params.chatType,
          );
        const seen = new Set(
          session.messages.map((m) => m.messageId).filter(Boolean) as string[],
        );
        for (const it of params.items) {
          if (seen.has(it.messageId)) continue;
          seen.add(it.messageId);
          session.messages.push({
            messageId: it.messageId,
            role: it.role,
            content: it.content,
            timestamp: it.timestampSec * 1000,
            senderId: it.senderId,
            senderName: it.senderName,
            quoteIds: it.quoteIds,
            imageKeys: it.imageKeys,
          });
        }
        session.messages.sort((a, b) => a.timestamp - b.timestamp);
        this.pruneSession(session, params.retainNotBeforeMs);
        session.updatedAt = Date.now();
        this.writeSessionAtomically(
          this.getSessionFilePath(
            params.userId,
            params.chatType,
            params.chatId,
          ),
          session,
        );
      },
    );
  }

  /** 用于模型上下文：时间正序，总字数不超过 maxChars（保留最近的一段） */
  getHistoryForContext(
    userId: string,
    chatId: string,
    chatType: ChatType,
    maxChars: number,
    options?: { excludeMessageIds?: Set<string> },
  ): RuntimeConversationMessage[] {
    const session = this.readSession(userId, chatType, chatId);
    const raw = (session?.messages ?? [])
      .filter((m) => {
        if (!m.messageId || !options?.excludeMessageIds) return true;
        return !options.excludeMessageIds.has(m.messageId);
      })
      .map(
        (m): RuntimeConversationMessage => ({
          role: m.role,
          content: m.content,
        }),
      );
    return trimHistoryByCharBudget(raw, maxChars);
  }

  getHistoryEntriesForContext(
    userId: string,
    chatId: string,
    chatType: ChatType,
    maxChars: number,
    options?: { excludeMessageIds?: Set<string> },
  ): QuotedMessage[] {
    const session = this.readSession(userId, chatType, chatId);
    const source = (session?.messages ?? []).filter((m) => {
      if (!m.messageId || !options?.excludeMessageIds) return true;
      return !options.excludeMessageIds.has(m.messageId);
    });

    const picked: StoredMessage[] = [];
    let used = 0;
    for (let i = source.length - 1; i >= 0; i--) {
      const m = source[i]!;
      const add = charCountUnicode(m.content);
      if (used + add > maxChars) break;
      picked.push(m);
      used += add;
    }
    picked.reverse();

    return picked
      .filter((m): m is StoredMessage & { messageId: string } => !!m.messageId)
      .map((m) => ({
        messageId: m.messageId,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        senderId: m.senderId,
        senderName: m.senderName,
      }));
  }

  getQuotedMessagesByIds(
    userId: string,
    chatId: string,
    chatType: ChatType,
    quoteIds: string[],
  ): QuotedMessage[] {
    if (quoteIds.length === 0) return [];
    const session = this.readSession(userId, chatType, chatId);
    const byId = new Map<string, StoredMessage>();
    for (const m of session?.messages ?? []) {
      if (!m.messageId) continue;
      byId.set(m.messageId, m);
    }
    const out: QuotedMessage[] = [];
    for (const id of quoteIds) {
      const hit = byId.get(id);
      if (!hit || !hit.messageId) continue;
      out.push({
        messageId: hit.messageId,
        role: hit.role,
        content: hit.content,
        timestamp: hit.timestamp,
        senderId: hit.senderId,
        imageKeys: hit.imageKeys,
      });
    }
    return out;
  }

  /** @deprecated 兼容旧调用；等价于仅 p2p 的会话文件读取后按字数裁切 */
  getConversationHistory(
    userId: string,
    accountId: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    return this.getHistoryForContext(userId, accountId, "p2p", 20_000);
  }

  addMessage(
    userId: string,
    accountId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    void this.appendTurn({
      userId,
      chatId: accountId,
      chatType: "p2p",
      message: {
        role,
        content,
        timestamp: Date.now(),
      },
    });
  }

  async appendTurn(params: {
    userId: string;
    chatId: string;
    chatType: ChatType;
    message: Omit<StoredMessage, "messageId"> & { messageId?: string };
  }): Promise<void> {
    await this.withWriteLock(
      this.getSessionFilePath(params.userId, params.chatType, params.chatId),
      async () => {
        const session =
          this.readSession(params.userId, params.chatType, params.chatId) ??
          this.createEmptySession(
            params.userId,
            params.chatId,
            params.chatType,
          );
        const mid = params.message.messageId;
        if (mid) {
          const existing = session.messages.find((m) => m.messageId === mid);
          if (existing) {
            if (!existing.content?.trim() && params.message.content?.trim()) {
              existing.content = params.message.content;
            }
            if (!existing.senderId && params.message.senderId) {
              existing.senderId = params.message.senderId;
            }
            if (!existing.senderName && params.message.senderName) {
              existing.senderName = params.message.senderName;
            }
            if (
              (!existing.quoteIds || existing.quoteIds.length === 0) &&
              params.message.quoteIds &&
              params.message.quoteIds.length > 0
            ) {
              existing.quoteIds = params.message.quoteIds;
            }
            if (
              (!existing.imageKeys || existing.imageKeys.length === 0) &&
              params.message.imageKeys &&
              params.message.imageKeys.length > 0
            ) {
              existing.imageKeys = params.message.imageKeys;
            }
            if (
              typeof existing.timestamp !== "number" ||
              !Number.isFinite(existing.timestamp)
            ) {
              existing.timestamp = params.message.timestamp;
            }
            session.updatedAt = Date.now();
            this.writeSessionAtomically(
              this.getSessionFilePath(
                params.userId,
                params.chatType,
                params.chatId,
              ),
              session,
            );
            return;
          }
        }
        session.messages.push({
          messageId: mid,
          role: params.message.role,
          content: params.message.content,
          timestamp: params.message.timestamp,
          senderId: params.message.senderId,
          senderName: params.message.senderName,
          quoteIds: params.message.quoteIds,
          imageKeys: params.message.imageKeys,
        });
        const floor = Date.now() - RETENTION_MS;
        this.pruneSession(session, floor);
        session.updatedAt = Date.now();
        this.writeSessionAtomically(
          this.getSessionFilePath(
            params.userId,
            params.chatType,
            params.chatId,
          ),
          session,
        );
      },
    );
  }

  clearConversation(userId: string, chatId: string): void {
    for (const chatType of ["p2p", "group"] as const) {
      const path = this.getSessionFilePath(userId, chatType, chatId);
      try {
        if (existsSync(path)) rmSync(path);
      } catch (e) {
        console.warn(`[FeishuConversationStore] clear failed ${path}`, e);
      }
    }
  }

  clearAllConversations(userId: string): void {
    if (!existsSync(this.sessionsDir)) return;
    const prefix = `${this.safeFileToken(userId)}__`;
    for (const name of readdirSync(this.sessionsDir)) {
      if (!name.endsWith(".json")) continue;
      if (!name.startsWith(prefix)) continue;
      try {
        rmSync(join(this.sessionsDir, name));
      } catch (e) {
        console.warn(`[FeishuConversationStore] clear user file ${name}`, e);
      }
    }
  }

  private withWriteLock(
    filePath: string,
    task: () => Promise<void> | void,
  ): Promise<void> {
    const prev = FeishuConversationStore.writeQueues.get(filePath);
    const run = (prev ?? Promise.resolve())
      .catch(() => {})
      .then(async () => task());
    FeishuConversationStore.writeQueues.set(filePath, run);
    return run.finally(() => {
      if (FeishuConversationStore.writeQueues.get(filePath) === run) {
        FeishuConversationStore.writeQueues.delete(filePath);
      }
    });
  }

  async patchMessageImageKeys(params: {
    userId: string;
    chatId: string;
    chatType: ChatType;
    messageId: string;
    imageKeys: string[];
  }): Promise<void> {
    if (!params.messageId?.trim() || params.imageKeys.length === 0) return;
    await this.withWriteLock(
      this.getSessionFilePath(params.userId, params.chatType, params.chatId),
      async () => {
        const session = this.readSession(
          params.userId,
          params.chatType,
          params.chatId,
        );
        if (!session?.messages?.length) return;
        const target = session.messages.find(
          (m) => m.messageId === params.messageId,
        );
        if (!target) return;
        const merged = new Set<string>(target.imageKeys ?? []);
        for (const key of params.imageKeys) {
          const k = key?.trim();
          if (k) merged.add(k);
        }
        const nextKeys = [...merged];
        if (nextKeys.length === (target.imageKeys?.length ?? 0)) return;
        target.imageKeys = nextKeys;
        session.updatedAt = Date.now();
        this.writeSessionAtomically(
          this.getSessionFilePath(
            params.userId,
            params.chatType,
            params.chatId,
          ),
          session,
        );
      },
    );
  }

  private ensureSessionsDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private createEmptySession(
    userId: string,
    chatId: string,
    chatType: ChatType,
  ): SessionFile {
    return {
      version: 1,
      platform: "feishu",
      domain: this.domain,
      ownerUserId: userId,
      chatId,
      chatType,
      updatedAt: Date.now(),
      messages: [],
    };
  }

  private readSession(
    userId: string,
    chatType: ChatType,
    chatId: string,
  ): SessionFile | null {
    const path = this.getSessionFilePath(userId, chatType, chatId);
    const legacyPath = this.getLegacySessionFilePath(userId, chatType, chatId);
    try {
      const candidate = existsSync(path)
        ? path
        : existsSync(legacyPath)
          ? legacyPath
          : null;
      if (!candidate) return null;
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as SessionFile;
      if (!Array.isArray(parsed.messages)) return null;
      return parsed;
    } catch (e) {
      console.warn(`[FeishuConversationStore] read failed ${path}`, e);
      return null;
    }
  }

  private writeSessionAtomically(filePath: string, data: SessionFile): void {
    const tmpPath = `${filePath}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    writeFileSync(tmpPath, payload, "utf-8");
    renameSync(tmpPath, filePath);
  }

  private pruneSession(session: SessionFile, retainNotBeforeMs: number): void {
    session.messages = session.messages
      .filter((m) => m.timestamp >= retainNotBeforeMs)
      .slice(-MAX_MESSAGES_PER_SESSION);
  }

  private getSessionFilePath(
    userId: string,
    chatType: ChatType,
    chatId: string,
  ): string {
    const fileName = `${this.safeFileToken(userId)}__${this.safeFileToken(this.sessionScope)}__${chatType}__${this.safeFileToken(chatId)}.json`;
    return join(this.sessionsDir, fileName);
  }

  private getLegacySessionFilePath(
    userId: string,
    chatType: ChatType,
    chatId: string,
  ): string {
    const fileName = `${this.safeFileToken(userId)}__${chatType}__${this.safeFileToken(chatId)}.json`;
    return join(this.sessionsDir, fileName);
  }

  private safeFileToken(raw: string): string {
    return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}

export {
  FeishuConversationStore,
  type FeishuDomain,
  type ChatType,
  type StoredMessage,
};
