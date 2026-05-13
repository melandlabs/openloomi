import { google, type people_v1, type gmail_v1 } from "googleapis";
import type { GaxiosResponseWithHTTP2 } from "googleapis-common";
import type { OAuth2Client } from "google-auth-library";
import { AppError } from "@openloomi/shared/errors";
import {
  updateIntegrationAccount,
  type BotWithAccount,
} from "@/lib/db/queries";
import { getApplicationBaseUrl } from "@/lib/env";
import type { ExtractEmailInfo } from "../email";
import type { Attachment } from "@openloomi/shared";
import { ingestAttachmentForUser } from "@/lib/integrations/utils/attachments";
import { cleanEmailForLLM, buildSnippet } from "@openloomi/integrations/utils";
import type { UserType } from "@/app/(auth)/auth";

const GMAIL_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Raw attachment format (before ingestion)
 */
interface RawAttachment {
  filename: string;
  size: number;
  mimeType: string;
  contentId?: string | undefined;
  base64Data?: string;
}

/**
 * Base email info without attachments
 */
interface BaseEmailFields {
  uid: string;
  subject: string;
  from: { name: string; email: string };
  /** Cleaned HTML */
  html?: string;
  /** Uncleaned original HTML, for info source to display email original content */
  rawHtml?: string;
  cc?: Array<{ name: string; email: string }>;
  bcc?: Array<{ name: string; email: string }>;
  timestamp: number;
  text: string;
  snippet: string;
}

/**
 * Formatted email with raw attachments (before ingestion)
 */
interface FormattedGmailEmail extends BaseEmailFields {
  attachments: RawAttachment[];
  labelIds?: string[];
  gmailCategory?: string;
  priority?: string;
}

// Scopes for Gmail OAuth integration
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

/**
 * Stored credentials for Gmail OAuth integration
 */
export type GmailStoredCredentials = {
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  expiryDate?: number | null;
};

/**
 * Gmail OAuth Adapter for API-based email sending
 * Handles OAuth credentials refresh automatically
 */
export class GmailOAuthAdapter {
  private oauth2Client: OAuth2Client;
  private gmailService: gmail_v1.Gmail;
  private peopleService: people_v1.People;
  private botId: string;
  private userId: string;
  private platformAccountId: string | null;
  private storedCredentials: GmailStoredCredentials;
  ownerUserId: string | undefined;
  ownerUserType: UserType | undefined;

  constructor(options: {
    bot: BotWithAccount;
    credentials: GmailStoredCredentials;
    ownerUserId?: string;
    ownerUserType?: UserType;
  }) {
    const clientId =
      process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
    const clientSecret =
      process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AppError(
        "bad_request:api",
        "Gmail integration is not configured. Please set GOOGLE_CLIENT_ID/SECRET.",
      );
    }

    const redirectUri =
      process.env.GMAIL_REDIRECT_URI ??
      `${getApplicationBaseUrl()}/api/gmail/callback`;

    this.oauth2Client = new google.auth.OAuth2({
      clientId,
      clientSecret,
      redirectUri,
    });

    this.botId = options.bot.id;
    this.userId = options.bot.userId;
    this.platformAccountId = options.bot.platformAccount?.id ?? null;
    this.storedCredentials = options.credentials ?? {};
    this.ownerUserId = options.ownerUserId;
    this.ownerUserType = options.ownerUserType;

    this.oauth2Client.setCredentials({
      access_token: this.storedCredentials.accessToken ?? undefined,
      refresh_token: this.storedCredentials.refreshToken ?? undefined,
      expiry_date: this.storedCredentials.expiryDate ?? undefined,
      scope: this.storedCredentials.scope ?? undefined,
      token_type: this.storedCredentials.tokenType ?? undefined,
    });

    this.gmailService = google.gmail({
      version: "v1",
      auth: this.oauth2Client,
    });

