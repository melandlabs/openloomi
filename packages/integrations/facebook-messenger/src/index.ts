import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  Message,
  At,
  Image,
} from "@openloomi/integrations/channels";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";
import type {
  DialogInfo,
  ExtractedMessageInfo,
} from "@openloomi/integrations/channels/sources/types";

type MessengerParticipant = { id: string; name?: string };

type MessengerConversation = {
  id: string;
  updated_time?: string;
  message_count?: number;
  snippet?: string;
  participants?: { data?: MessengerParticipant[] };
};

type MessengerMessage = {
  id: string;
  message?: string;
  created_time?: string;
  from?: MessengerParticipant;
};

type ConversationListResponse = {
  data?: MessengerConversation[];
  paging?: { next?: string };
};

type MessagesResponse = {
  data?: MessengerMessage[];
  paging?: { next?: string };
};

const GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v19.0";
const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;
const FIRST_LANDING_MESSAGE_CHUNK_COUNT = 10;

export class FacebookMessengerAdapter extends MessagePlatformAdapter {
  private pageAccessToken: string;
  private pageId: string;
  private pageName?: string;
  private graphVersion: string;
  private participantCache = new Map<string, MessengerParticipant | null>();
  private asyncIteratorState = {
    conversations: [] as MessengerConversation[],
    currentConversationIndex: 0,
    currentMessageIndex: 0,
    offsetDate: 0,
    isInitialized: false,
  };

  constructor(opts?: {
    pageAccessToken?: string;
    pageId?: string;
    pageName?: string;
    graphVersion?: string;
    botId?: string;
  }) {
    super();
    this.pageAccessToken =
      opts?.pageAccessToken ?? process.env.FB_PAGE_ACCESS_TOKEN ?? "";
    this.pageId = opts?.pageId ?? process.env.FB_PAGE_ID ?? "";
    this.pageName = opts?.pageName ?? process.env.FB_PAGE_NAME;
    this.graphVersion =
      opts?.graphVersion ??
      process.env.FB_GRAPH_VERSION ??
      DEFAULT_GRAPH_VERSION;

    if (!this.pageAccessToken) {
      throw new Error(
        "[facebook_messenger] Missing page access token for adapter initialization",
      );
    }
    if (!this.pageId) {
      throw new Error(
        "[facebook_messenger] Missing page ID for adapter initialization",
      );
    }
  }

