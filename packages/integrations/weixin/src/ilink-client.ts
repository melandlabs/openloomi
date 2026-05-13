/**
 * WeChat iLink HTTP client
 *
 * Protocol types and CDN utilities directly use @tencent-weixin/openclaw-weixin official library:
 *   - Protocol types / enum constants  → src/api/types.ts
 *   - CDN encryption upload           → src/cdn/cdn-upload.ts (uploadBufferToCdn)
 *   - CDN download decryption        → src/cdn/pic-decrypt.ts (downloadAndDecryptBuffer)
 *   - AES-128-ECB utilities        → src/cdn/aes-ecb.ts (aesEcbPaddedSize)
 *
 * HTTP client layer (apiFetch + each iLink API method) maintained independently:
 *   The official library's api.ts depends on openclaw/plugin-sdk through accounts.ts to read openclaw.json,
 *   while we get token and routeTag from database credentials (WeixinIlinkCredentials),
 *   so we cannot directly use the official api.ts, keeping our own HTTP layer.
 */
import crypto from "node:crypto";

// ============= Official Protocol Types & Constants ==========================================
export type {
  WeixinMessage,
  MessageItem,
  CDNMedia,
  ImageItem,
  VoiceItem,
  FileItem,
  VideoItem,
  GetUpdatesResp,
  GetConfigResp,
  SendTypingReq,
} from "@tencent-weixin/openclaw-weixin/src/api/types";
export {
  MessageType,
  MessageState,
  MessageItemType,
  UploadMediaType,
  TypingStatus,
} from "@tencent-weixin/openclaw-weixin/src/api/types";

import type {
  GetUpdatesResp,
  GetConfigResp,
} from "@tencent-weixin/openclaw-weixin/src/api/types";
import {
  MessageType,
  MessageState,
  UploadMediaType,
  TypingStatus,
} from "@tencent-weixin/openclaw-weixin/src/api/types";

// ============= Official CDN Utility Functions ==============================================
export { uploadBufferToCdn } from "./cdn/cdn-upload";
export { downloadAndDecryptBuffer } from "./cdn/pic-decrypt";
export { aesEcbPaddedSize, encryptAesEcb, decryptAesEcb } from "./cdn/aes-ecb";
export { buildCdnUploadUrl, buildCdnDownloadUrl } from "./cdn/cdn-url";

import { aesEcbPaddedSize } from "./cdn/aes-ecb";
import { uploadBufferToCdn } from "./cdn/cdn-upload";
import { downloadAndDecryptBuffer } from "./cdn/pic-decrypt";

// TypingStatus alias (backward compatible)
export const TYPING_STATUS = TypingStatus;

// =============================================================================

/** CDN media file base URL */
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_LONG_POLL_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

/** Read channel_version from installed package version (consistent with official buildBaseInfo()) */
function resolveChannelVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("@tencent-weixin/openclaw-weixin/package.json") as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const CHANNEL_VERSION = resolveChannelVersion();

/** WeChat account credentials stored in database (difference from official library WeixinApiOptions: carries routeTag) */
export type WeixinIlinkCredentials = {
  ilinkToken: string;
  /** Default https://ilinkai.weixin.qq.com */
  baseUrl?: string;
  /** Optional route tag (corresponds to channels.openclaw-weixin.routeTag in openclaw.json) */
  routeTag?: string;
};

