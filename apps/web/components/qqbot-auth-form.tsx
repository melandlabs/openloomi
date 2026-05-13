"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
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
import { toast } from "@/components/toast";
import { QQBotStepsDialog } from "@/components/qqbot-steps-dialog";
import { getAuthToken } from "@/lib/auth/token-manager";
import { getHomePath } from "@/lib/utils";

type AuthStatus = "idle" | "connecting" | "completed" | "error";

interface QQBotAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When true, renders form content inline without the Dialog wrapper */
  embedded?: boolean;
}

/**
 * QQ Bot authorization form.
 * Supports standalone dialog mode (default) and embedded inline mode.
 */
export function QQBotAuthForm({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
}: QQBotAuthFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  const resetState = useCallback(() => {
    setStatus("idle");
    setAppId("");
    setAppSecret("");
    setDisplayName("");
    setErrorMessage(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [status, resetState, onClose]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleClose();
      }
    },
    [handleClose],
  );

  const handleConnect = useCallback(async () => {
    const trimmedAppId = appId.trim();
    const trimmedSecret = appSecret.trim();
    if (!trimmedAppId || !trimmedSecret) {
      setErrorMessage(
        t(
          "auth.qqbotAppIdSecretRequired",
          "Please fill in App ID and App Secret",
        ),
      );
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);

    try {
      const name = displayName.trim() || `QQ · ${trimmedAppId.slice(0, 12)}`;
      await createIntegrationAccount({
        platform: "qqbot",
        externalId: trimmedAppId,
        displayName: name,
        credentials: {
          appId: trimmedAppId,
          appSecret: trimmedSecret,
        },
        bot: {
          name,
          description: t(
            "auth.qqbotBotDescription",
            "Chat with openloomi via QQ",
          ),
          adapter: "qqbot",
          enable: true,
        },
      });

      setStatus("completed");

      // Start QQ WebSocket listener
      try {
        const cloudAuthToken =
          typeof window !== "undefined" ? getAuthToken() : null;
        const response = await fetch("/api/qqbot/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cloudAuthToken ? { cloudAuthToken } : {}),
        });
        if (response.ok) {
          console.log("[QQBot] Listener started");
        }
      } catch (e) {
        console.warn("[QQBot] Failed to start listener:", e);
      }

      toast({
        type: "success",
        description: t("auth.qqbotConnectSuccess", "QQ connected"),
      });
      router.push(getHomePath());
      router.refresh();
      setTimeout(() => {
        handleClose();
        onSuccess?.();
      }, 800);
    } catch (error) {
      setStatus("error");
      const msg =
        error instanceof Error ? error.message : t("common.operationFailed");
      setErrorMessage(msg);
    }
  }, [appId, appSecret, displayName, t, router, handleClose, onSuccess]);

  const formBody = (
    <>
      <p className="text-sm text-muted-foreground">
        {t(
          "auth.qqbotDescription",
          "Create a bot on QQ Open Platform, get AppID and AppSecret, fill them in below to chat with openloomi.",
        )}
      </p>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="qqbot-app-id">{t("auth.qqbotAppId", "App ID")}</Label>
          <Input
            id="qqbot-app-id"
            placeholder="123456789"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            disabled={status === "connecting"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="qqbot-app-secret">
            {t("auth.qqbotAppSecret", "App Secret")}
          </Label>
          <Input
            id="qqbot-app-secret"
            type="password"
            placeholder="••••••••••••••••"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            disabled={status === "connecting"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="qqbot-display-name">
            {t("auth.qqbotDisplayName", "Display name (optional)")}
          </Label>
          <Input
            id="qqbot-display-name"
            placeholder={t("auth.qqbotDisplayNamePlaceholder", "My QQ bot")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={status === "connecting"}
          />
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStepsOpen(true)}
          disabled={status === "connecting"}
          className="border-[#12B7F5] text-[#12B7F5] hover:bg-[#12B7F5]/10"
        >
          {t("auth.qqbotStepsLink", "Setup steps")}
        </Button>
        {!embedded && (
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={status === "connecting"}
          >
            {t("common.cancel", "Cancel")}
          </Button>
        )}
        <Button
          onClick={handleConnect}
          disabled={status === "connecting"}
          className="bg-[#12B7F5] hover:bg-[#0E9AD4]"
        >
          {status === "connecting"
            ? t("auth.connecting", "Connecting...")
            : t("auth.qqbotConnect", "Connect QQ")}
        </Button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <>
        {formBody}
        <QQBotStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
      </>
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="z-[1010] sm:max-w-md overflow-hidden max-h-[90vh] overflow-y-auto"
          overlayClassName="z-[1009]"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RemixIcon name="chat-smile" className="h-5 w-5 text-[#12B7F5]" />
              {t("auth.qqbotTitle", "Connect QQ")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "auth.qqbotDescription",
                "Create a bot on QQ Open Platform, get AppID and AppSecret, fill them in below to chat with openloomi.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="qqbot-app-id">
                {t("auth.qqbotAppId", "App ID")}
              </Label>
              <Input
                id="qqbot-app-id"
                placeholder="123456789"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                disabled={status === "connecting"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qqbot-app-secret">
                {t("auth.qqbotAppSecret", "App Secret")}
              </Label>
              <Input
                id="qqbot-app-secret"
                type="password"
                placeholder="••••••••••••••••"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                disabled={status === "connecting"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qqbot-display-name">
                {t("auth.qqbotDisplayName", "Display name (optional)")}
              </Label>
              <Input
                id="qqbot-display-name"
                placeholder={t("auth.qqbotDisplayNamePlaceholder", "My QQ bot")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={status === "connecting"}
              />
            </div>
            {errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepsOpen(true)}
              disabled={status === "connecting"}
              className="border-[#12B7F5] text-[#12B7F5] hover:bg-[#12B7F5]/10"
            >
              {t("auth.qqbotStepsLink", "Setup steps")}
            </Button>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={status === "connecting"}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleConnect}
              disabled={status === "connecting"}
              className="bg-[#12B7F5] hover:bg-[#0E9AD4]"
            >
              {status === "connecting"
                ? t("auth.connecting", "Connecting...")
                : t("auth.qqbotConnect", "Connect QQ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QQBotStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
    </>
  );
}
