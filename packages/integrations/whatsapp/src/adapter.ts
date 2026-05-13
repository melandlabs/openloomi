/**
 * WhatsApp Adapter using @whiskeysockets/baileys (WebSocket protocol)
 *
 * Replaces whatsapp-web.js (Puppeteer/Chromium) with Baileys WebSocket.
 * No browser = no automation detection surface.
 *
 * This adapter is platform-agnostic - web-specific dependencies are provided
 * via interfaces (CredentialStore, FileIngester, ClientRegistry, etc.)
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  proto,
  type WAMessage,
  type WASocket,
  fetchLatestBaileysVersion,
  makeWASocket,
  type ConnectionState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { downloadMediaMessage } from "@whiskeysockets/baileys/lib/Utils/messages";
import pino from "pino";
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";
import type {
  Image as openloomiImage,
  Message as openloomiMessage,
  File as openloomiFile,
  Messages,
} from "@openloomi/integrations/channels";
import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";
import type {
  BaileysAuthStateProvider,
  ClientRegistry,
  FileIngester,
  ConfigProvider,
} from "@openloomi/integrations/core";

const DEBUG = process.env.DEBUG_WHATSAPP === "true";

const maxDialogCount = 100;
const maxMessageCount = 200;
const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;
const WHATSAPP_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type WhatsAppDialogInfo = {
  id: string;
  name: string;
  type: "private" | "group";
};

export type WhatsAppUserInfo = {
  wid: string;
  pushName?: string;
  formattedNumber?: string;
};

type WhatsAppLoginCallbacks = {
  onQr?: (qr: string) => Promise<void> | void;
  onCode?: (code: string) => Promise<void> | void;
  onSession?: (session: unknown) => Promise<void> | void;
  onReady?: (info: WhatsAppUserInfo) => Promise<void> | void;
  onError?: (error: Error) => Promise<void> | void;
};

type LoginDeferred = {
  resolveFirstQr: (qr: string) => void;
  rejectFirstQr: (error: Error) => void;
  firstQrResolved: boolean;
  callbacks: WhatsAppLoginCallbacks;
  rejectLogin: (error: Error) => void;
};

function isImageMessage(message: openloomiMessage): message is openloomiImage {
  if (typeof message !== "object" || message === null) return false;
  if (!("url" in message) && !("base64" in message)) return false;
  return !isFileMessage(message);
}

function isFileMessage(message: openloomiMessage): message is openloomiFile {
  if (typeof message !== "object" || message === null) return false;
  return "url" in message && "name" in message;
}

/**
 * Module-level registry of active WhatsAppAdapters by sessionId.
 * Used by QR login to expose the adapter for socket re-registration by accountId.
 */
const activeAdapters = new Map<string, WhatsAppAdapter>();

/**
 * Export active adapters map so other modules (self-listener, QR route) can
 * store/retrieve adapters by accountId key.
 */
export { activeAdapters };

export class WhatsAppAdapter extends MessagePlatformAdapter {
  sock: WASocket | null = null;
  botId: string;
  messages: Messages;
  name = "";

  private sessionId: string;
  private authStateProvider: BaileysAuthStateProvider | undefined;
  private authState: Awaited<
    ReturnType<BaileysAuthStateProvider["createAuthState"]>
  > | null = null;
  private isReady = false;
  /** In-memory chat list (replaces makeInMemoryStore in v7). Updated via chats.upsert events. */
  private chats: Map<string, WhatsAppDialogInfo> = new Map();
  private asyncIteratorState = {
    chatIds: [] as string[],
    currentChatIndex: 0,
    currentMessageIndex: 0,
    offsetDate: 0,
    isInitialized: false,
  };
  private isAuthenticated = false;
  private initializationPromise: Promise<void> | null = null;
  /** Exposed so other adapters (e.g. insights bot) can await socket readiness. */
  get pendingInitialization(): Promise<void> | null {
    return this.initializationPromise;
  }
  private loginDeferred: LoginDeferred | null = null;
  private ownerUserId?: string;
  private ownerUserType?: string;
  private eventCleanup: Array<() => void> = [];
  /** Pending reconnect socket creation, used to prevent concurrent reconnects */
  private _pendingReconnect: Promise<WASocket> | null = null;
  /** Cache of recently sent messages for msgRetry requests (max 256 entries). */
  private sentMessageCache: Map<string, proto.IMessage>;
  private fileIngester?: FileIngester;
  private clientRegistry?: ClientRegistry;
  private configProvider?: ConfigProvider;

  constructor(opts?: {
    botId?: string;
    ownerUserId?: string;
    ownerUserType?: string;
    /** Override sessionId — used by insight bot to reuse QR login's session */
    sessionKey?: string;
    authStateProvider: BaileysAuthStateProvider;
    fileIngester?: FileIngester;
    clientRegistry?: ClientRegistry;
    configProvider?: ConfigProvider;
  }) {
    super();
    this.botId = opts?.botId ?? "";
    this.sessionId =
      (opts?.sessionKey ?? this.botId) || `wa-${randomUUID().slice(0, 8)}`;
    this.messages = [];
    this.ownerUserId = opts?.ownerUserId;
    this.ownerUserType = opts?.ownerUserType;
    this.authStateProvider = opts?.authStateProvider;
    this.fileIngester = opts?.fileIngester;
    this.clientRegistry = opts?.clientRegistry;
    this.configProvider = opts?.configProvider;
    // Initialize sentMessageCache once here so it persists across createSocket()
    // calls and reconnections — the getMessage closure captures this reference.
    this.sentMessageCache = new Map<string, proto.IMessage>();

    // Prevent duplicate socket creation — if another adapter already has a socket
    // for this botId registered in the client registry, reuse it (same as Telegram).
    let existingSock: WASocket | undefined;
    if (this.clientRegistry) {
      existingSock = this.clientRegistry.getClientBySessionKey(this.botId) as
        | WASocket
        | undefined;
    }

    // Also check activeAdapters — QR route stores adapter under accountId,
    // so self-listener's adapter (with botId=accountId) can find it.
    if (!existingSock && this.botId) {
      const existingAdapter = activeAdapters.get(this.botId);
      if (existingAdapter?.sock) {
        existingSock = existingAdapter.sock as WASocket;
        if (DEBUG)
          console.log(
            `[whatsapp] [${this.sessionId}] Found existing socket in activeAdapters for botId=${this.botId}, reusing`,
          );
      }
    }

    if (existingSock) {
      this.sock = existingSock;
      this.isReady = true;
      this.isAuthenticated = true;
      // Set up listeners so callbacks (e.g. onReady) get triggered
      this.setupListenersOnSocket(existingSock);
    }
  }

