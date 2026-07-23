"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ChatMessage } from "@openloomi/shared";

import type { Insight } from "@/lib/db/schema";
import {
  buildNavigationUrl,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { mutate } from "swr";
import { toast } from "@/components/toast";
import { streamNativeAgentResponse } from "@/lib/ai/router/index";
import { isTauri } from "@/lib/tauri";
import {
  useModelPreference,
  getModelConfig,
} from "@/components/agent/model-selector";
import { useTranslation } from "react-i18next";
import { saveMessagesToDatabase } from "@/lib/ai/chat/save-messages";
import { getAuthToken } from "@/lib/auth/token-manager";
import { uploadImageTUS } from "@/lib/files/tus-upload";
import type { ImageAttachment } from "@openloomi/ai/agent/types";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import {
  artifactPathBasename,
  extractArtifactPathsFromText,
  pickPreferredArtifactPath,
} from "@/lib/files/extract-artifact-paths";
import { formatAgentStreamErrorForUser } from "@/lib/ai/runtime/format-error";
import { parseCodexInterruptedError } from "@/lib/ai/extensions/agent/codex/interrupt-marker";
import { detectLifestyleImageTrigger } from "@/lib/ai/image-generation/lifestyle-trigger";

// Max retry attempts for stream errors
const MAX_STREAM_RETRY_ATTEMPTS = 3;
const LIFESTYLE_IMAGE_CONSENT_STORAGE_KEY =
  "openloomi:lifestyle-image-consent:v1";

type LifestyleImageGenerationApiResponse = {
  success: boolean;
  prompt?: string;
  sourceSummary?: unknown;
  warnings?: unknown[];
  usage?: {
    provider?: string;
    model?: string;
    imageCount?: number;
    creditsUsed?: number;
    costMode?: string;
    quotaMode?: string;
  };
  images?: Array<{
    imageUrl?: string;
    dataUrl?: string;
    b64Json?: string;
    mimeType?: string;
    revisedPrompt?: string;
  }>;
  imageUrl?: string;
  dataUrl?: string;
  b64Json?: string;
  mimeType?: string;
  error?: string;
  errorType?: string;
  imageGeneration?: {
    provider?: string;
    model?: string;
    imageCount?: number;
    creditsUsed?: number;
  };
};

type ChatHistoryCache = {
  chats?: Array<{
    id: string;
    title?: string;
    createdAt?: Date | string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

// Independent state per chat
type ChatSessionState = {
  isAgentRunning: boolean;
  focusedInsights: Insight[];
  abortFn: (() => void) | null;
};

export interface ChatContextValue {
  // Current chat ID
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;

  // Messages
  messages: ChatMessage[];
  setMessages: (
    updater: React.SetStateAction<ChatMessage[]>,
    chatId?: string | null,
  ) => void;
  sendMessage: (content: any, options?: any) => Promise<void>;
  setSendMessage: (fn: (content: any, options?: any) => Promise<void>) => void;
  confirmLifestyleImageGeneration: (input: {
    chatId: string;
    assistantMessageId: string;
    prompt: string;
  }) => Promise<void>;
  declineLifestyleImageGeneration: (input: {
    chatId: string;
    assistantMessageId: string;
  }) => void;
  stop: () => void;

  // Per-chat session states
  isAgentRunning: boolean;
  focusedInsights: Insight[];
  setIsAgentRunning: (running: boolean, chatId?: string) => void;
  setFocusedInsight: (insight: Insight) => void;
  /** Set focused insight for a specific chatId (used when navigating from other pages to associate insight) */
  setFocusedInsightForChat: (chatId: string, insight: Insight) => void;
  removeFocusedInsight: (insightId: string) => void;
  clearFocusedInsights: () => void;
  toggleFocusedInsight: (insight: Insight) => void;

  // Insight detail drawer state
  selectedInsight: Insight | null;
  setSelectedInsight: (insight: Insight | null) => void;
  isInsightDrawerOpen: boolean;
  setIsInsightDrawerOpen: (open: boolean) => void;
  toggleInsightDrawer: (insight: Insight | null) => void;

  // File preview state
  previewFile: {
    path: string;
    name: string;
    type: string;
    taskId?: string;
  } | null;
  openFilePreviewPanel: (file: {
    path: string;
    name: string;
    type: string;
    taskId?: string;
  }) => void;
  closeFilePreviewPanel: () => void;

  // Vault state
  isVaultOpen: boolean;
  setVaultOpen: (open: boolean) => void;

  // Switch chatId
  switchChatId: (chatId: string | null, forceRefresh?: boolean) => void;

  // Sending lock - prevents chat switching while message is being sent
  isSending: boolean;

  // Get all chat session states (used to display running status of each chat in header)
  getChatSessionStates: () => Map<string, ChatSessionState>;
  // Get isAgentRunning for a specific chatId (not necessarily the activeChatId)
  getIsAgentRunningByChatId: (chatId: string) => boolean;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

export function useChatContextOptional(): ChatContextValue | null {
  const context = useContext(ChatContext);
  return context || null;
}

function hasAcceptedLifestyleImageConsent(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(LIFESTYLE_IMAGE_CONSENT_STORAGE_KEY) ===
    "accepted"
  );
}

function acceptLifestyleImageConsent(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LIFESTYLE_IMAGE_CONSENT_STORAGE_KEY, "accepted");
}

function getLifestyleImageUrl(
  response: LifestyleImageGenerationApiResponse,
): { url: string; mediaType: string } | null {
  const image = response.images?.[0];
  const mimeType = image?.mimeType || response.mimeType || "image/png";
  const url =
    image?.dataUrl ||
    image?.imageUrl ||
    response.dataUrl ||
    response.imageUrl ||
    (image?.b64Json ? `data:${mimeType};base64,${image.b64Json}` : null) ||
    (response.b64Json ? `data:${mimeType};base64,${response.b64Json}` : null);

  return url ? { url, mediaType: mimeType } : null;
}

export function ChatContextProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();

  // Model selection state
  const [selectedModel] = useModelPreference();

  // =====================================================================
  // Chat state management
  // =====================================================================

  // Client-side selected chat ID
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("activeChatId");
        if (saved) return saved;
      } catch (e) {
        console.error("[ChatContext] Failed to load activeChatId:", e);
      }
    }
    return generateUUID();
  });

  // Persist activeChatId - use debounced async write to avoid blocking main thread
  useEffect(() => {
    if (activeChatId) {
      const timeoutId = setTimeout(() => {
        localStorage.setItem("activeChatId", activeChatId);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [activeChatId]);

  // Max messages per chat to prevent memory issues from unbounded growth
  const MAX_MESSAGES_PER_CHAT = 1000;

  // Messages state - isolated per chatId
  const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage[]>>(
    new Map(),
  );

  // Sending lock - prevents chat switching while message is being sent
  const [isSending, setIsSending] = useState(false);

  // Get messages for a specific chat
  const getMessages = useCallback(
    (chatId: string | null): ChatMessage[] => {
      if (!chatId) return [];
      return messagesMap.get(chatId) || [];
    },
    [messagesMap],
  );

  // Get messages for current activeChatId
  const messages = activeChatId ? messagesMap.get(activeChatId) || [] : [];

  // Set messages for a specific chat
  const setMessagesForChat = useCallback(
    (chatId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessagesMap((prev) => {
        const newMap = new Map(prev);
        const chatMessages = newMap.get(chatId) || [];
        const updated = updater(chatMessages);
        // Enforce max messages per chat to prevent memory overflow
        newMap.set(
          chatId,
          updated.length > MAX_MESSAGES_PER_CHAT
            ? updated.slice(-MAX_MESSAGES_PER_CHAT)
            : updated,
        );
        return newMap;
      });
    },
    [],
  );

  // Compatibility with old setMessages interface
  // Supports passing chatId parameter to lock to a specific chat (used in streaming callbacks)
  const setMessages = useCallback(
    (
      updater: React.SetStateAction<ChatMessage[]>,
      chatIdOverride?: string | null,
    ) => {
      const targetChatId = chatIdOverride || activeChatId;
      if (!targetChatId) return;
      setMessagesForChat(targetChatId, (prev) => {
        if (typeof updater === "function") {
          return (updater as (prev: ChatMessage[]) => ChatMessage[])(prev);
        }
        return updater;
      });
    },
    [activeChatId, setMessagesForChat],
  );

  // Messages ref (used to access latest messages in callbacks)
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // messagesMap ref, used to access latest map in callbacks
  const messagesMapRef = useRef(messagesMap);
  useEffect(() => {
    messagesMapRef.current = messagesMap;
  }, [messagesMap]);

  // Stream error retry management
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const [lastUserMessage, setLastUserMessage] = useState<any>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // =====================================================================
  // sendMessage implementation
  // =====================================================================

  // Unified threshold: files larger than this use TUS chunked upload.
  // 400KB stays well under Vercel's 4.5MB body limit and protects small images too.
  const TUS_SIZE_THRESHOLD = 400 * 1024;

  function isImageFile(mediaType?: string): boolean {
    return mediaType?.startsWith("image/") ?? false;
  }

  // Set isAgentRunning for a specific chatId (used by stream callbacks to clear lock for correct chat)
  // Defined early to avoid initialization order issues with sendMessage
  const setIsAgentRunningForChatFn = useCallback(
    (chatId: string, running: boolean) => {
      if (!chatId) return;
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState =
          newMap.get(chatId) ||
          ({
            isAgentRunning: false,
            focusedInsights: [],
            abortFn: null,
          } as ChatSessionState);
        newMap.set(chatId, { ...currentState, isAgentRunning: running });
        return newMap;
      });
    },
    [],
  );

  const saveChatMessageImmediately = useCallback(
    (message: ChatMessage, chatId: string) => {
      saveMessagesToDatabase([message], chatId, {
        immediate: true,
        skipSync: false,
      });
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/history"),
        undefined,
        { revalidate: true },
      );
    },
    [],
  );

  const saveUserMessageAndUpdateHistory = useCallback(
    async (message: ChatMessage, chatId: string) => {
      const result = await saveMessagesToDatabase([message], chatId, {
        immediate: true,
        skipSync: false,
      });
      if (!result?.chat) return;

      const chat = result.chat;
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/history"),
        (data: ChatHistoryCache | undefined) => {
          if (!data || !data.chats) return data;
          const existingIndex = data.chats.findIndex(
            (item) => item.id === chat.id,
          );
          if (existingIndex >= 0) {
            const newChats = [...data.chats];
            newChats[existingIndex] = {
              ...newChats[existingIndex],
              title: chat.title,
            };
            return { ...data, chats: newChats };
          }
          return {
            ...data,
            chats: [
              ...data.chats,
              {
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt,
                latestMessageContent: null,
                latestMessageTime: chat.createdAt,
                messageCount: 1,
              },
            ],
          };
        },
        false,
      );
    },
    [],
  );

  const generateLifestyleImageReply = useCallback(
    async ({
      chatId,
      prompt,
      assistantMessageId,
      sourceUserMessageId,
    }: {
      chatId: string;
      prompt: string;
      assistantMessageId?: string;
      sourceUserMessageId?: string;
    }) => {
      const replyId = assistantMessageId || generateUUID();
      const replyCreatedAt = new Date();
      const loadingText = "Creating your lifestyle image...";
      const loadingMessage = {
        role: "assistant" as const,
        content: loadingText,
        id: replyId,
        createdAt: replyCreatedAt,
        parts: [
          { type: "text" as const, text: loadingText },
          {
            type: "data-lifestyleImageStatus" as const,
            data: {
              id: replyId,
              status: "loading" as const,
            },
          },
        ],
        metadata: {
          createdAt: replyCreatedAt.toISOString(),
          lifestyleImage: {
            status: "loading",
            sourceUserMessageId,
          },
        },
      } as ChatMessage;

      setIsSending(true);
      setIsAgentRunningForChatFn(chatId, true);
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === replyId);
        if (index === -1) return [...prev, loadingMessage];
        const next = [...prev];
        next[index] = loadingMessage;
        return next;
      }, chatId);

      try {
        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };
        let cloudAuthToken: string | null = null;
        try {
          cloudAuthToken = getAuthToken();
        } catch (error) {
          console.error("[LifestyleImage] Failed to read auth token:", error);
        }
        if (cloudAuthToken) {
          headers.Authorization = `Bearer ${cloudAuthToken}`;
        }

        const response = await fetch("/api/ai/v1/images/lifestyle/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            chatId,
            triggerPrompt: prompt,
            outputFormat: "png",
            responseFormat: "data_url",
            imageCount: 1,
          }),
        });
        const data = (await response
          .json()
          .catch(() => null)) as LifestyleImageGenerationApiResponse | null;

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.error ||
              `Lifestyle image generation failed (${response.status})`,
          );
        }

        const image = getLifestyleImageUrl(data);
        if (!image) {
          throw new Error("Image provider returned no displayable image");
        }

        const successText = "Here is your lifestyle image.";
        const provider =
          data.usage?.provider || data.imageGeneration?.provider || "unknown";
        const model =
          data.usage?.model || data.imageGeneration?.model || "unknown";
        const imageCount =
          data.usage?.imageCount || data.imageGeneration?.imageCount || 1;
        const creditsUsed =
          data.usage?.creditsUsed ?? data.imageGeneration?.creditsUsed ?? 0;
        const successMessage = {
          role: "assistant" as const,
          content: successText,
          id: replyId,
          createdAt: replyCreatedAt,
          parts: [
            { type: "text" as const, text: successText },
            {
              type: "file" as const,
              url: image.url,
              name: "lifestyle-image.png",
              mediaType: image.mediaType,
              source: "lifestyle-image-generation",
            },
            {
              type: "data-lifestyleImageStatus" as const,
              data: {
                id: replyId,
                status: "success" as const,
                provider,
                model,
                imageCount,
                creditsUsed,
              },
            },
          ],
          metadata: {
            createdAt: replyCreatedAt.toISOString(),
            lifestyleImage: {
              status: "success",
              provider,
              model,
              imageCount,
              creditsUsed,
              costMode: data.usage?.costMode ?? "estimated",
              quotaMode: data.usage?.quotaMode ?? "record_only",
              prompt: data.prompt,
              sourceSummary: data.sourceSummary,
              warnings: data.warnings,
              sourceUserMessageId,
            },
          },
        } as ChatMessage;

        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === replyId);
          if (index === -1) return [...prev, successMessage];
          const next = [...prev];
          next[index] = successMessage;
          return next;
        }, chatId);
        saveChatMessageImmediately(successMessage, chatId);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Lifestyle image generation failed";
        const failedMessage = {
          role: "assistant" as const,
          content: errorMessage,
          id: replyId,
          createdAt: replyCreatedAt,
          parts: [
            {
              type: "error" as const,
              content: errorMessage,
            },
            {
              type: "data-lifestyleImageStatus" as const,
              data: {
                id: replyId,
                status: "error" as const,
                error: errorMessage,
              },
            },
          ],
          metadata: {
            createdAt: replyCreatedAt.toISOString(),
            lifestyleImage: {
              status: "error",
              error: errorMessage,
              sourceUserMessageId,
            },
          },
        } as ChatMessage;

        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === replyId);
          if (index === -1) return [...prev, failedMessage];
          const next = [...prev];
          next[index] = failedMessage;
          return next;
        }, chatId);
        saveChatMessageImmediately(failedMessage, chatId);
        toast({
          type: "error",
          description: errorMessage,
        });
      } finally {
        setIsSending(false);
        setIsAgentRunningForChatFn(chatId, false);
      }
    },
    [
      saveChatMessageImmediately,
      setIsAgentRunningForChatFn,
      setMessages,
      setIsSending,
    ],
  );

  const confirmLifestyleImageGeneration = useCallback<
    ChatContextValue["confirmLifestyleImageGeneration"]
  >(
    async ({ chatId, assistantMessageId, prompt }) => {
      acceptLifestyleImageConsent();
      await generateLifestyleImageReply({
        chatId,
        prompt,
        assistantMessageId,
      });
    },
    [generateLifestyleImageReply],
  );

  const declineLifestyleImageGeneration = useCallback<
    ChatContextValue["declineLifestyleImageGeneration"]
  >(
    ({ chatId, assistantMessageId }) => {
      const declinedText = "Lifestyle image generation canceled.";
      const declinedCreatedAt = new Date();
      const declinedMessage = {
        role: "assistant" as const,
        content: declinedText,
        id: assistantMessageId,
        createdAt: declinedCreatedAt,
        parts: [{ type: "text" as const, text: declinedText }],
        metadata: {
          createdAt: declinedCreatedAt.toISOString(),
          lifestyleImage: {
            status: "declined",
          },
        },
      } as ChatMessage;

      setMessages((prev) => {
        const index = prev.findIndex(
          (message) => message.id === assistantMessageId,
        );
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = declinedMessage;
        return next;
      }, chatId);
      saveChatMessageImmediately(declinedMessage, chatId);
    },
    [saveChatMessageImmediately, setMessages],
  );

  // Create safe sendMessage wrapper, integrating intelligent routing
  const sendMessage: ChatContextValue["sendMessage"] = useCallback(
    async (message, options) => {
      // Wait for activeChatId to stabilize, avoid adding messages to wrong chat when switching chat immediately after sending
      // Try multiple times to get stable activeChatId
      let stableActiveChatId = activeChatId;
      const maxRetries = 5;
      for (let i = 0; i < maxRetries; i++) {
        // Brief wait to ensure activeChatId has updated
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (activeChatId === stableActiveChatId) {
          break;
        }
        stableActiveChatId = activeChatId;
      }

      if (!stableActiveChatId || stableActiveChatId.length === 0) {
        return Promise.reject(new Error("Chat is not properly initialized"));
      }

      // Capture chatId for message updates, ensure streaming updates still write to correct chat after switching
      const chatIdForMessages = stableActiveChatId;

      // Set sending lock to prevent chat switching during send
      setIsSending(true);

      // Save user message for possible stream error retry
      if (message && !isRetrying) {
        setLastUserMessage(message);
      }

      // Extract message content (handle different message types)
      let messageContent: string;
      if (typeof message === "string") {
        messageContent = message;
      } else if (message && typeof message === "object") {
        // Handle complex message types
        // Prefer extracting text from parts
        if ((message as any).parts && Array.isArray((message as any).parts)) {
          const textPart = (message as any).parts.find(
            (p: any) => p.type === "text" && p.text,
          );
          if (textPart) {
            messageContent = textPart.text;
          } else {
            // If no text part found, check if there are image attachments
            const hasImages = (message as any).parts.some(
              (p: any) =>
                p.type === "file" && p.mediaType?.startsWith("image/"),
            );
            // If images present but no text, use default prompt
            if (hasImages) {
              messageContent = t("auth.errors.streamError.analyzeImages");
            } else {
              // Try other fields
              messageContent =
                (message as any).content ||
                (message as any).text ||
                t("auth.errors.streamError.analyzeContent");
            }
          }
        } else {
          // No parts array, try to get fields directly
          messageContent =
            (message as any).content ||
            (message as any).text ||
            t("auth.errors.streamError.analyzeContent");
        }
      } else {
        messageContent = String(message);
      }

      // Ensure messageContent is not empty
      if (!messageContent || messageContent.trim() === "") {
        messageContent = t("auth.errors.streamError.analyzeContent");
      }

      const triggerMessageObject =
        message && typeof message === "object"
          ? (message as {
              parts?: ChatMessage["parts"];
              metadata?: Record<string, unknown>;
            })
          : null;
      const lifestyleTrigger = detectLifestyleImageTrigger(messageContent);
      if (
        lifestyleTrigger.matched &&
        lifestyleTrigger.confidence === "high" &&
        triggerMessageObject?.metadata?.skipLifestyleImageTrigger !== true
      ) {
        const userMessageCreatedAt = new Date();
        const userMessage = {
          role: "user" as const,
          content: messageContent,
          createdAt: userMessageCreatedAt,
          parts: triggerMessageObject?.parts || [
            { type: "text" as const, text: messageContent },
          ],
          metadata: {
            ...triggerMessageObject?.metadata,
            createdAt: userMessageCreatedAt.toISOString(),
            lifestyleImageTrigger: {
              kind: lifestyleTrigger.kind,
              reason: lifestyleTrigger.reason,
            },
          },
          id: generateUUID(),
        } as ChatMessage;
        setMessages((prev) => [...prev, userMessage], chatIdForMessages);
        await saveUserMessageAndUpdateHistory(userMessage, chatIdForMessages);

        if (!hasAcceptedLifestyleImageConsent()) {
          const consentMessageId = generateUUID();
          const consentCreatedAt = new Date(userMessageCreatedAt.getTime() + 1);
          const consentMessage = {
            role: "assistant" as const,
            content: "",
            id: consentMessageId,
            createdAt: consentCreatedAt,
            parts: [
              {
                type: "data-lifestyleImageConsent" as const,
                data: {
                  id: consentMessageId,
                  prompt: messageContent,
                  reason: lifestyleTrigger.reason,
                  createdAt: new Date().toISOString(),
                },
              },
            ],
            metadata: {
              createdAt: consentCreatedAt.toISOString(),
              lifestyleImage: {
                status: "consent_required",
                sourceUserMessageId: userMessage.id,
              },
            },
          } as ChatMessage;
          setMessages((prev) => [...prev, consentMessage], chatIdForMessages);
          saveChatMessageImmediately(consentMessage, chatIdForMessages);
          setIsSending(false);
          return Promise.resolve();
        }

        await generateLifestyleImageReply({
          chatId: chatIdForMessages,
          prompt: messageContent,
          sourceUserMessageId: userMessage.id,
        });
        return Promise.resolve();
      }

      // Extract image attachments, file attachments, RAG documents and focused insights from message
      const images: ImageAttachment[] = [];
      const fileAttachments: Array<{
        name: string;
        data: string;
        mimeType: string;
      }> = [];
      let ragDocuments: Array<{ id: string; name: string }> = [];
      let focusedInsightIds: string[] = [];
      let focusedInsights: Array<{
        id: string;
        title: string;
        description?: string | null;
        details?: any[] | null;
        groups?: string[] | null;
        platform?: string | null;
      }> = [];

      if (message && typeof message === "object") {
        // Extract image attachments - read directly from local file, not via URL
        if ((message as any).parts && Array.isArray((message as any).parts)) {
          for (const part of (message as any).parts) {
            if (part.type === "file" && part.mediaType?.startsWith("image/")) {
              // Image attachment - check if there is an original file object
              try {
                let base64Data: string | undefined;

                // Method 1: If imageUrl is set (TUS-uploaded to cloud), use it directly as image URL
                if ((part as any).serverImageTUSUrl) {
                  images.push({
                    url: (part as any).serverImageTUSUrl,
                    mimeType: part.mediaType,
                  });
                }
                // Method 2: If blobPath is set (local path), fetch and convert to base64
                else if (part.blobPath) {
                  try {
                    const resp = await fetch(part.blobPath);
                    if (!resp.ok) {
                      console.error(
                        "[safeSendMessage] ✗ blobPath fetch failed:",
                        resp.status,
                      );
                    } else {
                      const blob = await resp.blob();
                      const base64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () =>
                          resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                      });
                      base64Data = base64.split(",")[1];
                    }
                  } catch (err) {
                    console.error(
                      "[safeSendMessage] ✗ blobPath fetch error:",
                      err,
                    );
                  }
                }
                // Method 2: Prefer checking if part has original file object (fallback upload)
                else if (part.file && part.file instanceof File) {
                  // All images are processed locally via FileReader → base64.
                  // We previously routed large files through uploadImageTUS(),
                  // but /api/ai/v1/upload does not exist and we no longer need
                  // a separate server hop just to read the bytes back.
                  const file = part.file as File;
                  const base64 = await new Promise<string>(
                    (resolve, reject) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(file);
                    },
                  );
                  base64Data = base64.split(",")[1];
                }
                // Method 2: Check message.files array
                else if (
                  (message as any).files &&
                  Array.isArray((message as any).files)
                ) {
                  const file = (message as any).files.find(
                    (f: any) => f.name === part.name,
                  );
                  if (file && file instanceof File) {
                    // Read directly as base64 — see sibling block above for rationale.
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () =>
                          resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      },
                    );
                    base64Data = base64.split(",")[1];
                  }
                }
                // Method 3: Get via downloadUrl (with validation)
                else if (part.downloadUrl) {
                  const response = await fetch(part.downloadUrl);

                  const contentType = response.headers.get("content-type");
                  if (!contentType?.startsWith("image/")) {
                    console.error(
                      "[safeSendMessage] ✗ downloadUrl did not return image:",
                      contentType,
                    );
                    continue; // Skip this image
                  }

                  const blob = await response.blob();
                  const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                  base64Data = base64.split(",")[1];
                }
                // Method 4: Try normal URL (last resort)
                else if (part.url) {
                  const response = await fetch(part.url);

                  const contentType = response.headers.get("content-type");
                  if (!contentType?.startsWith("image/")) {
                    console.error(
                      "[safeSendMessage] ✗ url did not return image:",
                      contentType,
                    );
                    continue; // Skip this image
                  }

                  const blob = await response.blob();
                  const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                  base64Data = base64.split(",")[1];
                }

                if (base64Data) {
                  images.push({
                    data: base64Data,
                    mimeType: part.mediaType,
                  });
                }
              } catch (error) {
                console.error(
                  "[safeSendMessage] ✗ Exception loading image:",
                  part.name,
                  error,
                );
              }
            }
          }
        }

        // Handle all file attachments (including non-image files) - used to save to workspace
        if ((message as any).parts && Array.isArray((message as any).parts)) {
          for (const part of (message as any).parts) {
            if (part.type === "file") {
              // Skip images: they are already handled in the images loop above
              if (isImageFile(part.mediaType)) continue;

              // All file types (including images) can be saved to workspace
              try {
                let base64Data: string | undefined;

                // Method 1: Prefer checking if part has original file object
                if (part.file && part.file instanceof File) {
                  const file = part.file as File;
                  // Use TUS for large non-image files
                  if (file.size > TUS_SIZE_THRESHOLD) {
                    const blobUrl = await uploadImageTUS(file);
                    if (blobUrl) {
                      // Fetch back from our TUS endpoint as base64 for the agent
                      const headers: HeadersInit = { credentials: "include" };
                      const cloudToken = getAuthToken();
                      if (cloudToken) {
                        headers.Authorization = `Bearer ${cloudToken}`;
                      }
                      const resp = await fetch(blobUrl, headers);
                      const buffer = await resp.arrayBuffer();
                      const base64 = Buffer.from(buffer).toString("base64");
                      const mimeType =
                        part.mediaType || "application/octet-stream";
                      base64Data = `data:${mimeType};base64,${base64}`;
                    } else {
                      toast({
                        type: "error",
                        description: `File "${part.name}" upload failed`,
                      });
                      return;
                    }
                  } else {
                    // Read directly from original File object
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () =>
                          resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(part.file);
                      },
                    );
                    base64Data = base64;
                  }
                }
                // Method 2: Check message.files array
                else if (
                  (message as any).files &&
                  Array.isArray((message as any).files)
                ) {
                  const file = (message as any).files.find(
                    (f: any) => f.name === part.name,
                  );
                  if (file && file instanceof File) {
                    // Use TUS for large non-image files
                    if (file.size > TUS_SIZE_THRESHOLD) {
                      const blobUrl = await uploadImageTUS(file);
                      if (blobUrl) {
                        const headers: HeadersInit = { credentials: "include" };
                        const cloudToken = getAuthToken();
                        if (cloudToken) {
                          headers.Authorization = `Bearer ${cloudToken}`;
                        }
                        const resp = await fetch(blobUrl, headers);
                        const buffer = await resp.arrayBuffer();
                        const base64 = Buffer.from(buffer).toString("base64");
                        const mimeType =
                          part.mediaType || "application/octet-stream";
                        base64Data = `data:${mimeType};base64,${base64}`;
                      } else {
                        toast({
                          type: "error",
                          description: `File "${part.name}" upload failed`,
                        });
                        return;
                      }
                    } else {
                      const base64 = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onloadend = () =>
                            resolve(reader.result as string);
                          reader.onerror = reject;
                          reader.readAsDataURL(file);
                        },
                      );
                      base64Data = base64;
                    }
                  }
                }
                // Method 3: Get via downloadUrl
                else if (part.downloadUrl) {
                  const response = await fetch(part.downloadUrl);
                  const blob = await response.blob();
                  const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                  base64Data = base64;
                }
                // Method 4: Try normal URL
                else if (part.url) {
                  const response = await fetch(part.url);
                  const blob = await response.blob();
                  const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                  base64Data = base64;
                }

                if (base64Data) {
                  fileAttachments.push({
                    name: part.name,
                    data: base64Data,
                    mimeType: part.mediaType || "application/octet-stream",
                  });
                }
              } catch (error) {
                console.error(
                  "[safeSendMessage] ✗ Exception loading file attachment:",
                  part.name,
                  error,
                );
              }
            }
          }
        }

        // Extract RAG documents
        if ((message as any).metadata?.ragDocuments) {
          ragDocuments = (message as any).metadata.ragDocuments;
        }

        // Extract focused insights
        if ((message as any).metadata?.focusedInsights) {
          focusedInsights = (message as any).metadata.focusedInsights;
        }
        if ((message as any).metadata?.focusedInsightIds) {
          focusedInsightIds = (message as any).metadata.focusedInsightIds;
        }
      }

      // Add user message to conversation history (preserve original parts and metadata)
      const userMessage = {
        role: "user" as const,
        content: messageContent,
        parts: (message as any).parts || [
          { type: "text" as const, text: messageContent },
        ],
        metadata: (message as any).metadata, // Preserve metadata (includes ragDocuments and focusedInsights)
        id: generateUUID(),
      } as ChatMessage;
      setMessages((prev) => [...prev, userMessage], chatIdForMessages);

      // Immediately save user message to database and update history cache
      saveMessagesToDatabase([userMessage], activeChatId ?? "").then(
        (result) => {
          if (!result?.chat) return;

          const chat = result.chat;
          // Directly update SWR cache so chat header shows title immediately
          mutate(
            (key) => typeof key === "string" && key.startsWith("/api/history"),
            (data: any) => {
              if (!data || !data.chats) return data;
              // Check if this chat already exists, update title if it does, add to front if it doesn't
              const existingIndex = data.chats.findIndex(
                (c: any) => c.id === chat.id,
              );
              if (existingIndex >= 0) {
                // Update existing chat title
                const newChats = [...data.chats];
                newChats[existingIndex] = {
                  ...newChats[existingIndex],
                  title: chat.title,
                };
                return { ...data, chats: newChats };
              }
              // Add new chat to end of list (rightmost)
              return {
                ...data,
                chats: [
                  ...data.chats,
                  {
                    id: chat.id,
                    title: chat.title,
                    createdAt: chat.createdAt,
                    latestMessageContent: null,
                    latestMessageTime: chat.createdAt,
                    messageCount: 1,
                  },
                ],
              };
            },
            false,
          );
        },
      );

      // Create a temporary assistant message for streaming updates
      // Add an empty text part to avoid isPendingAssistant filtering in messages.tsx
      // Refer to hasVisibleAssistantContent logic: messages with empty parts will not render
      const assistantMessageId = generateUUID();
      const assistantMessage = {
        role: "assistant" as const,
        content: "",
        parts: [{ type: "text" as const, text: "" }],
        id: assistantMessageId,
      } as ChatMessage;
      setMessages((prev) => [...prev, assistantMessage], chatIdForMessages);

      // Record start index of new message (for saving to database)
      // Bug fix: store assistantMessageId for onDone to use instead of index
      const newMessageStartIndex = messages.length;
      const assistantMessageIdForRetry = assistantMessageId;

      // Used to manage message stream order
      let parts: any[] = [];
      let textContent = "";
      // Used for message deduplication - track received messageIds
      const receivedMessageIds = new Set<string>();

      try {
        // Call Native Agent API
        // Note: Billing is now handled in the backend API, no need to pass userId and userType here

        // Build conversation history
        // During retry, need to remove incomplete last round of conversation
        let conversationMessages = messages.filter((m) => m.role !== "system");

        // If retrying, check if last round of conversation is complete
        // (assistant message may only have error, no actual content)
        if (isRetrying && conversationMessages.length >= 2) {
          const lastMessage =
            conversationMessages[conversationMessages.length - 1];
          if (lastMessage.role === "assistant") {
            // Check if message has actual content (via parts)
            const hasContent = lastMessage.parts?.some(
              (part: any) =>
                part.type === "text" && part.text && part.text.trim() !== "",
            );
            if (!hasContent) {
              // Remove incomplete assistant message
              conversationMessages = conversationMessages.slice(0, -1);
            }
          }
        }

        const conversation = conversationMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: getTextFromMessage(m),
        }));

        // Get user auth token for native agent in Tauri mode
        let cloudAuthToken: string | undefined;
        if (isTauri()) {
          try {
            cloudAuthToken = getAuthToken() || undefined;
          } catch (error) {
            console.error(
              "[NativeAgent] Failed to read cloud_auth_token:",
              error,
            );
          }
        }

        // Configure to use local API endpoint in Tauri mode
        const effectiveModel =
          selectedModel === "default" ? DEFAULT_AI_MODEL : selectedModel;
        const modelCfg = getModelConfig(selectedModel);
        const modelConfig = cloudAuthToken
          ? {
              baseUrl: AI_PROXY_BASE_URL, // SDK will automatically add /v1/messages
              apiKey: cloudAuthToken, // User's auth token
              model: effectiveModel, // Use user-selected model
              thinkingLevel: modelCfg?.supportsThinking
                ? (modelCfg.defaultThinkingLevel ?? "adaptive")
                : undefined,
            }
          : undefined;

        setIsAgentRunningFn(true, stableActiveChatId);
        // Set abort function and message update for current conversation
        const chatIdForAbort = stableActiveChatId;

        // Directly save AI message parts during streaming updates
        // Avoid AI message parts being lost to database when switching chats
        const saveAssistantMessage = () => {
          // Directly use local parts variable and assistantMessageId to construct message
          // Because messagesRef.current has not been updated to the latest state yet
          if (parts.length === 0) return;

          const messageToSave = {
            role: "assistant" as const,
            content: textContent,
            parts: [...parts], // Copy current parts
            id: assistantMessageId,
          } as ChatMessage;
          saveMessagesToDatabase([messageToSave], activeChatId ?? "");
        };

        const abortFn = await streamNativeAgentResponse(messageContent, {
          chatId: stableActiveChatId ?? undefined,
          conversation,
          taskId: stableActiveChatId ?? undefined, // Use stableActiveChatId as taskId so Workspace can correctly display files
          workDir: stableActiveChatId
            ? `~/.openloomi/sessions/${stableActiveChatId}`
            : undefined, // Pass complete workDir path to ensure files are created in the correct directory
          images,
          fileAttachments:
            fileAttachments.length > 0 ? fileAttachments : undefined,
          ragDocuments,
          focusedInsightIds,
          focusedInsights,
          authToken: cloudAuthToken,
          // Immediately save abortFn to ref and state, reduce race conditions
          onAbortFnReady: (abortFn) => {
            // Update both ref and state simultaneously to ensure stop function can access synchronously
            abortFnRef.current = abortFn;
            if (chatIdForAbort) {
              setChatSessionStates((prev) => {
                const newMap = new Map(prev);
                const currentState = getChatSessionState(chatIdForAbort);
                newMap.set(chatIdForAbort, { ...currentState, abortFn });
                return newMap;
              });
            }
          },
          onUpdate: async (data) => {
            // Ensure state is true when receiving message.
            // Pass the captured chatIdForAbort so the running flag is set on the
            // SAME chat that onDone/onError later clears. Without this, updates
            // default to the current activeChatId, which can drift (e.g. when the
            // user switches chats mid-stream), leaving the flag stuck true and the
            // send button locked in the loading/stop state after completion.
            setIsAgentRunningFn(true, chatIdForAbort ?? undefined);

            // Deduplicate based on messageId - avoid duplicate messages
            const messageId = (data as { messageId?: string }).messageId;
            if (messageId) {
              if (receivedMessageIds.has(messageId)) {
                // Skip duplicate messages
                return;
              }
              receivedMessageIds.add(messageId);
            }

            // Handle streaming updates
            if (data.type === "text") {
              // Text content - accumulate incremental text sent by backend
              // Backend sends incremental text chunks each time, frontend needs to accumulate
              const newContent: string = data.content || "";

              // Check if content increment would cause duplication (e.g. "Hello Hello")
              // If new content already exists in textContent, skip it
              // Use indexOf check because "Hello " + "Hello" = "Hello Hello" can occur
              if (
                typeof newContent === "string" &&
                newContent.length >= 10 &&
                textContent.startsWith(newContent)
              ) {
                // Content already exists, skip this increment
                return;
              }

              textContent += newContent;

              // Update or create text part
              const lastPart = parts[parts.length - 1];
              if (lastPart && lastPart.type === "text") {
                // Update last text part
                parts[parts.length - 1] = {
                  type: "text" as const,
                  text: textContent,
                };
              } else {
                // Create new text part
                parts.push({
                  type: "text" as const,
                  text: textContent,
                });
              }

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    content: textContent,
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "tool_use") {
              // Tool call - add or update the existing part.
              // Some providers stream the tool call before the full input is available,
              // then send the same toolUseId again with parameters.
              const toolUseId = data.toolUseId || data.id;
              const toolPart = {
                type: "tool-native" as const,
                toolName: data.name || "unknown",
                toolInput: data.input,
                status: "executing",
                toolUseId,
              };

              const existingIndex = parts.findIndex(
                (part: any) =>
                  part?.type === "tool-native" &&
                  toolUseId &&
                  part?.toolUseId === toolUseId,
              );
              if (existingIndex >= 0) {
                parts[existingIndex] = {
                  ...parts[existingIndex],
                  ...toolPart,
                  toolInput: data.input ?? parts[existingIndex].toolInput,
                };
              } else {
                parts.push(toolPart);
              }
              // Reset textContent so subsequent new text chunks start accumulating from empty
              textContent = "";

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "tool_result") {
              // Tool execution result - update corresponding tool use part
              // Check if it is a raw-message query tool result.
              if (data.output && typeof data.output === "string") {
                try {
                  const outputObj = JSON.parse(data.output);
                  if (outputObj.method === "indexeddb_query") {
                    const {
                      queryRawMessages,
                      queryRawMessagesGrouped,
                      formatRawMessagesForAI,
                    } = await import("@openloomi/indexeddb/client");

                    const params = outputObj.params;
                    let messages: any[];
                    let resultText: string;

                    // Use grouped query if groupBy is specified
                    if (params.groupBy && params.groupBy !== "none") {
                      const grouped = await queryRawMessagesGrouped(params);
                      const groupKeys = Object.keys(grouped).sort((a, b) => {
                        if (a === "Today") return -1;
                        if (b === "Today") return 1;
                        if (a === "Yesterday") return -1;
                        if (b === "Yesterday") return 1;
                        return b.localeCompare(a);
                      });

                      const totalMessages =
                        Object.values(grouped).flat().length;
                      resultText = `Found ${totalMessages} messages grouped by ${params.groupBy}:\n\n`;

                      for (const key of groupKeys) {
                        const groupMessages = grouped[key];
                        resultText += `## ${key} (${groupMessages.length} messages)\n`;
                        resultText += formatRawMessagesForAI(groupMessages);
                        resultText += "\n\n";
                      }

                      messages = Object.values(grouped).flat();
                    } else {
                      messages = await queryRawMessages(params);
                      resultText = formatRawMessagesForAI(messages);
                    }

                    // Send result back to Agent as user message
                    if (messages.length > 0) {
                      const title = `Query Results (${messages.length} messages)`;
                      const fullText = `${title}\n\n${resultText}`;

                      // Add a new text part
                      parts.push({
                        type: "text" as const,
                        text: fullText,
                      });

                      setMessages((prev) => {
                        const updated = [...prev];
                        const lastIndex = updated.length - 1;
                        if (
                          lastIndex >= 0 &&
                          updated[lastIndex].role === "assistant"
                        ) {
                          updated[lastIndex] = {
                            ...updated[lastIndex],
                            parts: [...parts],
                          } as ChatMessage;
                        }
                        return updated;
                      }, chatIdForMessages);
                    } else {
                      // No messages found, update tool output
                      data.output = "No messages found matching your criteria.";
                    }
                  }
                } catch (e) {
                  // Not a JSON or not an indexeddb_query, continue normal processing
                }
              }

              // Find corresponding tool use part and update
              const updatedParts = parts.map((part) => {
                if (
                  part.type === "tool-native" &&
                  part.toolUseId === data.toolUseId
                ) {
                  const updatedPart = {
                    ...part,
                    status: data.isError
                      ? ("error" as const)
                      : ("completed" as const),
                    toolOutput: data.output,
                    isError: data.isError,
                  };

                  // Check if files were generated (supports .pptx, .pdf, .xlsx, .md etc.)
                  if (data.output && typeof data.output === "string") {
                    const foundFiles = extractArtifactPathsFromText(
                      data.output,
                    );

                    if (foundFiles.length > 0) {
                      const filePathRaw = pickPreferredArtifactPath(foundFiles);
                      if (filePathRaw) {
                        // Clean path: remove trailing whitespace and parentheses
                        const filePath = filePathRaw
                          .trim()
                          .replace(/[()\s]+$/g, "");

                        const fileName = artifactPathBasename(filePath);
                        const fileExt = fileName
                          .split(".")
                          .pop()
                          ?.toLowerCase();

                        updatedPart.generatedFile = {
                          path: filePath,
                          name: fileName,
                          type: fileExt || "unknown",
                        };

                        // For code or text files, add code preview
                        if (
                          [
                            "py",
                            "js",
                            "ts",
                            "tsx",
                            "jsx",
                            "md",
                            "txt",
                          ].includes(fileExt || "")
                        ) {
                          // Try to extract code content from output
                          const codeMatch = data.output.match(
                            /File created successfully at: (.+)/,
                          );
                          if (codeMatch) {
                            updatedPart.codeFile = {
                              path: filePath,
                              name: fileName,
                              language: fileExt,
                            };
                          }
                        }
                      }
                    }
                  }

                  return updatedPart;
                }
                return part;
              });

              parts = updatedParts;

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "reasoning") {
              // Reasoning content - accumulate incremental reasoning text
              const newReasoning: string = data.content || data.text || "";

              if (!newReasoning) return; // Skip empty reasoning

              // Find if there's already a reasoning part at the end of the current parts
              const lastPart = parts[parts.length - 1];

              if (lastPart && lastPart.type === "reasoning") {
                // Append to existing reasoning part (streaming accumulation)
                const existingText = (lastPart as any).text || "";
                (lastPart as any).text = existingText + newReasoning;
              } else {
                // Create new reasoning part
                parts.push({
                  type: "reasoning" as const,
                  text: newReasoning,
                });
              }
            } else if (data.type === "insightsRefresh") {
              // Insight change notification for optimistic update
              // Create a data-insightsRefresh part
              const insightPart = {
                type: "data-insightsRefresh" as const,
                data: {
                  action: data.action,
                  insightId: data.insightId,
                  insight: data.insight,
                },
              };

              parts.push(insightPart);

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "permission_request") {
              // Permission request from SDK - needs user confirmation
              const permissionPart = {
                type: "data-permission-request" as const,
                data: {
                  permissionRequest: data.permissionRequest,
                },
              };

              parts.push(permissionPart);

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "retry") {
              // Codex CLI 0.144+ emits non-terminal retry/transport-fallback
              // notices as `retry` AgentMessages (e.g. "Reconnecting... 2/5
              // (request timed out)"). These are transient status events
              // from a still-running turn, not terminal assistant errors.
              // Surface a brief info toast for visibility, but do NOT push a
              // chat part — the loading indicator stays up, the turn keeps
              // running, and the final `turn.completed` / agent message will
              // follow normally. Pushing a part here would leave a duplicate
              // Agent Execution Timeout card above the eventual successful
              // reply (issue #385).
              const retryMessage =
                data.content || data.message || "Codex is reconnecting…";
              const attempt =
                typeof data.attempt === "number" &&
                typeof data.maxAttempts === "number"
                  ? ` (${data.attempt}/${data.maxAttempts})`
                  : "";
              toast({
                type: "info",
                description: `${retryMessage}${attempt}`,
              });
            } else if (data.type === "error") {
              console.error("[NativeAgent] Error:", data.message);
              const errorMessage = data.message || "Unknown error";
              const userFriendlyMessage = formatAgentStreamErrorForUser(
                "chat",
                errorMessage,
              );
              toast({
                type: "error",
                description: userFriendlyMessage,
              });
              // Add error to message
              const errorPart = {
                type: "error" as const,
                content: userFriendlyMessage,
              };
              parts.push(errorPart);

              // Provider-timeout interruption: surface a structured data part
              // so the chat UI can render an explicit Continue action that
              // reuses the preserved workspace. We deliberately skip the
              // stream-level auto-retry path (handled in onError) by tagging
              // the part with an interruption payload — see issue #356.
              const interruption = parseCodexInterruptedError(errorMessage);
              if (interruption?.canResume) {
                parts.push({
                  type: "data-interruption",
                  data: {
                    reason: "timeout",
                    timeoutMs: interruption.timeoutMs,
                    workspacePath: interruption.workspacePath,
                    completedArtifacts: interruption.completedArtifacts,
                    canResume: true,
                  },
                } as ChatMessage["parts"][number]);
              }

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    parts: [...parts],
                  } as ChatMessage;
                }
                return updated;
              }, chatIdForMessages);
            } else if (data.type === "result") {
              // Handle error result types
              if (data.content === "error_during_execution") {
                toast({
                  type: "error",
                  description: "Agent execution failed. Please try again.",
                });
                // Add error to message
                const errorPart = {
                  type: "error" as const,
                  content: "Agent execution failed. Please try again.",
                };
                parts.push(errorPart);

                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (
                    lastIndex >= 0 &&
                    updated[lastIndex].role === "assistant"
                  ) {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      parts: [...parts],
                    } as ChatMessage;
                  }
                  return updated;
                }, chatIdForMessages);
              } else if (data.content === "error_max_turns") {
                toast({
                  type: "error",
                  description: "Agent reached maximum turn limit.",
                });
                // Add error to message for consistency with error_during_execution
                const errorPart = {
                  type: "error" as const,
                  content: "Agent reached maximum turn limit.",
                };
                parts.push(errorPart);
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (
                    lastIndex >= 0 &&
                    updated[lastIndex].role === "assistant"
                  ) {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      parts: [...parts],
                    } as ChatMessage;
                  }
                  return updated;
                }, chatIdForMessages);
              } else if (data.content === "error_max_budget_usd") {
                toast({
                  type: "error",
                  description: "Agent reached maximum budget.",
                });
                // Add error to message for consistency with error_during_execution
                const errorPart = {
                  type: "error" as const,
                  content: "Agent reached maximum budget.",
                };
                parts.push(errorPart);
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (
                    lastIndex >= 0 &&
                    updated[lastIndex].role === "assistant"
                  ) {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      parts: [...parts],
                    } as ChatMessage;
                  }
                  return updated;
                }, chatIdForMessages);
              } else if (
                data.content === "error_max_structured_output_retries"
              ) {
                toast({
                  type: "error",
                  description:
                    "Agent failed to produce valid structured output.",
                });
                // Add error to message for consistency
                const errorPart = {
                  type: "error" as const,
                  content: "Agent failed to produce valid structured output.",
                };
                parts.push(errorPart);
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (
                    lastIndex >= 0 &&
                    updated[lastIndex].role === "assistant"
                  ) {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      parts: [...parts],
                    } as ChatMessage;
                  }
                  return updated;
                }, chatIdForMessages);
              }
            }

            // Save AI message parts on every update
            // Ensure AI message parts already generated won't be lost to database when switching chats
            // Backend uses onConflictDoUpdate to handle duplicate saves
            saveAssistantMessage();
          },
          modelConfig,
          onDone: async () => {
            // Clear sending lock
            setIsSending(false);
            // Cleanup native agent state - use chatIdForAbort to ensure lock is cleared for correct chat
            // Fallback to activeChatId if chatIdForAbort is not available (should not happen but safety check)
            const chatIdToClear = chatIdForAbort || activeChatId;
            // Clear abort function in ref FIRST to prevent race with stop()
            abortFnRef.current = null;
            // Clear abort function and isAgentRunning for current conversation atomically
            if (chatIdToClear) {
              setChatSessionStates((prev) => {
                const newMap = new Map(prev);
                const currentState = getChatSessionState(chatIdToClear);
                newMap.set(chatIdToClear, {
                  ...currentState,
                  isAgentRunning: false,
                  abortFn: null,
                });
                return newMap;
              });
            }

            // Reset stream error retry count and retry flag (execution success)
            setStreamRetryCount(0);
            setIsRetrying(false);

            // Save Native Agent messages to database (only non-user messages, user messages already saved on send)
            // Bug fix: use assistantMessageId to find messages instead of index
            const allNewMessages =
              messagesRef.current.length > newMessageStartIndex
                ? messagesRef.current.slice(newMessageStartIndex)
                : messagesRef.current.filter(
                    (m) => m.id === assistantMessageIdForRetry,
                  );
            const messagesToSave = allNewMessages.filter(
              (m) => m.role !== "user",
            );
            saveMessagesToDatabase(messagesToSave, activeChatId ?? "", {
              immediate: true,
              skipSync: false,
            });

            mutate(
              (key) =>
                typeof key === "string" && key.startsWith("/api/history"),
              undefined,
              { revalidate: true },
            );
          },
          onError: (error) => {
            // Clear sending lock
            setIsSending(false);
            console.error("[NativeAgent] Stream error:", error);
            // Cleanup native agent state - use chatIdForAbort to ensure lock is cleared for correct chat
            // Fallback to activeChatId if chatIdForAbort is not available (should not happen but safety check)
            const chatIdToClear = chatIdForAbort || activeChatId;
            // Clear abort function in ref FIRST to prevent race with stop()
            abortFnRef.current = null;
            // Clear abort function and isAgentRunning for current conversation atomically
            if (chatIdToClear) {
              setChatSessionStates((prev) => {
                const newMap = new Map(prev);
                const currentState = getChatSessionState(chatIdToClear);
                newMap.set(chatIdToClear, {
                  ...currentState,
                  isAgentRunning: false,
                  abortFn: null,
                });
                return newMap;
              });
            }

            // Safely extract error properties
            const errorName =
              error instanceof Error
                ? error.name
                : typeof error === "string"
                  ? "String Error"
                  : "Unknown Error";
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            // Detect if it is a stream connection error (network issues or service timeout)
            const lowerErrorMessage = errorMessage.toLowerCase();
            const isRetryable = (error as any)?.isRetryable;
            const isStreamConnectionError =
              isRetryable === true ||
              lowerErrorMessage.includes("stream") ||
              lowerErrorMessage.includes("network") ||
              lowerErrorMessage.includes("connection") ||
              lowerErrorMessage.includes("timeout") ||
              lowerErrorMessage.includes("fetch") ||
              lowerErrorMessage.includes("cloud") ||
              lowerErrorMessage.includes("502") ||
              lowerErrorMessage.includes("503") ||
              lowerErrorMessage.includes("504") ||
              lowerErrorMessage.includes("bad gateway") ||
              lowerErrorMessage.includes("upstream") ||
              (errorName === "TypeError" &&
                lowerErrorMessage.includes("fetch"));

            // Display error message
            const errorContent = isStreamConnectionError
              ? `Stream Error: ${errorMessage}`
              : `Stream Error: ${errorMessage}\n\nError Type: ${errorName}`;

            // Add error part to message for friendly display
            setMessages((prev) => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
                // Safely get existing parts, use empty array if not available
                const existingParts = Array.isArray(updated[lastIndex].parts)
                  ? updated[lastIndex].parts
                  : [];

                updated[lastIndex] = {
                  ...updated[lastIndex],
                  content: errorContent,
                  parts: [
                    ...existingParts,
                    {
                      type: "error" as const,
                      content: errorContent,
                    },
                  ],
                } as ChatMessage;
              }
              return updated;
            }, chatIdForMessages);

            // If it is a stream connection error and max retry count not reached, auto retry
            if (
              isStreamConnectionError &&
              streamRetryCount < MAX_STREAM_RETRY_ATTEMPTS
            ) {
              toast({
                type: "info",
                description: t("auth.errors.streamError.retrying", {
                  current: streamRetryCount + 1,
                  max: MAX_STREAM_RETRY_ATTEMPTS,
                }),
              });

              // Immediately increment retry count
              const nextRetryCount = streamRetryCount + 1;
              setStreamRetryCount(nextRetryCount);

              // Retry after delay
              setTimeout(() => {
                if (lastUserMessage) {
                  // Set retry flag, force use native agent
                  setIsRetrying(true);

                  // Remove assistant message by ID instead of position (bug fix: avoid deleting wrong message if user sent new message during delay)
                  setMessages((prev) => {
                    const updated = prev.filter(
                      (m) => m.id !== assistantMessageIdForRetry,
                    );
                    return updated;
                  }, chatIdForMessages);

                  // Build retry message, tell AI to continue previous task
                  // Create new message object to avoid modifying original lastUserMessage
                  const retryPromptText = t(
                    "auth.errors.streamError.retryPrompt",
                  );
                  let retryMessage: any;
                  if (
                    typeof lastUserMessage === "object" &&
                    lastUserMessage.parts
                  ) {
                    // If object format (with parts), add continue instruction
                    const textPart = lastUserMessage.parts.find(
                      (p: any) => p.type === "text",
                    );
                    if (textPart) {
                      // Create new parts array, prepend "Please continue:" to original text
                      const updatedParts = lastUserMessage.parts.map(
                        (part: any) =>
                          part.type === "text"
                            ? {
                                ...part,
                                text: `${retryPromptText}${part.text}`,
                              }
                            : part,
                      );
                      retryMessage = {
                        ...lastUserMessage,
                        parts: updatedParts,
                      };
                    } else {
                      // If no text part, create one
                      retryMessage = {
                        ...lastUserMessage,
                        parts: [
                          { type: "text", text: retryPromptText },
                          ...lastUserMessage.parts,
                        ],
                      };
                    }
                  } else if (typeof lastUserMessage === "string") {
                    // If string format, prepend continue prefix
                    retryMessage = `${retryPromptText}${lastUserMessage}`;
                  } else {
                    // Other cases, use original message directly
                    retryMessage = lastUserMessage;
                  }

                  // Resend message
                  sendMessage(retryMessage)
                    .then(() => {
                      // Reset retry flag on success
                      setIsRetrying(false);
                    })
                    .catch((err) => {
                      console.error("[NativeAgent] Retry failed:", err);
                      setIsRetrying(false);
                    });
                }
              }, 2000); // Retry after 2 seconds

              // Keep native mode, do not interrupt execution
              return;
            }

            // Max retry count reached or not a stream connection error
            if (isStreamConnectionError) {
              toast({
                type: "error",
                description: t("auth.errors.streamError.maxRetriesReached", {
                  max: MAX_STREAM_RETRY_ATTEMPTS,
                }),
              });
            } else {
              toast({
                type: "error",
                description: `${t("auth.errors.streamError.description")}: ${errorMessage}`,
              });
            }

            // Reset retry count
            setStreamRetryCount(0);
          },
        });

        // Save abort function for current conversation so it can still abort after switching conversations
        if (chatIdForAbort) {
          setChatSessionStates((prev) => {
            const newMap = new Map(prev);
            const currentState = getChatSessionState(chatIdForAbort);
            newMap.set(chatIdForAbort, { ...currentState, abortFn });
            return newMap;
          });
        }

        return Promise.resolve();
      } catch (error) {
        console.error("[NativeAgent] API call failed:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorContent = `API Error: ${errorMessage}`;

        // Show toast with error details
        toast({
          type: "error",
          description: `Call failed: ${errorMessage}`,
        });

        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
            // Safely get existing parts, use empty array if not available
            const existingParts = Array.isArray(updated[lastIndex].parts)
              ? updated[lastIndex].parts
              : [];

            updated[lastIndex] = {
              ...updated[lastIndex],
              content: errorContent,
              parts: [
                ...existingParts,
                {
                  type: "error" as const,
                  content: errorContent,
                },
              ],
            } as ChatMessage;
          }
          return updated;
        }, chatIdForMessages);
        // Bug fix: clear isSending lock to allow future messages
        setIsSending(false);
        return Promise.reject(error);
      }
    },
    [
      activeChatId,
      messages,
      setMessages,
      t,
      setIsAgentRunningForChatFn,
      saveUserMessageAndUpdateHistory,
      saveChatMessageImmediately,
      generateLifestyleImageReply,
    ],
  );

  // setSendMessage - no longer needed because sendMessage is implemented in context
  const setSendMessage = useCallback((fn: any) => {}, []);

  // =====================================================================
  // UI state
  // =====================================================================

  // Insight drawer state
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [isInsightDrawerOpen, setIsInsightDrawerOpen] = useState(false);

  // Vault state
  const [isVaultOpen, setIsVaultOpen] = useState(false);

  // File preview state
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
    type: string;
    taskId?: string;
  } | null>(null);

  const closeFilePreviewPanel = useCallback(() => {
    setPreviewFile(null);
  }, []);

  // =====================================================================
  // Per-chat state management (persisted to localStorage)
  // =====================================================================

  // Load chatSessionStates from localStorage
  const loadChatSessionStatesFromStorage = (): Map<
    string,
    ChatSessionState
  > => {
    if (typeof window === "undefined") return new Map();
    try {
      const saved = localStorage.getItem("chatSessionStates");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Convert plain object back to Map
        const map = new Map<string, ChatSessionState>();
        for (const [key, value] of Object.entries(parsed)) {
          map.set(key, value as ChatSessionState);
        }
        return map;
      }
    } catch (e) {
      console.error("[ChatContext] Failed to load chatSessionStates:", e);
    }
    return new Map();
  };

  const [chatSessionStates, setChatSessionStates] = useState<
    Map<string, ChatSessionState>
  >(loadChatSessionStatesFromStorage);

  // Use ref to store current abortFn, ensure stop function can access synchronously
  // Avoid issues caused by React state async updates
  const abortFnRef = useRef<(() => void) | null>(null);

  // Persist chatSessionStates to localStorage - use debounced async write to avoid blocking main thread
  // Limit stored sessions to prevent localStorage quota exceeded errors
  const MAX_STORED_SESSIONS = 20;
  const MAX_FOCUSED_INSIGHTS = 10;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timeoutId = setTimeout(() => {
      try {
        // Convert Map to plain object for JSON serialization
        // Limit to most recent sessions to prevent localStorage quota exceeded
        const entries = Array.from(chatSessionStates.entries());
        const recentEntries = entries.slice(-MAX_STORED_SESSIONS);
        const obj: Record<string, Omit<ChatSessionState, "abortFn">> = {};
        recentEntries.forEach(([key, value]) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { abortFn, focusedInsights, ...rest } = value;
          obj[key] = {
            ...rest,
            // Limit focusedInsights per session to prevent quota exceeded
            focusedInsights:
              focusedInsights?.slice(-MAX_FOCUSED_INSIGHTS) ?? [],
          };
        });
        localStorage.setItem("chatSessionStates", JSON.stringify(obj));
      } catch (e) {
        // Handle QuotaExceededError specifically - clear old data and retry with fewer sessions
        if (
          e instanceof DOMException &&
          (e.name === "QuotaExceededError" || e.code === 22)
        ) {
          console.warn(
            "[ChatContext] localStorage quota exceeded, clearing old sessions",
          );
          try {
            // Keep only the most recent 5 sessions and minimal data
            const entries = Array.from(chatSessionStates.entries());
            const recentEntries = entries.slice(-5);
            const obj: Record<string, Omit<ChatSessionState, "abortFn">> = {};
            recentEntries.forEach(([key, value]) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { abortFn, ...rest } = value;
              obj[key] = { ...rest, focusedInsights: [] };
            });
            localStorage.setItem("chatSessionStates", JSON.stringify(obj));
          } catch {
            // If even that fails, clear entirely
            localStorage.removeItem("chatSessionStates");
          }
        } else {
          console.error("[ChatContext] Failed to save chatSessionStates:", e);
        }
      }
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [chatSessionStates]);

  const getChatSessionState = useCallback(
    (chatId: string): ChatSessionState => {
      return (
        chatSessionStates.get(chatId) || {
          isAgentRunning: false,
          focusedInsights: [],
          abortFn: null,
        }
      );
    },
    [chatSessionStates],
  );

  // Get isAgentRunning for a specific chatId (not necessarily the activeChatId)
  const getIsAgentRunningByChatId = useCallback(
    (chatId: string): boolean => {
      return getChatSessionState(chatId).isAgentRunning;
    },
    [getChatSessionState],
  );

  const currentSessionState = activeChatId
    ? getChatSessionState(activeChatId)
    : { isAgentRunning: false, focusedInsights: [], abortFn: null };

  // stop function - iterate all sessions to find and abort running agent
  const stop = useCallback(() => {
    // Prefer using abortFn in ref to ensure synchronous access
    let abortFn = abortFnRef.current;
    let chatIdWithAbort: string | null = null;

    // If not in ref, try to get from state
    if (!abortFn) {
      for (const [chatId, state] of chatSessionStates) {
        if (state.abortFn) {
          abortFn = state.abortFn;
          chatIdWithAbort = chatId;
          break;
        }
      }
    }

    // Immediately set isAgentRunning = false to prevent triggering new requests during abort
    if (chatIdWithAbort) {
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(chatIdWithAbort);
        if (state) {
          newMap.set(chatIdWithAbort, { ...state, isAgentRunning: false });
        }
        return newMap;
      });
    }

    try {
      if (abortFn) {
        abortFn();
      } else {
        console.warn("[stop] No abortFn found, cannot stop the request");
      }
    } catch (error) {
      console.error("[stop] Error aborting native agent:", error);
    } finally {
      // Clear abort functions and running state for all conversations
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        for (const [chatId, state] of newMap) {
          if (state.abortFn || state.isAgentRunning) {
            newMap.set(chatId, {
              ...state,
              abortFn: null,
              isAgentRunning: false,
            });
          }
        }
        return newMap;
      });
    }
    return Promise.resolve();
  }, [chatSessionStates]);

  const setIsAgentRunningFn = useCallback(
    (running: boolean, chatId?: string) => {
      const targetChatId = chatId ?? activeChatId;
      if (!targetChatId) return;
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState = getChatSessionState(targetChatId);
        newMap.set(targetChatId, { ...currentState, isAgentRunning: running });
        return newMap;
      });
    },
    [activeChatId, getChatSessionState],
  );

  const setFocusedInsightFn = useCallback(
    (insight: Insight) => {
      if (!activeChatId) return;
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState = getChatSessionState(activeChatId);
        if (currentState.focusedInsights.some((i) => i.id === insight.id)) {
          return prev;
        }
        const newInsights = [...currentState.focusedInsights, insight];
        newMap.set(activeChatId, {
          ...currentState,
          focusedInsights: newInsights,
        });
        return newMap;
      });
    },
    [activeChatId, getChatSessionState],
  );

  // Set focused insight for a specific chatId
  const setFocusedInsightForChatFn = useCallback(
    (chatId: string, insight: Insight) => {
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState = getChatSessionState(chatId);
        if (currentState.focusedInsights.some((i) => i.id === insight.id)) {
          return prev;
        }
        const newInsights = [...currentState.focusedInsights, insight];
        newMap.set(chatId, {
          ...currentState,
          focusedInsights: newInsights,
        });
        return newMap;
      });
    },
    [getChatSessionState],
  );

  const removeFocusedInsightFn = useCallback(
    (insightId: string) => {
      if (!activeChatId) return;
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState = getChatSessionState(activeChatId);
        const newInsights = currentState.focusedInsights.filter(
          (i) => i.id !== insightId,
        );
        newMap.set(activeChatId, {
          ...currentState,
          focusedInsights: newInsights,
        });
        return newMap;
      });
    },
    [activeChatId, getChatSessionState],
  );

  const clearFocusedInsightsFn = useCallback(() => {
    if (!activeChatId) return;
    setChatSessionStates((prev) => {
      const newMap = new Map(prev);
      const currentState = getChatSessionState(activeChatId);
      newMap.set(activeChatId, { ...currentState, focusedInsights: [] });
      return newMap;
    });
  }, [activeChatId, getChatSessionState]);

  const toggleFocusedInsightFn = useCallback(
    (insight: Insight) => {
      if (!activeChatId) return;
      setChatSessionStates((prev) => {
        const newMap = new Map(prev);
        const currentState = getChatSessionState(activeChatId);
        const exists = currentState.focusedInsights.some(
          (i) => i.id === insight.id,
        );
        let newInsights: Insight[];
        if (exists) {
          newInsights = currentState.focusedInsights.filter(
            (i) => i.id !== insight.id,
          );
        } else {
          if (currentState.focusedInsights.length >= 5) {
            toast({
              type: "info",
              description: "You can only focus on up to 5 Insights",
            });
            return prev;
          }
          newInsights = [...currentState.focusedInsights, insight];
        }
        newMap.set(activeChatId, {
          ...currentState,
          focusedInsights: newInsights,
        });
        return newMap;
      });
    },
    [activeChatId, getChatSessionState],
  );

  const openFilePreviewPanel = useCallback(
    (file: { path: string; name: string; type: string; taskId?: string }) => {
      setPreviewFile(file);
    },
    [],
  );

  const toggleInsightDrawer = useCallback(
    (insight: Insight | null) => {
      setSelectedInsight(insight);
      setIsInsightDrawerOpen(!!insight);
      if (insight?.id) {
        const newPath = buildNavigationUrl({
          pathname,
          searchParams,
          paramsToUpdate: { insightDetailId: insight.id },
        });
        router.replace(newPath);
      } else {
        if (searchParams.get("insightDetailId")) {
          const newPath = buildNavigationUrl({
            pathname,
            searchParams,
            paramsToUpdate: { insightDetailId: null },
          });
          router.replace(newPath);
        }
      }
    },
    [pathname, searchParams, router],
  );

  // =====================================================================
  // Switch Chat
  // =====================================================================

  const switchChatId = useCallback(
    async (newChatId: string | null, forceRefresh?: boolean) => {
      // Close drawer when switching conversations
      setIsInsightDrawerOpen(false);
      setSelectedInsight(null);
      // Close drawer when switching conversations
      setIsInsightDrawerOpen(false);
      setSelectedInsight(null);

      // Prevent chat switching while sending a message
      if (isSending) {
        return;
      }

      if (!newChatId) {
        const newUuid = generateUUID();
        setActiveChatId(newUuid);
        // No need to manually clear, will get empty array from map when switching to new chat
        return;
      }

      // Switch activeChatId first, messages will automatically be fetched from messagesMap
      // If the chat already has cached messages, use them directly; otherwise will fetch from API later
      const existingMessages = messagesMapRef.current.get(newChatId) || [];
      setActiveChatId(newChatId);

      // If already has cached messages and not forcing refresh, use cache
      if (existingMessages.length > 0 && !forceRefresh) {
        return;
      }

      // Load messages asynchronously without blocking UI
      (async () => {
        try {
          const response = await fetch(`/api/chat/${newChatId}/messages`);
          // 404 means new conversation has no history, this is normal
          if (response.status === 404) {
            // Keep empty, do not store in map
            return;
          }
          if (!response.ok) {
            console.error(
              "[switchChatId] Failed to fetch messages:",
              response.status,
            );
            return;
          }
          const data = await response.json();
          const uiMessages = data.messages || [];
          // Store fetched messages in map
          setMessagesMap((prev) => {
            const newMap = new Map(prev);
            newMap.set(newChatId, uiMessages);
            return newMap;
          });
        } catch (error) {
          console.error("[switchChatId] Failed to switch chat:", error);
        }
      })();
    },
    [],
  );

  const contextValue = useMemo<ChatContextValue>(() => {
    return {
      activeChatId,
      setActiveChatId,
      messages,
      setMessages,
      sendMessage,
      setSendMessage,
      confirmLifestyleImageGeneration,
      declineLifestyleImageGeneration,
      stop,
      // Per-chat states
      isAgentRunning: currentSessionState.isAgentRunning,
      focusedInsights: currentSessionState.focusedInsights,
      setIsAgentRunning: setIsAgentRunningFn,
      setFocusedInsight: setFocusedInsightFn,
      setFocusedInsightForChat: setFocusedInsightForChatFn,
      removeFocusedInsight: removeFocusedInsightFn,
      clearFocusedInsights: clearFocusedInsightsFn,
      toggleFocusedInsight: toggleFocusedInsightFn,
      // Insight drawer
      selectedInsight,
      setSelectedInsight,
      isInsightDrawerOpen,
      setIsInsightDrawerOpen,
      toggleInsightDrawer,
      // File preview
      previewFile,
      openFilePreviewPanel,
      closeFilePreviewPanel,
      // Vault
      isVaultOpen,
      setVaultOpen: setIsVaultOpen,
      // Switch chat
      switchChatId,
      // Sending lock
      isSending,
      // Get all chat session states
      getChatSessionStates: () => chatSessionStates,
      // Get isAgentRunning for a specific chatId
      getIsAgentRunningByChatId,
    };
  }, [
    activeChatId,
    messages,
    currentSessionState,
    chatSessionStates,
    setIsAgentRunningFn,
    setFocusedInsightFn,
    removeFocusedInsightFn,
    clearFocusedInsightsFn,
    toggleFocusedInsightFn,
    selectedInsight,
    isInsightDrawerOpen,
    toggleInsightDrawer,
    previewFile,
    openFilePreviewPanel,
    closeFilePreviewPanel,
    isVaultOpen,
    switchChatId,
    isSending,
    getIsAgentRunningByChatId,
    confirmLifestyleImageGeneration,
    declineLifestyleImageGeneration,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
