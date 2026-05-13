import type { Attachment } from "@openloomi/shared";

export interface SendReplyInput {
  botId: string;
  draft: string;
  platform?: string;
  recipients: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Attachment[];
}

export type ToolSendReplyPart = {
  type: "tool-sendReply";
  state?: string;
};

export function isToolSendReplyPart(part: unknown): part is ToolSendReplyPart {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const record = part as { type?: unknown };
  return record.type === "tool-sendReply";
}
