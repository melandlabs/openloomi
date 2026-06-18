import { ImapFlow } from "imapflow";
import type { ImapFlowOptions, ListResponse, MailboxObject } from "imapflow";
import { createTransport } from "nodemailer";
import type { SentMessageInfo } from "nodemailer";
import type { Attachment as NodemailerAttachment } from "nodemailer/lib/mailer";
import { Buffer } from "node:buffer";
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  Message,
  Image,
} from "@openloomi/integrations/channels";
import {
  type MessageEvent,
  type MessageTarget,
  PrivateMessageEvent,
} from "@openloomi/integrations/channels";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import type { Attachment } from "@openloomi/shared";
import { ingestAttachmentForUser } from "@/lib/integrations/utils/attachments";
import type { UserType } from "@/app/(auth)/auth";
import {
  formatTimingError,
  shouldLogTimingEvent,
} from "@/lib/insights/refresh-telemetry";
import { createLogger } from "@/lib/utils/logger";
import {
  cleanEmailForLLM,
  buildSnippet,
  cleanupMarkdown,
  htmlToPlainText,
} from "@openloomi/integrations/utils";

export {
  stripQuotedText,
  isBoilerplate,
  buildSnippet,
} from "@openloomi/integrations/utils";
export { isPromotionalEmail };

const logger = createLogger("EmailAdapterFetch");
const GMAIL_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const UNBOUNDED_EMAIL_FETCH_MAX_RESULTS = Number.MAX_SAFE_INTEGER;
const EMAIL_FETCH_BATCH_SIZE = 25;
const EMAIL_FALLBACK_RECENT_COUNT = 10;
type EmailFetchFolder = {
  name: string;
  isSent: boolean;
  source: "listed" | "fallback";
  specialUse?: string;
  exists?: number;
  flags?: string[];
};
const GMAIL_FETCH_FOLDERS: Array<{ name: string; isSent: boolean }> = [
  { name: "[Gmail]/All Mail", isSent: false },
  { name: "[Google Mail]/All Mail", isSent: false },
  { name: "INBOX", isSent: false },
  { name: "[Gmail]/Sent Mail", isSent: true },
  { name: "[Google Mail]/Sent Mail", isSent: true },
  { name: "[Gmail]/Sent", isSent: true },
  { name: "SENT", isSent: true },
  { name: "Sent", isSent: true },
  { name: "Sent Mail", isSent: true },
];
const DEFAULT_FETCH_FOLDERS: Array<{ name: string; isSent: boolean }> = [
  { name: "INBOX", isSent: false },
  { name: "Sent", isSent: true },
  { name: "Sent Items", isSent: true },
  { name: "SENT", isSent: true },
];

export type EmailFetchTimingEvent = {
  phase: string;
  status: "start" | "success" | "failure" | "skip";
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: unknown;
};

export type EmailFetchOptions = {
  maxResults?: number;
  onTiming?: (event: EmailFetchTimingEvent) => void;
};

function normalizeEmailFetchMaxResults(maxResults?: number): number {
  if (maxResults === undefined) {
    return UNBOUNDED_EMAIL_FETCH_MAX_RESULTS;
  }
  return Math.max(1, Math.floor(maxResults));
}

function formatEmailFetchMaxResults(maxResults: number): number | "unbounded" {
  return maxResults === UNBOUNDED_EMAIL_FETCH_MAX_RESULTS
    ? "unbounded"
    : maxResults;
}

function takeMostRecentUids(uids: number[], maxResults: number): number[] {
  if (maxResults === UNBOUNDED_EMAIL_FETCH_MAX_RESULTS) {
    return [...uids].reverse();
  }
  return uids.slice(-maxResults).reverse();
}

function shouldLogEmailFetchTiming(event: EmailFetchTimingEvent) {
  return shouldLogTimingEvent({
    phase: event.phase,
    status: event.status,
    isSummaryPhase: (phase) => phase === "imap_fetch_emails",
  });
}

const PROMOTIONAL_SENDER_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^newsletter@/i,
  /^marketing@/i,
  /^promo(tions)?@/i,
  /^deals@/i,
  /^offers@/i,
  /^info@.*\.(shop|store|deals)/i,
  /^mailer-daemon@/i,
  /^notifications?@/i,
  /^updates?@/i,
  /^digest@/i,
  /^campaign@/i,
  /^bulk@/i,
];

const SUBSCRIPTION_DOMAIN_PATTERNS = [
  /\.apple\.com$/i,
  /news\.apple\.com/i,
  /news\.google\.com/i,
  /newsletter/i,
  /\.news$/i,
];

const PROMOTION_SUBJECT_PATTERNS = [
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bweekly\b/i,
  /\bmonthly\b/i,
  /\bsubscription\b/i,
  /apple news/i,
];

/**
 * Determine if an email is a marketing/promotional email (via email headers + heuristic rules)
 *
 * Judgement criteria:
 * 1. List-Unsubscribe email header exists
 * 2. Precedence value is bulk or list
 * 3. Sender address matches common promotional patterns
 * 4. X-Mailer / X-Campaign and other marketing platform markers exist
 * 5. Sender domain matches subscription/news service patterns (e.g., Apple News)
 * 6. Subject matches subscription/news patterns (newsletter, digest, weekly, etc.)
 *
 * Signals 1-4: require at least two signals to classify as promotional email\n * Signals 5-6: any one signal is sufficient (subscription email features are obvious).
 */
