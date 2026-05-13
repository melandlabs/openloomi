"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import { PreviewAttachment } from "@/components/preview-attachment";
import type { Attachment } from "@openloomi/shared";
import {
  useIntegrations,
  type IntegrationId,
  type IntegrationAccountClient,
} from "@/hooks/use-integrations";
import { toast } from "sonner";
import { jsonrepair } from "jsonrepair";
import { RemixIcon } from "@/components/remix-icon";
import { EMAIL_REGEX } from "./utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { RichTextEditor } from "@/components/rich-text-editor-dynamic";
import type { SendReplyInput } from "../send-reply";
import {
  htmlToPlainText,
  plainTextToHtml,
  TG_SEND_INVALID_PEER_ID_ERR_MSG,
  type InsightReplyWorkspaceProps,
} from "./";
import { QuickReply } from "./quick-reply";
import { FullReplyHeader } from "./full-reply-header";
import { ReplyOptions } from "./reply-options";
import { ReplyRecipients } from "./reply-recipients";
import { ReplyLanguageTips } from "./reply-language-tips";
import { ReplyTranslationComparison } from "./reply-translation-comparison";
import { ReplyPolishRequest } from "./reply-polish-request";
import { ReplyPolishResult } from "./reply-polish-result";
import { AccountBadgeSelector } from "./account-badge-selector";
import { isDevelopmentEnvironment } from "@/lib/env/constants";
import { useInsightCache } from "@/hooks/use-insight-cache";
import type { DetailData, TimelineData } from "@/lib/ai/subagents/insights";
import {
  useReplyLanguage,
  useReplyContacts,
  useReplyAttachments,
  useReplyAiAssist,
} from "./hooks";