  private async graphGet<T>(path: string, query?: Record<string, string>) {
    const url = new URL(
      `${GRAPH_BASE}/${this.graphVersion}/${path.replace(/^\//, "")}`,
    );
    url.searchParams.set("access_token", this.pageAccessToken);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    const response = await fetch(url.toString());
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[facebook_messenger] Graph request failed ${response.status}: ${body}`,
      );
    }
    return (await response.json()) as T;
  }

  private async graphPost<T>(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const url = `${GRAPH_BASE}/${this.graphVersion}/${path.replace(/^\//, "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        ...body,
        access_token: this.pageAccessToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[facebook_messenger] Graph POST failed ${response.status}: ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  private messagesToText(messages: Messages): string {
    const parts: string[] = [];
    for (const item of messages) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (this.isPlainText(item)) {
        parts.push(item.text ?? "");
      } else if (this.isAt(item)) {
        parts.push(`@${item.display ?? item.target}`);
      } else if (this.isImage(item)) {
        parts.push(item.url ?? item.path ?? "");
      } else if (item && typeof item === "object") {
        parts.push(
          (item as { text?: string }).text ??
            (item as { message?: string }).message ??
            "",
        );
      }
    }
    return parts
      .map((part) => (part ?? "").toString().trim())
      .filter((part) => part.length > 0)
      .join("\n");
  }

  private isPlainText(item: Message): item is { text?: string } {
    return typeof item === "object" && item !== null && "text" in item;
  }

  private isAt(item: Message): item is At {
    return typeof item === "object" && item !== null && "target" in item;
  }

  private isImage(item: Message): item is Image {
    return typeof item === "object" && item !== null && "url" in item;
  }

  private async resolveRecipient(
    conversationId: string,
  ): Promise<MessengerParticipant | null> {
    if (this.participantCache.has(conversationId)) {
      return this.participantCache.get(conversationId) ?? null;
    }
    try {
      const detail = await this.graphGet<MessengerConversation>(
        `${conversationId}`,
        { fields: "participants" },
      );
      const participant =
        detail.participants?.data?.find(
          (p) => p.id && p.id !== this.pageId && !p.id.startsWith(this.pageId),
        ) ?? null;
      this.participantCache.set(conversationId, participant ?? null);
      return participant ?? null;
    } catch (error) {
      console.error(
        `[facebook_messenger] Failed to resolve participant for conversation ${conversationId}`,
        error,
      );
      this.participantCache.set(conversationId, null);
      return null;
    }
  }

  async sendMessages(
    _target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    const recipient = await this.resolveRecipient(id);
    if (!recipient?.id) {
      throw new Error(
        `[facebook_messenger] Cannot resolve recipient for conversation ${id}`,
      );
    }

    const text = this.messagesToText(messages);
    if (!text) {
      throw new Error("[facebook_messenger] Message content cannot be empty");
    }

    await this.graphPost(`${this.pageId}/messages`, {
      messaging_type: "RESPONSE",
      recipient: { id: recipient.id },
      message: { text },
    });
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    _quoteOrigin = false,
  ): Promise<void> {
    const targetId = (event as any)?.target?.id ?? undefined;
    const conversationId =
      typeof targetId === "string" && targetId.length > 0
        ? targetId
        : event?.sourcePlatformObject?.conversation_id;
    const resolvedConversationId = conversationId ?? event?.attachments?.[0];
    if (!resolvedConversationId) {
      throw new Error(
        "[facebook_messenger] Cannot determine conversation to reply to",
      );
    }
    await this.sendMessages("private", resolvedConversationId, messages);
  }

  async getDialogs(): Promise<DialogInfo[]> {
    const conversations = await this.fetchConversations();
    return conversations.map((conv) => {
      const participant =
        conv.participants?.data?.find((p) => p.id !== this.pageId) ?? null;
      const name =
        participant?.name ??
        this.pageName ??
        conv.snippet ??
        `Conversation ${conv.id.slice(-6)}`;
      const isGroup = (conv.participants?.data?.length ?? 0) > 2;
      const metadata = participant
        ? {
            platform: "facebook_messenger",
            conversationId: conv.id,
            participantId: participant.id,
            participantName: participant.name,
          }
        : {
            platform: "facebook_messenger",
            conversationId: conv.id,
          };
      return {
        id: conv.id,
        name,
        type: isGroup ? "group" : "private",
        metadata,
      };
    });
  }

  private async fetchConversations(
    limit = 50,
  ): Promise<MessengerConversation[]> {
    try {
      const data = await this.graphGet<ConversationListResponse>(
        `${this.pageId}/conversations`,
        {
          fields: "participants,updated_time,snippet,message_count",
          limit: `${limit}`,
        },
      );
      return data.data ?? [];
    } catch (error) {
      console.error(
        `[facebook_messenger] Failed to fetch conversations for page ${this.pageId}`,
        error,
      );
      return [];
    }
  }

  private mapMessage(
    conversation: MessengerConversation,
    message: MessengerMessage,
  ): ExtractedMessageInfo | null {
    if (!message.created_time) {
      return null;
    }
    const participant =
      conversation.participants?.data?.find((p) => p.id !== this.pageId) ??
      null;
    const chatName =
      participant?.name ??
      this.pageName ??
      conversation.snippet ??
      `Conversation ${conversation.id.slice(-6)}`;
    return {
      chatType:
        (conversation.participants?.data?.length ?? 0) > 2
          ? "group"
          : "private",
      chatName,
      sender: message.from?.name ?? message.from?.id ?? "Unknown",
      text: message.message ?? "",
      timestamp: Math.floor(new Date(message.created_time).getTime() / 1000),
    };
  }

  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{
    messages: ExtractedMessageInfo[];
    hasMore: boolean;
  }> {
    // Use the passed chunkSize or default value
    const maxMessageChunkCount = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;

    const extracted: ExtractedMessageInfo[] = [];

    if (!this.asyncIteratorState.isInitialized) {
      const conversations = await this.fetchConversations(100);
      this.asyncIteratorState.conversations = conversations;
      this.asyncIteratorState.currentConversationIndex = 0;
      this.asyncIteratorState.currentMessageIndex = 0;
      this.asyncIteratorState.offsetDate = since;
      this.asyncIteratorState.isInitialized = true;
    }

    const { conversations, currentConversationIndex, offsetDate } =
      this.asyncIteratorState;

    for (
      let convIdx = currentConversationIndex;
      convIdx < conversations.length;
      convIdx++
    ) {
      const conversation = conversations[convIdx];
      const messages = await this.fetchMessagesForConversation(
        conversation.id,
        offsetDate,
      );

      for (const msg of messages) {
        if (msg.timestamp < offsetDate) {
          continue;
        }
        extracted.push(msg);
        if (extracted.length >= maxMessageChunkCount) {
          this.asyncIteratorState.currentConversationIndex = convIdx;
          return { messages: extracted, hasMore: true };
        }
      }

      this.asyncIteratorState.currentConversationIndex = convIdx + 1;
    }

    this.asyncIteratorState.isInitialized = false;
    this.asyncIteratorState.currentConversationIndex = 0;
    this.asyncIteratorState.currentMessageIndex = 0;

    return { messages: extracted, hasMore: false };
  }

  private async fetchMessagesForConversation(
    conversationId: string,
    since: number,
  ): Promise<ExtractedMessageInfo[]> {
    try {
      const response = await this.graphGet<MessagesResponse>(
        `${conversationId}/messages`,
        {
          fields: "id,message,from,created_time",
          limit: "50",
        },
      );

      const messages = response.data ?? [];
      const conversation = this.asyncIteratorState.conversations.find(
        (conv) => conv.id === conversationId,
      ) ?? { id: conversationId };

      const mapped = messages
        .filter((msg) => {
          const ts = msg.created_time
            ? Math.floor(new Date(msg.created_time).getTime() / 1000)
            : 0;
          return ts >= since;
        })
        .map((msg) => this.mapMessage(conversation, msg))
        .filter((item): item is ExtractedMessageInfo => Boolean(item));

      return mapped.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error(
        `[facebook_messenger] Failed to fetch messages for conversation ${conversationId}`,
        error,
      );
      return [];
    }
  }

  async kill(): Promise<boolean> {
    // No long-lived connection to clean up for Graph API calls
    return true;
  }
}