function isPromotionalEmail(parsed: ParsedMail): boolean {
  const headers = parsed.headers;
  let signals = 0;

  // Signal 1: List-Unsubscribe email header
  if (headers.has("list-unsubscribe")) {
    signals++;
  }

  // Signal 2: Precedence: bulk or list
  const precedence = headers.get("precedence")?.toString().toLowerCase();
  if (precedence === "bulk" || precedence === "list") {
    signals++;
  }

  // Signal 3: Sender matches promotional pattern
  const fromAddress = parsed.from?.value?.[0]?.address;
  if (
    fromAddress &&
    PROMOTIONAL_SENDER_PATTERNS.some((pattern) => pattern.test(fromAddress))
  ) {
    signals++;
  }

  // Signal 4: Marketing platform email header markers
  const marketingHeaders = [
    "x-campaign",
    "x-campaignid",
    "x-mailer",
    "x-mailgun-tag",
    "x-sg-id", // SendGrid
    "x-ses-outgoing", // Amazon SES
    "x-mandrill-user", // Mailchimp/Mandrill
    "x-mc-user", // Mailchimp
    "feedback-id", // Usually added by bulk email platforms
  ];
  for (const header of marketingHeaders) {
    if (headers.has(header)) {
      signals++;
      break;
    }
  }

  // Signal 5: Sender domain matches subscription/news service pattern (e.g., Apple News)
  if (
    fromAddress &&
    SUBSCRIPTION_DOMAIN_PATTERNS.some((pattern) => pattern.test(fromAddress))
  ) {
    return true;
  }

  // Signal 6: Subject matches subscription/news pattern
  const subject = parsed.subject || "";
  if (PROMOTION_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject))) {
    return true;
  }

  // Signals 1-4: require at least two signals to classify as promotional email to reduce false positives
  return signals >= 2;
}

export interface BaseEmailInfo {
  uid: string;
  subject: string;
  from: { name: string; email: string };
  /** Cleaned HTML, for AI and default display */
  html?: string;
  /** Uncleaned raw HTML, for displaying original email in info source tab */
  rawHtml?: string;
  cc?: Array<{ name: string; email: string }>;
  bcc?: Array<{ name: string; email: string }>;
  timestamp: number;
  text: string;
  snippet: string;
  // Gmail-specific fields
  labelIds?: string[];
  gmailCategory?: string;
  priority?: string;
  /** Indicates if email is from SENT folder (IMAP adapter) */
  isSent?: boolean;
}

/**
 * Formatted email structure (unified output format)
 */
export interface ExtractEmailInfo extends BaseEmailInfo {
  attachments?: Attachment[];
}

interface FormattedEmail extends BaseEmailInfo {
  attachments: Array<{
    filename: string;
    size: number;
    mimeType: string;
    contentId?: string;
    base64Data?: string;
  }>;
}

/**
 * buildCleanEmailContent is now an alias for cleanEmailForLLM, maintaining backward compatibility
 */
export function buildCleanEmailContent({
  html,
  text,
}: {
  html?: string | null;
  text?: string | null;
}): { markdown: string; plain: string; html?: string } {
  const result = cleanEmailForLLM({ html, text });
  return {
    markdown: result.markdown,
    plain: result.plain,
    html: result.cleanHtml,
  };
}

/**
 * Gmail adapter based on Google App Password
 * Core dependencies: IMAP (receive) + SMTP (send) protocols
 */
export class EmailAdapter extends MessagePlatformAdapter {
  // IMAP client instance
  client: ImapFlow;
  // SMTP client (for sending emails)
  private smtpTransport: ReturnType<typeof createTransport>;
  // Polling-related variables
  private pollingInterval: NodeJS.Timeout | null = null;
  // Cache current user email
  private gmailAddress: string;
  private botId?: string;
  private ownerUserId?: string;
  private ownerUserType?: UserType;
  private parseEmailFn: typeof simpleParser;
  private imapHost: string;

