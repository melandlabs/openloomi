import type { Insight } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@openloomi/shared";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ContactMeta } from "@openloomi/integrations/contacts";

export type InsightReplyContext = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
};

export type InsightReplyWorkspaceProps = {
  insight: Insight;
  onExpandedChange?: (isExpanded: boolean) => void;
  initialExpanded?: boolean;
  initialRecipient?: string;
  initialAccountId?: string;
  onGenerateStateChange?: (state: {
    isLoading: boolean;
    hasOptions: boolean;
  }) => void;
  /**
   * Register callback for "prepend @name to reply input", for use by "Reply" button in source message bubbles
   */
  registerPrependToReplyInput?: (fn: (name: string) => void) => void;
};

export type UserContact = {
  id: string;
  userId: string;
  type: string | null;
  contactId: string;
  contactName: string;
  contactMeta?: ContactMeta | null;
};

export type DraftPayload = {
  draft: string;
  attachments: Attachment[];
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  platform: string | null;
};
