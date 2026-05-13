import {
  getContact,
  getContactsByName,
  getContactsBySearchTerm,
  getContactByIMessageIdentifier,
  getBotWithAccountById,
  updateIntegrationAccount,
} from "../db/queries";
import type { UserContact } from "../db/schema";
import { AppError } from "@openloomi/shared/errors";
import type { Attachment } from "@openloomi/shared";
import type {
  File as FileMsg,
  Image,
  Messages,
  Voice,
} from "@openloomi/integrations/channels";
import { handleTelegramAuthFailure } from "@/lib/integrations/telegram/session";
import { isTelegramContactMeta } from "@openloomi/integrations/contacts";
import { getBotCredentials } from "./token";
import { fileIngester } from "../integrations/providers/file-ingester";
import { telegramClientRegistry } from "../integrations/telegram/client-registry";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Determine if it is a phone number format (starts with + or pure digits)
const PHONE_NUMBER_REGEX = /^(\+?[0-9]{10,15}|[0-9]{10,15})$/;

/**
 * Find contact by contactId or contactName
 * Prioritizes contactId exact match, falls back to contactName exact match if not found
 * For phone number format, also tries to find via iMessage chatId format
 * @param userId User ID
 * @param identifier contactId or contactName
 * @param botId Optional, used to filter contacts of a specific bot
 * @returns Contact object or null
 */
async function findContactByIdOrName(
  userId: string,
  identifier: string,
  botId?: string,
) {
  // Prefer to find by contactId first
  let contact = await getContact(userId, identifier);

  // If not found, try to find by contactName
  if (!contact) {
    const contacts = await getContactsByName(userId, identifier);
    // If botId is provided, prefer contacts that match botId
    if (botId) {
      contact = contacts.find((c) => c.botId === botId) ?? contacts[0] ?? null;
    } else {
      contact = contacts[0] ?? null;
    }
  }

  // If still not found and the identifier looks like a phone number or email,
  // try to find via iMessage format
  if (!contact && botId) {
    const normalizedId = identifier.replace(/\s+/g, "");
    const isPhoneNumber = PHONE_NUMBER_REGEX.test(normalizedId);
    const isEmail = EMAIL_REGEX.test(normalizedId);

    if (isPhoneNumber || isEmail) {
      contact = await getContactByIMessageIdentifier(
        userId,
        normalizedId,
        botId,
      );
    }
  }

  return contact;
}

/**
 * Search for similar contacts
 * Used when exact match is not found to search for similar contacts
 * @param userId User ID
 * @param searchTerm Search term
 * @param botId Optional, used to filter contacts of a specific bot
 * @returns List of similar contacts
 */
async function findSimilarContacts(
  userId: string,
  searchTerm: string,
  botId?: string,
): Promise<UserContact[]> {
  try {
    let contacts = await getContactsBySearchTerm(userId, searchTerm);

    // If botId is provided, filter contacts for that bot
    if (botId) {
      contacts = contacts.filter((c) => c.botId === botId);
    }

    // Limit return count to maximum 5
    return contacts.slice(0, 5);
  } catch (error) {
    console.error("[sendReply] Error searching similar contacts:", error);
    return [];
  }
}

