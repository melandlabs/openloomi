import "server-only";

import sgMail, { type MailDataRequired } from "@sendgrid/mail";
import {
  createTransport,
  type SentMessageInfo,
  type Transporter,
} from "nodemailer";
import { URL } from "node:url";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_ADDRESS =
  process.env.MARKETING_EMAIL_FROM ||
  process.env.EMAIL_FROM ||
  process.env.SMTP_FROM ||
  "";

const FALLBACK_FROM_ADDRESS =
  process.env.MARKETING_EMAIL_FROM ||
  process.env.EMAIL_FROM ||
  process.env.SMTP_FROM ||
  process.env.MAILPIT_EMAIL_FROM ||
  "marketing@openloomi.test";

let initialized = false;
let mailpitTransport: Transporter | null = null;

function getClient() {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_ADDRESS) {
    return null;
  }

  if (!initialized) {
    sgMail.setApiKey(SENDGRID_API_KEY);
    initialized = true;
  }

  return sgMail;
}

function getMailpitTransport() {
  const smtpUrl = process.env.MAILPIT_SMTP_URL;
  if (!smtpUrl) {
    return null;
  }

  if (!mailpitTransport) {
    const parsed = new URL(smtpUrl);
    const secure = parsed.protocol === "smtps:";
    const port = parsed.port ? Number(parsed.port) : secure ? 465 : 1025;
    const auth =
      parsed.username || parsed.password
        ? {
            user: decodeURIComponent(parsed.username),
            pass: decodeURIComponent(parsed.password),
          }
        : undefined;

    mailpitTransport = createTransport({
      host: parsed.hostname,
      port,
      secure,
      auth,
    });
  }

  return mailpitTransport;
}

export type SendGridSendOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  categories?: string[];
  customArgs?: Record<string, string>;
};

export async function sendViaSendGrid(
  options: SendGridSendOptions,
): Promise<{ delivered: boolean; responseId?: string; error?: string }> {
  const client = getClient();
  const fromAddress = FALLBACK_FROM_ADDRESS;

  if (!client) {
    const transport = getMailpitTransport();
    if (!transport) {
      console.warn(
        "[SendGrid] Missing SENDGRID_API_KEY or MARKETING_EMAIL_FROM. No local SMTP fallback configured, skipping email.",
      );
      return { delivered: false, error: "sendgrid_not_configured" };
    }

    try {
      const info = (await transport.sendMail({
        to: options.to,
        from: fromAddress,
        subject: options.subject,
        html: options.html,
        text: options.text,
      })) as SentMessageInfo;

      return {
        delivered: true,
        responseId:
          typeof info.messageId === "string" ? info.messageId : undefined,
      };
    } catch (error) {
      console.error("[SendGrid] Local SMTP fallback failed", error);
      return {
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const mail: MailDataRequired = {
    to: options.to,
    from: fromAddress,
    subject: options.subject,
    html: options.html,
    text: options.text,
    ...(options.categories ? { categories: options.categories } : {}),
    ...(options.customArgs ? { customArgs: options.customArgs } : {}),
  };

  try {
    const [response] = await client.send(mail);
    const responseId = response?.headers?.get("x-message-id") ?? undefined;
    return { delivered: true, responseId };
  } catch (error) {
    console.error("[SendGrid] Failed to send email", error);
    return {
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
