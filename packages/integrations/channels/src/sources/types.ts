import type { ExtractedMessageInfo } from "@openloomi/shared";
export {
  coerceDate,
  timeBeforeHours,
  timeBeforeHoursMs,
  timeBeforeMinutes,
  delay,
} from "@openloomi/shared";
export type { ExtractedMessageInfo };

export type DialogInfo = {
  id: string;
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
};

export type TgUserInfo = {
  firstName?: string;
  lastName?: string;
  userName?: string;
};

export type Platform =
  | "slack"
  | "telegram"
  | "gmail"
  | "whatsapp"
  | "discord"
  | "linkedin"
  | "instagram"
  | "twitter"
  | "google_calendar"
  | "outlook_calendar"
  | "teams"
  | "facebook_messenger"
  | "outlook"
  | "google_docs"
  | "hubspot"
  | "notion"
  | "rss"
  | "jira"
  | "linear"
  | "imessage"
  | "feishu"
  | "dingtalk"
  | "qqbot";

const isEmptyAttachments = (attachments?: unknown[] | null | undefined) =>
  !attachments?.length;
const isEmptyQuoted = (quoted: unknown | null | undefined) => quoted == null;

export function isEmptyMessage(msg: ExtractedMessageInfo | null): boolean {
  if (msg === null) return true;
  return (
    msg.text === "" &&
    isEmptyAttachments(msg.attachments) &&
    isEmptyQuoted(msg.quoted)
  );
}

export function getTgUserNameString(userInfo: TgUserInfo): string {
  if (userInfo.firstName || userInfo.lastName) {
    return `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim();
  }
  return userInfo.userName ?? "";
}