    this.peopleService = google.people({
      version: "v1",
      auth: this.oauth2Client,
    });
  }

  private async persistCredentialsIfChanged() {
    const nextCredentials: GmailStoredCredentials = {
      accessToken: this.oauth2Client.credentials.access_token ?? null,
      refreshToken: this.oauth2Client.credentials.refresh_token ?? null,
      scope: this.oauth2Client.credentials.scope ?? null,
      tokenType: this.oauth2Client.credentials.token_type ?? null,
      expiryDate: this.oauth2Client.credentials.expiry_date ?? null,
    };

    const changed =
      nextCredentials.accessToken !== this.storedCredentials.accessToken ||
      nextCredentials.refreshToken !== this.storedCredentials.refreshToken ||
      nextCredentials.scope !== this.storedCredentials.scope ||
      nextCredentials.tokenType !== this.storedCredentials.tokenType ||
      nextCredentials.expiryDate !== this.storedCredentials.expiryDate;

    if (!changed || !this.platformAccountId) {
      this.storedCredentials = nextCredentials;
      return;
    }

    await updateIntegrationAccount({
      userId: this.userId,
      platformAccountId: this.platformAccountId,
      credentials: nextCredentials,
    });
    this.storedCredentials = nextCredentials;
  }

  private async withGmail<T>(
    callback: (gmail: gmail_v1.Gmail) => Promise<T>,
  ): Promise<T> {
    const result = await callback(this.gmailService);
    await this.persistCredentialsIfChanged();
    return result;
  }

  /**
   * Send email via Gmail API
   */
  async sendEmail({
    to,
    subject,
    body,
    html,
  }: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ id: string }> {
    return this.withGmail(async (gmail) => {
      let emailContent: string;

      if (html) {
        // HTML email with multipart
        const htmlBody = html.replace(/\n/g, "<br>");
        emailContent = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          'Content-Type: multipart/alternative; boundary="boundary"',
          "",
          "--boundary",
          "Content-Type: text/plain; charset=utf-8",
          "",
          body.replace(/<[^>]+>/g, ""), // Plain text fallback
          "",
          "--boundary",
          "Content-Type: text/html; charset=utf-8",
          "",
          htmlBody,
          "",
          "--boundary--",
        ].join("\r\n");
      } else {
        // Plain text email
        emailContent = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "MIME-Version: 1.0",
          "",
          body,
        ].join("\r\n");
      }

      // Base64URL encode
      const encodedMessage = Buffer.from(emailContent).toString("base64url");

      // Send email
      const sendResponse = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage },
      });

      const messageId = sendResponse.data.id;
      if (!messageId) {
        throw new Error("Gmail API did not return a message ID");
      }
      return { id: messageId };
    });
  }

  /**
   * Find contact by name via Google People API
   */
  async findContactEmail(name: string): Promise<
    Array<{
      name: string;
      email: string;
    }>
  > {
    const searchResponse = await this.peopleService.people.searchContacts({
      query: name,
      readMask: "names,emailAddresses,nicknames",
    });

    const contacts = searchResponse.data.results ?? [];

    if (contacts.length === 0) {
      const otherContactsResponse =
        await this.peopleService.otherContacts.search({
          query: `${name}*`,
          readMask: "names,emailAddresses,nicknames",
        });
      contacts.push(...(otherContactsResponse.data.results ?? []));
    }

    return contacts.map((result: any) => {
      const person = result.person ?? {};
      const names = person.names ?? [{}];
      const emails = person.emailAddresses ?? [{}];

      return {
        name: names[0].displayName ?? "N/A",
        email: emails[0].value ?? "N/A",
      };
    });
  }

  /**
   * Get user's Gmail address
   */
  async getUserEmailAddress(): Promise<string> {
    return this.withGmail(async (gmail) => {
      const profile = await gmail.users.getProfile({
        userId: "me",
      });
      return profile.data.emailAddress ?? "";
    });
  }

  /**
   * Get emails since a specific timestamp
   * @param since - Unix timestamp in seconds
   * @param maxLimits - Maximum number of emails to retrieve
   */
  async getEmailsByTime(
    since: number,
    maxLimits = 100,
  ): Promise<ExtractEmailInfo[]> {
    return this.withGmail(async (gmail) => {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: `after:${Math.floor(since)} -category:promotions`,
      });

      const messages = res.data.messages || [];
      const detailedMessages: ExtractEmailInfo[] = [];

      for (let i = 0; i < messages.length && i < maxLimits; i++) {
        const message = messages[i];
        if (message.id) {
          const msgDetail = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });
          const formattedMessage = await this.formatGmailMessage(msgDetail);
          const attachments =
            await this.ingestEmailAttachments(formattedMessage);
          detailedMessages.push({
            ...formattedMessage,
            attachments,
          });
        }
      }
      return detailedMessages;
    });
  }

  /**
   * Format Gmail API message to FormattedGmailEmail format (with raw attachments)
   */
  private async formatGmailMessage(
    message: GaxiosResponseWithHTTP2<gmail_v1.Schema$Message>,
  ): Promise<FormattedGmailEmail> {
    const payload = message.data.payload;
    const headers = payload?.headers || [];

    const getHeader = (name: string): string => {
      const header = headers.find(
        (h: any) => h.name?.toLowerCase() === name.toLowerCase(),
      );
      return header?.value || "";
    };

    const subject = getHeader("Subject");
    const fromHeader = getHeader("From");
    const ccHeader = getHeader("Cc");

    // Parse from address
    const from = this.parseEmailAddress(fromHeader);
    // Parse cc addresses
    const cc = this.parseEmailAddresses(ccHeader);

    // Extract original email body
    const { text: rawText, html: rawHtml } = this.extractEmailBody(payload);
    const timestamp = message.data.internalDate
      ? Math.floor(Number(message.data.internalDate) / 1000)
      : Math.floor(Date.now() / 1000);

    // Clean content through unified pipeline
    const cleaned = cleanEmailForLLM({ html: rawHtml, text: rawText });
    const cleanedText =
      cleaned.markdown.length > 0 ? cleaned.markdown : rawText;
    const cleanedPlain = cleaned.plain.length > 0 ? cleaned.plain : cleanedText;

    const attachments = this.extractAttachments(payload);

    const labelIds = message.data.labelIds || [];
    const gmailCategory = this.extractGmailCategory(labelIds);
    const priority = this.extractPriority(headers);

    return {
      uid: message.data.id || "",
      subject,
      from,
      cc,
      bcc: [],
      timestamp,
      text: cleanedText,
      html: cleaned.cleanHtml || undefined,
      rawHtml: rawHtml?.trim() || undefined,
      snippet: buildSnippet(cleanedPlain),
      attachments,
      labelIds,
      gmailCategory,
      priority,
    };
  }

  /**
   * Extract Gmail category from label IDs
   */
  private extractGmailCategory(labelIds: string[]): string | undefined {
    const categoryMap: Record<string, string> = {
      CATEGORY_PROMOTIONS: "promotions",
      CATEGORY_SOCIAL: "social",
      CATEGORY_UPDATES: "updates",
      CATEGORY_FORUMS: "forums",
      CATEGORY_PERSONAL: "personal",
    };

    for (const labelId of labelIds) {
      if (categoryMap[labelId]) {
        return categoryMap[labelId];
      }
    }
    return undefined;
  }

  /**
   * Extract priority from email headers
   */
  private extractPriority(
    headers: Array<{ name?: string | null; value?: string | null }>,
  ): string | undefined {
    // Check for X-Priority header (1 = High, 3 = Normal, 5 = Low)
    const xPriorityHeader = headers.find(
      (h) => h.name?.toLowerCase() === "x-priority",
    );
    const xPriority = xPriorityHeader?.value;
    if (xPriority) {
      const match = xPriority.match(/\d/);
      if (match) {
        const priority = Number.parseInt(match[0]);
        if (priority <= 2) return "high";
        if (priority >= 4) return "low";
      }
    }

    // Check for Importance header
    const importanceHeader = headers.find(
      (h) => h.name?.toLowerCase() === "importance",
    );
    const importance = importanceHeader?.value?.toLowerCase();
    if (importance === "high") return "high";
    if (importance === "low") return "low";

    // Check for Priority header
    const priorityHeader = headers.find(
      (h) => h.name?.toLowerCase() === "priority",
    );
    const priority = priorityHeader?.value?.toLowerCase();
    if (priority === "urgent" || priority === "high") return "high";
    if (priority === "non-urgent" || priority === "low") return "low";

    return undefined;
  }

  /**
   * Parse a single email address
   */
  private parseEmailAddress(addressStr: string): {
    name: string;
    email: string;
  } {
    const emailRegex = /(?:"?([^"]*)"?\s)?(?:<)?([^>]+@[^>]+)(?:>)?/;
    const match = addressStr.match(emailRegex);

    if (match) {
      return {
        name: (match[1] || "").trim(),
        email: match[2]?.trim() || "",
      };
    }

    return { name: "", email: addressStr.trim() };
  }

  /**
   * Parse multiple email addresses
   */
  private parseEmailAddresses(
    addressesStr: string,
  ): Array<{ name: string; email: string }> {
    if (!addressesStr) return [];

    return addressesStr
      .split(",")
      .map((addr) => this.parseEmailAddress(addr.trim()))
      .filter((addr) => addr.email.length > 0);
  }

  /**
   * Extract email body (text and HTML) from Gmail message payload
   */
  private extractEmailBody(payload?: gmail_v1.Schema$MessagePart): {
    text: string;
    html: string;
  } {
    if (!payload) {
      return { text: "", html: "" };
    }

    let text = "";
    let html = "";

    const decodeBase64URL = (data?: string | null): string => {
      if (!data) return "";
      try {
        const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
        const buffer = Buffer.from(padded, "base64");
        return buffer.toString("utf-8");
      } catch {
        return "";
      }
    };

    const extractBody = (part: gmail_v1.Schema$MessagePart): void => {
      const mimeType = part.mimeType?.toLowerCase() || "";

      if (part.body?.data) {
        const decoded = decodeBase64URL(part.body.data);
        if (mimeType === "text/plain") {
          text = decoded;
        } else if (mimeType === "text/html") {
          html = decoded;
        }
      }

      if (part.parts) {
        for (const subPart of part.parts) {
          if (!text || !html) {
            extractBody(subPart);
          }
        }
      }
    };

    extractBody(payload);

    return { text, html };
  }

  /**
   * Extract attachments from Gmail message payload
   */
  private extractAttachments(
    payload?: gmail_v1.Schema$MessagePart,
  ): RawAttachment[] {
    if (!payload) return [];

    const attachments: RawAttachment[] = [];

    const extractFromPart = (part: gmail_v1.Schema$MessagePart): void => {
      const mimeType = part.mimeType?.toLowerCase() || "";

      // Check if this part is an attachment
      if (
        part.body?.attachmentId &&
        part.filename &&
        mimeType !== "text/plain" &&
        mimeType !== "text/html"
      ) {
        const contentIdHeader = part.headers?.find(
          (h: any) => h.name?.toLowerCase() === "content-id",
        )?.value;
        attachments.push({
          filename: part.filename,
          size: part.body.size || 0,
          mimeType: mimeType,
          contentId: contentIdHeader ?? undefined,
          base64Data: undefined, // Will be fetched separately if needed
        });
      }

      // Recursively process child parts
      if (part.parts) {
        for (const subPart of part.parts) {
          extractFromPart(subPart);
        }
      }
    };

    extractFromPart(payload);
    return attachments;
  }

  /**
   * Ingest email attachments for a user
   */
  private async ingestEmailAttachments(
    email: FormattedGmailEmail,
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
        console.warn(
          `[gmail ${this.botId}] Attachment ${attachment.filename} has no data, skipping`,
        );
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(attachment.base64Data, "base64");
      } catch (error) {
        console.warn(
          `[gmail ${this.botId}] Failed to decode attachment ${attachment.filename}`,
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
        logContext: `[gmail ${this.botId}]`,
      });

      if (ingested) {
        collected.push(ingested);
      }
    }

    return collected;
  }

  /**
   * Get attachments from Gmail message by ID
   * TODO: Implement fetching attachment data from Gmail API
   * Currently attachments are extracted but data is not fetched
   */
  private async getAttachmentData(
    messageId: string,
    attachmentId: string,
  ): Promise<string> {
    return this.withGmail(async (gmail) => {
      const response = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });

      const data = response.data.data;
      if (!data) return "";

      try {
        const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
        return Buffer.from(padded, "base64").toString("base64");
      } catch {
        return "";
      }
    });
  }
}