// =============================================================================
// Internal HTTP Utilities
// =============================================================================

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** X-WECHAT-UIN: Random uint32 decimal string then base64 (consistent with official library) */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(opts: {
  token?: string;
  body: string;
  routeTag?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(opts.body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  if (opts.routeTag?.trim()) {
    headers.SKRouteTag = opts.routeTag.trim();
  }
  return headers;
}

async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  routeTag?: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({
    token: params.token,
    body: params.body,
    routeTag: params.routeTag,
  });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(
        `Weixin iLink HTTP ${res.status}: ${rawText.slice(0, 500)}`,
      );
    }
    if (process.env.DEBUG_WEIXIN === "true") {
      console.log(
        `[Weixin iLink] ${params.endpoint} response: ${rawText.slice(0, 300)}`,
      );
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

function assertWriteOk(rawText: string, apiName: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[Weixin iLink] ${apiName} returned non-JSON: ${rawText.slice(0, 300)}`,
    );
  }
  const top = parsed as { ret?: number; errcode?: number; errmsg?: string };
  const nested = parsed.base_response as
    | { ret?: number; errcode?: number; errmsg?: string }
    | undefined;
  const ret = top.ret ?? nested?.ret;
  const errcode = top.errcode ?? nested?.errcode;
  const errmsg = (top.errmsg ?? nested?.errmsg) as string | undefined;
  if (ret !== undefined && ret !== 0) {
    throw new Error(
      `[Weixin iLink] ${apiName} failed ret=${ret} errcode=${errcode} errmsg=${errmsg ?? ""}`,
    );
  }
  if (errcode !== undefined && errcode !== 0) {
    throw new Error(
      `[Weixin iLink] ${apiName} failed errcode=${errcode} errmsg=${errmsg ?? ""}`,
    );
  }
}

function generateClientId(): string {
  return `openloomi-weixin-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// =============================================================================
// iLink API Methods
// =============================================================================

/** Long-poll to fetch new messages */
export async function weixinGetUpdates(params: {
  credentials: WeixinIlinkCredentials;
  getUpdatesBuf: string;
  timeoutMs?: number;
}): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_MS;
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const body = JSON.stringify({
    get_updates_buf: params.getUpdatesBuf ?? "",
    base_info: buildBaseInfo(),
  });
  try {
    const rawText = await apiFetch({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      body,
      token: params.credentials.ilinkToken,
      timeoutMs: timeout,
      routeTag: params.credentials.routeTag,
    });
    return JSON.parse(rawText) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw err;
  }
}

/** Send text message to specified user */
export async function weixinSendTextMessage(params: {
  credentials: WeixinIlinkCredentials;
  toUserId: string;
  contextToken: string;
  text: string;
}): Promise<void> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const clientId = generateClientId();
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken,
      item_list: [{ type: 1, text_item: { text: params.text } }],
    },
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  assertWriteOk(rawText, "sendmessage(text)");
}

/** Get CDN upload pre-signed parameters */
export async function weixinGetUploadUrl(params: {
  credentials: WeixinIlinkCredentials;
  toUserId: string;
  filekey: string;
  mediaType: number;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  aeskey: string;
  noNeedThumb?: boolean;
}): Promise<{ upload_param?: string; thumb_upload_param?: string }> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const body = JSON.stringify({
    filekey: params.filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize: params.rawsize,
    rawfilemd5: params.rawfilemd5,
    filesize: params.filesize,
    no_need_thumb: params.noNeedThumb ?? true,
    aeskey: params.aeskey,
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  return JSON.parse(rawText) as {
    upload_param?: string;
    thumb_upload_param?: string;
  };
}

/** Send image message to specified user (auto-upload to CDN) */
export async function weixinSendImageMessage(params: {
  credentials: WeixinIlinkCredentials;
  toUserId: string;
  contextToken: string;
  imageBuffer: Buffer;
  caption?: string;
  cdnBaseUrl?: string;
}): Promise<void> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const cdnBase = params.cdnBaseUrl ?? CDN_BASE_URL;

  const plaintext = params.imageBuffer;
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const aeskey = crypto.randomBytes(16);
  const aeskeyHex = aeskey.toString("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");

  const uploadResp = await weixinGetUploadUrl({
    credentials: params.credentials,
    toUserId: params.toUserId,
    filekey,
    mediaType: UploadMediaType.IMAGE,
    rawsize,
    rawfilemd5,
    filesize,
    aeskey: aeskeyHex,
    noNeedThumb: true,
  });
  if (!uploadResp.upload_param) {
    throw new Error(
      "[Weixin sendImage] getUploadUrl did not return upload_param",
    );
  }

  // Use official library's CDN upload function (includes retry logic)
  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam: uploadResp.upload_param,
    filekey,
    aeskey,
    cdnBaseUrl: cdnBase,
    label: "sendImage",
  });

  if (params.caption?.trim()) {
    await weixinSendTextMessage({
      credentials: params.credentials,
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      text: params.caption.trim(),
    });
  }

  // aes_key field format: base64(hexKeyString), consistent with official library send.ts
  const aesKeyForMessage = Buffer.from(aeskeyHex).toString("base64");
  const clientId = generateClientId();
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken,
      item_list: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: aesKeyForMessage,
              encrypt_type: 1,
            },
            mid_size: filesize,
          },
        },
      ],
    },
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  assertWriteOk(rawText, "sendmessage(image)");
}

