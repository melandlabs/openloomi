"use client";

import { useCallback, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button, Input, Label } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { createIntegrationAccount } from "@/lib/integrations/client";
import { useIntegrations } from "@/hooks/use-integrations";
import { getAuthToken } from "@/lib/auth/token-manager";

// Authorization status type
type AuthStatus =
  | "idle"
  | "checking"
  | "ready"
  | "connecting"
  | "completed"
  | "error";

interface IMessageAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When true, renders form content inline without the Dialog wrapper */
  embedded?: boolean;
}

/**
 * iMessage authorization form component.
 * Supports standalone dialog mode (default) and embedded inline mode.
 */
export function IMessageAuthForm({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
}: IMessageAuthFormProps) {
  const { t } = useTranslation();
  const { mutate: refreshIntegrations } = useIntegrations();
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [displayName, setDisplayName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorI18nKey, setErrorI18nKey] = useState<string | null>(null);
  const [isMacOS, setIsMacOS] = useState<boolean>(true);

  // Map backend error messages to i18n keys and extract specific error details
  const mapErrorToI18nKey = (
    error: string,
  ): { key: string | null; message?: string } => {
    if (error.includes("only available on macOS")) {
      return { key: "auth.imessageMacOnlyDesc" };
    }
    if (error.includes("Failed to initialize")) {
      return { key: "auth.imessageErrorInitFailed" };
    }
    if (error.includes("Full Disk Access")) {
      return { key: "auth.imessageErrorPermission" };
    }
    if (error.includes("Unable to connect to iMessage:")) {
      const message = error
        .replace("Unable to connect to iMessage:", "")
        .trim();
      // When extracted error detail is empty, fallback to showing original error instead of template with empty placeholder
      if (!message) return { key: null };
      return { key: "auth.imessageErrorConnection", message };
    }
    return { key: null };
  };

  // Safe i18n translation: if interpolation fails ({{xxx}} not replaced), fallback to original text
  const safeTranslate = (
    key: string,
    params?: Record<string, string | undefined>,
    fallback?: string,
  ): string => {
    const result = t(key, params);
    if (result.includes("{{")) {
      return fallback || result.replace(/\{\{.*?\}\}/g, "").trim();
    }
    return result;
  };

  // Detect if running on macOS
  useEffect(() => {
    if (typeof window !== "undefined") {
      const platform = navigator.platform.toLowerCase();
      setIsMacOS(platform.includes("mac"));
    }
  }, []);

  // Reset state
  const resetState = useCallback(() => {
    setStatus("idle");
    setDisplayName("");
    setErrorMessage(null);
    setErrorI18nKey(null);
  }, []);

  // Close dialog
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [status, resetState, onClose]);

  // Check iMessage availability
  const checkAvailability = useCallback(async () => {
    setStatus("checking");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/imessage/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (data.available) {
        setStatus("ready");
        // Auto-set display name
        if (data.userInfo?.name) {
          setDisplayName(data.userInfo.name);
        } else {
          setDisplayName(
            t("auth.imessageDisplayNamePlaceholder", "My iMessage"),
          );
        }
      } else {
        setStatus("error");
        const rawError = data.error || t("auth.imessageNotAvailable");
        const { key: i18nKey, message } = data.error
          ? mapErrorToI18nKey(data.error)
          : { key: null };
        setErrorI18nKey(i18nKey);
        setErrorMessage(
          i18nKey ? safeTranslate(i18nKey, { message }, rawError) : rawError,
        );
      }
    } catch (error) {
      setStatus("error");
      const errorMsg =
        error instanceof Error ? error.message : t("common.operationFailed");
      const { key: i18nKey, message } = mapErrorToI18nKey(errorMsg);
      setErrorI18nKey(i18nKey);
      setErrorMessage(
        i18nKey ? safeTranslate(i18nKey, { message }, errorMsg) : errorMsg,
      );
    }
  }, [t]);

  // Connect iMessage
  const handleConnect = useCallback(async () => {
    if (!displayName.trim()) {
      setErrorI18nKey("auth.displayNameRequired");
      setErrorMessage(
        t("auth.displayNameRequired", "Please enter a display name"),
      );
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);
    setErrorI18nKey(null);

    try {
      // Call API to create integration account
      await createIntegrationAccount({
        platform: "imessage",
        externalId: "local-imessage",
        displayName: displayName.trim(),
        credentials: {
          // iMessage is a local connection, no additional credentials needed
          type: "local",
          connectedAt: new Date().toISOString(),
        },
        bot: {
          name: displayName.trim(),
          description: `iMessage - ${displayName.trim()}`,
          adapter: "imessage",
          enable: true,
        },
      });

      setStatus("completed");

      // Start iMessage self-message listener immediately after successful authorization
      try {
        const cloudAuthToken = getAuthToken() || undefined;

        const response = await fetch("/api/imessage/init-self-listener", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            cloudAuthToken ? { authToken: cloudAuthToken } : {},
          ),
        });
        if (response.ok) {
          console.log("[iMessage] Self-message listener started");
        }
      } catch (error) {
        console.error(
          "[iMessage] Failed to start self-message listener:",
          error,
        );
      }

      // Refresh integration list
      await refreshIntegrations();

      // Delay closing dialog
      setTimeout(() => {
        handleClose();
        onSuccess?.();
      }, 1500);
    } catch (error) {
      setStatus("error");
      const errorMsg =
        error instanceof Error ? error.message : t("common.operationFailed");
      const { key: i18nKey, message } = mapErrorToI18nKey(errorMsg);
      setErrorI18nKey(i18nKey);
      setErrorMessage(
        i18nKey ? safeTranslate(i18nKey, { message }, errorMsg) : errorMsg,
      );
    }
  }, [displayName, t, refreshIntegrations, handleClose, onSuccess]);

  // Auto-check availability when dialog opens
  useEffect(() => {
    if (isOpen && status === "idle" && isMacOS) {
      checkAvailability();
    }
  }, [isOpen, status, isMacOS, checkAvailability]);

  // Render content
  const renderContent = () => {
    // Non-macOS system
    if (!isMacOS) {
      return (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="flex size-16 items-center justify-center rounded-full bg-amber-100">
            <RemixIcon
              name="error_warning"
              size="size-8"
              className="text-amber-600"
            />
          </div>
          <div className="text-center">
            <p className="font-medium text-foreground">
              {t("auth.imessageMacOnly", "macOS only")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "auth.imessageMacOnlyDesc",
                "iMessage integration is only available on macOS. Please use this feature on a Mac computer.",
              )}
            </p>
          </div>
        </div>
      );
    }

    switch (status) {
      case "idle":
      case "checking":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-blue-500"
            />
            <p className="text-sm text-muted-foreground">
              {t("auth.imessageChecking", "Checking iMessage availability...")}
            </p>
          </div>
        );

      case "ready":
        return (
          <div className="space-y-6">
            {/* Permission explanation */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <RemixIcon
                  name="shield"
                  size="size-5"
                  className="mt-0.5 text-blue-600"
                />
                <div className="text-sm">
                  <p className="font-medium text-blue-900">
                    {t("auth.imessagePermissionTitle", "Required permissions")}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-blue-800">
                    <li>
                      {t(
                        "auth.imessagePermission1",
                        "Full disk access - used to read the message database",
                      )}
                    </li>
                    <li>
                      {t(
                        "auth.imessagePermission2",
                        "Automation permission - used to send messages",
                      )}
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Display name input */}
            <div className="space-y-2">
              <Label htmlFor="imessage-display-name">
                {t("auth.displayName", "Display name")}
              </Label>
              <Input
                id="imessage-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t(
                  "auth.imessageDisplayNamePlaceholder",
                  "My iMessage",
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "auth.imessageDisplayNameHint",
                  "This name will be used to identify your iMessage account in openloomi",
                )}
              </p>
            </div>

            {/* Data explanation */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-start gap-3">
                <RemixIcon
                  name="hard_drive"
                  size="size-5"
                  className="mt-0.5 text-muted-foreground"
                />
                <div className="text-sm text-muted-foreground">
                  <p>
                    {t(
                      "auth.imessageDataNote",
                      "Your message data stays on your local device. openloomi will only read recent messages when you use it to generate insights.",
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case "connecting":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-blue-500"
            />
            <p className="text-sm text-muted-foreground">
              {t("auth.imessageConnecting", "Connecting to iMessage...")}
            </p>
          </div>
        );

      case "completed":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex size-16 items-center justify-center rounded-full bg-green-100">
              <RemixIcon
                name="circle_check"
                size="size-8"
                className="text-green-600"
              />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">
                {t("auth.imessageConnected", "iMessage connected")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  "auth.imessageConnectedDesc",
                  "You can now access your iMessage messages through openloomi.",
                )}
              </p>
            </div>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex size-16 items-center justify-center rounded-full bg-red-100">
              <RemixIcon
                name="error_warning"
                size="size-8"
                className="text-red-600"
              />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">
                {t("auth.imessageError", "Connection failed")}
              </p>
              <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Render footer buttons
  const renderFooter = () => {
    if (!isMacOS) {
      return (
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      );
    }

    switch (status) {
      case "idle":
      case "checking":
        return (
          <DialogFooter>
            <Button variant="secondary" onClick={handleClose}>
              {t("common.cancel", "Cancel")}
            </Button>
          </DialogFooter>
        );

      case "ready":
        return (
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={handleClose}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleConnect}
              disabled={!displayName.trim()}
              className="bg-[#007AFF] hover:bg-[#0056CC]"
            >
              <RemixIcon name="apple" size="size-4" className="mr-2" />
              {t("auth.imessageConnect", "Connect iMessage")}
            </Button>
          </DialogFooter>
        );

      case "connecting":
        return (
          <DialogFooter>
            <Button disabled>
              <RemixIcon
                name="loader_2"
                size="size-4"
                className="mr-2 animate-spin"
              />
              {t("common.processing", "Processing...")}
            </Button>
          </DialogFooter>
        );

      case "error":
        return (
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={checkAvailability}>
              {t("common.retry", "Retry")}
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              {t("common.close", "Close")}
            </Button>
          </DialogFooter>
        );

      case "completed":
        return (
          <DialogFooter>
            <Button variant="secondary" onClick={handleClose}>
              {t("common.close", "Close")}
            </Button>
          </DialogFooter>
        );

      default:
        return null;
    }
  };

  if (embedded) {
    return (
      <>
        <p className="text-sm text-muted-foreground mb-2">
          {t(
            "auth.imessageConnectDescription",
            "Connect your Mac iMessage to read and send messages in openloomi.",
          )}
        </p>
        {renderContent()}
        {renderFooter()}
      </>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogContent className="max-w-md !z-[1010]" overlayClassName="z-[130]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-[#007AFF]/10">
              <RemixIcon
                name="apple"
                size="size-5"
                className="text-[#007AFF]"
              />
            </div>
            <div>
              <DialogTitle>
                {t("auth.imessageConnectTitle", "Connect iMessage")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "auth.imessageConnectDescription",
                  "Connect your Mac iMessage to read and send messages in openloomi.",
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {renderContent()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
}
