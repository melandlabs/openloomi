"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import type { ChatMessage } from "@openloomi/shared";
import { useIntegrations } from "@/hooks/use-integrations";
import { toast } from "sonner";
import { AccountSelector } from "@/components/account-selector";
import { Spinner } from "@/components/spinner";
import { RichTextEditor } from "@/components/rich-text-editor-dynamic";
import type { UserContact } from "@/components/insight-detail-footer";

export interface MessageForwardPanelProps {
  message: ChatMessage;
  onClose: () => void;
}

/**
 * Remove citation markers ^[...]^ from message text
 */
function removeCitations(text: string): string {
  return text.replace(/\^\[([^\]]+)\]\^/g, "");
}

/**
 * Convert HTML to plain text (for API compatibility)
 */
function htmlToPlainText(html: string): string {
  // Create a temporary div element to parse HTML
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // Handle line breaks
  tmp.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  tmp.querySelectorAll("p").forEach((p) => {
    p.after("\n\n");
  });
  tmp.querySelectorAll("li").forEach((li) => {
    li.after("\n");
  });

  // Get text content and clean up extra whitespace
  return tmp.textContent || tmp.innerText || "";
}

/**
 * Convert markdown to simple HTML
 * Handles basic markdown formats: bold, italic, links, lists, code, etc.
 */
function markdownToSimpleHtml(text: string): string {
  if (!text) return "";

  // Clear citation markers
  let clean = removeCitations(text);

  // HTML escape
  const escapeHtml = (input: string): string =>
    input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  clean = escapeHtml(clean);

  // Handle code blocks ```code```
  clean = clean.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    "<pre><code>$2</code></pre>",
  );

  // Handle inline code `code`
  clean = clean.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Handle bold **text** or __text__
  clean = clean.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  clean = clean.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Handle italic *text* or _text_
  clean = clean.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  clean = clean.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Handle links [text](url)
  clean = clean.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Handle unordered lists
  clean = clean.replace(/^[\s]*[-*]\s+(.*)$/gm, "<li>$1</li>");
  clean = clean.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Handle ordered lists
  clean = clean.replace(/^[\s]*\d+\.\s+(.*)$/gm, "<li>$1</li>");
  clean = clean.replace(/(<li>.*<\/li>\n?)+/g, "<ol>$&</ol>");

  // Handle blockquote > text
  clean = clean.replace(/^>\s+(.*)$/gm, "<blockquote>$1</blockquote>");

  // Handle headings
  clean = clean.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
  clean = clean.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
  clean = clean.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

  // Handle line breaks and paragraphs
  const paragraphs = clean.split(/\n{2,}/);
  return paragraphs
    .map((paragraph) => {
      const withBreaks = paragraph.replace(/\n/g, "<br />");
      return withBreaks.trim().length > 0 ? `<p>${withBreaks}</p>` : "";
    })
    .filter((p) => p.length > 0)
    .join("");
}

/**
 * Extract and convert message content to HTML
 */
function extractMessageContent(message: ChatMessage): string {
  const text =
    message.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim() || "";

  return markdownToSimpleHtml(text);
}

/**
 * Message Forward Panel Component
 * Allows users to forward messages from the chat panel to connected channels (email, Telegram, etc.)
 * Supports contact search and rich text editing
 */