  /**
   * Initialize adapter
   * @param opts - Configuration (must include App Password)
   */
  constructor(opts?: {
    botId?: string;
    emailAddress?: string; // Your Gmail address (e.g., xxx@gmail.com)
    appPassword?: string; // Google App Password (16 digits without spaces)
    pollingIntervalMs?: number; // Polling interval (default 30 seconds)
    ownerUserId?: string;
    ownerUserType?: UserType;
    imap?: {
      host?: string;
      port?: number;
      secure?: boolean;
      tls?: ImapFlowOptions["tls"];
    };
    smtp?: {
      host?: string;
      port?: number;
      secure?: boolean;
    };
    parseEmail?: typeof simpleParser;
  }) {
    super();

    this.botId = opts?.botId;
    const address = opts?.emailAddress ?? process.env.GOOGLE_GMAIL_ADDRESS;
    const password = opts?.appPassword ?? process.env.GOOGLE_APP_PASSWORD;

    if (!address || !password) {
      throw new Error("Must provider gmailAddress and appPassword");
    }

    // Initialize IMAP configuration
    this.gmailAddress = address;
    this.ownerUserId = opts?.ownerUserId;
    this.ownerUserType = opts?.ownerUserType;
    this.parseEmailFn = opts?.parseEmail ?? simpleParser;

    const imapHost =
      opts?.imap?.host ?? process.env.EMAIL_IMAP_HOST ?? "imap.gmail.com";
    this.imapHost = imapHost;
    const imapPort = Number(
      opts?.imap?.port ?? process.env.EMAIL_IMAP_PORT ?? 993,
    );
    const imapSecure =
      opts?.imap?.secure ??
      (process.env.EMAIL_IMAP_SECURE
        ? process.env.EMAIL_IMAP_SECURE === "1"
        : true);

    // Initialize IMAP client
    this.client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      tls: opts?.imap?.tls,
      auth: {
        /** Username */
        user: address,
        /** Password for regular authentication (if using OAuth2 then use `accessToken` instead) */
        pass: password,
      },
      logger: false,
    });
    // Initialize SMTP client (for sending emails)
    const smtpHost =
      opts?.smtp?.host ?? process.env.EMAIL_SMTP_HOST ?? "smtp.gmail.com";
    const smtpPort = Number(
      opts?.smtp?.port ?? process.env.EMAIL_SMTP_PORT ?? 465,
    );
    const smtpSecure =
      opts?.smtp?.secure ??
      (process.env.EMAIL_SMTP_SECURE
        ? process.env.EMAIL_SMTP_SECURE === "1"
        : true);
    this.smtpTransport = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // Port 465 requires SSL enabled
      auth: {
        user: this.gmailAddress,
        pass: password,
      },
    });
  }

  private emitFetchTiming(
    onTiming: EmailFetchOptions["onTiming"] | undefined,
    phase: string,
    status: EmailFetchTimingEvent["status"],
    details?: Record<string, unknown>,
    startedAt?: number,
    error?: unknown,
  ) {
    const event: EmailFetchTimingEvent = {
      phase,
      status,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      details,
      error,
    };
    onTiming?.(event);

    if (!shouldLogEmailFetchTiming(event)) {
      return;
    }

    const payload = {
      phase,
      status,
      durationMs: event.durationMs,
      botId: this.botId,
      platform: this.isGmailHost() ? "gmail" : "email",
      ...details,
      ...(error === undefined ? {} : { error: formatTimingError(error) }),
    };
    const line = JSON.stringify(payload);
    if (status === "failure") {
      logger.error(line);
      return;
    }
    if (status === "skip") {
      logger.warn(line);
      return;
    }
    logger.info(line);
  }

  /**
   * Get emails by days (e.g., 1 = last 1 day)
   */
  async getEmailsByDays(days = 1) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return this.getEmailsByTime(cutoffDate);
  }

  /**
   * Get emails by hours (e.g., 1 = last 1 hour)
   */
  async getEmailsByHours(hours = 1) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);
    return this.getEmailsByTime(cutoffDate);
  }

  /**
   * Get emails by timestamp (get emails after specified time)
   * @param since - Start time (Date object)
   */
  async getEmailsByTime(since: Date, options: EmailFetchOptions = {}) {
    const maxResults = normalizeEmailFetchMaxResults(options.maxResults);
    const maxResultsForLog = formatEmailFetchMaxResults(maxResults);
    const startedAt = Date.now();
    try {
      // Ensure IMAP is connected
      this.emitFetchTiming(options.onTiming, "imap_connect", "start", {
        host: this.imapHost,
        since: since.toISOString(),
        maxResults: maxResultsForLog,
      });
      await this.client.connect();
      this.emitFetchTiming(
        options.onTiming,
        "imap_connect",
        "success",
        {
          host: this.imapHost,
          since: since.toISOString(),
          maxResults: maxResultsForLog,
          capabilities: this.getSafeCapabilities(),
        },
        startedAt,
      );

      const folders = await this.resolveFetchFolders({
        onTiming: options.onTiming,
      });
      const dedupedEmails = new Map<string, ExtractEmailInfo>();

      for (const folder of folders) {
        if (dedupedEmails.size >= maxResults) {
          break;
        }
        const remaining = maxResults - dedupedEmails.size;
        try {
          const folderResults = await this.fetchEmailsFromFolder(
            folder.name,
            folder.isSent,
            since,
            {
              maxResults: remaining,
              useGmailRawSearch: this.isGmailHost(),
              onTiming: options.onTiming,
            },
          );
          for (const email of folderResults) {
            const key = this.getEmailDedupeKey(email);
            if (!dedupedEmails.has(key)) {
              dedupedEmails.set(key, email);
            } else if (email.isSent) {
              dedupedEmails.set(key, {
                ...dedupedEmails.get(key),
                ...email,
                isSent: true,
              });
            }
          }
        } catch (error) {
          this.emitFetchTiming(
            options.onTiming,
            "imap_folder_skip",
            "skip",
            {
              folder: folder.name,
              isSent: folder.isSent,
              folderSource: folder.source,
              specialUse: folder.specialUse,
              reason: "folder_unavailable_or_search_failed",
            },
            undefined,
            error,
          );
        }
      }

      const results = Array.from(dedupedEmails.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, maxResults);
      this.emitFetchTiming(
        options.onTiming,
        "imap_fetch_emails",
        "success",
        {
          since: since.toISOString(),
          resultCount: results.length,
          maxResults: maxResultsForLog,
          folderCount: folders.length,
          folders: folders.map((folder) => ({
            name: folder.name,
            isSent: folder.isSent,
            source: folder.source,
            specialUse: folder.specialUse,
            exists: folder.exists,
          })),
        },
        startedAt,
      );
      return results;
    } catch (error) {
      this.emitFetchTiming(
        options.onTiming,
        "imap_fetch_emails",
        "failure",
        {
          since: since.toISOString(),
          maxResults: maxResultsForLog,
        },
        startedAt,
        error,
      );
      console.error(`[Bot ${this.botId}] [gmail] failed:`, error);
      throw new Error(`Get email failed: ${(error as Error).message}`);
    }
  }

  /**
   * Fetch emails from a specific folder
   * @param folder - Folder name (e.g., "INBOX", "SENT", "[Gmail]/Sent")
   * @param isSent - Whether this is the sent folder
   * @param since - Start time filter
   */
  private async fetchEmailsFromFolder(
    folder: string,
    isSent: boolean,
    since: Date,
    options: {
      maxResults: number;
      useGmailRawSearch: boolean;
      onTiming?: (event: EmailFetchTimingEvent) => void;
    },
  ): Promise<ExtractEmailInfo[]> {
    const folderStartedAt = Date.now();
    this.emitFetchTiming(options.onTiming, "imap_folder_open", "start", {
      folder,
      isSent,
    });
    let mailbox: MailboxObject;
    try {
      mailbox = await this.client.mailboxOpen(folder);
    } catch (error) {
      this.emitFetchTiming(
        options.onTiming,
        "imap_folder_open",
        "failure",
        { folder, isSent },
        folderStartedAt,
        error,
      );
      throw error;
    }
    if (!mailbox) throw new Error(`Cannot open ${folder}`);
    this.emitFetchTiming(
      options.onTiming,
      "imap_folder_open",
      "success",
      {
        folder,
        isSent,
        exists: mailbox.exists,
      },
      folderStartedAt,
    );

    try {
      const searchStartedAt = Date.now();
      const searchResult = await this.searchEmailUids(folder, since, options);
      this.emitFetchTiming(
        options.onTiming,
        "imap_folder_search",
        "success",
        {
          folder,
          isSent,
          strategy: searchResult.strategy,
          query: searchResult.query,
          fallbackReason: searchResult.fallbackReason,
          uidCount: searchResult.uids.length,
          since: since.toISOString(),
        },
        searchStartedAt,
      );

      const recentUids = takeMostRecentUids(
        searchResult.uids,
        options.maxResults,
      );
      const results: ExtractEmailInfo[] = [];
      let promotionalCount = 0;
      let skippedOldCount = 0;
      let fetchedMessageCount = 0;
      const fetchStartedAt = Date.now();

      // Keep RFC822 source fetches bounded even when callers request the full
      // time window, because each message source can be large.
      for (
        let offset = 0;
        offset < recentUids.length && results.length < options.maxResults;
        offset += EMAIL_FETCH_BATCH_SIZE
      ) {
        const uidBatch = recentUids.slice(
          offset,
          offset + EMAIL_FETCH_BATCH_SIZE,
        );
        const messages = await this.client.fetchAll(
          uidBatch,
          {
            envelope: true,
            bodyStructure: true,
            source: true,
          },
          { uid: true },
        );
        fetchedMessageCount += messages.length;
        const messagesByUid = new Map(
          messages.map((message) => [message.uid, message] as const),
        );

        for (const uid of uidBatch) {
          if (results.length >= options.maxResults) break;
          const msg = messagesByUid.get(uid);
          if (!msg || !msg.source) {
            continue;
          }

          const parsed = await this.parseEmailFn(msg.source);
          if (parsed.date && parsed.date < since) {
            skippedOldCount++;
            continue;
          }
          if (isPromotionalEmail(parsed)) {
            promotionalCount++;
            continue;
          }
          const email = this.formatEmail(parsed, msg.uid, isSent);
          const attachments = await this.ingestEmailAttachments(email);
          results.push({
            ...email,
            attachments,
          });
        }
      }

      // Fallback: if time-filtered search yielded no results, fetch most recent emails
      if (results.length === 0) {
        const fallbackStartedAt = Date.now();
        this.emitFetchTiming(
          options.onTiming,
          "imap_folder_fallback",
          "start",
          {
            folder,
            isSent,
            reason: "time_filter_no_results",
          },
        );

        const fallbackUids = await this.searchRecentEmailUids(
          EMAIL_FALLBACK_RECENT_COUNT,
        );
        const fallbackResults: ExtractEmailInfo[] = [];
        let fallbackPromotionalCount = 0;
        let fallbackFetchedCount = 0;

        for (
          let offset = 0;
          offset < fallbackUids.uids.length &&
          fallbackResults.length < EMAIL_FALLBACK_RECENT_COUNT;
          offset += EMAIL_FETCH_BATCH_SIZE
        ) {
          const uidBatch = fallbackUids.uids.slice(
            offset,
            offset + EMAIL_FETCH_BATCH_SIZE,
          );
          const messages = await this.client.fetchAll(
            uidBatch,
            { envelope: true, bodyStructure: true, source: true },
            { uid: true },
          );
          fallbackFetchedCount += messages.length;
          const messagesByUid = new Map(
            messages.map((message) => [message.uid, message] as const),
          );

          for (const uid of uidBatch) {
            if (fallbackResults.length >= EMAIL_FALLBACK_RECENT_COUNT) break;
            const msg = messagesByUid.get(uid);
            if (!msg || !msg.source) continue;
            const parsed = await this.parseEmailFn(msg.source);
            if (isPromotionalEmail(parsed)) {
              fallbackPromotionalCount++;
              continue;
            }
            const email = this.formatEmail(parsed, msg.uid, isSent);
            const attachments = await this.ingestEmailAttachments(email);
            fallbackResults.push({ ...email, attachments });
          }
        }

        this.emitFetchTiming(
          options.onTiming,
          "imap_folder_fallback",
          "success",
          {
            folder,
            isSent,
            strategy: fallbackUids.strategy,
            fetchedCount: fallbackFetchedCount,
            resultCount: fallbackResults.length,
            promotionalCount: fallbackPromotionalCount,
          },
          fallbackStartedAt,
        );

        if (fallbackResults.length > 0) {
          this.emitFetchTiming(
            options.onTiming,
            "imap_folder_fetch",
            "success",
            {
              folder,
              isSent,
              requestedUidCount: recentUids.length,
              fetchedMessageCount,
              resultCount: results.length,
              skippedOldCount,
              promotionalCount,
              skippedPromotionalCount: promotionalCount,
              fallbackResultCount: fallbackResults.length,
            },
            fetchStartedAt,
          );
          return fallbackResults;
        }
      }

      this.emitFetchTiming(
        options.onTiming,
        "imap_folder_fetch",
        "success",
        {
          folder,
          isSent,
          requestedUidCount: recentUids.length,
          fetchedMessageCount,
          resultCount: results.length,
          skippedOldCount,
          promotionalCount,
          skippedPromotionalCount: promotionalCount,
        },
        fetchStartedAt,
      );

      return results;
    } finally {
      await this.client.mailboxClose();
    }
  }

  private isGmailHost(): boolean {
    return /(^|\.)gmail\.com$/i.test(this.imapHost);
  }

  private getSafeCapabilities(): string[] {
    return Array.from(this.client.capabilities.keys()).filter((capability) =>
      ["IMAP4REV1", "UIDPLUS", "X-GM-EXT-1", "XLIST", "SPECIAL-USE"].includes(
        capability.toUpperCase(),
      ),
    );
  }

  private async resolveFetchFolders(options: {
    onTiming?: (event: EmailFetchTimingEvent) => void;
  }): Promise<EmailFetchFolder[]> {
    const fallbackFolders = (
      this.isGmailHost() ? GMAIL_FETCH_FOLDERS : DEFAULT_FETCH_FOLDERS
    ).map((folder): EmailFetchFolder => ({ ...folder, source: "fallback" }));

    const startedAt = Date.now();
    this.emitFetchTiming(options.onTiming, "imap_list_mailboxes", "start", {
      host: this.imapHost,
    });
    try {
      const mailboxes = await this.client.list({
        statusQuery: { messages: true },
      });
      const selected = this.selectFetchFoldersFromList(mailboxes);
      this.emitFetchTiming(
        options.onTiming,
        "imap_list_mailboxes",
        "success",
        {
          mailboxCount: mailboxes.length,
          selectedFolders: selected.map((folder) => ({
            name: folder.name,
            isSent: folder.isSent,
            source: folder.source,
            specialUse: folder.specialUse,
            exists: folder.exists,
            flags: folder.flags,
          })),
          fallbackUsed: selected.length === 0,
        },
        startedAt,
      );
      return selected.length > 0 ? selected : fallbackFolders;
    } catch (error) {
      this.emitFetchTiming(
        options.onTiming,
        "imap_list_mailboxes",
        "failure",
        {
          fallbackFolders: fallbackFolders.map((folder) => ({
            name: folder.name,
            isSent: folder.isSent,
          })),
        },
        startedAt,
        error,
      );
      return fallbackFolders;
    }
  }

  private selectFetchFoldersFromList(
    mailboxes: ListResponse[],
  ): EmailFetchFolder[] {
    const selectable = mailboxes.filter(
      (mailbox) =>
        !mailbox.flags.has("\\Noselect") && !mailbox.flags.has("\\NonExistent"),
    );
    const selected = new Map<string, EmailFetchFolder>();
    const addFolder = (mailbox: ListResponse | undefined, isSent: boolean) => {
      if (!mailbox || selected.has(mailbox.path)) return;
      selected.set(mailbox.path, {
        name: mailbox.path,
        isSent,
        source: "listed",
        specialUse: mailbox.specialUse,
        exists: mailbox.status?.messages,
        flags: this.getSafeMailboxFlags(mailbox.flags),
      });
    };
    const findBySpecialUse = (specialUse: string) =>
      selectable.find((mailbox) => mailbox.specialUse === specialUse);
    const findByPath = (predicate: (normalizedPath: string) => boolean) =>
      selectable.find((mailbox) =>
        predicate(this.normalizeMailboxPath(mailbox.path)),
      );

    if (this.isGmailHost()) {
      addFolder(
        findBySpecialUse("\\All") ??
          findByPath(
            (path) =>
              path === "[gmail]/all mail" ||
              path === "[google mail]/all mail" ||
              path.endsWith("/all mail"),
          ),
        false,
      );
    }

    addFolder(
      findBySpecialUse("\\Inbox") ?? findByPath((path) => path === "inbox"),
      false,
    );
    addFolder(
      findBySpecialUse("\\Sent") ??
        findByPath((path) => /(^|\/)(sent|sent mail|sent items)$/i.test(path)),
      true,
    );

    return Array.from(selected.values());
  }

  private normalizeMailboxPath(path: string): string {
    return path.trim().replace(/\\/g, "/").toLowerCase();
  }

  private getSafeMailboxFlags(flags: Set<string>): string[] {
    return Array.from(flags).filter((flag) =>
      [
        "\\All",
        "\\Archive",
        "\\Inbox",
        "\\Sent",
        "\\Drafts",
        "\\Junk",
        "\\Trash",
        "\\Noselect",
        "\\NonExistent",
      ].includes(flag),
    );
  }

  private async searchEmailUids(
    folder: string,
    since: Date,
    options: {
      useGmailRawSearch: boolean;
      maxResults: number;
      onTiming?: (event: EmailFetchTimingEvent) => void;
    },
  ): Promise<{
    uids: number[];
    strategy: string;
    query?: string;
    fallbackReason?: string;
  }> {
    if (options.useGmailRawSearch) {
      try {
        const gmraw = this.buildGmailRawSearchQuery(folder, since);
        const uids = await this.client.search({ gmraw }, { uid: true });
        if (Array.isArray(uids) && uids.length > 0) {
          return { uids, strategy: "gmail_raw", query: gmraw };
        }
        const fallback = await this.searchEmailUidsByImapSince(since);
        return {
          ...fallback,
          fallbackReason: "gmail_raw_empty",
          query: gmraw,
        };
      } catch (error) {
        this.emitFetchTiming(
          options.onTiming,
          "imap_gmail_raw_search",
          "skip",
          {
            folder,
            reason: "gmail_raw_failed_fallback_to_imap_since",
          },
          undefined,
          error,
        );
        const fallback = await this.searchEmailUidsByImapSince(since);
        return {
          ...fallback,
          fallbackReason: "gmail_raw_failed",
        };
      }
    }

    return this.searchEmailUidsByImapSince(since);
  }

  private async searchEmailUidsByImapSince(
    since: Date,
  ): Promise<{ uids: number[]; strategy: string; query: string }> {
    const dayStart = new Date(since);
    dayStart.setHours(0, 0, 0, 0);
    const uids = await this.client.search({ since: dayStart }, { uid: true });
    return {
      uids: Array.isArray(uids) ? uids : [],
      strategy: "imap_since",
      query: `SINCE ${dayStart.toISOString()}`,
    };
  }

  private async searchRecentEmailUids(
    count: number,
  ): Promise<{ uids: number[]; strategy: string }> {
    // Search all UIDs in the mailbox, then take the highest ones (most recent)
    const uids = await this.client.search({ all: true }, { uid: true });
    const allUids = Array.isArray(uids) ? uids : [];
    // UIDs from IMAP are typically in ascending order; reverse for most recent
    const sorted = allUids.reverse();
    return {
      uids: sorted.slice(0, count),
      strategy: "recent_fallback",
    };
  }

  private buildGmailRawSearchQuery(folder: string, since: Date): string {
    const days = this.getGmailRawSearchWindowDays(since);
    const parts = [`newer_than:${days}d`, "-in:spam", "-in:trash"];
    if (this.isSentFolderName(folder)) {
      parts.push("in:sent");
    }
    return parts.join(" ");
  }

  private getGmailRawSearchWindowDays(since: Date): number {
    const diffMs = Date.now() - since.getTime();
    const diffDays = Math.ceil(Math.max(diffMs, 0) / (24 * 60 * 60 * 1000));
    // Gmail date operators are day-granular in practice; add one day to avoid
    // losing boundary-day messages and filter exact timestamps after fetch.
    return Math.max(1, diffDays + 1);
  }

  private isSentFolderName(folder: string): boolean {
    return /(^|\/)(sent|sent mail|sent items)$/i.test(folder);
  }

  private getEmailDedupeKey(email: ExtractEmailInfo): string {
    return [
      email.timestamp,
      email.from.email.toLowerCase(),
      email.subject.trim().toLowerCase(),
      email.snippet.trim().slice(0, 120),
    ].join("|");
  }

  private formatEmail(
    parsed: ParsedMail,
    uid: number,
    isSent = false,
  ): FormattedEmail {
    const fromAddress = Array.isArray(parsed.from?.value)
      ? parsed.from.value[0]
      : parsed.from?.value;
    const htmlContent = this.extractHtmlContent(parsed);
    const cleaned = cleanEmailForLLM({
      html: htmlContent,
      text: parsed.text ?? "",
    });
    const markdownBody =
      cleaned.markdown.length > 0
        ? cleaned.markdown
        : cleanupMarkdown(htmlToPlainText(htmlContent) || parsed.text || "");
    const plainText = cleaned.plain.length > 0 ? cleaned.plain : markdownBody;

    const priority = this.extractPriorityFromHeaders(parsed);
    const isPromo = isPromotionalEmail(parsed);

    return {
      uid: uid.toString(),
      subject: parsed.subject || "",
      from: {
        name: fromAddress?.name || "",
        email: fromAddress?.address || "",
      },
      html: cleaned.cleanHtml,
      rawHtml: htmlContent?.trim() || undefined,
      cc: this.formatAddresses(parsed.cc),
      bcc: this.formatAddresses(parsed.bcc),
      timestamp: (parsed.date ? parsed.date.getTime() : Date.now()) / 1000,
      text: markdownBody,
      snippet: buildSnippet(plainText),
      attachments:
        parsed.attachments?.map((att) => ({
          filename: att.filename || "unknown",
          size: att.size,
          mimeType: att.contentType,
          contentId: att.cid || att.contentId || undefined,
          base64Data: att.content?.toString("base64") || "",
        })) || [],
      priority,
      gmailCategory: isPromo ? "promotions" : undefined,
      isSent,
    };
  }

  /**
   * Extract priority from email headers (IMAP/POP3)
   */
  private extractPriorityFromHeaders(parsed: ParsedMail): string | undefined {
    const headers = parsed.headers;

    // Check for X-Priority header (1 = High, 3 = Normal, 5 = Low)
    const xPriority = headers.get("x-priority");
    if (xPriority) {
      const match = xPriority.toString().match(/\d/);
      if (match) {
        const priority = Number.parseInt(match[0]);
        if (priority <= 2) return "high";
        if (priority >= 4) return "low";
      }
    }

    // Check for Importance header
    const importance = headers.get("importance")?.toString().toLowerCase();
    if (importance === "high") return "high";
    if (importance === "low") return "low";

    // Check for Priority header
    const priority = headers.get("priority")?.toString().toLowerCase();
    if (priority === "urgent" || priority === "high") return "high";
    if (priority === "non-urgent" || priority === "low") return "low";

    // Check for X-MS-Mail-Priority (Outlook)
    const msPriority = headers
      .get("x-ms-mail-priority")
      ?.toString()
      .toLowerCase();
    if (msPriority === "high") return "high";
    if (msPriority === "low") return "low";

    return undefined;
  }

  private extractHtmlContent(parsed: ParsedMail): string {
    const { html, textAsHtml } = parsed;

    if (typeof html === "string") {
      return html;
    }
    if (Buffer.isBuffer(html)) {
      return html.toString("utf-8");
    }
    if (Array.isArray(html)) {
      return html
        .map((part) =>
          typeof part === "string"
            ? part
            : Buffer.isBuffer(part)
              ? part.toString("utf-8")
              : "",
        )
        .join("");
    }

    if (typeof textAsHtml === "string") {
      return textAsHtml;
    }

    return "";
  }

  private formatAddresses(
    address?: AddressObject | AddressObject[],
  ): Array<{ name: string; email: string }> {
    if (!address) return [];

    const addresses = Array.isArray(address) ? address : [address];
    return addresses.map((addr) => ({
      name: addr.value.at(0)?.name || "",
      email: addr.value.at(0)?.address || "",
    }));
  }

  /**
   * Send email (basic method)
   */
  async sendEmail(
    recipient: string | string[],
    subject: string,
    body: string,
    isHtml = false,
    options?: { cc?: string[]; bcc?: string[] },
  ): Promise<{ id: string }> {
    try {
      const defaultBody = body?.trim().length ? body : "";
      // Build email options
      const mailOptions = {
        from: this.gmailAddress, // Sender (must match email bound to App Password)
        to: recipient,
        cc: options?.cc && options.cc.length > 0 ? options.cc : undefined,
        bcc: options?.bcc && options.bcc.length > 0 ? options.bcc : undefined,
        subject,
        text: isHtml ? defaultBody.replace(/<[^>]+>/g, "") : defaultBody, // Plain text fallback
        html: isHtml ? defaultBody : undefined,
      };

      // Send email
      const info = await this.smtpTransport.sendMail(mailOptions);
      return { id: (info as SentMessageInfo).messageId || "" };
    } catch (err) {
      console.error("Failed to send email:", err);
      throw new Error(`Failed to send email: ${(err as Error).message}`);
    }
  }

  /**
   * Send single message (adapter original adapter interface)
   */
  async sendMessage(
    target: MessageTarget,
    id: string,
    message: string,
  ): Promise<void> {
    await this.sendMessages(target, id, [message]);
  }

  /**
   * Send multiple messages (adapting to original adapter interface)
   */
  async sendMessages(
    target: MessageTarget,
    id: string | string[],
    messages: Messages,
    options?: {
      cc?: string[];
      bcc?: string[];
      html?: string;
      subject?: string;
    },
  ): Promise<void> {
    const { textParts, images } = this.partitionMessages(messages);
    const ccList =
      options?.cc?.filter((value) => value.trim().length > 0) ?? [];
    const bccList =
      options?.bcc?.filter((value) => value.trim().length > 0) ?? [];
    const htmlBody =
      typeof options?.html === "string" && options.html.trim().length > 0
        ? options.html.trim()
        : undefined;

    const attachmentResults = await Promise.all(
      images.map(async (image, index) => {
        try {
          return await this.prepareAttachment(image, index);
        } catch (error) {
          console.error(
            `[Bot ${this.botId}] [gmail] Failed to prepare attachment`,
            error,
          );
          return null;
        }
      }),
    );

    const validAttachments = attachmentResults.filter(
      (attachment): attachment is NodemailerAttachment => Boolean(attachment),
    );

    const body = textParts.join("\n").trim();

    // Use provided subject or generate from first line of message body
    const emailSubject =
      options?.subject?.trim() ||
      (body.length > 0 ? body.split("\n")[0].trim() : "New Message");

    if (validAttachments.length === 0) {
      await this.sendEmail(
        id,
        emailSubject,
        htmlBody ?? body,
        Boolean(htmlBody),
        {
          cc: ccList,
          bcc: bccList,
        },
      );
      return;
    }

    const fallbackBody =
      body.length > 0 ? body : "Image(s) attached via openloomi.";

    await this.smtpTransport.sendMail({
      from: this.gmailAddress,
      to: id,
      cc: ccList.length > 0 ? ccList : undefined,
      bcc: bccList.length > 0 ? bccList : undefined,
      subject: emailSubject,
      text: fallbackBody,
      html: htmlBody,
      attachments: validAttachments,
    });
  }

  /**
   * Reply to email (adapting to original adapter interface, supports quoting original text)
   */
  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    quoteOrigin = false,
  ): Promise<void> {
    if (!(event instanceof PrivateMessageEvent)) {
      throw new Error(
        "Only private message replies supported (email has no group chat concept)",
      );
    }

    const recipient = String(event.sender.id);
    await this.sendMessages("private", recipient, messages);
  }

  /**
   * Get current user email (directly returns address at initialization, no API call needed)
   */
  async getUserEmailAddress(): Promise<string> {
    return this.gmailAddress;
  }

  /**
   * Stop adapter (disconnect + clear polling)
   */
  async kill(): Promise<boolean> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.client.close();
    this.smtpTransport.close();
    return true;
  }

  private async ingestEmailAttachments(
    email: FormattedEmail,
  ): Promise<Attachment[]> {
    if (!this.ownerUserId || !this.ownerUserType) {
      return [];
    }

    if (!Array.isArray(email.attachments) || email.attachments.length === 0) {
      return [];
    }

    const collected: Attachment[] = [];

    for (const attachment of email.attachments) {
      if (!attachment.base64Data) {
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(attachment.base64Data, "base64");
      } catch (error) {
        console.warn(
          `[gmail${this.botId ? ` ${this.botId}` : ""}] Failed to decode attachment ${attachment.filename}`,
          error,
        );
        continue;
      }

      const ingested = await ingestAttachmentForUser({
        source: "gmail",
        ownerUserId: this.ownerUserId,
        ownerUserType: this.ownerUserType,
        maxSizeBytes: GMAIL_MAX_ATTACHMENT_BYTES,
        originalFileName: attachment.filename ?? null,
        mimeTypeHint: attachment.mimeType ?? null,
        sizeHintBytes: attachment.size ?? null,
        contentId: attachment.contentId ?? null,
        downloadAttachment: async () => ({
          data: buffer,
          contentType: attachment.mimeType ?? undefined,
          sizeBytes: buffer.length,
        }),
        logContext: this.botId ? `[gmail ${this.botId}]` : "[gmail]",
      });

      if (ingested) {
        collected.push(ingested);
      }
    }

    return collected;
  }

  /**
   * Check if muted (email has no mute concept, returns false)
   */
  async isMuted(groupId: number): Promise<boolean> {
    return false;
  }

  private partitionMessages(messages: Messages): {
    textParts: string[];
    images: Image[];
  } {
    const textParts: string[] = [];
    const images: Image[] = [];

    for (const message of messages) {
      if (this.isImageMessage(message)) {
        images.push(message);
        continue;
      }

      const text = this.messageToPlainText(message);
      if (text.trim().length > 0) {
        textParts.push(text);
      }
    }

    return { textParts, images };
  }

  private messageToPlainText(message: Message): string {
    if (typeof message === "string") {
      return message;
    }

    if ("text" in message) {
      return message.text;
    }

    if ("target" in message) {
      return `@${message.target}`;
    }

    if ("nodes" in message) {
      return message.nodes
        .map((node) => this.messageToPlainText(node as Message))
        .join("");
    }

    return "";
  }

  private isImageMessage(message: Message): message is Image {
    return (
      typeof message === "object" &&
      message !== null &&
      "url" in message &&
      typeof (message as Image).url === "string" &&
      (message as Image).url.length > 0
    );
  }

  private inferFileName(image: Image, index: number): string {
    if (image.id && image.id.trim().length > 0) {
      return image.id;
    }

    if (image.path) {
      const segments = image.path.split("/");
      const candidate = segments[segments.length - 1];
      if (candidate) return candidate;
    }

    if (image.url) {
      try {
        const url = new URL(image.url);
        const filename = url.pathname.split("/").pop();
        if (filename && filename.trim().length > 0) {
          return filename;
        }
      } catch (error) {
        console.warn(
          `[Bot ${this.botId}] [gmail] Failed to parse filename from URL`,
          error,
        );
      }
    }

    return `image-${index + 1}.jpg`;
  }

  private async prepareAttachment(
    image: Image,
    index: number,
  ): Promise<NodemailerAttachment> {
    const filename = this.inferFileName(image, index);

    if (image.base64) {
      const base64Content = image.base64.includes(",")
        ? (image.base64.split(",").pop() ?? image.base64)
        : image.base64;

      return {
        filename,
        content: Buffer.from(base64Content, "base64"),
        contentType: image.contentType,
      };
    }

    if (image.path) {
      return {
        filename,
        path: image.path,
        contentType: image.contentType,
      };
    }

    if (image.url) {
      return {
        filename,
        path: image.url,
        contentType: image.contentType,
      };
    }

    throw new Error("Unable to resolve attachment source for Gmail upload");
  }
}