export function ReplyWorkspace({
  insight,
  onExpandedChange,
  initialExpanded = false,
  initialRecipient,
  initialAccountId,
  onGenerateStateChange,
  registerPrependToReplyInput,
}: InsightReplyWorkspaceProps) {
  const { t } = useTranslation();
  const draftContentRef = useRef<string>("");
  const { accounts, groupedByIntegration } = useIntegrations();
  const botAccount = accounts.find((a) => a.bot?.id === insight.botId);
  const defaultAccount = botAccount ?? accounts[0];

  // Get insights pagination context for optimistic updates
  const { addReply: addReplyToCache } = useInsightCache();

  // Use language-related hook
  const {
    targetLanguage,
    setTargetLanguage,
    inferredConversationLanguage,
    hasManualLanguageSelection,
    setHasManualLanguageSelection,
    userLanguagePreference,
    setUserLanguagePreference,
    languageOptions,
    resolveLanguageLabel,
  } = useReplyLanguage({
    insight,
    contextMessages: [],
  });

  // Find account based on initialAccountId or platform
  const getInitialAccountId = useCallback(() => {
    if (initialAccountId) {
      const account = accounts.find((a) => a.id === initialAccountId);
      if (account) return initialAccountId;
    }
    // If no account is specified, try to find a matching account based on the insight's platform
    const detailPlatform = (insight.platform || insight.details?.[0]?.platform)
      ?.toLowerCase()
      ?.trim();
    if (detailPlatform) {
      const normalized = detailPlatform.replace(/\s+/g, "") as IntegrationId;
      const platformAccounts = groupedByIntegration[normalized];
      if (platformAccounts && platformAccounts.length > 0) {
        // Prefer botAccount, otherwise select the first one
        const matchingBotAccount = platformAccounts.find(
          (a) => a.bot?.id === insight.botId,
        );
        return matchingBotAccount?.id ?? platformAccounts[0]?.id ?? null;
      }
    }
    return defaultAccount?.id ?? null;
  }, [
    initialAccountId,
    accounts,
    insight.platform,
    insight.details,
    insight.botId,
    groupedByIntegration,
    defaultAccount,
  ]);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    () => getInitialAccountId(),
  );
  const [draftContent, setDraftContent] = useState<string>("");
  const [userLanguageDraft, setUserLanguageDraft] = useState<string | null>(
    null,
  ); // Reply content in the user's preferred language (for displaying in the tips card)

  const [recipients, setRecipients] = useState<string[]>(() => {
    if (initialRecipient) {
      return [initialRecipient];
    }
    return [];
  });
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [bccRecipients, setBccRecipients] = useState<string[]>([]);
  // Use attachment-related hook
  const {
    attachments,
    uploadQueue,
    handleFileChange,
    processFiles,
    handleRemoveAttachment,
    clearAttachments,
  } = useReplyAttachments();

  // File drag-and-drop state
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  /**
   * Handle drag enter event
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFile(true);
    }
  }, []);

  /**
   * Handle drag leave event
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  /**
   * Handle drag over event
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handle file drop event
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await processFiles(Array.from(files));
      }
    },
    [processFiles],
  );

  /**
   * Handle paste event
   */
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      // Extract files from clipboard
      const files: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Check if it is a file type
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      // If there are files, call the file upload handler
      if (files.length > 0) {
        e.preventDefault();
        await processFiles(files);
      }
    },
    [processFiles],
  );

  // Use contact-related hook
  const currentPlatform = useMemo(() => {
    const currentAccount = selectedAccountId
      ? accounts.find((account) => account.id === selectedAccountId)
      : defaultAccount;
    const detailPlatform = (insight.platform || insight.details?.[0]?.platform)
      ?.toLowerCase()
      ?.trim();
    const normalized = detailPlatform
      ? (detailPlatform.replace(/\s+/g, "") as IntegrationId)
      : null;
    if (
      normalized &&
      groupedByIntegration[normalized as IntegrationId]?.length
    ) {
      return normalized as IntegrationId;
    }
    return currentAccount?.platform ?? null;
  }, [
    accounts,
    selectedAccountId,
    defaultAccount,
    groupedByIntegration,
    insight,
  ]);

  const {
    contacts,
    filteredContacts,
    searchQuery,
    setSearchQuery,
    isLoadingContacts,
    showContactsList,
    setShowContactsList,
    activeRecipientField,
    setActiveRecipientField,
    contactsListRef,
  } = useReplyContacts({ currentPlatform });

  // Get recipient label
  const getRecipientLabel = useCallback(
    (recipient: string) => {
      const matched = contacts.find(
        (contact) => contact.contactName === recipient,
      );
      const email = matched?.contactId;
      if (email && EMAIL_REGEX.test(email)) {
        return `${matched?.contactName} · ${email}`;
      }
      return recipient;
    },
    [contacts],
  );
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  // Used to track locally sent messages to avoid auto-generating AI replies
  const [localSentDetails, setLocalSentDetails] = useState<DetailData[]>([]);
  // Record the previous insight.id, used to detect switching
  const prevInsightIdRef = useRef<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const prevInitialExpandedRef = useRef(initialExpanded);
  const isExternalChangeRef = useRef(false);
  const isClearingRef = useRef(false);

  // Track the failure count and state of auto-generating AI replies, avoid infinite retries
  const autoGenerateFailureCountRef = useRef(0);
  const MAX_AUTO_GENERATE_RETRIES = 3; // Maximum retry count
  const hasAutoGenerateFailedRef = useRef(false);

  // When the externally passed initialExpanded changes, sync internal state
  useEffect(() => {
    if (prevInitialExpandedRef.current !== initialExpanded) {
      isExternalChangeRef.current = true;
      setIsExpanded(initialExpanded);
      prevInitialExpandedRef.current = initialExpanded;
      // Reset flag
      setTimeout(() => {
        isExternalChangeRef.current = false;
      }, 0);
    }
  }, [initialExpanded]);
  const [showCcBccFields, setShowCcBccFields] = useState(false);
  const [lastOriginalDraft, setLastOriginalDraft] = useState<string | null>(
    null,
  );
  const [activeTranslation, setActiveTranslation] = useState<{
    language: string;
    label: string;
    detectedLanguage?: string | null;
    translatedContent?: string; // Translated content (HTML format)
  } | null>(null);
  // Plain text content of the collapsed input (used in collapsed state)
  const [collapsedInputText, setCollapsedInputText] = useState<string>("");

  // When collapsed input content changes, sync to draftContent
  const handleCollapsedInputChange = useCallback((value: string) => {
    setCollapsedInputText(value);
    // Convert plain text to HTML and update draftContent
    const htmlContent = plainTextToHtml(value);
    setDraftContent(htmlContent);
    setSendSuccess(false);
    setSendError(null);
  }, []);

  // When insight switches, clear local sent records and reset failure count
  useEffect(() => {
    if (
      prevInsightIdRef.current !== null &&
      prevInsightIdRef.current !== insight.id
    ) {
      // Insight switched, clear local state
      setLocalSentDetails([]);
      // Reset auto-generate failure count
      autoGenerateFailureCountRef.current = 0;
      hasAutoGenerateFailedRef.current = false;
    }
    prevInsightIdRef.current = insight.id;
  }, [insight.id]);

  // When expand/collapse state changes, sync content and notify parent
  useEffect(() => {
    // If currently clearing content, skip sync logic
    if (isClearingRef.current) {
      // Still need to notify parent of expand state change
      if (!isExternalChangeRef.current) {
        onExpandedChange?.(isExpanded);
      }
      return;
    }
    if (isExpanded) {
      // When expanding: sync the collapsed input text to draftContent (if any)
      if (collapsedInputText) {
        const currentPlainText = htmlToPlainText(draftContent);
        if (currentPlainText !== collapsedInputText) {
          const htmlContent = plainTextToHtml(collapsedInputText);
          setDraftContent(htmlContent);
        }
      }
    } else {
      // When collapsing: sync draftContent to the collapsed input
      const plainText = htmlToPlainText(draftContent);
      setCollapsedInputText(plainText);
    }
    // Only notify parent on non-externally-controlled state changes (i.e., user operations)
    if (!isExternalChangeRef.current) {
      onExpandedChange?.(isExpanded);
    }
  }, [isExpanded, onExpandedChange]); // Only execute when expand state changes

  // When draftContent changes, sync to collapsed input (regardless of expand or collapse state)
  // This ensures AI-generated content is correctly synced to the collapsed input
  useEffect(() => {
    // If currently clearing content, skip sync logic
    if (isClearingRef.current) {
      return;
    }
    const plainText = htmlToPlainText(draftContent);
    // Only update when the converted plain text differs from the current collapsedInputText
    // Avoids triggering unnecessary updates during user manual input
    if (plainText !== collapsedInputText) {
      setCollapsedInputText(plainText);
    }
  }, [draftContent, collapsedInputText]);

  // Sync draftContent to ref, used by "prepend @name to input" feature
  useEffect(() => {
    draftContentRef.current = draftContent;
  }, [draftContent]);

  // Register callback to "prepend @name to reply input", called by the "Reply" button on source message bubbles
  useEffect(() => {
    if (!registerPrependToReplyInput) return;
    const prependToReplyInput = (name: string) => {
      const currentPlain = htmlToPlainText(draftContentRef.current);
      const newPlain = currentPlain.trim()
        ? `@${name}， ${currentPlain}`
        : `@${name}`;
      setDraftContent(plainTextToHtml(newPlain));
      setCollapsedInputText(newPlain);
    };
    registerPrependToReplyInput(prependToReplyInput);
    return () => registerPrependToReplyInput(() => {});
  }, [registerPrependToReplyInput]);

  useEffect(() => {
    if (
      !hasManualLanguageSelection &&
      targetLanguage !== inferredConversationLanguage
    ) {
      setTargetLanguage(inferredConversationLanguage);
    }
  }, [
    hasManualLanguageSelection,
    inferredConversationLanguage,
    targetLanguage,
  ]);

  // Get language preference from user personalization settings
  useEffect(() => {
    const fetchUserLanguagePreference = async () => {
      try {
        const response = await fetch("/api/preferences/insight");
        if (response.ok) {
          const data = (await response.json()) as { language?: string };
          setUserLanguagePreference(data.language || null);
        }
      } catch (error) {
        console.error("Failed to fetch user language preference", error);
      }
    };
    void fetchUserLanguagePreference();
  }, []);

  const normalizeAudienceInput = useCallback((value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    }
    return [];
  }, []);

  /**
   * Apply AI-generated draft
   */
  const applyAiDraft = useCallback(
    (input: SendReplyInput) => {
      const nextDraft = input?.draft ?? "";
      setDraftContent(nextDraft);
      setSendSuccess(false);
      setSendError(null);
      setLastOriginalDraft(null);
      setActiveTranslation(null);
      setHasManualLanguageSelection(false);
    },
    [accounts, normalizeAudienceInput],
  );

  const recipientInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGmail = currentPlatform === "gmail";
  // In local test environment, always show CC and BCC
  const shouldShowCcBcc = isGmail || isDevelopmentEnvironment;
  // CC button display logic: only gmail shows in production, all show in test environment
  const shouldShowCcButton = isGmail || isDevelopmentEnvironment;

  const parseGeneratedReply = useCallback(
    (text: string): SendReplyInput | null => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        try {
          parsed = JSON.parse(jsonrepair(text));
        } catch {
          return null;
        }
      }

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const record = parsed as Record<string, unknown>;
      const draftValue = ["draft", "reply", "message", "content"].reduce<
        string | null
      >((acc, key) => {
        if (acc) return acc;
        const value = record[key];
        return typeof value === "string" && value.trim().length > 0
          ? value
          : null;
      }, null);

      if (!draftValue) {
        return null;
      }

      const recipientsParsed = normalizeAudienceInput(
        (record as { recipients?: unknown }).recipients ??
          (record as { recipient?: unknown }).recipient,
      );
      const ccParsed = normalizeAudienceInput(
        (record as { cc?: unknown }).cc ?? null,
      );
      const bccParsed = normalizeAudienceInput(
        (record as { bcc?: unknown }).bcc ?? null,
      );

      const attachmentsValue = record.attachments;
      const attachmentsParsed = Array.isArray(attachmentsValue)
        ? attachmentsValue.filter((item): item is Attachment => {
            if (!item || typeof item !== "object") return false;
            const candidate = item as Record<string, unknown>;
            return (
              typeof candidate.url === "string" &&
              typeof candidate.name === "string" &&
              typeof candidate.contentType === "string"
            );
          })
        : [];

      const toneValue = record.tone;

      return {
        botId: insight.botId,
        draft: draftValue,
        platform:
          typeof record.platform === "string"
            ? (record.platform as string)
            : (currentPlatform ?? "direct"),
        recipients: recipientsParsed,
        cc: ccParsed,
        bcc: bccParsed,
        attachments: attachmentsParsed,
      } satisfies SendReplyInput;
    },
    [currentPlatform, normalizeAudienceInput],
  );

  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedAccountId !== null) {
        setSelectedAccountId(null);
      }
      return;
    }

    const exists = accounts.some((account) => account.id === selectedAccountId);
    if (!exists && defaultAccount) {
      setSelectedAccountId(defaultAccount.id);
    }
  }, [accounts, selectedAccountId]);

  // When initialRecipient or initialAccountId changes, update state and clear existing text
  useEffect(() => {
    if (initialRecipient) {
      setRecipients([initialRecipient]);
      // Set clearing flag to prevent other useEffect from restoring content
      isClearingRef.current = true;
      // Clear existing text content (including collapsed input)
      setDraftContent("");
      setCollapsedInputText("");
      setUserLanguageDraft(null);
      setLastOriginalDraft(null);
      setActiveTranslation(null);
      // Reset the flag in the next event loop
      setTimeout(() => {
        isClearingRef.current = false;
      }, 0);
    } else {
      const fallbackRecipients =
        insight.groups.length > 0
          ? [insight.groups[0]]
          : insight.people.length > 0
            ? [insight.people[0]]
            : [];
      setRecipients(fallbackRecipients);
    }
  }, [initialRecipient, insight.groups, insight.people]);

  useEffect(() => {
    if (initialAccountId) {
      const account = accounts.find((a) => a.id === initialAccountId);
      if (account) {
        setSelectedAccountId(initialAccountId);
      }
    } else {
      const newAccountId = getInitialAccountId();
      if (newAccountId !== selectedAccountId) {
        setSelectedAccountId(newAccountId);
      }
    }
  }, [initialAccountId, accounts, getInitialAccountId, selectedAccountId]);

  // When insight changes, reset some states (but keep initialRecipient and initialAccountId)
  useEffect(() => {
    if (!initialRecipient) {
      setCcRecipients([]);
      setBccRecipients([]);
      setLastOriginalDraft(null);
      setActiveTranslation(null);
      setHasManualLanguageSelection(false);
    }
  }, [insight.id, initialRecipient]);

  // Handle click outside to close contacts list
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInInput =
        recipientInputRef.current?.contains(target) ||
        ccInputRef.current?.contains(target) ||
        bccInputRef.current?.contains(target);
      const isInList = contactsListRef.current?.contains(target);
      if (!isInInput && !isInList) {
        setShowContactsList(false);
        setActiveRecipientField(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowContactsList, setActiveRecipientField]);

  const handleAddRecipient = useCallback(
    (recipient: string, field: "to" | "cc" | "bcc" = "to") => {
      const trimmed = recipient.trim();
      if (!trimmed) return;
      const setter =
        field === "to"
          ? setRecipients
          : field === "cc"
            ? setCcRecipients
            : setBccRecipients;
      setter((prev) => {
        if (prev.includes(trimmed)) return prev;
        return [...prev, trimmed];
      });
      setSendError(null);
      setSendSuccess(false);
    },
    [],
  );

  const handleRemoveRecipient = useCallback(
    (recipient: string, field: "to" | "cc" | "bcc" = "to") => {
      const setter =
        field === "to"
          ? setRecipients
          : field === "cc"
            ? setCcRecipients
            : setBccRecipients;
      setter((prev) => prev.filter((item) => item !== recipient));
      setSendSuccess(false);
    },
    [],
  );

  const canSendOriginal = useMemo(() => {
    if (!currentPlatform) return false;
    if (isSending || uploadQueue.length > 0) return false;
    // Basic check for HTML content being empty or just empty paragraph
    const stripped = htmlToPlainText(draftContent);
    if (stripped.length === 0 && attachments.length === 0) {
      return false;
    }
    return recipients.length > 0;
  }, [
    attachments.length,
    currentPlatform,
    draftContent,
    isSending,
    recipients.length,
    uploadQueue.length,
  ]);

  const handleSend = useCallback(async () => {
    if (!currentPlatform) {
      toast.error(
        t("common.missingPlatform", "Select an account to send from."),
      );
      return;
    }

    if (uploadQueue.length > 0) {
      toast.error(
        t(
          "insight.sendWhileUploading",
          "Wait for uploads to finish before sending.",
        ),
      );
      return;
    }

    const contentToSend = draftContent ?? "";
    const strippedContent = htmlToPlainText(contentToSend);

    if (
      recipients.length === 0 ||
      (strippedContent.length === 0 && attachments.length === 0)
    ) {
      return;
    }

    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);

    const requestBody = {
      botId: insight.botId,
      recipients: recipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
      message: strippedContent,
      messageHtml: contentToSend,
      attachments:
        attachments.length > 0
          ? attachments.map((item) => ({
              url: item.url,
              name: item.name,
              contentType: item.contentType,
              sizeBytes: item.sizeBytes,
              blobPath: item.blobPath,
              downloadUrl: item.downloadUrl,
            }))
          : undefined,
    };
    const totalRecipients =
      requestBody.recipients.length +
      (requestBody.cc?.length ?? 0) +
      (requestBody.bcc?.length ?? 0);

    try {
      const response = await fetch("/api/bot/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();
      if (!response.ok) {
        const errorMessage =
          typeof result?.message === "string"
            ? result.message
            : t("common.sendFailedUnknownReason");
        throw new Error(errorMessage);
      }

      setIsSending(false);
      setSendSuccess(true);

      // Optimistically update insight: update details and timeline in both mock mode and normal success
      if (result.mock || result.success) {
        const currentTime = Date.now();

        // Get the currently selected account info
        const currentAccount = selectedAccountId
          ? accounts.find((account) => account.id === selectedAccountId)
          : defaultAccount;

        // Use account display name or bot name as the sender
        const senderName =
          currentAccount?.displayName || currentAccount?.bot?.name || "Me";

        const newDetail: DetailData = {
          time: currentTime,
          person: senderName,
          platform: currentPlatform,
          channel: recipients[0] || undefined,
          content: strippedContent,
        };

        // Generate different timeline summary based on the current language
        const summaryPrefix = t("insight.youReplied", "You replied");
        const contentPreview =
          strippedContent.slice(0, 50) +
          (strippedContent.length > 50 ? "..." : "");
        const newTimelineItem: TimelineData = {
          time: currentTime,
          label: "💬",
          summary: `${summaryPrefix}: ${contentPreview}`,
        };

        // Check if the recipient has changed
        // Only update the current insight's history when sending to the original insight's recipients
        const originalRecipients = [
          ...(insight.groups || []),
          ...(insight.people || []),
        ];
        const isReplyingToOriginalRecipients = recipients.some((recipient) =>
          originalRecipients.includes(recipient),
        );

        // 1. Only perform frontend optimistic update when replying to original recipients
        if (isReplyingToOriginalRecipients) {
          // Update local sent records to prevent auto AI generation
          setLocalSentDetails((prev) => [...prev, newDetail]);

          // Update all panel insights using global cache (including list and detail page)
          addReplyToCache(insight.id, newDetail, newTimelineItem);

          // Dispatch event to notify drawer to update local state (for source page to immediately display new message)
          window.dispatchEvent(
            new CustomEvent("insight:replySent", {
              detail: {
                insightId: insight.id,
                detail: newDetail,
                timeline: newTimelineItem,
              },
            }),
          );

          // 2. Asynchronously call backend API for persistent update (does not block user operations)
          fetch(`/api/insights/${insight.id}/reply`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              detail: newDetail,
              timeline: newTimelineItem,
            }),
          })
            .then((updateResponse) => {
              if (!updateResponse.ok) {
                // If backend update fails, roll back frontend update (reload data)
                // SWR will automatically revalidate
              }
            })
            .catch((error) => {
              // If network error, roll back frontend update
              // SWR will automatically revalidate
            });
        }
        // If the recipient changed, do not update the current insight's history
        // New chat will automatically create a new insight in the background if needed
      }

      toast.success(
        result.mock
          ? t(
              "insight.replySentSuccessMock",
              "Reply sent successfully (mock mode).",
            )
          : t("insight.replySentSuccess", "Reply sent successfully."),
      );
      setDraftContent("");
      setUserLanguageDraft(null); // Clear user preferred language hint
      clearAttachments(); // Clear all attachments
      setSendError(null);
      setLastOriginalDraft(null);
      setActiveTranslation(null);
      setHasManualLanguageSelection(false);
    } catch (error) {
      let errorMessage =
        error instanceof Error ? error.message : t("common.sendErrorGeneric");
      if (errorMessage.includes(TG_SEND_INVALID_PEER_ID_ERR_MSG)) {
        errorMessage = t("common.sendErrorCannotFindInputEntity");
      }
      setIsSending(false);
      setSendError(errorMessage);
      toast.error(
        t("insight.replySentFailed", "We couldn't send that reply."),
        {
          description: errorMessage,
        },
      );
    }
  }, [
    attachments,
    bccRecipients,
    ccRecipients,
    currentPlatform,
    draftContent,
    recipients,
    t,
    uploadQueue.length,
  ]);

  // Use AI assist-related hook
  const {
    generateLoading,
    polishLoading,
    pendingTask,
    replyOptions,
    selectedOptionId,
    handleAssistGenerate,
    handleAssistPolish,
    handleConfirmPolishRequest,
    handleCancelPolishRequest,
    showPolishRequest,
    setShowPolishRequest,
    handleTranslate,
    handleOptionSelect,
    handleOptionDeselect,
  } = useReplyAiAssist({
    insight,
    draftContent,
    setDraftContent,
    setUserLanguageDraft,
    setIsExpanded,
    inferredConversationLanguage,
    userLanguagePreference,
    targetLanguage,
    setTargetLanguage,
    resolveLanguageLabel,
    setHasManualLanguageSelection,
    lastOriginalDraft,
    setLastOriginalDraft,
    activeTranslation,
    setActiveTranslation,
    setIsTranslating,
    autoGenerateFailureCountRef,
    hasAutoGenerateFailedRef,
    maxRetries: MAX_AUTO_GENERATE_RETRIES,
  });

  /**
   * Save the original draft when showing the polish request input
   */
  useEffect(() => {
    if (showPolishRequest && !lastOriginalDraft) {
      setLastOriginalDraft(draftContent);
    }
  }, [showPolishRequest, draftContent, lastOriginalDraft]);

  /**
   * Notify parent component of generation state changes
   */
  useEffect(() => {
    onGenerateStateChange?.({
      isLoading: generateLoading,
      hasOptions: replyOptions.length > 0,
    });
  }, [generateLoading, replyOptions.length, onGenerateStateChange]);

  /**
   * Determine if the last message was sent by "self"
   * By comparing the person of the last detail with the current account's display name
   * Also considers locally sent messages (not yet synced to insight.details)
   */
  const isLastMessageFromSelf = useMemo(() => {
    // If there are locally sent messages, consider the last one as sent by self
    if (localSentDetails.length > 0) {
      return true;
    }

    const details = insight.details;
    if (!details || details.length === 0) return false;

    // Get the last message
    const lastDetail = details[details.length - 1];
    if (!lastDetail?.person) return false;

    // Get current account info
    const currentAccount = selectedAccountId
      ? accounts.find((account) => account.id === selectedAccountId)
      : defaultAccount;

    // Possible "self" identifier list
    const selfIdentifiers = [
      currentAccount?.displayName,
      currentAccount?.bot?.name,
      "Me", // Default sender name
    ].filter(Boolean) as string[];

    // Check if the sender of the last message is "self"
    return selfIdentifiers.some(
      (identifier) =>
        lastDetail.person?.toLowerCase() === identifier.toLowerCase(),
    );
  }, [
    insight.details,
    selectedAccountId,
    accounts,
    defaultAccount,
    localSentDetails,
  ]);

  /**
   * Auto-generate reply: when opening Insight detail, automatically start generating reply
   * If the last message was sent by self, do not auto-generate AI content
   * Limit retry count to avoid infinite retries
   */
  useEffect(() => {
    const shouldAutoGenerate = true;

    // If already failed and exceeded retry limit, do not auto-generate
    if (
      hasAutoGenerateFailedRef.current &&
      autoGenerateFailureCountRef.current >= MAX_AUTO_GENERATE_RETRIES
    ) {
      console.log(
        `[AutoGenerate] Retry limit reached (${MAX_AUTO_GENERATE_RETRIES} times), stopping auto-generation`,
      );
      return;
    }

    // Check if there is already draft content (if so, generation has already been done)
    if (draftContent.trim().length > 0) {
      return;
    }

    // If the last message was sent by self, do not auto-generate AI content
    if (isLastMessageFromSelf) {
      return;
    }

    // Check each condition in detail
    const checkResult = {
      insightId: insight.id,
      shouldAutoGenerate,
      pendingTask: pendingTask ?? "none",
      draftContentLength: draftContent.trim().length,
      generateLoading,
      isLastMessageFromSelf,
      failureCount: autoGenerateFailureCountRef.current,
      maxRetries: MAX_AUTO_GENERATE_RETRIES,
      // Which conditions failed
      failedConditions: [] as string[],
    };

    if (pendingTask !== null)
      checkResult.failedConditions.push("pendingTask !== null");
    if (draftContent.trim().length > 0)
      checkResult.failedConditions.push("hasDraftContent");
    if (generateLoading) checkResult.failedConditions.push("generateLoading");
    if (!shouldAutoGenerate)
      checkResult.failedConditions.push("!shouldAutoGenerate");
    if (isLastMessageFromSelf)
      checkResult.failedConditions.push("isLastMessageFromSelf");

    // Check conditions: no ongoing tasks, no draft content
    if (
      pendingTask !== null ||
      draftContent.trim().length > 0 ||
      generateLoading ||
      !shouldAutoGenerate
    ) {
      return;
    }

    // Delay slightly to ensure component is fully loaded
    const timeoutId = setTimeout(() => {
      void handleAssistGenerate();
    }, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    insight.id,
    pendingTask,
    draftContent,
    generateLoading,
    isLastMessageFromSelf,
    handleAssistGenerate,
  ]);

  /**
   * Confirm translation (apply translated content to rich text box, clear comparison card)
   */
  const handleConfirmTranslation = useCallback(() => {
    // Set the translated content in the rich text box
    if (activeTranslation?.translatedContent) {
      setDraftContent(activeTranslation.translatedContent);
    }
    setLastOriginalDraft(null);
    setActiveTranslation(null);
    setSendSuccess(false);
    setSendError(null);
  }, [
    activeTranslation,
    setDraftContent,
    setLastOriginalDraft,
    setActiveTranslation,
    setSendSuccess,
    setSendError,
  ]);

  /**
   * Undo translation (restore original text, clear comparison card)
   */
  const handleUndoTranslation = useCallback(() => {
    if (lastOriginalDraft === null) return;
    setDraftContent(lastOriginalDraft);
    setLastOriginalDraft(null);
    setActiveTranslation(null);
    setSendSuccess(false);
    setSendError(null);
    setHasManualLanguageSelection(false);
    setTargetLanguage(inferredConversationLanguage);
  }, [
    inferredConversationLanguage,
    lastOriginalDraft,
    setDraftContent,
    setLastOriginalDraft,
    setActiveTranslation,
    setSendSuccess,
    setSendError,
    setHasManualLanguageSelection,
    setTargetLanguage,
  ]);

  /**
   * Confirm polish (apply polished content to rich text box, clear result card)
   */
  const handleConfirmPolish = useCallback(() => {
    // Set the polished content in the rich text box
    if (
      activeTranslation?.translatedContent &&
      activeTranslation.language === "polish"
    ) {
      setDraftContent(activeTranslation.translatedContent);
    }
    setLastOriginalDraft(null);
    setActiveTranslation(null);
    setShowPolishRequest(false); // Hide input after confirmation
    setSendSuccess(false);
    setSendError(null);
  }, [
    activeTranslation,
    setDraftContent,
    setLastOriginalDraft,
    setActiveTranslation,
    setShowPolishRequest,
    setSendSuccess,
    setSendError,
  ]);

  /**
   * Undo polish (restore original text, clear result card)
   */
  const handleUndoPolish = useCallback(() => {
    if (lastOriginalDraft === null) return;
    setDraftContent(lastOriginalDraft);
    setLastOriginalDraft(null);
    setActiveTranslation(null);
    setShowPolishRequest(false); // Hide input after undo
    setSendSuccess(false);
    setSendError(null);
  }, [
    lastOriginalDraft,
    setDraftContent,
    setLastOriginalDraft,
    setActiveTranslation,
    setShowPolishRequest,
    setSendSuccess,
    setSendError,
  ]);

  const isUploading = uploadQueue.length > 0;

  /**
   * Polish button - AI-optimize the current draft
   */
  const polishButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-5 w-5 p-0 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={polishLoading || htmlToPlainText(draftContent).length === 0}
          onClick={handleAssistPolish}
          aria-label={t("insight.aiAssistPolish", "AI Polish")}
        >
          {polishLoading ? (
            <Spinner size={12} />
          ) : (
            // Use the specified RemixIcon class (avoids icon inconsistency from RemixIcon name mapping)
            <i className="ri-ai size-3 text-sm inline-flex items-center justify-center shrink-0 leading-none" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t("insight.aiAssistPolish", "AI Polish")}</p>
      </TooltipContent>
    </Tooltip>
  );

  /**
   * Generate button - generate reply or regenerate reply
   */
  const generateButton = useMemo(() => {
    const hasContent = htmlToPlainText(draftContent).length > 0;
    const labelKey = hasContent
      ? "insight.aiAssistRegenerate"
      : "insight.aiAssistGenerate";
    const defaultLabel = hasContent ? "Regenerate Reply" : "Generate Reply";

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center h-5 w-5 p-0 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={generateLoading}
            onClick={handleAssistGenerate}
            aria-label={t(labelKey, defaultLabel)}
          >
            {generateLoading ? (
              <Spinner size={12} />
            ) : (
              <i className="ri-quill-pen-ai-line size-3 text-sm inline-flex items-center justify-center shrink-0 leading-none" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t(labelKey, defaultLabel)}</p>
        </TooltipContent>
      </Tooltip>
    );
  }, [draftContent, generateLoading, handleAssistGenerate, t]);

  const translatePreviewControl = useMemo(() => {
    const disabled =
      isSending ||
      isTranslating ||
      htmlToPlainText(draftContent).length === 0 ||
      uploadQueue.length > 0;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center h-5 w-5 p-0 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={disabled}
                aria-label={`${t("insight.translateButton", "AI Translate")} · ${resolveLanguageLabel(targetLanguage)}`}
              >
                {isTranslating ? (
                  <Spinner size={12} />
                ) : (
                  <i className="ri-translate-ai size-3 text-sm inline-flex items-center justify-center shrink-0 leading-none" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {languageOptions.map((option) => (
                <DropdownMenuItem
                  key={option.code}
                  onClick={() => {
                    void handleTranslate(option.code);
                  }}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{option.label}</span>
                  {option.code === targetLanguage ? (
                    <RemixIcon
                      name="check"
                      size="size-3.5"
                      className="text-primary"
                    />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("insight.translateButton", "AI Translate")}</p>
        </TooltipContent>
      </Tooltip>
    );
  }, [
    draftContent,
    handleTranslate,
    isSending,
    isTranslating,
    languageOptions,
    resolveLanguageLabel,
    targetLanguage,
    t,
    uploadQueue.length,
  ]);

  /** Whether the current Insight has only one channel (for source tab: hide "Reply to xxx" input when single channel) */
  const singleChannel = (insight.details?.length ?? 0) <= 1;

  // Get plain text from HTML content for the collapsed input
  const collapsedTextValue = useMemo(() => {
    if (!isExpanded) {
      // Collapsed state: prefer collapsedInputText, if not available convert from draftContent
      if (collapsedInputText) {
        return collapsedInputText;
      }
      return htmlToPlainText(draftContent);
    }
    // Expanded state: convert from draftContent
    return htmlToPlainText(draftContent);
  }, [isExpanded, collapsedInputText, draftContent]);

  return (
    <div
      className="bg-white w-full overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label={t("chat.fileDropArea", "File drop area")}
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* File drag hint layer */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 text-primary">
            <div className="p-4 rounded-full bg-primary/20">
              <RemixIcon name="attachment" size="size-8" />
            </div>
            <div className="text-lg font-semibold">
              {t("chat.dropFilesHere", "Drop files here")}
            </div>
            <div className="text-sm opacity-80">
              {t(
                "chat.supportedFileTypes",
                "Images and documents (PDF, DOC, PPT, TXT)",
              )}
            </div>
          </div>
        </div>
      )}
      {!isExpanded ? (
        <QuickReply
          value={collapsedTextValue}
          onChange={handleCollapsedInputChange}
          onSend={() => void handleSend()}
          onExpand={() => setIsExpanded(true)}
          canSend={canSendOriginal}
          isSending={isSending}
          isUploading={isUploading}
          sendSuccess={sendSuccess}
          sendError={sendError}
          recipients={recipients}
          getRecipientLabel={getRecipientLabel}
          onRemoveRecipient={(recipient) =>
            handleRemoveRecipient(recipient, "to")
          }
          isGenerating={generateLoading}
          onAddRecipient={(recipient) => handleAddRecipient(recipient, "to")}
          inputRef={recipientInputRef}
          contactsListRef={contactsListRef}
          showContactsList={showContactsList && activeRecipientField === "to"}
          setShowContactsList={setShowContactsList}
          setActiveRecipientField={setActiveRecipientField}
          contacts={contacts}
          filteredContacts={filteredContacts}
          isLoadingContacts={isLoadingContacts}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          replyOptions={replyOptions}
          selectedOptionId={selectedOptionId}
          onSelectReplyOption={(option) =>
            handleOptionSelect(option, userLanguageDraft)
          }
          onDeselectReplyOption={() => {
            isClearingRef.current = true;
            handleOptionDeselect();
            setCollapsedInputText("");
            setTimeout(() => {
              isClearingRef.current = false;
            }, 0);
          }}
          showRecipientRow={!singleChannel}
        />
      ) : (
        <>
          <FullReplyHeader
            onCollapse={() => setIsExpanded(false)}
            sendSuccess={sendSuccess}
            sendError={sendError}
            recipientInput={
              <ReplyRecipients
                label={t("common.recipient")}
                recipients={recipients}
                onAdd={(recipient) => handleAddRecipient(recipient, "to")}
                onRemove={(recipient) => handleRemoveRecipient(recipient, "to")}
                placeholder={t(
                  "common.selectRecipientMulti",
                  "Select recipients (multiple allowed)",
                )}
                inputRef={recipientInputRef}
                contactsListRef={contactsListRef}
                showContactsList={
                  showContactsList && activeRecipientField === "to"
                }
                setShowContactsList={setShowContactsList}
                setActiveRecipientField={setActiveRecipientField}
                fieldType="to"
                contacts={contacts}
                filteredContacts={filteredContacts}
                isLoadingContacts={isLoadingContacts}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                getRecipientLabel={getRecipientLabel}
                hideLabel={true}
                showReplyLabel={true}
              />
            }
            ccButton={
              shouldShowCcButton ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCcBccFields(!showCcBccFields)}
                  className="h-7 text-xs"
                >
                  {t("common.cc", "CC")}
                </Button>
              ) : undefined
            }
            accountSelector={
              <AccountBadgeSelector
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                platforms={
                  Object.entries(groupedByIntegration)
                    .filter(
                      (entry): entry is [string, IntegrationAccountClient[]] =>
                        Array.isArray(entry[1]) && entry[1].length > 0,
                    )
                    .map(([platform]) => platform as IntegrationId)
                    .filter((platform) => platform === currentPlatform) ??
                  undefined
                }
                botId={insight.botId}
              />
            }
          />
        </>
      )}

      {isExpanded ? (
        <div className="flex flex-col gap-2 pt-2 pb-0 max-h-[50vh] overflow-y-auto box-border reply-container lg:max-h-[62vh] w-full">
          {/* Recipient recent messages card - displayed below the recipient selection component */}
          {/* {(recipients.length > 0 ||
              ccRecipients.length > 0 ||
              bccRecipients.length > 0) && (
              <div className="p-0">
                <RecipientRecentMessages
                  insight={insight}
                  recipients={[
                    ...recipients,
                    ...ccRecipients,
                    ...bccRecipients,
                  ]}
                  getRecipientLabel={getRecipientLabel}
                />
              </div>
            )} */}
          {/* CC */}
          {shouldShowCcBcc && showCcBccFields && (
            <ReplyRecipients
              key="cc-recipients"
              label={t("common.cc", "CC")}
              recipients={ccRecipients}
              onAdd={(recipient) => handleAddRecipient(recipient, "cc")}
              onRemove={(recipient) => handleRemoveRecipient(recipient, "cc")}
              placeholder={t(
                "common.addCcHint",
                "Add CC recipients by typing and pressing Enter",
              )}
              inputRef={ccInputRef}
              contactsListRef={contactsListRef}
              showContactsList={
                showContactsList && activeRecipientField === "cc"
              }
              setShowContactsList={setShowContactsList}
              setActiveRecipientField={setActiveRecipientField}
              fieldType="cc"
              contacts={contacts}
              filteredContacts={filteredContacts}
              isLoadingContacts={isLoadingContacts}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              getRecipientLabel={getRecipientLabel}
            />
          )}

          {/* BCC */}
          {shouldShowCcBcc && showCcBccFields && (
            <ReplyRecipients
              key="bcc-recipients"
              label={t("common.bcc", "BCC")}
              recipients={bccRecipients}
              onAdd={(recipient) => handleAddRecipient(recipient, "bcc")}
              onRemove={(recipient) => handleRemoveRecipient(recipient, "bcc")}
              placeholder={t(
                "common.addBccHint",
                "Add BCC recipients by typing and pressing Enter",
              )}
              inputRef={bccInputRef}
              contactsListRef={contactsListRef}
              showContactsList={
                showContactsList && activeRecipientField === "bcc"
              }
              setShowContactsList={setShowContactsList}
              setActiveRecipientField={setActiveRecipientField}
              fieldType="bcc"
              contacts={contacts}
              filteredContacts={filteredContacts}
              isLoadingContacts={isLoadingContacts}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              getRecipientLabel={getRecipientLabel}
            />
          )}

          {/* Reply options card and tips card container */}
          {replyOptions.length > 0 && (
            <div className="mt-0 flex flex-col space-y-3">
              {/* Reply options card */}
              <ReplyOptions
                options={replyOptions}
                onSelect={(option) =>
                  handleOptionSelect(option, userLanguageDraft)
                }
                selectedOptionId={selectedOptionId}
              />

              {/* User preferred language tips card - displayed below the reply options */}
              {(() => {
                // Calculate the framework_type of the currently selected option
                const selectedOption = selectedOptionId
                  ? replyOptions.find((_, index) => {
                      const optionId = `${replyOptions[index]?.framework_type}-${index}`;
                      return optionId === selectedOptionId;
                    })
                  : null;
                const selectedFrameworkType =
                  selectedOption?.framework_type ?? null;

                // Determine whether to show tips card: only show when target language is inconsistent
                const shouldShowTips =
                  userLanguageDraft &&
                  userLanguagePreference &&
                  targetLanguage &&
                  userLanguagePreference !== targetLanguage;

                return shouldShowTips ? (
                  <ReplyLanguageTips
                    userLanguageDraft={userLanguageDraft}
                    selectedFrameworkType={selectedFrameworkType ?? undefined}
                  />
                ) : null;
              })()}
            </div>
          )}

          <div
            key="rich-text-editor-wrapper"
            className="m-0 w-full overflow-hidden"
          >
            <RichTextEditor
              onPaste={handlePaste}
              content={draftContent}
              onChange={(newContent) => {
                const previousContent = draftContent;
                setDraftContent(newContent);
                setSendSuccess(false);
                setSendError(null);
                // If the user manually edited the content, clear the user preferred language hint (because content changed)
                // But only clear when content truly changed and not initialized from empty content
                if (
                  userLanguageDraft &&
                  previousContent &&
                  previousContent.trim() !== "" &&
                  newContent !== previousContent &&
                  newContent.trim() !== previousContent.trim()
                ) {
                  setUserLanguageDraft(null);
                }
              }}
              placeholder={t(
                "insight.replyTextareaPlaceholder",
                "Type your reply here...",
              )}
              onAttach={() => fileInputRef.current?.click()}
              disabled={isSending || isUploading}
              className="min-h-[120px]"
              toolbarRight={
                <>
                  {translatePreviewControl}
                  {polishButton}
                  {generateButton}
                </>
              }
              sendButton={
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => handleSend()}
                  disabled={!canSendOriginal || isSending}
                  className="h-5 w-5 shrink-0 text-primary hover:text-primary hover:bg-primary/10"
                  aria-label={t("common.send", "Send")}
                >
                  {isSending ? (
                    <Spinner size={12} />
                  ) : (
                    <RemixIcon
                      name="send_plane"
                      size="size-4"
                      className="text-primary"
                    />
                  )}
                </Button>
              }
              statusText={null}
              contentBefore={
                // Prefer showing the result card; if there is a result, show it; otherwise show the input (may be loading state)
                activeTranslation?.translatedContent ? (
                  activeTranslation.language === "polish" ? (
                    <ReplyPolishResult
                      polishedContent={activeTranslation.translatedContent}
                      onConfirm={handleConfirmPolish}
                      onUndo={handleUndoPolish}
                    />
                  ) : lastOriginalDraft ? (
                    <ReplyTranslationComparison
                      translatedContent={activeTranslation.translatedContent}
                      targetLanguageLabel={activeTranslation.label}
                      detectedLanguage={activeTranslation.detectedLanguage}
                      onConfirm={handleConfirmTranslation}
                      onUndo={handleUndoTranslation}
                    />
                  ) : undefined
                ) : showPolishRequest ? (
                  // During polish generation, also show the input card but with loading state
                  <ReplyPolishRequest
                    onConfirm={handleConfirmPolishRequest}
                    onCancel={handleCancelPolishRequest}
                    isLoading={polishLoading}
                  />
                ) : undefined
              }
            />
          </div>

          {attachments.length > 0 || uploadQueue.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div key={attachment.url} className="relative h-16 w-16">
                  <PreviewAttachment
                    attachment={attachment}
                    className="h-full w-full object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                    onClick={() => handleRemoveAttachment(attachment.url)}
                  >
                    <RemixIcon name="close" size="size-3" />
                  </button>
                </div>
              ))}
              {uploadQueue.map((pending) => (
                <div key={pending} className="relative h-16 w-16">
                  <PreviewAttachment
                    attachment={{
                      url: pending,
                      name: pending,
                      contentType: "",
                    }}
                    isUploading
                    className="h-full w-full object-cover rounded-lg"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : null}
    </div>
  );
}
