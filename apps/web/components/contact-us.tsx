import type React from "react";
import { useState, useEffect } from "react";
import { Button, Textarea } from "@openloomi/ui";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { toast } from "./toast";
import { isTauri, openUrl } from "@/lib/tauri";
import { getStoredAuthToken } from "@/lib/auth/remote-client";

type ContactUsPlacement = "floating" | "inline" | "sidebar";

interface ContactUsProps {
  placement?: ContactUsPlacement;
  /** Custom trigger button for sidebar and similar scenarios */
  customTrigger?: React.ReactNode;
  /** Open a specific dialog directly when trigger is clicked. */
  triggerAction?: "feedback" | "email";
  /** Controlled: open as dialog (e.g., from user dropdown menu click "Contact Us") */
  dialogOpen?: boolean;
  /** Controlled: dialog open state change callback */
  onDialogOpenChange?: (open: boolean) => void;
}

export default function ContactUs({
  placement = "floating",
  customTrigger,
  triggerAction,
  dialogOpen,
  onDialogOpenChange,
}: ContactUsProps) {
  const { t } = useTranslation();
  const [showEmailOptions, setShowEmailOptions] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle"); // idle, copied
  const [feedbackContent, setFeedbackContent] = useState("");
  const [contactEmail, setContactEmail] = useState(""); // Optional contact email
  const [wordCount, setWordCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const MAX_WORDS = 500; // Cloud API supports more characters
  const isTauriEnv = isTauri();

  const email = "support@melandlabs.ai";
  const discordLink = "https://discord.gg/xkJaJyWcsv";

  useEffect(() => {
    setWordCount(feedbackContent.length);
  }, [feedbackContent]);

  const handleDiscordClick = () => {
    if (isTauriEnv) {
      openUrl(discordLink);
    } else {
      openUrl(discordLink);
    }
  };

  const handleEmailClick = () => {
    if (isTauriEnv) {
      openUrl(`mailto:${email}?subject=openloomi Suggestions`);
    } else {
      openUrl(`mailto:${email}?subject=openloomi Suggestions`);
    }
    setShowEmailOptions(false);
  };

  const copyEmailToClipboard = () => {
    navigator.clipboard.writeText(email);
    setCopyStatus("copied");

    setTimeout(() => {
      setCopyStatus("idle");
    }, 2000);
  };

  const handleFeedbackChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= MAX_WORDS) {
      setFeedbackContent(e.target.value);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackContent.trim()) {
      toast({
        type: "error",
        description: t("feedback.emptyError"),
      });
      return;
    }

    // Validate email format (if provided)
    if (contactEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        toast({
          type: "error",
          description: t("feedback.invalidEmail"),
        });
        return;
      }
    }

    try {
      setIsSubmitting(true);

      // Build request data
      const requestData: {
        content: string;
        email?: string;
        systemInfo?: {
          platform: string;
          appVersion?: string;
          osVersion?: string;
        };
      } = {
        content: feedbackContent,
      };

      // If contact email is provided, add to request
      if (contactEmail.trim()) {
        requestData.email = contactEmail.trim();
      }

      // Add system info in Tauri environment
      if (isTauriEnv) {
        requestData.systemInfo = {
          platform: "desktop",
          // Can add more system info
          // appVersion: await getAppVersion(),
          // osVersion: await getOSVersion(),
        };
      }

      // Unified call to local API route (supports Web and Tauri)
      // Try to read cloud token from localStorage, include if available
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      const cloudToken = getStoredAuthToken();
      if (cloudToken) {
        headers.Authorization = `Bearer ${cloudToken}`;
      }

      const response = await fetch("/api/remote-feedback", {
        method: "POST",
        headers,
        body: JSON.stringify(requestData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || t("feedback.submitError"));
      }

      toast({
        type: "success",
        description: data.message || t("feedback.submitSuccess"),
      });

      // Reset form
      setFeedbackContent("");
      setContactEmail("");
      setShowFeedbackForm(false);
    } catch (error) {
      console.error("[Contact Us] Failed to submit feedback", error);
      // Show detailed error message
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast({
        type: "error",
        description: `${t("feedback.submitError")}: ${errorMessage}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const containerClass =
    placement === "floating"
      ? "fixed right-4 bottom-6 z-40 md:top-24 md:bottom-auto md:right-6"
      : "relative";

  const triggerClass =
    placement === "floating"
      ? "group size-11 rounded-xl border border-border bg-card text-foreground shadow-sm transition-all duration-200 hover:bg-surface-hover"
      : "h-8 text-xs whitespace-nowrap";

  const contentClass =
    placement === "floating" ? "w-80 p-0 mb-2 mr-2" : "w-80 p-0 mt-2 sm:mt-3";

  /** Only hide HoverCard when in dialog mode (e.g., opened from user menu) */
  const showHoverCard =
    triggerAction === undefined &&
    (customTrigger !== undefined ||
      dialogOpen === undefined ||
      onDialogOpenChange === undefined);

  /**
   * Handle direct trigger actions for feedback/email entry points.
   * This bypasses the Contact Us hover card and opens target dialogs directly.
   */
  const handleDirectTriggerClick = () => {
    if (triggerAction === "feedback") {
      setShowFeedbackForm(true);
      return;
    }
    if (triggerAction === "email") {
      setShowEmailOptions(true);
    }
  };

  /**
   * Render custom trigger with direct-action behavior when configured.
   */
  const renderDirectTrigger = () => {
    if (!triggerAction || !customTrigger) {
      return null;
    }
    return (
      <div onClick={handleDirectTriggerClick} role="button" tabIndex={0}>
        {customTrigger}
      </div>
    );
  };

  return (
    <div className={cn(containerClass)}>
      {renderDirectTrigger()}
      {showHoverCard && (
        <HoverCard>
          <HoverCardTrigger asChild>
            {customTrigger || (
              <Button
                variant={placement === "inline" ? "outline" : "ghost"}
                className={triggerClass}
                size={placement === "floating" ? "icon" : "sm"}
                aria-label={t("common.contactUs")}
              >
                <RemixIcon
                  name="support_agent"
                  size={placement === "floating" ? "size-5" : "size-4"}
                  className={
                    placement === "floating"
                      ? "text-muted-foreground transition-transform duration-200 group-hover:scale-105"
                      : "text-muted-foreground"
                  }
                />
                {placement === "inline" ? (
                  <span className="hidden sm:inline-block">
                    {t("common.contactUs")}
                  </span>
                ) : null}
              </Button>
            )}
          </HoverCardTrigger>
          <HoverCardContent
            className={cn(
              contentClass,
              "!z-[9999] border-border bg-card shadow-md rounded-lg",
            )}
            side="top"
            align={placement === "floating" ? "end" : "start"}
          >
            <div className="p-6">
              {/* Title */}
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-full bg-surface-muted text-muted-foreground flex items-center justify-center">
                  <RemixIcon name="support_agent" size="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    {t("common.contactUs")}
                  </h3>
                </div>
              </div>

              {/* Description text */}
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                {t("common.suggestion")}
              </p>

              {/* Action buttons */}
              <div className="space-y-3">
                {/* Send Feedback - Shown on both Web and desktop versions */}
                <Button
                  onClick={() => setShowFeedbackForm(true)}
                  className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
                >
                  <RemixIcon name="attachment" size="size-4" className="mr-3" />
                  {t("feedback.sendFeedback")}
                </Button>

                <Button
                  onClick={handleDiscordClick}
                  className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
                >
                  <div className="relative size-4 mr-3">
                    <Image
                      src="/images/discord.svg"
                      alt="Discord logo"
                      fill
                      style={{ objectFit: "contain" }}
                    />
                  </div>
                  {t("common.joinDiscord")}
                  {isTauriEnv && (
                    <RemixIcon
                      name="arrow_right_up"
                      size="size-3"
                      className="ml-auto opacity-70"
                    />
                  )}
                </Button>

                <Button
                  onClick={() => setShowEmailOptions(true)}
                  variant="outline"
                  className="w-full justify-start border-border hover:bg-surface-hover rounded-lg"
                >
                  <RemixIcon name="inbox_text" size="size-4" className="mr-3" />
                  {t("common.mailToUs")}
                </Button>
              </div>

              {/* Footer note */}
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                  {t("common.reply")}
                </p>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      )}

      {/* Controlled dialog: used when opened from user menu "Contact us" */}
      {typeof dialogOpen === "boolean" && onDialogOpenChange && (
        <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
          <DialogContent
            className="sm:max-w-md !z-[9999] bg-card border-border shadow-md rounded-lg"
            overlayClassName="!z-[9998]"
          >
            <DialogHeader className="sr-only">
              <DialogTitle>{t("common.contactUs")}</DialogTitle>
            </DialogHeader>
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-full bg-surface-muted text-muted-foreground flex items-center justify-center">
                  <RemixIcon name="support_agent" size="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    {t("common.contactUs")}
                  </h3>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                {t("common.suggestion")}
              </p>
              <div className="space-y-3">
                <Button
                  onClick={() => {
                    onDialogOpenChange(false);
                    setShowFeedbackForm(true);
                  }}
                  className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
                >
                  <RemixIcon name="attachment" size="size-4" className="mr-3" />
                  {t("feedback.sendFeedback")}
                </Button>
                <Button
                  onClick={handleDiscordClick}
                  className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
                >
                  <div className="relative size-4 mr-3">
                    <Image
                      src="/images/discord.svg"
                      alt="Discord logo"
                      fill
                      style={{ objectFit: "contain" }}
                    />
                  </div>
                  {t("common.joinDiscord")}
                  {isTauriEnv && (
                    <RemixIcon
                      name="arrow_right_up"
                      size="size-3"
                      className="ml-auto opacity-70"
                    />
                  )}
                </Button>
                <Button
                  onClick={() => {
                    onDialogOpenChange(false);
                    setShowEmailOptions(true);
                  }}
                  variant="outline"
                  className="w-full justify-start border-border hover:bg-surface-hover rounded-lg"
                >
                  <RemixIcon name="inbox_text" size="size-4" className="mr-3" />
                  {t("common.mailToUs")}
                </Button>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                  {t("common.reply")}
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Email options dialog */}
      <Dialog open={showEmailOptions} onOpenChange={setShowEmailOptions}>
        <DialogContent
          className="sm:max-w-md !z-[9999] bg-card border-border shadow-md rounded-lg"
          overlayClassName="!z-[9998]"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground font-semibold tracking-tight">
              <RemixIcon name="inbox_text" size="size-5" />
              {t("common.emailOptions")}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-center justify-between p-3 border border-border rounded-lg mb-4 bg-background">
              <span className="text-sm font-medium text-foreground">
                {email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyEmailToClipboard}
                className="h-8 px-2 hover:bg-surface-hover"
              >
                {copyStatus === "copied" ? (
                  <>
                    <RemixIcon
                      name="check"
                      size="size-4"
                      className="mr-1 text-success"
                    />
                    <span>{t("common.copied")}</span>
                  </>
                ) : (
                  <>
                    <RemixIcon
                      name="file_copy"
                      size="size-4"
                      className="mr-1"
                    />
                    <span>{t("common.copy")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setShowEmailOptions(false)}
              className="border-border hover:bg-surface-hover rounded-lg"
            >
              <RemixIcon name="close" size="size-4" className="mr-2" />
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleEmailClick}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
            >
              <RemixIcon name="inbox_text" size="size-4" className="mr-2" />
              {t("common.openMailClient")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFeedbackForm} onOpenChange={setShowFeedbackForm}>
        <DialogContent
          className="sm:max-w-md !z-[9999] bg-card border-border shadow-md rounded-lg"
          overlayClassName="!z-[9998]"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground font-semibold tracking-tight">
              <RemixIcon name="attachment" size="size-5" />
              {t("feedback.feedbackForm")}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Feedback content */}
            <div>
              <Textarea
                placeholder={t("feedback.feedbackPlaceholder")}
                value={feedbackContent}
                onChange={handleFeedbackChange}
                className={cn(
                  "min-h-[120px] resize-y bg-background border-border rounded-md focus:ring-ring placeholder:text-muted-foreground",
                  wordCount === MAX_WORDS && "border-destructive/50",
                )}
              />
              <div className="flex justify-between items-center mt-2 text-sm">
                <span
                  className={cn(
                    "flex items-center",
                    wordCount === MAX_WORDS
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {wordCount === MAX_WORDS && (
                    <RemixIcon
                      name="error_warning"
                      size="size-3"
                      className="mr-1"
                    />
                  )}
                  {t("feedback.wordCount", {
                    count: wordCount,
                    max: MAX_WORDS,
                  })}
                </span>
              </div>
            </div>

            {/* Optional contact email - only shown when not logged in or in Tauri environment */}
            <div>
              <input
                type="email"
                placeholder={t("feedback.contactEmailOptional", {
                  defaultValue: "Your email (optional)",
                })}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("feedback.contactEmailHint", {
                  defaultValue:
                    "Leave your email if you'd like us to follow up",
                })}
              </p>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setShowFeedbackForm(false)}
              disabled={isSubmitting}
              className="border-border hover:bg-surface-hover rounded-lg"
            >
              <RemixIcon name="close" size="size-4" className="mr-2" />
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmitFeedback}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm"
              disabled={isSubmitting || !feedbackContent.trim()}
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 size-4 text-primary-foreground"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <title>{t("feedback.submitting")}</title>
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t("feedback.submitting")}
                </>
              ) : (
                <>
                  <RemixIcon name="send_plane" size="size-4" className="mr-2" />
                  {t("feedback.submit")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