  /**
   * Register the socket under an additional key (e.g. account.id).
   * Call this after QR login succeeds and integration account is created,
   * so self-listener and insight bot can find the socket by accountId.
   */
  setRegisterSocketAs(key: string): void {
    const sock = this.sock;
    if (sock && this.clientRegistry) {
      this.clientRegistry.registerClient(key, sock);
      if (DEBUG)
        console.log(
          `[whatsapp] [${this.sessionId}] Socket also registered under ${key}`,
        );
    }
  }

  /**
   * Find an active adapter by sessionId and register its socket under accountId.
   * Called from guest-guide after integration account is created.
   */
  static registerSocketByAccountId(sessionId: string, accountId: string): void {
    const adapter = activeAdapters.get(sessionId);
    if (!adapter) {
      if (DEBUG)
        console.log(
          `[whatsapp] [${sessionId}] No active adapter found to register under ${accountId}`,
        );
      return;
    }
    adapter.setRegisterSocketAs(accountId);
  }

  private async ensureAuthState() {
    if (this.authState) return this.authState;
    if (!this.authStateProvider) {
      throw new Error("authStateProvider is required but not provided");
    }
    this.authState = await this.authStateProvider.createAuthState(
      this.sessionId,
    );
    return this.authState;
  }

  /**
   * Create and connect the Baileys socket with in-memory store.
   * Auth state must be loaded (await ensureAuthState()) before calling this.
   */
  private async createSocket(): Promise<WASocket> {
    if (DEBUG)
      console.log(
        `[whatsapp] [${this.sessionId}] createSocket() called, current sock: ${!!this.sock}`,
      );

    // Reuse existing sentMessageCache on reconnect so pending msgRetry requests
    // can still find cached plaintext from before the reconnect.
    const existingCache = this.sock
      ? (this.sock as any).sentMessageCache
      : undefined;
    if (existingCache) {
      this.sentMessageCache = existingCache;
      if (DEBUG)
        console.log(
          `[whatsapp] [${this.sessionId}] Reusing existing sentMessageCache on reconnect`,
        );
    }

    // Ensure auth state is loaded before passing to makeWASocket
    const auth = await this.ensureAuthState();
    if (DEBUG)
      console.log(
        `[whatsapp] [${this.sessionId}] Auth state loaded, me: ${!!auth.creds.me?.id}`,
      );

    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: DEBUG ? "debug" : "silent" });

    const sock = makeWASocket({
      version,
      auth,
      logger,
      printQRInTerminal: false,
      browser: ["openloomi", "Desktop", "0.3.0"],
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30_000,
      syncFullHistory: true,
      // Required for Note-to-Self message delivery — without this, self-chat
      // messages stay in "waiting for this message" indefinitely. Baileys wraps
      // self-messages in deviceSentMessage and needs getMessage() to respond to
      // msgRetry requests from the phone so it can retransmit the plaintext.
      getMessage: async (key) => {
        if (DEBUG)
          console.log(
            `[whatsapp] [${this.sessionId}] getMessage called: id=${key.id} remoteJid=${key.remoteJid} fromMe=${key.fromMe}`,
          );
        // Check sent message cache (AI replies cached for msgRetry requests).
        // v7 also uses messageRetryManager internally when enableRecentMessageCache is enabled.
        const cached = this.sentMessageCache.get(key.id || "");
        if (cached) {
          if (DEBUG)
            console.log(
              `[whatsapp] [${this.sessionId}] getMessage: CACHE HIT for ${key.id}`,
            );
          return cached;
        }
        if (DEBUG)
          console.log(
            `[whatsapp] [${this.sessionId}] getMessage: NOT FOUND for ${key.id} (remoteJid=${key.remoteJid}), returning empty`,
          );
        // 3. Return empty message rather than undefined — prevents indefinite
        // "waiting for this message" when the content is genuinely not available.
        return proto.Message.fromObject({});
      },
    });

    if (DEBUG)
      console.log(
        `[whatsapp] [${this.sessionId}] makeWASocket() returned, sock.ev exists: ${!!sock.ev}`,
      );

    // Attach sent message cache for msgRetry requests.
    // v7 also manages recent messages internally via messageRetryManager when
    // enableRecentMessageCache is enabled.
    (sock as any).sentMessageCache = this.sentMessageCache;

    // Store the socket so subsequent calls can reference it (reconnect flow)
    this.sock = sock;

    // Register immediately — before connection="open" fires — so other adapters
    // (e.g. insights bot) can't race and create a duplicate socket. The "connection=open"
    // handler will re-register with the same socket (idempotent), so this is safe.
    if (this.botId && this.clientRegistry) {
      this.clientRegistry.registerClient(this.botId, sock);
    }

    // Register internal event handlers
    this.registerInternalEvents(sock);

    // Cache incoming messages so getMessage() can return them for msgRetry requests.
    // When a self-message is sent from the phone, WhatsApp requests the plaintext
    // via msgRetry. Without this cache, getMessage returns empty and the phone shows
    // "waiting for this message".
    sock.ev.on("messages.upsert", (data) => {
      for (const msg of data.messages) {
        if (msg.key.id && msg.message) {
          this.sentMessageCache.set(msg.key.id, msg.message);
          if (this.sentMessageCache.size > 256) {
            const oldest = this.sentMessageCache.keys().next().value;
            if (oldest) this.sentMessageCache.delete(oldest);
          }
        }
        if (DEBUG) {
          console.log(
            `[whatsapp] [DEBUG] messages.upsert: jid=${msg.key.remoteJid} fromMe=${msg.key.fromMe} id=${msg.key.id}`,
          );
        }
      }
    });

    return sock;
  }

  private registerInternalEvents(sock: WASocket) {
    // Connection state updates — QR, open, close
    const connHandler = (update: Partial<ConnectionState>) => {
      const { connection, qr, lastDisconnect } = update;

      if (DEBUG)
        console.log(
          `[whatsapp] connection update: ${connection}, hasQR: ${!!qr}`,
        );

      if (qr) {
        this.isAuthenticated = false;
        if (DEBUG)
          console.log(
            `[whatsapp] [${this.sessionId}] QR received (len=${qr.length}), loginDeferred exists: ${!!this.loginDeferred}, firstQrResolved: ${this.loginDeferred?.firstQrResolved ?? false}`,
          );
        if (this.loginDeferred && !this.loginDeferred.firstQrResolved) {
          this.loginDeferred.firstQrResolved = true;
          this.loginDeferred.resolveFirstQr(qr);
        }
        void this.loginDeferred?.callbacks.onQr?.(qr);
        if (DEBUG)
          console.log(
            `[whatsapp] [${this.sessionId}] onQr callback fired, updating session...`,
          );
      }

      if (connection === "open") {
        this.isAuthenticated = true;
        this.isReady = true;

        // Fire login callbacks only once (guarded by firstQrResolved)
        if (this.loginDeferred?.firstQrResolved) {
          void this.handleLoginReady();
        }

        // Register in global registry so self-listener can find this socket
        if (this.botId && this.clientRegistry) {
          this.clientRegistry.registerClient(this.botId, sock);
          if (DEBUG)
            console.log(
              `[whatsapp] [${this.sessionId}] Socket registered in client registry, sock.user: ${sock.user?.id}`,
            );
        }
      }

      if (connection === "close") {
        const reason = lastDisconnect?.error?.message ?? "unknown";
        const errObj = lastDisconnect?.error as
          | (Error & {
              code?: string;
              tag?: string;
              statusCode?: number;
              output?: { statusCode?: number };
              attrs?: { code?: string | number };
              data?: unknown;
            })
          | undefined;
        const errorCode = errObj?.code ?? "N/A";
        const disconnectTag = errObj?.tag ?? "N/A";
        // Extract statusCode from: Boom.output.statusCode > attrs.code > direct statusCode
        const statusCode =
          (errObj as unknown as { output?: { statusCode?: number } })?.output
            ?.statusCode ??
          (typeof errObj?.attrs?.code === "string"
            ? Number.parseInt(errObj.attrs.code as unknown as string, 10)
            : (errObj?.attrs?.code as number | undefined)) ??
          errObj?.statusCode ??
          0;
        if (DEBUG)
          console.warn(
            `[whatsapp] Socket closed: ${reason} (code=${errorCode}, tag=${disconnectTag}, statusCode=${statusCode})`,
          );

        const wasClean =
          lastDisconnect?.error === undefined ||
          lastDisconnect?.error?.message?.includes("clean");

        if (!wasClean) {
          this.isReady = false;
          this.isAuthenticated = false;

          let err: Error =
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error
              : new Error(
                  (lastDisconnect?.error as unknown as { message?: string })
                    ?.message ?? "Connection failed",
                );

          // If this is a restartRequired (515) or timeout (408), just reconnect.
          // DO NOT reject the login promise — ensureReady() is already waiting
          // and will see isReady=true when the new socket opens (connection === "open").
          if (
            statusCode === DisconnectReason.restartRequired ||
            statusCode === DisconnectReason.timedOut ||
            statusCode === DisconnectReason.connectionReplaced
          ) {
            if (DEBUG)
              console.log(
                `[whatsapp] [${this.sessionId}] Got recoverable error (${statusCode}), reconnecting (no promise reject)...`,
              );
            // If a reconnect is already in flight, don't start another one.
            // The in-flight createSocket() will handle the reconnection.
            if (this._pendingReconnect) {
              if (DEBUG)
                console.log(
                  `[whatsapp] [${this.sessionId}] Reconnect already in progress, skipping...`,
                );
              return;
            }
            const oldSock = this.sock;
            this._pendingReconnect = new Promise<WASocket>((resolve) => {
              setTimeout(async () => {
                try {
                  // Kill the old socket to stop its listeners firing stale events
                  if (oldSock) {
                    await this.kill(oldSock);
                  }
                  const newSock = await this.createSocket();
                  resolve(newSock);
                } catch (err) {
                  if (DEBUG)
                    console.error(
                      `[whatsapp] [${this.sessionId}] Reconnect createSocket failed:`,
                      err,
                    );
                  resolve(null as unknown as WASocket);
                } finally {
                  this._pendingReconnect = null;
                }
              }, 500);
            });
            return;
          }

          // Terminal errors — give user-friendly message
          if (statusCode === DisconnectReason.loggedOut) {
            err = new Error(
              "WhatsApp session expired. Please disconnect and re-link your account.",
            );
          } else if (statusCode === DisconnectReason.forbidden) {
            err = new Error(
              "WhatsApp access denied. Your account may be banned.",
            );
          }

          // Pre-QR error: socket closed before QR was emitted
          // Reject the QR promise so the API route returns an error response
          if (!this.loginDeferred?.firstQrResolved && this.loginDeferred) {
            this.loginDeferred.rejectFirstQr(err);
            const cb = this.loginDeferred.callbacks.onError;
            if (cb) void cb(err);
            // Keep loginDeferred alive — reconnect logic may replace it
          }

          // Post-QR error: socket closed after QR was emitted
          // Reject the login promise so the frontend gets notified
          if (this.loginDeferred?.firstQrResolved) {
            this.loginDeferred.rejectLogin(err);
            const cb = this.loginDeferred.callbacks.onError;
            if (cb) void cb(err);
            // Keep loginDeferred alive — reconnect logic may replace it
          }
        }

        // Unregister from global registry
        if (this.botId && this.clientRegistry) {
          this.clientRegistry.unregisterClient(this.botId);
        }
      }
    };
    sock.ev.on("connection.update", connHandler);
    this.eventCleanup.push(() => sock.ev.off("connection.update", connHandler));

    // Auth state changes — save to disk so myAppStateKeyId and other keys persist
    const credsHandler = () => {
      if (this.isAuthenticated) {
        void this.saveAuthState().catch((e) =>
          DEBUG ? console.error("[whatsapp] saveCreds failed:", e) : undefined,
        );
      }
    };
    sock.ev.on("creds.update", credsHandler);
    this.eventCleanup.push(() => sock.ev.off("creds.update", credsHandler));

    // Populate in-memory chats map (used by getDialogs and chat history)
    sock.ev.on(
      "chats.upsert",
      (newChats: import("@whiskeysockets/baileys/lib/Types/Chat").Chat[]) => {
        for (const chat of newChats) {
          if (!chat.id || chat.id === "status@broadcast") continue;
          const name =
            (chat as any).name ?? (chat as any).subject ?? jidToUser(chat.id);
          this.chats.set(chat.id, {
            id: chat.id,
            name: name ?? jidToUser(chat.id),
            type: chat.id.endsWith("@g.us") ? "group" : "private",
          });
        }
      },
    );

    sock.ev.on(
      "chats.update",
      (
        updates: import("@whiskeysockets/baileys/lib/Types/Chat").ChatUpdate[],
      ) => {
        for (const update of updates) {
          if (!update.id) continue;
          const existing = this.chats.get(update.id);
          if (existing) {
            const name = (update as any).name ?? (update as any).subject;
            if (name) {
              existing.name = name;
            }
          }
        }
      },
    );

    sock.ev.on(
      "messaging-history.set",
      ({
        chats: historyChats,
      }: {
        chats: import("@whiskeysockets/baileys/lib/Types/Chat").Chat[];
      }) => {
        for (const chat of historyChats) {
          if (!chat.id || chat.id === "status@broadcast") continue;
          const name =
            (chat as any).name ?? (chat as any).subject ?? jidToUser(chat.id);
          this.chats.set(chat.id, {
            id: chat.id,
            name: name ?? jidToUser(chat.id),
            type: chat.id.endsWith("@g.us") ? "group" : "private",
          });
        }
      },
    );

    // Set up listeners for callers that reuse this socket
    this.setupListenersOnSocket(sock);
  }

  private async saveAuthState(): Promise<void> {
    if (!this.authState) return;
    const saveFn = (this.authState as any).saveCreds;
    if (saveFn) await saveFn();
  }

  /**
   * Register connection/creds listeners on an existing socket.
   * Called when a socket is reused from the registry.
   */
  setupListenersOnSocket(sock: WASocket): void {
    const connHandler = (update: {
      connection?: string;
      qr?: string;
      lastDisconnect?: { error?: Error };
    }) => {
      if (update.qr) {
        this.loginDeferred?.resolveFirstQr?.(update.qr);
      }
      if (update.connection === "open") {
        this.isAuthenticated = true;
        this.isReady = true;
        if (this.loginDeferred?.firstQrResolved) {
          void this.handleLoginReady();
        }
        if (this.botId && this.clientRegistry) {
          this.clientRegistry.registerClient(this.botId, sock);
          if (DEBUG)
            console.log(
              `[whatsapp] [${this.sessionId}] Socket registered in client registry, sock.user: ${sock.user?.id}`,
            );
        }
      }
      if (update.connection === "close") {
        const lastDisconnect = update.lastDisconnect;
        const reason = lastDisconnect?.error?.message ?? "unknown";
        const errObj = lastDisconnect?.error as
          | (Error & {
              code?: string;
              tag?: string;
              statusCode?: number;
              output?: { statusCode?: number };
              attrs?: { code?: string | number };
              data?: unknown;
            })
          | undefined;
        const statusCode =
          (errObj as unknown as { output?: { statusCode?: number } })?.output
            ?.statusCode ??
          (typeof errObj?.attrs?.code === "string"
            ? Number.parseInt(errObj.attrs.code as unknown as string, 10)
            : (errObj?.attrs?.code as number | undefined)) ??
          errObj?.statusCode ??
          0;
        if (DEBUG)
          console.log(
            `[whatsapp] Socket closed: ${reason} (statusCode=${statusCode})`,
          );
        const wasClean =
          lastDisconnect?.error === undefined ||
          lastDisconnect?.error?.message?.includes("clean");
        if (!wasClean) {
          this.isReady = false;
          this.isAuthenticated = false;
          const err: Error =
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error
              : new Error(
                  (lastDisconnect?.error as unknown as { message?: string })
                    ?.message ?? `Connection closed: ${reason}`,
                );
          if (
            statusCode === DisconnectReason.restartRequired ||
            statusCode === DisconnectReason.timedOut ||
            statusCode === DisconnectReason.connectionReplaced
          ) {
            if (DEBUG)
              console.log(
                `[whatsapp] [${this.sessionId}] Got recoverable error (${statusCode}), reconnecting...`,
              );
            if (this._pendingReconnect) {
              if (DEBUG)
                console.log(
                  `[whatsapp] [${this.sessionId}] Reconnect already in progress, skipping...`,
                );
              return;
            }
            const oldSock = this.sock;
            this._pendingReconnect = new Promise<WASocket>((resolve) => {
              setTimeout(async () => {
                try {
                  if (oldSock) {
                    await this.kill(oldSock);
                  }
                  const newSock = await this.createSocket();
                  resolve(newSock);
                } catch (e) {
                  if (DEBUG)
                    console.error(
                      `[whatsapp] [${this.sessionId}] Reconnect failed:`,
                      e,
                    );
                  resolve(null as unknown as WASocket);
                } finally {
                  this._pendingReconnect = null;
                }
              }, 500);
            });
            return;
          }
          if (!this.loginDeferred?.firstQrResolved && this.loginDeferred) {
            this.loginDeferred.rejectFirstQr(err);
          }
          if (this.loginDeferred?.firstQrResolved) {
            this.loginDeferred.rejectLogin(err);
          }
        }
        if (this.botId && this.clientRegistry) {
          this.clientRegistry.unregisterClient(this.botId);
        }
      }
    };
    sock.ev.on("connection.update", connHandler);
    this.eventCleanup.push(() => sock.ev.off("connection.update", connHandler));
    const credsHandler = () => {
      if (this.isAuthenticated) {
        void this.saveAuthState().catch((e) =>
          DEBUG ? console.error("[whatsapp] saveCreds failed:", e) : undefined,
        );
      }
    };
    sock.ev.on("creds.update", credsHandler);
    this.eventCleanup.push(() => sock.ev.off("creds.update", credsHandler));
  }

  private async handleLoginReady() {
    if (!this.loginDeferred) return;
    try {
      const info = this.getUserInfo();
      await this.loginDeferred.callbacks.onSession?.(this.sessionId);
      await this.loginDeferred.callbacks.onReady?.(info);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error ?? ""));
      await this.loginDeferred.callbacks.onError?.(err);
    }
    // Keep loginDeferred around — close handler may still need rejectLogin
  }

  private isTauriMode(): boolean {
    return this.configProvider?.get("TAURI_MODE") === "true";
  }

  private timeBeforeHours(hours: number): number {
    return Math.floor(Date.now() / 1000) - hours * 3600;
  }

  private async ensureReady(): Promise<void> {
    // If we already have a connected socket, reuse it — don't create a new one.
    if (this.sock) return;

    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        // Clean up old wwebjs auth files from previous failed attempts
        if (!this.isTauriMode()) {
          const { existsSync, rmSync } = await import("node:fs");
          const oldAuthDir = path.join(process.cwd(), ".wwebjs_auth");
          try {
            if (existsSync(oldAuthDir)) {
              console.log("[whatsapp] Removing old wwebjs auth directory");
              rmSync(oldAuthDir, { recursive: true, force: true });
            }
          } catch {
            /* ignore */
          }
        }

        const exists = await this.authStateExists();
        if (DEBUG)
          console.log(
            `[whatsapp] Session check: ${exists ? "exists" : "not found"} for ${this.sessionId}`,
          );

        // Create socket — Baileys restores session automatically if exists,
        // otherwise QR will be emitted via connection.update.
        // Socket is registered in createSocket() immediately after makeWASocket() returns,
        // so ensureReady() can reliably check the registry here.
        if (this.botId && this.clientRegistry) {
          const existing = this.clientRegistry.getClientBySessionKey(
            this.botId,
          ) as WASocket | undefined;
          if (existing) {
            console.log(
              `[whatsapp] [${this.sessionId}] Reusing existing socket from registry for botId=${this.botId}`,
            );
            this.sock = existing;
            this.isReady = true;
            return;
          }
        }

        console.log(
          `[whatsapp] [${this.sessionId}] Creating new socket (sessionId=${this.sessionId} botId=${this.botId})`,
        );
        this.sock = await this.createSocket();

        const maxWaitTime = 120_000;
        const checkInterval = 500;
        const startTime = Date.now();
        const isLoginFlow = !!this.loginDeferred;
        const isDev = process.env.NODE_ENV === "development";

        while (!this.isReady && Date.now() - startTime < maxWaitTime) {
          if (!isLoginFlow && this.loginDeferred?.firstQrResolved && !isDev) {
            const elapsed = Date.now() - startTime;
            if (elapsed > 10_000) {
              throw new Error(
                "WhatsApp session requires re-authentication. Please disconnect and reconnect your WhatsApp account.",
              );
            }
          }
          await new Promise((r) => setTimeout(r, checkInterval));
        }

        if (!this.isReady) {
          throw new Error(
            `[whatsapp] Socket failed to connect within ${maxWaitTime}ms`,
          );
        }

        if (DEBUG)
          console.log(`[whatsapp] Ready for session ${this.sessionId}`);
      })().catch((error) => {
        this.initializationPromise = null;
        throw error;
      });
    }

    await this.initializationPromise;
  }

  // ----- Public API -----

  async startQrLogin(callbacks: WhatsAppLoginCallbacks = {}): Promise<string> {
    // If socket already exists and is connected, user is already logged in — call onReady immediately
    if (this.sock && this.isReady) {
      console.log(
        `[whatsapp] [${this.sessionId}] Socket already connected, calling onReady directly`,
      );
      void this.handleLoginReady();
      return "";
    }
    if (this.loginDeferred) {
      throw new Error("[whatsapp] A login flow is already in progress");
    }

    // Register so external callers can find this adapter by sessionId
    activeAdapters.set(this.sessionId, this);

    this.loginDeferred = {
      resolveFirstQr: () => {},
      rejectFirstQr: () => {},
      rejectLogin: () => {},
      firstQrResolved: false,
      callbacks,
    };

    const firstQrPromise = new Promise<string>((resolve, reject) => {
      if (!this.loginDeferred)
        return reject(new Error("Login not initialized"));
      this.loginDeferred.resolveFirstQr = resolve;
      this.loginDeferred.rejectFirstQr = reject;
      this.loginDeferred.rejectLogin = reject;
    });

    void (async () => {
      try {
        await this.ensureReady();
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error(String(error ?? ""));
        if (this.loginDeferred) {
          // Reject with the stored reject function (works even after QR resolved)
          this.loginDeferred.rejectLogin(err);
          const cb = this.loginDeferred.callbacks.onError;
          if (cb) await cb(err);
          // Don't null loginDeferred here — keep it so close handler can also reject
        }
      }
    })();

    return firstQrPromise;
  }

  async startPairingCodeLogin(
    phoneNumber: string,
    callbacks: WhatsAppLoginCallbacks = {},
  ): Promise<string> {
    if (this.loginDeferred) {
      throw new Error("[whatsapp] A login flow is already in progress");
    }

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error("[whatsapp] Invalid phone number format");
    }

    this.loginDeferred = {
      resolveFirstQr: () => {},
      rejectFirstQr: () => {},
      rejectLogin: () => {},
      firstQrResolved: false,
      callbacks,
    };

    const firstCodePromise = new Promise<string>((resolve, reject) => {
      if (!this.loginDeferred)
        return reject(new Error("Login not initialized"));
      this.loginDeferred.resolveFirstQr = resolve;
      this.loginDeferred.rejectFirstQr = reject;
      this.loginDeferred.rejectLogin = reject;
    });

    void (async () => {
      try {
        await this.ensureReady();

        const sock = this.sock;
        if (!sock) throw new Error("Socket not initialized");

        const code = await sock.requestPairingCode(cleanPhone);
        if (DEBUG)
          console.log(`[whatsapp] Pairing code for ${cleanPhone}: ${code}`);

        if (this.loginDeferred && !this.loginDeferred.firstQrResolved) {
          this.loginDeferred.firstQrResolved = true;
          this.loginDeferred.resolveFirstQr(code);
        }
        const cb = this.loginDeferred?.callbacks.onCode;
        if (cb) await cb(code);
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error(String(error ?? ""));
        if (this.loginDeferred) {
          this.loginDeferred.rejectFirstQr(err);
          const cb = this.loginDeferred.callbacks.onError;
          if (cb) await cb(err);
          this.loginDeferred = null;
        }
      }
    })();

    return firstCodePromise;
  }

  getUserInfo(): WhatsAppUserInfo {
    const me = this.sock?.user;
    if (!me) {
      return { wid: "", pushName: undefined, formattedNumber: undefined };
    }
    return {
      wid: me.id ?? "",
      pushName: me.name ?? me.notify ?? me.verifiedName ?? undefined,
      formattedNumber: jidToUser(me.id ?? ""),
    };
  }

  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    await this.ensureReady();
    const chatId = this.resolveChatId(target, id);

    for (const message of messages) {
      try {
        if (typeof message === "string") {
          if (!message.trim()) continue;
          const sent = await this.sock?.sendMessage(chatId, { text: message });
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        } else if (isImageMessage(message)) {
          const media = await this.prepareMediaMessage(message);
          if (!media) continue;
          const sent = await this.sock?.sendMessage(chatId, media);
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        } else if (isFileMessage(message)) {
          const media = await this.prepareFileMessage(message);
          if (!media) continue;
          const sent = await this.sock?.sendMessage(chatId, media);
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        }
      } catch (error) {
        if (DEBUG)
          console.error(
            `[whatsapp] Failed to send message to ${chatId}:`,
            error,
          );
        throw error;
      }
    }
  }

  async sendMessage(
    target: MessageTarget,
    id: string,
    message: string,
  ): Promise<void> {
    await this.sendMessages(target, id, [message]);
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    quoteOrigin = false,
  ): Promise<void> {
    await this.ensureReady();
    const msg = event.sourcePlatformObject as WAMessage | undefined;
    const targetId =
      event.targetType === "group"
        ? event.sender.group.id
        : (event.sender as { id: string }).id;
    const normalizedTargetId = String(targetId);

    if (quoteOrigin && msg) {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) return;
      for (const message of messages) {
        if (typeof message === "string") {
          if (!message.trim()) continue;
          const sent = await this.sock?.sendMessage(
            remoteJid,
            { text: message },
            { quoted: msg },
          );
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        } else if (isImageMessage(message)) {
          const media = await this.prepareMediaMessage(message);
          if (!media) continue;
          const sent = await this.sock?.sendMessage(remoteJid, media, {
            quoted: msg,
          });
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        } else if (isFileMessage(message)) {
          const media = await this.prepareFileMessage(message);
          if (!media) continue;
          const sent = await this.sock?.sendMessage(remoteJid, media, {
            quoted: msg,
          });
          if (sent?.message && sent.key.id) {
            this.sentMessageCache.set(sent.key.id, sent.message);
            if (this.sentMessageCache.size > 256) {
              const oldest = this.sentMessageCache.keys().next().value;
              if (oldest) this.sentMessageCache.delete(oldest);
            }
          }
        }
      }
      return;
    }

    await this.sendMessages(event.targetType, normalizedTargetId, messages);
  }

  async run(): Promise<void> {
    await this.ensureReady();
  }

  isUsingLocalAuth(): boolean {
    // In Tauri mode, auth is stored in files (useMultiFileAuthState) — equivalent to LocalAuth
    return this.isTauriMode();
  }

  /**
   * Start the socket without waiting for connection (for self-listener use).
   * Creates the socket and registers it in the client registry.
   * Always sets up listeners (even when socket was already connected)
   * so callers receive events.
   */
  async startSocket(): Promise<WASocket> {
    await this.ensureReady();
    if (!this.sock)
      throw new Error("[whatsapp] Socket not available after ensureReady");
    // Always set up listeners — even when socket was reused from registry,
    // it may not have this adapter's handlers attached yet.
    this.setupListenersOnSocket(this.sock);
    return this.sock;
  }

  /**
   * Attach this adapter to an already-connected socket (from registry).
   * Used by QR login to reuse the self-listener's socket instead of creating a new one.
   */
  attachToSocket(sock: WASocket): void {
    this.sock = sock;
    this.isReady = true;
    this.isAuthenticated = true;
    // Adopt the socket's existing sentMessageCache so getMessage reads the
    // same cache that self-listener writes to.
    if ((sock as any).sentMessageCache) {
      this.sentMessageCache = (sock as any).sentMessageCache;
    }
    // Set up listeners so QR callbacks get triggered
    this.setupListenersOnSocket(sock);

    // Also set up chats listeners so this.chats is populated.
    // Without these, getChatsByChunk returns empty (no chat JIDs to iterate).
    sock.ev.on(
      "chats.upsert",
      (newChats: import("@whiskeysockets/baileys/lib/Types/Chat").Chat[]) => {
        for (const chat of newChats) {
          if (!chat.id || chat.id === "status@broadcast") continue;
          const name =
            (chat as any).name ?? (chat as any).subject ?? jidToUser(chat.id);
          this.chats.set(chat.id, {
            id: chat.id,
            name: name ?? jidToUser(chat.id),
            type: chat.id.endsWith("@g.us") ? "group" : "private",
          });
        }
      },
    );

    sock.ev.on(
      "chats.update",
      (
        updates: import("@whiskeysockets/baileys/lib/Types/Chat").ChatUpdate[],
      ) => {
        for (const update of updates) {
          if (!update.id) continue;
          const existing = this.chats.get(update.id);
          if (existing) {
            const name = (update as any).name ?? (update as any).subject;
            if (name) {
              existing.name = name;
            }
          }
        }
      },
    );

    sock.ev.on(
      "messaging-history.set",
      ({
        chats: historyChats,
      }: {
        chats: import("@whiskeysockets/baileys/lib/Types/Chat").Chat[];
      }) => {
        for (const chat of historyChats) {
          if (!chat.id || chat.id === "status@broadcast") continue;
          const name =
            (chat as any).name ?? (chat as any).subject ?? jidToUser(chat.id);
          this.chats.set(chat.id, {
            id: chat.id,
            name: name ?? jidToUser(chat.id),
            type: chat.id.endsWith("@g.us") ? "group" : "private",
          });
        }
      },
    );

    // Force a history sync so messaging-history.set fires and populates
    // both this.chats and the InMemoryStore (via self-listener).
    const sockExtra = sock as unknown as {
      resyncAppState?: (
        collections: string[],
        isInitialSync: boolean,
      ) => Promise<void>;
    };
    sockExtra.resyncAppState?.(
      [
        "critical_block",
        "critical_unblock_low",
        "regular_high",
        "regular_low",
        "regular",
      ],
      true,
    );
    // Register under this adapter's botId
    if (this.botId && this.clientRegistry) {
      this.clientRegistry.registerClient(this.botId, sock);
    }
  }

  /**
   * Kill the socket. If targetSock is provided, only kill that socket's listeners
   * (used during reconnect to avoid killing the new socket's listeners).
   * If no targetSock, kills the current socket.
   */
  async kill(targetSock?: WASocket): Promise<boolean> {
    const sockToKill = targetSock ?? this.sock;
    if (!sockToKill) return true;

    try {
      activeAdapters.delete(this.sessionId);
      // Only clean up listeners for the target socket, leave other sockets intact
      for (const cleanup of this.eventCleanup) {
        try {
          cleanup();
        } catch {
          /* ignore */
        }
      }
      this.eventCleanup = [];

      try {
        sockToKill.end(undefined); // Just closes WS, does NOT emit close event with error
      } catch {
        /* ignore */
      }

      // Only update state if killing the current (last) socket
      if (sockToKill === this.sock) {
        if (this.botId && this.clientRegistry) {
          try {
            this.clientRegistry.unregisterClient(this.botId);
          } catch {
            /* ignore */
          }
        }
        this.isReady = false;
        this.isAuthenticated = false;
        this.initializationPromise = null;
        this.sock = null;
      }
      return true;
    } catch (error) {
      console.error("[whatsapp] Failed to shutdown socket:", error);
      return false;
    }
  }

  getSessionIdentifier(): string {
    return this.sessionId;
  }

  async getDialogs(): Promise<WhatsAppDialogInfo[]> {
    await this.ensureReady();
    return Array.from(this.chats.values()).slice(0, maxDialogCount);
  }

  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    const maxMessageChunkCount = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;
    await this.ensureReady();
    const sock = this.sock;
    if (!sock) throw new Error("[whatsapp] Socket not available");

    // If this.chats is still empty (resyncAppState hasn't fired yet in attachToSocket),
    // trigger it here and wait. Without this, the bot finds 0 messages because
    // resyncAppState is async and attachToSocket returns before it fires.
    if (this.chats.size === 0) {
      console.log(
        "[whatsapp] getChatsByChunk: this.chats is empty, triggering history sync...",
      );
      const sockExtra = sock as unknown as {
        resyncAppState?: (
          collections: string[],
          isInitialSync: boolean,
        ) => Promise<void>;
      };
      await sockExtra.resyncAppState?.(
        [
          "critical_block",
          "critical_unblock_low",
          "regular_high",
          "regular_low",
          "regular",
        ],
        true,
      );
      if (this.chats.size === 0) {
        console.log(
          "[whatsapp] getChatsByChunk: this.chats still empty after sync, returning empty",
        );
        return { messages: [], hasMore: false };
      }
    }

    const extractedMessages: ExtractedMessageInfo[] = [];
    const selfJid = jidToUser(sock.user?.id ?? "");

    if (!this.asyncIteratorState.isInitialized) {
      const chatIds = Array.from(this.chats.keys())
        .filter((j) => j !== "status@broadcast")
        .slice(0, maxDialogCount);
      this.asyncIteratorState.chatIds = chatIds;
      this.asyncIteratorState.currentChatIndex = 0;
      this.asyncIteratorState.currentMessageIndex = 0;
      this.asyncIteratorState.offsetDate = since;
      this.asyncIteratorState.isInitialized = true;

      if (this.asyncIteratorState.chatIds.length === 0) {
        this.asyncIteratorState.isInitialized = false;
        return { messages: [], hasMore: false };
      }
    }

    const { chatIds, currentChatIndex, offsetDate } = this.asyncIteratorState;

    for (
      let chatIndex = currentChatIndex;
      chatIndex < chatIds.length;
      chatIndex++
    ) {
      const chatJid = chatIds[chatIndex];
      try {
        const store = (sock as any).store;
        const history =
          (await store?.loadMessages?.(chatJid, maxMessageCount, {})) ?? [];

        const filteredMessages = (history as WAMessage[])
          .filter((m) => {
            const msgTs = (m.messageTimestamp as number) ?? 0;
            return msgTs >= offsetDate;
          })
          .reverse();

        for (
          let messageIndex =
            chatIndex === currentChatIndex
              ? this.asyncIteratorState.currentMessageIndex
              : 0;
          messageIndex < filteredMessages.length;
          messageIndex++
        ) {
          const msg = filteredMessages[messageIndex];
          const senderJid = msg.key.participant ?? msg.key.remoteJid ?? "";
          if (jidToUser(senderJid) === selfJid) continue;

          const info = this.extractMessageInfo(msg, chatJid);
          if (info) extractedMessages.push(info);
          if (extractedMessages.length >= maxMessageChunkCount) {
            this.asyncIteratorState.currentChatIndex = chatIndex;
            this.asyncIteratorState.currentMessageIndex = messageIndex + 1;
            return { messages: extractedMessages, hasMore: true };
          }
        }

        this.asyncIteratorState.currentMessageIndex = 0;
        this.asyncIteratorState.currentChatIndex = chatIndex + 1;
      } catch (error) {
        console.warn(
          `[whatsapp] Failed to load messages for ${chatJid}:`,
          error,
        );
      }
    }

    this.asyncIteratorState.isInitialized = false;
    return { messages: extractedMessages, hasMore: false };
  }

  async getChatsByChunkHours(
    hours = 8,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    return this.getChatsByChunk(this.timeBeforeHours(hours));
  }

  async getChatsByTime(cutoffDate: number): Promise<ExtractedMessageInfo[]> {
    await this.ensureReady();
    const sock = this.sock;
    if (!sock) return [];

    const extractedMessages: ExtractedMessageInfo[] = [];
    const store = (sock as any).store;
    const selfJid = jidToUser(sock.user?.id ?? "");
    const chatIds = Array.from(this.chats.keys())
      .filter((j) => j !== "status@broadcast")
      .slice(0, maxDialogCount);

    let emptyCount = 0;

    for (const chatJid of chatIds) {
      if (emptyCount >= 10) break;

      try {
        const history =
          (await store?.loadMessages?.(chatJid, maxMessageCount, {})) ?? [];

        const filteredMessages = (history as WAMessage[])
          .filter((m) => {
            const msgTs = (m.messageTimestamp as number) ?? 0;
            return msgTs >= cutoffDate;
          })
          .reverse();

        if (filteredMessages.length === 0) {
          emptyCount++;
          continue;
        }

        emptyCount = 0;

        for (const msg of filteredMessages) {
          const senderJid = msg.key.participant ?? msg.key.remoteJid ?? "";
          if (jidToUser(senderJid) === selfJid) continue;

          const info = this.extractMessageInfo(msg, chatJid);
          if (info) extractedMessages.push(info);
        }
      } catch (error) {
        console.warn(
          `[whatsapp] Failed to load messages for ${chatJid}:`,
          error,
        );
      }
    }

    return extractedMessages;
  }

  async getChatsByHours(hours = 1): Promise<ExtractedMessageInfo[]> {
    return this.getChatsByTime(this.timeBeforeHours(hours));
  }

  async getChatsByDays(days = 1): Promise<ExtractedMessageInfo[]> {
    return this.getChatsByTime(this.timeBeforeHours(days * 24));
  }

  resetChunkIterator(): void {
    this.asyncIteratorState.isInitialized = false;
    this.asyncIteratorState.chatIds = [];
    this.asyncIteratorState.currentChatIndex = 0;
    this.asyncIteratorState.currentMessageIndex = 0;
    this.asyncIteratorState.offsetDate = 0;
  }

  private extractMessageInfo(
    msg: WAMessage,
    chatJid: string,
  ): ExtractedMessageInfo | null {
    try {
      const messageText = this.getMessageText(msg);
      const timestamp = (msg.messageTimestamp as number) ?? 0;
      const isGroup = chatJid.endsWith("@g.us");
      const senderJid = msg.key.participant ?? msg.key.remoteJid ?? "";
      const senderName = jidToUser(senderJid);

      let chatName = jidToUser(chatJid);
      if (isGroup && senderJid) {
        chatName = senderName;
      }

      return {
        id: msg.key.id ?? String(timestamp),
        chatType: isGroup ? "group" : "private",
        chatName,
        sender: senderName,
        text: messageText,
        timestamp,
        isOutgoing: msg.key.fromMe ?? false,
      };
    } catch (error) {
      console.warn("[whatsapp] Failed to extract message info:", error);
      return null;
    }
  }

  private getMessageText(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return "";

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.documentMessage?.title) return m.documentMessage.title;

    return "";
  }

  private resolveChatId(target: MessageTarget, id: string): string {
    if (id.includes("@")) return id;
    return target === "group" ? `${id}@g.us` : `${id}@s.whatsapp.net`;
  }

  private async prepareMediaMessage(
    image: openloomiImage,
  ): Promise<{ image: Buffer } | null> {
    try {
      let buffer: Buffer;

      if (image.base64) {
        buffer = Buffer.from(image.base64, "base64");
      } else if (image.url) {
        const response = await fetch(image.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${image.url}: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        return null;
      }

      return { image: buffer };
    } catch (error) {
      console.error("[whatsapp] Failed to prepare media:", error);
      return null;
    }
  }

  private async prepareFileMessage(file: openloomiFile): Promise<{
    document: Buffer;
    mimetype: string;
    fileName: string;
  } | null> {
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file.url}: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimetype = this.guessMimeType(file.name);
      return {
        document: buffer,
        mimetype,
        fileName: file.name,
      };
    } catch (error) {
      console.error("[whatsapp] Failed to prepare file:", error);
      return null;
    }
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      csv: "text/csv",
      zip: "application/zip",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    return mimeTypes[ext ?? ""] ?? "application/octet-stream";
  }

  async authStateExists(): Promise<boolean> {
    // Check via the auth state provider's underlying storage
    // This is a simplified check - actual implementation may vary by provider
    if (!this.authState) return false;
    const creds = (this.authState as any).creds;
    return !!creds && !!creds.me;
  }

  /**
   * @deprecated Use authStateExists instead
   */
  async sessionExists(): Promise<boolean> {
    return this.authStateExists();
  }

  async forceSaveSession(): Promise<void> {
    await this.saveAuthState();
    if (DEBUG) console.log(`[whatsapp] Session saved for ${this.sessionId}`);
  }

  /** Save session to disk. Call after QR login completes. */
  saveSession(): Promise<void> {
    return this.forceSaveSession();
  }

  async checkSessionStatus(): Promise<{
    exists: boolean;
    ready: boolean;
    authenticated: boolean;
  }> {
    const exists = await this.authStateExists();
    return {
      exists,
      ready: this.isReady,
      authenticated: this.isAuthenticated,
    };
  }

  async restoreSession(): Promise<boolean> {
    try {
      const exists = await this.authStateExists();
      if (!exists) {
        if (DEBUG)
          console.log(`[whatsapp] No session found for ${this.sessionId}`);
        return false;
      }
      if (DEBUG)
        console.log(`[whatsapp] Restoring session for ${this.sessionId}`);
      await this.ensureReady();
      return this.isReady;
    } catch (error) {
      if (DEBUG)
        console.error(
          `[whatsapp] Failed to restore session for ${this.sessionId}:`,
          error,
        );
      return false;
    }
  }

  async ingestMessageAttachments(msg: WAMessage): Promise<any[]> {
    if (!this.ownerUserId || !this.ownerUserType || !this.fileIngester)
      return [];

    const m = msg.message;
    if (!m) return [];

    // Find media message
    let mimeType: string | undefined;
    let isMedia = false;

    if (m.imageMessage) {
      mimeType = m.imageMessage.mimetype ?? undefined;
      isMedia = true;
    } else if (m.videoMessage) {
      mimeType = m.videoMessage.mimetype ?? undefined;
      isMedia = true;
    } else if (m.stickerMessage) {
      mimeType = m.stickerMessage.mimetype ?? undefined;
      isMedia = true;
    } else if (m.documentMessage) {
      mimeType = m.documentMessage.mimetype ?? undefined;
      isMedia = true;
    }

    if (!isMedia || !mimeType || !this.sock) return [];

    try {
      const buffer = await downloadMediaMessage(msg, "buffer", {});

      const fileName = `attachment.${mimeType.split("/")[1] ?? "bin"}`;

      const ingested = await this.fileIngester.ingestForUser({
        source: "whatsapp",
        ownerUserId: this.ownerUserId,
        ownerUserType: this.ownerUserType as any,
        maxSizeBytes: WHATSAPP_MAX_ATTACHMENT_BYTES,
        originalFileName: fileName,
        mimeTypeHint: mimeType,
        sizeHintBytes: buffer.length,
        downloadAttachment: async () => {
          // Convert Node.js Buffer to ArrayBuffer for the interface
          const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
          return {
            data: arrayBuffer,
            contentType: mimeType ?? "application/octet-stream",
            sizeBytes: buffer.length,
          };
        },
        logContext: this.botId ? `[whatsapp ${this.botId}]` : "[whatsapp]",
      });

      return ingested ? [ingested] : [];
    } catch (error) {
      console.error(
        `[whatsapp${this.botId ? ` ${this.botId}` : ""}] Failed to ingest attachment ${msg.key.id}`,
        error,
      );
      return [];
    }
  }

  getSocket(): WASocket | null {
    return this.sock;
  }
}

function jidToUser(jid: string): string {
  return jid.split("@")[0];
}