export function MessageForwardPanel({
  message,
  onClose,
}: MessageForwardPanelProps) {
  const { t } = useTranslation();
  const { accounts } = useIntegrations();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    () =>
      accounts.find((a) => a.platform === "telegram")?.id ??
      accounts[0]?.id ??
      null,
  );
  const [recipients, setRecipients] = useState<
    Array<{ name: string; id: string }>
  >([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [forwardContent, setForwardContent] = useState(() =>
    extractMessageContent(message),
  );
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Contact search related state
  const [contacts, setContacts] = useState<UserContact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<UserContact[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isLoadingContacts, setIsLoadingContacts] = useState<boolean>(false);
  const [showContactsList, setShowContactsList] = useState<boolean>(false);

  // Get currently selected account
  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  // Current platform
  const currentPlatform = currentAccount?.platform ?? null;

  // Load contact list
  const loadContacts = useCallback(async () => {
    if (!currentPlatform) return;
    setIsLoadingContacts(true);
    try {
      const url = new URL("/api/bot/contact", window.location.origin);
      url.searchParams.set("platform", currentPlatform);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as {
        contacts: UserContact[];
      };
      setContacts(data.contacts ?? []);
      setFilteredContacts(data.contacts ?? []);
    } catch (error) {
      console.error("Failed to fetch contacts", error);
      // Don't show toast since it's silent loading
    } finally {
      setIsLoadingContacts(false);
    }
  }, [currentPlatform]);

  // Load contacts when platform changes
  useEffect(() => {
    if (currentPlatform) {
      void loadContacts();
    }
  }, [currentPlatform, loadContacts]);

  // Search contacts
  useEffect(() => {
    if (!searchQuery) {
      setFilteredContacts(contacts);
      return;
    }
    const lowerQuery = searchQuery.toLowerCase();
    const matchedContacts = contacts.filter((contact) =>
      contact.contactName.toLowerCase().includes(lowerQuery),
    );
    const exactMatches = matchedContacts.filter(
      (contact) => contact.contactName.toLowerCase() === lowerQuery,
    );
    const partialMatches = matchedContacts.filter(
      (contact) => contact.contactName.toLowerCase() !== lowerQuery,
    );
    setFilteredContacts([...exactMatches, ...partialMatches]);
  }, [contacts, searchQuery]);

  // Handle adding recipient
  const handleAddRecipient = useCallback(
    (contactName: string, contactId?: string) => {
      const trimmed = contactName.trim();
      if (!trimmed) return;

      // Deduplicate by contactName and contactId
      const id = contactId || trimmed;
      const exists = recipients.some((r) => r.id === id || r.name === trimmed);

      if (exists) {
        toast.error(
          t("message.forward.recipientAlreadyAdded", "Recipient already added"),
        );
        return;
      }

      setRecipients((prev) => [...prev, { name: trimmed, id }]);
      setRecipientInput("");
      setSearchQuery("");
      setShowContactsList(false);
      setSendSuccess(false);
    },
    [recipients, t],
  );

  // Handle removing recipient
  const handleRemoveRecipient = useCallback((recipientId: string) => {
    setRecipients((prev) => prev.filter((item) => item.id !== recipientId));
    setSendSuccess(false);
  }, []);

  // Handle input change
  const handleInputChange = useCallback((value: string) => {
    setRecipientInput(value);
    setSearchQuery(value);
    setShowContactsList(value.length > 0);
  }, []);

  // Handle send
  const handleSend = useCallback(async () => {
    // Validate forward content
    if (!forwardContent.trim()) {
      toast.error(
        t("message.forward.enterContent", "Please enter message content"),
      );
      return;
    }

    // Validate recipients
    if (recipients.length === 0) {
      toast.error(
        t("message.forward.addRecipient", "Please add at least one recipient"),
      );
      return;
    }

    // Validate account
    if (!currentAccount?.bot) {
      toast.error(
        t("message.forward.selectAccount", "Please select an account"),
      );
      return;
    }

    setIsSending(true);

    try {
      const plainText = htmlToPlainText(forwardContent);
      const recipientNames = recipients.map((r) => r.name);

      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          botId: currentAccount?.bot?.id,
          recipients: recipientNames,
          message: plainText,
          messageHtml: forwardContent,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send message");
      }

      if (result.success) {
        setSendSuccess(true);
        toast.success(
          t("message.forward.success", "Message forwarded successfully"),
        );

        // Delay close so user can see success message
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        toast.error(
          result.error ||
            t("message.forward.failed", "Failed to forward message"),
        );
      }
    } catch (error) {
      console.error("Failed to forward message:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("message.forward.failed", "Failed to forward message"),
      );
    } finally {
      setIsSending(false);
    }
  }, [currentAccount, recipients, forwardContent, onClose, t]);

  // Whether can send
  const canSend = !!(
    currentAccount?.bot &&
    recipients.length > 0 &&
    forwardContent.trim().length > 0
  );

  // Handle Enter to add recipient (but not when selecting from contact list)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // If there are search results and first match, select the first one
        if (filteredContacts.length > 0) {
          const firstContact = filteredContacts[0];
          handleAddRecipient(firstContact.contactName, firstContact.id);
        } else if (recipientInput.trim()) {
          // Manually entered recipient (not in list)
          handleAddRecipient(recipientInput);
        }
      }
      if (e.key === "Escape") {
        setShowContactsList(false);
      }
    },
    [handleAddRecipient, recipientInput, filteredContacts],
  );

  return (
    <div className="rounded-lg border border-border/50 bg-white p-4 shadow-sm w-full max-h-[80vh] flex flex-col">
      {/* Fixed top content */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <RemixIcon name="send_plane" size="size-4" />
          {t("message.forward.title", "Forward Message")}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          onClick={onClose}
        >
          <RemixIcon name="close" size="size-3.5" />
        </Button>
      </div>

      {/* Platform selection */}
      <div className="mb-3">
        <label
          htmlFor="platform-selector"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t("common.platform", "Platform")}
        </label>
        <div id="platform-selector">
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>
      </div>

      {/* Recipient input and search - outside scroll area */}
      <div className="mb-3">
        <label
          htmlFor="recipient-input"
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t("common.recipient", "Recipients")}
        </label>
        <div className="relative">
          <div className="flex flex-wrap gap-2 rounded-md border border-border/50 bg-white/95 p-2">
            {recipients.map((recipient) => (
              <span
                key={recipient.id}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
              >
                {recipient.name}
                <button
                  type="button"
                  className="text-primary/60 transition hover:text-primary"
                  onClick={() => handleRemoveRecipient(recipient.id)}
                >
                  ×
                </button>
              </span>
            ))}
            <div className="relative flex-1 min-w-[200px]">
              <input
                id="recipient-input"
                type="text"
                value={recipientInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (recipientInput.length > 0) {
                    setShowContactsList(true);
                  }
                }}
                placeholder={t(
                  "message.forward.addRecipientPlaceholder",
                  "Type to search or add recipient",
                )}
                className="w-full border-none bg-transparent text-xs outline-none"
                disabled={isSending}
              />
              {showContactsList && (
                <div className="absolute inset-x-0 top-full mt-1 z-10 bg-white border border-border/50 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div className="p-2 border-b border-border/50">
                    <div className="flex items-center gap-2 px-2">
                      <RemixIcon
                        name="search"
                        size="size-3.5"
                        className="text-muted-foreground"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t(
                          "common.searchContacts",
                          "Search contacts...",
                        )}
                        className="flex-1 text-xs outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {isLoadingContacts ? (
                    <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                      <Spinner size={16} />
                      {t("common.loadingContacts", "Loading contacts...")}
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                      {t("common.noContactsFound", "No contacts found")}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {filteredContacts.map((contact) => (
                        <li
                          key={contact.id}
                          className="cursor-pointer bg-white px-3 py-2 text-xs hover:bg-primary/5 flex items-center gap-2"
                          onClick={() => {
                            handleAddRecipient(contact.contactName, contact.id);
                          }}
                        >
                          <div className="flex-1 truncate">
                            {contact.contactName}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content area - only contains forward content */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-4 px-4">
        {/* Forward content - rich text editor */}
        <div className="mb-8">
          <label
            htmlFor="forward-content"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            {t("message.forward.content", "Message")}
          </label>
          <div className="rounded-md border border-border/50 bg-white/95 focus-within:ring-1 focus-within:ring-primary/30">
            <RichTextEditor
              content={forwardContent}
              onChange={setForwardContent}
              placeholder={t(
                "message.forward.contentPlaceholder",
                "Enter message content...",
              )}
              disabled={isSending}
              className="min-h-[120px] max-h-[250px]"
            />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-2 relative z-10 mt-4 pt-4 border-t border-border/50">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={isSending}
        >
          {t("common.cancel", "Cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSend}
          disabled={isSending || sendSuccess}
        >
          {isSending ? (
            <>
              <Spinner size={14} className="mr-1" />
              {t("message.forward.sending", "Sending...")}
            </>
          ) : sendSuccess ? (
            <>
              <RemixIcon name="check" size="size-3.5" />
              {t("message.forward.sent", "Sent")}
            </>
          ) : (
            <>
              <RemixIcon name="send_plane" size="size-3.5" />
              {t("message.forward.send", "Send")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