export async function sendReplyByBotId({
  id,
  userId,
  recipients,
  cc,
  bcc,
  message,
  messageHtml,
  subject,
  attachments = [],
  withAppSuffix = true,
  /** WeChat iLink reply required, context_token from recipient's previous message */
  weixinContextToken,
}: {
  id: string;
  userId?: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  message: string;
  messageHtml?: string;
  subject?: string;
  attachments?: Attachment[];
  withAppSuffix: boolean;
  weixinContextToken?: string;
}) {
  try {
    const bot = await getBotWithAccountById({ id });
    if (!bot) {
      throw new AppError(
        "bad_request:bot",
        "No valid account provided for the reply",
      );
    }

    // Skip sending messages for manual bots
    if (bot.adapter === "manual") {
      console.log(`[Bot ${bot.id}] is a manual bot, skipping message sending`);
      return {
        skipped: true,
        message: "Manual bot does not support sending messages",
      };
    }

    const ownerId = userId ?? bot.userId;
    const suffix = withAppSuffix ? " (By openloomi AI)" : "";
    const sentMessage = (message ?? "").trim() + suffix;
    const normalizedHtml =
      typeof messageHtml === "string" ? messageHtml.trim() : "";
    const sentHtmlMessage = normalizedHtml
      ? normalizedHtml + suffix
      : undefined;
    const sanitizedAttachments = (attachments ?? []).filter(
      (item): item is Attachment => Boolean(item?.url),
    );
    const normalizeList = (input?: string[]) =>
      Array.from(
        new Set(
          (input ?? [])
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );

    const recipientsSet = normalizeList(recipients);
    const ccSet = normalizeList(cc);
    const bccSet = normalizeList(bcc);

    if (recipientsSet.length === 0) {
      throw new AppError(
        "bad_request:bot",
        "No valid recipients provided for the reply",
      );
    }

    if (bot.adapter === "slack") {
      console.log(`[Bot ${bot.id}] uses Slack platform manager to send reply`);
      const { SlackAdapter } = await import("../integrations/slack");
      const adapter = new SlackAdapter({
        botId: bot.id,
        token: await getBotCredentials("slack", bot),
      });

      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, id);
          if (!contact || contact.botId !== id) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Cannot find the contact ${r}`,
            );
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: undefined,
              contentType: item.contentType,
            }));
            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          await adapter.sendMessages("group", contact.contactId, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Slack adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "telegram") {
      console.log(
        `[Bot ${bot.id}] uses Telegram platform manager to send reply`,
      );
      const { TelegramAdapter } =
        await import("@openloomi/integrations/telegram/adapter");
      const credentials = await getBotCredentials("telegram", bot);
      const configuredSession = credentials;
      const configuredBotToken = "";
      const sessionKey =
        typeof configuredSession === "string" ? configuredSession : "";
      const botToken =
        typeof configuredBotToken === "string"
          ? (configuredBotToken as string)
          : undefined;

      const adapter = new TelegramAdapter({
        botId: bot.id,
        botToken,
        session: sessionKey,
        fileIngester,
        clientRegistry: telegramClientRegistry,
      });
      const previousSession = sessionKey;

      try {
        for (const r of recipientsSet) {
          // Special handling for "me" - send to user's own Telegram account (Saved Messages)
          if (r === "me") {
            if (!adapter.client.connected) {
              await adapter.client.connect();
            }
            const me = await adapter.client.getMe();
            const ownUserId = me.id.toString();

            const messagesChain: Messages = [];
            if (sentMessage.trim().length > 0) {
              messagesChain.push(sentMessage);
            }

            if (sanitizedAttachments.length > 0) {
              const imageMessages: Image[] = sanitizedAttachments.map(
                (item) => ({
                  url: item.url,
                  id: item.name,
                  size: item.sizeBytes,
                  contentType: item.contentType,
                  // Use blobPath for local files
                  path:
                    item.blobPath || item.source === "local"
                      ? item.url.replace("file://", "")
                      : undefined,
                }),
              );

              messagesChain.push(...imageMessages);
            }

            if (messagesChain.length === 0) {
              throw new AppError(
                "bad_request:bot",
                "Cannot send an empty message",
              );
            }

            await adapter.sendMessages("private", ownUserId, messagesChain);
            continue;
          }

          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, id);

          if (!contact) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );

            // Search for similar contacts
            const similarContacts = await findSimilarContacts(ownerId, r, id);

            // Create error with similar contacts info
            const error = new AppError(
              "bad_request:bot",
              `Cannot find the contact "${r}"`,
            ) as any;

            // Attach similar contacts info to error object
            if (similarContacts.length > 0) {
              error.similarContacts = similarContacts.map((c) => ({
                contactId: c.contactId,
                contactName: c.contactName,
                botId: c.botId,
              }));
              console.log(
                `[Bot ${bot.id}] Found ${similarContacts.length} similar contacts for "${r}"`,
              );
            }

            throw error;
          }

          // Verify contact belongs to current bot
          if (contact.botId !== id) {
            console.warn(
              `[Bot ${bot.id}] contact ${r} belongs to a different bot ${contact.botId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Contact belongs to a different Telegram account. Please switch to the matching account and try again.`,
            );
          }

          // Verify if it's a Telegram contact
          if (!isTelegramContactMeta(contact.contactMeta)) {
            console.warn(
              `[Bot ${bot.id}] contact ${r} is not a Telegram contact`,
            );
            throw new AppError(
              "bad_request:bot",
              `Contact is not a valid Telegram contact`,
            );
          }

          adapter.primeContactMetadata(contact.contactId, contact.contactMeta);
          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              // Use blobPath for local files
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));

            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          await adapter.sendMessages("group", contact.contactId, messagesChain);
        }
      } catch (error) {
        await handleTelegramAuthFailure({
          bot,
          userId: ownerId,
          sessionKey,
          error,
        });
        console.error(error);
        throw error;
      } finally {
        if (adapter.client.connected) {
          await adapter.client.disconnect();
        }
      }
    } else if (bot.adapter === "whatsapp") {
      console.log(
        `[Bot ${bot.id}] uses WhatsApp platform manager to send reply`,
      );
      const { WhatsAppAdapter } = await import("../integrations/whatsapp");
      // credentials validated by getBotCredentials
      await getBotCredentials("whatsapp", bot);
      const adapter = new WhatsAppAdapter({
        botId: bot.id,
      });
      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          if (!contact || contact.botId !== bot.id) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Cannot find the contact ${r}`,
            );
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: undefined,
              contentType: item.contentType,
            }));
            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          const contactType = (contact.type ?? "").toLowerCase();
          const targetType =
            contactType === "group" || contactType === "supergroup"
              ? "group"
              : "private";
          const contactId = String(contact.contactId);

          await adapter.sendMessages(targetType, contactId, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill();
      }
    } else if (bot.adapter === "facebook_messenger") {
      console.log(
        `[Bot ${bot.id}] uses Facebook Messenger platform manager to send reply`,
      );
      const { FacebookMessengerAdapter } =
        await import("@openloomi/integrations/facebook-messenger");
      const credentials = await getBotCredentials("facebook_messenger", bot);
      if (!credentials?.pageAccessToken || !credentials.pageId) {
        throw new AppError(
          "bad_request:bot",
          "Facebook Messenger credentials are missing",
        );
      }
      const adapter = new FacebookMessengerAdapter({
        botId: bot.id,
        pageAccessToken: credentials.pageAccessToken,
        pageId: credentials.pageId,
        pageName:
          credentials.pageName ??
          bot.platformAccount?.displayName ??
          bot.platformAccount?.externalId,
      });
      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          if (!contact || contact.botId !== bot.id) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Cannot find the contact ${r}`,
            );
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: undefined,
              contentType: item.contentType,
            }));
            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          const contactType = (contact.type ?? "").toLowerCase();
          const targetType =
            contactType === "group" || contactType === "supergroup"
              ? "group"
              : "private";

          await adapter.sendMessages(
            targetType,
            String(contact.contactId),
            messagesChain,
          );
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Facebook Messenger adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "discord") {
      console.log(
        `[Bot ${bot.id}] uses Discord platform manager to send reply`,
      );
      const { DiscordAdapter } = await import("../integrations/discord");
      const credentials = await getBotCredentials("discord", bot);
      const adapter = new DiscordAdapter({
        botId: bot.id,
        token: credentials.accessToken,
        guildId: credentials.guildId,
      });
      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          if (!contact || contact.botId !== bot.id) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Cannot find the contact ${r}`,
            );
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: undefined,
              contentType: item.contentType,
            }));
            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          const contactType = (contact.type ?? "").toLowerCase();
          const targetType =
            contactType === "private" || contactType === "dm"
              ? "private"
              : "group";

          await adapter.sendMessages(
            targetType,
            contact.contactId,
            messagesChain,
          );
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Discord adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "teams") {
      console.log(`[Bot ${bot.id}] uses Teams platform manager to send reply`);
      const { TeamsAdapter } = await import("../integrations/teams");
      const credentials = await getBotCredentials("teams", bot);
      const adapter = new TeamsAdapter({
        botId: bot.id,
        credentials: credentials ?? { accessToken: "" },
        platformAccountId: bot.platformAccountId ?? undefined,
        accountUserId: bot.userId,
      });
      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          if (!contact || contact.botId !== bot.id || !contact.contactId) {
            console.warn(
              `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              `Cannot find the contact ${r}`,
            );
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: undefined,
              contentType: item.contentType,
            }));
            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          const contactType = (contact.type ?? "").toLowerCase();
          const targetType =
            contactType === "private" || contactType === "oneonone"
              ? "private"
              : "group";
          await adapter.sendMessages(
            targetType,
            contact.contactId,
            messagesChain,
          );
        }
      } catch (error) {
        console.error(error);
        throw error;
      }
    } else if (bot.adapter === "gmail") {
      console.log(`[Bot ${bot.id}] uses Gmail platform manager to send reply`);
      const credentials = await getBotCredentials("gmail", bot);

      // Check if using OAuth or App Password
      const isOAuthCredentials =
        credentials &&
        "refreshToken" in credentials &&
        credentials.refreshToken;

      if (isOAuthCredentials) {
        // Use Gmail OAuth Adapter
        console.log(`[Bot ${bot.id}] using Gmail OAuth adapter`);

        const { GmailOAuthAdapter } = await import("../integrations/gmail");
        const gmailAdapter = new GmailOAuthAdapter({
          bot,
          credentials:
            credentials as import("../integrations/gmail").GmailStoredCredentials,
        });

        try {
          const resolveEmail = async (
            label: string,
            audience: "to" | "cc" | "bcc",
          ) => {
            let contacts = await getContactsByName(ownerId, label);
            if (contacts.length === 0) {
              contacts = await getContactsBySearchTerm(ownerId, label);
            }
            const candidateEmails = contacts
              .map((contact) => contact.contactId?.trim())
              .filter((id): id is string =>
                Boolean(id && EMAIL_REGEX.test(id)),
              );

            const resolvedEmail =
              candidateEmails[0] ??
              (EMAIL_REGEX.test(label) ? label : undefined);

            if (!resolvedEmail) {
              console.warn(
                `[Bot ${bot.id}] cannot resolve gmail ${audience} recipient ${label} for user ${ownerId}`,
              );
              throw new AppError(
                "bad_request:bot",
                audience === "to"
                  ? `Cannot find a valid email for ${label}. Please enter the full address manually.`
                  : `Cannot find a valid email for ${audience.toUpperCase()} recipient ${label}. Please enter the full address manually.`,
              );
            }

            return resolvedEmail;
          };

          const resolveEmails = async (
            labels: string[],
            audience: "to" | "cc" | "bcc",
          ) =>
            Promise.all(labels.map((label) => resolveEmail(label, audience)));

          const dedupeEmails = (emails: string[], seen: Set<string>) => {
            const unique: string[] = [];
            for (const email of emails) {
              const lower = email.toLowerCase();
              if (seen.has(lower)) continue;
              seen.add(lower);
              unique.push(email);
            }
            return unique;
          };

          const resolvedTo = await resolveEmails(recipientsSet, "to");
          const resolvedCc = await resolveEmails(ccSet, "cc");
          const resolvedBcc = await resolveEmails(bccSet, "bcc");

          const seenEmails = new Set<string>();
          const toList = dedupeEmails(resolvedTo, seenEmails);
          const ccList = dedupeEmails(resolvedCc, seenEmails);
          const bccList = dedupeEmails(resolvedBcc, seenEmails);

          // Prepare email content
          const emailBody = sentMessage.trim();
          const emailHtml = sentHtmlMessage ?? undefined;

          // Build subject from parameter or first line of message
          const emailSubject =
            subject?.trim() ||
            (() => {
              const firstLine = emailBody.split("\n")[0];
              return firstLine.length < 100
                ? firstLine
                : `${emailBody.substring(0, 100)}...`;
            })();

          // Send to each recipient (Gmail API handles one recipient at a time for To)
          for (const to of toList) {
            const allRecipients = [...toList];
            if (ccList.length > 0) allRecipients.push(...ccList);
            if (bccList.length > 0) allRecipients.push(...bccList);

            await gmailAdapter.sendEmail({
              to,
              subject: emailSubject,
              body: emailBody,
              html: emailHtml,
            });
          }
        } catch (error) {
          console.error(error);
          throw error;
        }
      } else {
        // Use App Password Adapter (EmailAdapter with IMAP/SMTP)
        const { EmailAdapter } = await import("../integrations/email");
        const gmailAddress = credentials.email;
        const gmailAppPassword = credentials.appPassword;

        if (!gmailAddress || !gmailAppPassword) {
          throw new AppError(
            "bad_request:bot",
            `Failed to send Gmail message, bot ${bot.id} is missing required credentials`,
          );
        }

        const adapter = new EmailAdapter({
          botId: bot.id,
          emailAddress: gmailAddress,
          appPassword: gmailAppPassword,
        });

        const resolveEmail = async (
          label: string,
          audience: "to" | "cc" | "bcc",
        ) => {
          let contacts = await getContactsByName(ownerId, label);
          if (contacts.length === 0) {
            contacts = await getContactsBySearchTerm(ownerId, label);
          }
          const candidateEmails = contacts
            .map((contact) => contact.contactId?.trim())
            .filter((id): id is string => Boolean(id && EMAIL_REGEX.test(id)));

          const resolvedEmail =
            candidateEmails[0] ?? (EMAIL_REGEX.test(label) ? label : undefined);

          if (!resolvedEmail) {
            console.warn(
              `[Bot ${bot.id}] cannot resolve gmail ${audience} recipient ${label} for user ${ownerId}`,
            );
            throw new AppError(
              "bad_request:bot",
              audience === "to"
                ? `Cannot find a valid email for ${label}. Please enter the full address manually.`
                : `Cannot find a valid email for ${audience.toUpperCase()} recipient ${label}. Please enter the full address manually.`,
            );
          }

          return resolvedEmail;
        };

        const resolveEmails = async (
          labels: string[],
          audience: "to" | "cc" | "bcc",
        ) => Promise.all(labels.map((label) => resolveEmail(label, audience)));

        const dedupeEmails = (emails: string[], seen: Set<string>) => {
          const unique: string[] = [];
          for (const email of emails) {
            const lower = email.toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);
            unique.push(email);
          }
          return unique;
        };

        try {
          const resolvedTo = await resolveEmails(recipientsSet, "to");
          const resolvedCc = await resolveEmails(ccSet, "cc");
          const resolvedBcc = await resolveEmails(bccSet, "bcc");

          const seenEmails = new Set<string>();
          const toList = dedupeEmails(resolvedTo, seenEmails);
          const ccList = dedupeEmails(resolvedCc, seenEmails);
          const bccList = dedupeEmails(resolvedBcc, seenEmails);

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              // Use blobPath for local files
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));

            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          await adapter.sendMessages("private", toList, messagesChain, {
            subject,
            cc: ccList,
            bcc: bccList,
            html: sentHtmlMessage,
          });
        } catch (error) {
          console.error(error);
          throw error;
        } finally {
          await adapter.kill().catch((killError: unknown) => {
            console.error(
              `[Bot ${bot.id}] failed to shutdown Gmail adapter cleanly`,
              killError,
            );
          });
        }
      }
    } else if (bot.adapter === "outlook") {
      console.log(
        `[Bot ${bot.id}] uses Outlook platform manager to send reply`,
      );
      const { EmailAdapter } = await import("../integrations/email");
      const credentials = (await getBotCredentials("outlook", bot)) as {
        email?: string;
        appPassword?: string;
        imapHost?: string;
        imapPort?: number;
        smtpHost?: string;
        smtpPort?: number;
      };
      const outlookAddress = credentials.email;
      const outlookAppPassword = credentials.appPassword;

      if (!outlookAddress || !outlookAppPassword) {
        throw new AppError(
          "bad_request:bot",
          `Failed to send Outlook message, bot ${bot.id} is missing required credentials`,
        );
      }

      const adapter = new EmailAdapter({
        botId: bot.id,
        emailAddress: outlookAddress,
        appPassword: outlookAppPassword,
        imap: {
          host: credentials.imapHost ?? "outlook.office365.com",
          port: credentials.imapPort ?? 993,
          secure: true,
        },
        smtp: {
          host: credentials.smtpHost ?? "smtp.office365.com",
          port: credentials.smtpPort ?? 587,
          secure: false,
        },
      });

      const resolveEmail = async (
        label: string,
        audience: "to" | "cc" | "bcc",
      ) => {
        let contacts = await getContactsByName(ownerId, label);
        if (contacts.length === 0) {
          contacts = await getContactsBySearchTerm(ownerId, label);
        }
        const candidateEmails = contacts
          .map((contact) => contact.contactId?.trim())
          .filter((id): id is string => Boolean(id && EMAIL_REGEX.test(id)));

        const resolvedEmail =
          candidateEmails[0] ?? (EMAIL_REGEX.test(label) ? label : undefined);

        if (!resolvedEmail) {
          console.warn(
            `[Bot ${bot.id}] cannot resolve outlook ${audience} recipient ${label} for user ${ownerId}`,
          );
          throw new AppError(
            "bad_request:bot",
            audience === "to"
              ? `Cannot find a valid email for ${label}. Please enter the full address manually.`
              : `Cannot find a valid email for ${audience.toUpperCase()} recipient ${label}. Please enter the full address manually.`,
          );
        }

        return resolvedEmail;
      };

      const resolveEmails = async (
        labels: string[],
        audience: "to" | "cc" | "bcc",
      ) => Promise.all(labels.map((label) => resolveEmail(label, audience)));

      const dedupeEmails = (emails: string[], seen: Set<string>) => {
        const unique: string[] = [];
        for (const email of emails) {
          const lower = email.toLowerCase();
          if (seen.has(lower)) continue;
          seen.add(lower);
          unique.push(email);
        }
        return unique;
      };

      try {
        const resolvedTo = await resolveEmails(recipientsSet, "to");
        const resolvedCc = await resolveEmails(ccSet, "cc");
        const resolvedBcc = await resolveEmails(bccSet, "bcc");

        const seenEmails = new Set<string>();
        const toList = dedupeEmails(resolvedTo, seenEmails);
        const ccList = dedupeEmails(resolvedCc, seenEmails);
        const bccList = dedupeEmails(resolvedBcc, seenEmails);

        const messagesChain: Messages = [];
        if (sentMessage.trim().length > 0) {
          messagesChain.push(sentMessage);
        }

        if (sanitizedAttachments.length > 0) {
          const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
            url: item.url,
            id: item.name,
            size: undefined,
            contentType: item.contentType,
          }));

          messagesChain.push(...imageMessages);
        }

        if (messagesChain.length === 0) {
          throw new AppError("bad_request:bot", "Cannot send an empty message");
        }

        await adapter.sendMessages("private", toList, messagesChain, {
          subject,
          cc: ccList,
          bcc: bccList,
          html: sentHtmlMessage,
        });
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Outlook adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "instagram") {
      console.log(
        `[Bot ${bot.id}] uses Instagram platform manager to send reply`,
      );
      const { InstagramAdapter } =
        await import("@openloomi/integrations/instagram");
      const credentials = (await getBotCredentials("instagram", bot)) as {
        accessToken: string;
        pageId: string;
        igBusinessId: string;
        username?: string | null;
      };

      if (!credentials.accessToken || !credentials.igBusinessId) {
        throw new AppError(
          "bad_request:bot",
          `Failed to send Instagram message, bot ${bot.id} is missing required credentials`,
        );
      }

      const adapter = new InstagramAdapter({
        botId: bot.id,
        accessToken: credentials.accessToken,
        igBusinessId: credentials.igBusinessId,
        pageId: credentials.pageId,
        username: credentials.username,
      });

      const resolveRecipient = async (label: string) => {
        if (!label) {
          throw new AppError(
            "bad_request:bot",
            "Instagram recipient is required",
          );
        }
        return label;
      };

      try {
        const resolvedRecipients = await Promise.all(
          recipientsSet.map((r) => resolveRecipient(r)),
        );
        const messagesChain: Messages = [];
        if (sentMessage.trim().length > 0) {
          messagesChain.push(sentMessage);
        }

        if (messagesChain.length === 0) {
          throw new AppError("bad_request:bot", "Cannot send an empty message");
        }

        await adapter.sendMessages(
          "private",
          resolvedRecipients,
          messagesChain,
        );
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Instagram adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "twitter") {
      console.log(`[Bot ${bot.id}] uses X manager to send reply`);
      const { XAdapter } = await import("@openloomi/integrations/x");
      const credentials = (await getBotCredentials("twitter", bot)) as {
        accessToken?: string | null;
        refreshToken?: string | null;
        expiresAt?: number | null;
        userId?: string | null;
        username?: string | null;
      };

      if (!credentials.accessToken || !credentials.userId) {
        throw new AppError(
          "bad_request:bot",
          `Failed to send X DM, bot ${bot.id} is missing required credentials`,
        );
      }

      const adapter = new XAdapter({
        botId: bot.id,
        accessToken: credentials.accessToken,
        userId: credentials.userId,
        username: credentials.username,
        refreshToken: credentials.refreshToken ?? undefined,
        expiresAt: credentials.expiresAt ?? undefined,
        clientId: process.env.TWITTER_CLIENT_ID,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
        onCredentialsUpdated: async (updated) => {
          if (bot.platformAccountId) {
            await updateIntegrationAccount({
              userId: bot.userId,
              platformAccountId: bot.platformAccountId,
              credentials: {
                accessToken: updated.accessToken,
                refreshToken: updated.refreshToken ?? null,
                expiresAt: updated.expiresAt ?? null,
                userId: credentials.userId ?? null,
                username: credentials.username ?? null,
              },
            });
          }
        },
      });

      const resolveRecipient = async (label: string) => {
        if (!label) {
          throw new AppError("bad_request:bot", "X DM recipient is required");
        }
        return label;
      };

      try {
        const resolvedRecipients = await Promise.all(
          recipientsSet.map((r) => resolveRecipient(r)),
        );
        const messagesChain: Messages = [];
        if (sentMessage.trim().length > 0) {
          messagesChain.push(sentMessage);
        }

        if (messagesChain.length === 0) {
          throw new AppError("bad_request:bot", "Cannot send an empty message");
        }

        await adapter.sendMessages(
          "private",
          resolvedRecipients,
          messagesChain,
        );
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown X adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "imessage") {
      console.log(
        `[Bot ${bot.id}] uses iMessage platform manager to send reply`,
      );
      const { IMessageAdapter, isIMessageContactMeta, formatIMessageChatId } =
        await import("../integrations/imessage");

      const adapter = new IMessageAdapter({
        botId: bot.id,
      });

      try {
        for (const r of recipientsSet) {
          // Find contact by contactId or contactName
          const contact = await findContactByIdOrName(ownerId, r, bot.id);

          // Determine send target ID and type
          let targetId: string;
          let targetType: "private" | "group" = "private";

          if (contact && contact.botId === bot.id) {
            // Found contact, use contact's contactId
            // Ensure iMessage format is used, avoid sending SMS
            targetId = formatIMessageChatId(contact.contactId);
            targetType =
              (contact.type ?? "").toLowerCase() === "group"
                ? "group"
                : "private";

            // If valid contactMeta exists, set metadata cache
            if (isIMessageContactMeta(contact.contactMeta)) {
              adapter.primeContactMetadata(targetId, contact.contactMeta);
            }

            console.log(
              `[Bot ${bot.id}] found iMessage contact: ${contact.contactName} (${targetId})`,
            );
          } else {
            // Contact not found, check if valid phone number or email format
            const normalizedId = r.replace(/\s+/g, "");
            const isPhoneNumber = PHONE_NUMBER_REGEX.test(normalizedId);
            const isEmail = EMAIL_REGEX.test(normalizedId);

            if (isPhoneNumber || isEmail) {
              // Format phone number or email as iMessage chatId format
              // Ensure message is sent via iMessage network, not SMS
              targetId = formatIMessageChatId(normalizedId);
              console.log(
                `[Bot ${bot.id}] sending iMessage directly to: ${targetId}`,
              );
            } else {
              // Unrecognized format, throw error
              console.warn(
                `[Bot ${bot.id}] cannot find the contact ${r} for user ${ownerId}`,
              );

              // Search for similar contacts
              const similarContacts = await findSimilarContacts(
                ownerId,
                r,
                bot.id,
              );

              // Create error with similar contacts info
              const error = new AppError(
                "bad_request:bot",
                `Cannot find the contact "${r}"`,
              ) as any;

              // Attach similar contacts info to error object
              if (similarContacts.length > 0) {
                error.similarContacts = similarContacts.map((c) => ({
                  contactId: c.contactId,
                  contactName: c.contactName,
                  botId: c.botId,
                }));
              }

              throw error;
            }
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }

          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              // Use blobPath for local files
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));

            messagesChain.push(...imageMessages);
          }

          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }

          await adapter.sendMessages(targetType, targetId, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown iMessage adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "feishu") {
      console.log(`[Bot ${bot.id}] uses Feishu platform to send reply`);
      const { FeishuAdapter } = await import("@openloomi/integrations/feishu");
      const credentials = await getBotCredentials("feishu", bot);
      const adapter = new FeishuAdapter({
        botId: bot.id,
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        domain: credentials.domain,
      });
      try {
        for (const r of recipientsSet) {
          // Feishu side: recipient is chat_id (used for both p2p and group chats)
          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }
          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));
            messagesChain.push(...imageMessages);
          }
          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }
          await adapter.sendMessages("private", r, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Feishu adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "dingtalk") {
      console.log(`[Bot ${bot.id}] uses DingTalk platform to send reply`);
      const { DingTalkAdapter } =
        await import("@openloomi/integrations/dingtalk");
      const credentials = await getBotCredentials("dingtalk", bot);
      const adapter = new DingTalkAdapter({
        botId: bot.id,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      });
      try {
        // Fallback: if upstream doesn't explicitly pass attachments, try to identify sendable file paths/links from text
        const dingtalkAttachments: Attachment[] = [...sanitizedAttachments];
        if (dingtalkAttachments.length === 0 && sentMessage.trim().length > 0) {
          const { stat } = await import("node:fs/promises");
          const guessContentTypeByName = (name: string): string => {
            const lower = name.toLowerCase();
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
              return "image/jpeg";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".webp")) return "image/webp";
            if (lower.endsWith(".bmp")) return "image/bmp";
            if (lower.endsWith(".pdf")) return "application/pdf";
            if (lower.endsWith(".mp3")) return "audio/mpeg";
            if (lower.endsWith(".wav")) return "audio/wav";
            if (lower.endsWith(".amr")) return "audio/amr";
            if (lower.endsWith(".ogg")) return "audio/ogg";
            if (lower.endsWith(".m4a")) return "audio/mp4";
            if (lower.endsWith(".txt")) return "text/plain";
            if (lower.endsWith(".md")) return "text/markdown";
            if (lower.endsWith(".json")) return "application/json";
            return "application/octet-stream";
          };
          const fileCandidates = new Set<string>();
          const localPathRegex = /\/Users\/[^\s，。,；;）)]+/g;
          for (const m of sentMessage.matchAll(localPathRegex)) {
            if (m[0]) fileCandidates.add(m[0]);
          }
          const fileUrlRegex = /file:\/\/[^\s，。,；;）)]+/g;
          for (const m of sentMessage.matchAll(fileUrlRegex)) {
            if (m[0]) fileCandidates.add(m[0]);
          }
          for (const candidate of fileCandidates) {
            const localPath = candidate.startsWith("file://")
              ? candidate.replace("file://", "")
              : candidate;
            try {
              const st = await stat(localPath);
              if (!st.isFile()) continue;
              const name = localPath.split("/").pop() || "attachment.bin";
              dingtalkAttachments.push({
                name,
                url: `file://${localPath}`,
                contentType: guessContentTypeByName(name),
                sizeBytes: st.size,
                blobPath: localPath,
                source: "local",
              });
            } catch {
              // ignore invalid path candidate
            }
          }
          if (dingtalkAttachments.length > 0) {
            console.log(
              `[Bot ${bot.id}] inferred ${dingtalkAttachments.length} attachment(s) from message text for DingTalk`,
            );
          }
        }
        for (const r of recipientsSet) {
          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }
          if (dingtalkAttachments.length > 0) {
            const mediaMessages = dingtalkAttachments.map((item) => {
              const normalizedType = (item.contentType || "").toLowerCase();
              const localPath =
                item.blobPath ||
                (item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined);
              const localFileUrl = localPath ? `file://${localPath}` : item.url;
              if (normalizedType.startsWith("image/")) {
                const image: Image = {
                  url: item.url,
                  id: item.name,
                  size: item.sizeBytes,
                  contentType: item.contentType,
                  path: localPath,
                };
                return image;
              }
              if (normalizedType.startsWith("audio/")) {
                const voice: Voice = {
                  id: item.name,
                  url: item.url,
                  path: localPath,
                };
                return voice;
              }
              const file: FileMsg = {
                id: item.name,
                name: item.name,
                size: item.sizeBytes ?? 0,
                url: localFileUrl,
              };
              return file;
            });
            messagesChain.push(...mediaMessages);
          }
          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }
          await adapter.sendMessages("private", r, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown DingTalk adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "qqbot") {
      console.log(`[Bot ${bot.id}] uses QQ Bot platform to send reply`);
      const { QQBotAdapter } = await import("@openloomi/integrations/qqbot");
      if (typeof ownerId !== "string" || !ownerId) {
        throw new AppError(
          "bad_request:bot",
          "QQ Bot reply requires a valid userId (owner)",
        );
      }
      const credentials = await getBotCredentials("qqbot", bot);
      const adapter = new QQBotAdapter({
        botId: bot.id,
        appId: credentials.appId,
        appSecret: credentials.appSecret,
      });
      try {
        for (const r of recipientsSet) {
          // QQ: recipient is openid (private) or group_openid (group), distinguished via contact meta
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          const meta = contact?.contactMeta as
            | { platform?: string; chatType?: string }
            | null
            | undefined;
          const targetType: "private" | "group" =
            meta?.platform === "qqbot" && meta?.chatType === "group"
              ? "group"
              : "private";
          const targetId = r;

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }
          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));
            messagesChain.push(...imageMessages);
          }
          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }
          await adapter.sendMessages(targetType, targetId, messagesChain);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown QQBot adapter cleanly`,
            killError,
          );
        });
      }
    } else if (bot.adapter === "weixin") {
      console.log(`[Bot ${bot.id}] uses Weixin (iLink) platform to send reply`);
      const { WeixinAdapter } = await import("@openloomi/integrations/weixin");
      if (typeof ownerId !== "string" || !ownerId) {
        throw new AppError(
          "bad_request:bot",
          "Weixin reply requires a valid userId (owner)",
        );
      }
      const credentials = await getBotCredentials("weixin", bot);
      const adapter = new WeixinAdapter({
        botId: bot.id,
        credentials,
      });
      try {
        for (const r of recipientsSet) {
          const contact = await findContactByIdOrName(ownerId, r, bot.id);
          const meta = contact?.contactMeta as
            | { lastContextToken?: string; lastContextTokenAt?: number }
            | null
            | undefined;
          const contextToken =
            recipientsSet.length === 1 && weixinContextToken?.trim()
              ? weixinContextToken.trim()
              : meta?.lastContextToken?.trim() || "";

          // Validate contextToken: must exist and not be expired (23h window)
          const WEIXIN_TOKEN_MAX_AGE_MS = 23 * 60 * 60 * 1000;
          const tokenAge = meta?.lastContextTokenAt
            ? Date.now() - meta.lastContextTokenAt
            : Number.POSITIVE_INFINITY;

          if (
            !contextToken ||
            (!weixinContextToken?.trim() && tokenAge > WEIXIN_TOKEN_MAX_AGE_MS)
          ) {
            const reason = !contextToken
              ? "never chatted with the Bot"
              : `over ${Math.round(tokenAge / 3600000)} hours since last chat with Bot`;
            console.warn(
              `[Bot ${bot.id}] WeChat contextToken for ${r} invalid or expired: ${reason}`,
            );
            return {
              skipped: true,
              message: `WeChat notification failed: contact ${reason}, context_token invalid or expired. WeChat Bot cannot initiate conversations proactively; the contact must first send a message to the Bot before notifications can be sent.`,
            };
          }

          const messagesChain: Messages = [];
          if (sentMessage.trim().length > 0) {
            messagesChain.push(sentMessage);
          }
          if (sanitizedAttachments.length > 0) {
            const imageMessages: Image[] = sanitizedAttachments.map((item) => ({
              url: item.url,
              id: item.name,
              size: item.sizeBytes,
              contentType: item.contentType,
              path:
                item.blobPath || item.source === "local"
                  ? item.url.replace("file://", "")
                  : undefined,
            }));
            messagesChain.push(...imageMessages);
          }
          if (messagesChain.length === 0) {
            throw new AppError(
              "bad_request:bot",
              "Cannot send an empty message",
            );
          }
          await adapter.sendMessagesWithContext(r, messagesChain, contextToken);
        }
      } catch (error) {
        console.error(error);
        throw error;
      } finally {
        await adapter.kill().catch((killError: unknown) => {
          console.error(
            `[Bot ${bot.id}] failed to shutdown Weixin adapter cleanly`,
            killError,
          );
        });
      }
    } else {
      throw new AppError(
        "bad_request:bot",
        `Failed to send reply by the bot id with the unknown adapter ${bot.adapter}`,
      );
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}