/** Send file message to specified user (auto-upload to CDN) */
export async function weixinSendFileMessage(params: {
  credentials: WeixinIlinkCredentials;
  toUserId: string;
  contextToken: string;
  fileBuffer: Buffer;
  fileName: string;
  caption?: string;
  cdnBaseUrl?: string;
}): Promise<void> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const cdnBase = params.cdnBaseUrl ?? CDN_BASE_URL;

  const plaintext = params.fileBuffer;
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const aeskey = crypto.randomBytes(16);
  const aeskeyHex = aeskey.toString("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");

  const uploadResp = await weixinGetUploadUrl({
    credentials: params.credentials,
    toUserId: params.toUserId,
    filekey,
    mediaType: UploadMediaType.FILE,
    rawsize,
    rawfilemd5,
    filesize,
    aeskey: aeskeyHex,
    noNeedThumb: true,
  });
  if (!uploadResp.upload_param) {
    throw new Error(
      "[Weixin sendFile] getUploadUrl did not return upload_param",
    );
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam: uploadResp.upload_param,
    filekey,
    aeskey,
    cdnBaseUrl: cdnBase,
    label: "sendFile",
  });

  if (params.caption?.trim()) {
    await weixinSendTextMessage({
      credentials: params.credentials,
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      text: params.caption.trim(),
    });
  }

  const aesKeyForMessage = Buffer.from(aeskeyHex).toString("base64");
  const clientId = generateClientId();
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken,
      item_list: [
        {
          type: 4,
          file_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: aesKeyForMessage,
              encrypt_type: 1,
            },
            file_name: params.fileName,
            len: String(rawsize),
          },
        },
      ],
    },
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  assertWriteOk(rawText, "sendmessage(file)");
}

/** Get account configuration, mainly used to get typing_ticket */
export async function weixinGetConfig(params: {
  credentials: WeixinIlinkCredentials;
  ilinkUserId: string;
  contextToken?: string;
}): Promise<GetConfigResp> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const body = JSON.stringify({
    ilink_user_id: params.ilinkUserId,
    ...(params.contextToken ? { context_token: params.contextToken } : {}),
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/getconfig",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  return JSON.parse(rawText) as GetConfigResp;
}

/** Send or cancel "typing" status indicator */
export async function weixinSendTyping(params: {
  credentials: WeixinIlinkCredentials;
  ilinkUserId: string;
  typingTicket: string;
  status: 1 | 2;
}): Promise<void> {
  const baseUrl = params.credentials.baseUrl?.trim() || DEFAULT_BASE_URL;
  const body = JSON.stringify({
    ilink_user_id: params.ilinkUserId,
    typing_ticket: params.typingTicket,
    status: params.status,
    base_info: buildBaseInfo(),
  });
  const rawText = await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body,
    token: params.credentials.ilinkToken,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    routeTag: params.credentials.routeTag,
  });
  assertWriteOk(rawText, "sendtyping");
}

// =============================================================================
// Image MIME Type Detection (via file header magic bytes)
// =============================================================================

/** Infer image MIME type from file header magic bytes */
export function detectImageMimeType(buf: Buffer): string {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf.slice(1, 4).toString("ascii") === "PNG"
  ) {
    return "image/png";
  }
  if (
    buf.length >= 6 &&
    (buf.slice(0, 6).toString("ascii") === "GIF87a" ||
      buf.slice(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

// =============================================================================
// Compatibility export (backward compatible, keep old function name)
// =============================================================================

/**
 * @deprecated Please use downloadAndDecryptBuffer (from official library)
 * CDN download and decrypt, kept for backward compatibility
 */
export async function cdnDownloadAndDecrypt(
  encryptQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string = CDN_BASE_URL,
): Promise<Buffer> {
  return downloadAndDecryptBuffer(
    encryptQueryParam,
    aesKeyBase64,
    cdnBaseUrl,
    "cdnDownloadAndDecrypt",
  );
}
