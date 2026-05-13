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
import { DingTalkStepsDialog } from "@/components/dingtalk-steps-dialog";
import { DingTalkConnectSuccessAlert } from "@/components/dingtalk-connect-success-alert";
import { getAuthToken } from "@/lib/auth/token-manager";
import { getHomePath } from "@/lib/utils";

type AuthStatus = "idle" | "connecting" | "completed" | "error";

interface DingTalkAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When true, renders form content inline without the Dialog wrapper */
  embedded?: boolean;
}

/**
 * DingTalk authorization form.
 * Supports standalone dialog mode (default) and embedded inline mode.
 */
export function DingTalkAuthForm({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
}: DingTalkAuthFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [successAlertOpen, setSuccessAlertOpen] = useState(false);

  const resetState = useCallback(() => {
    setStatus("idle");
    setClientId("");
    setClientSecret("");
    setDisplayName("");
    setErrorMessage(null);
    setSuccessAlertOpen(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [status, resetState, onClose]);

  const handleConnect = useCallback(async () => {
    const trimmedId = clientId.trim();
    const trimmedSecret = clientSecret.trim();
    if (!trimmedId || !trimmedSecret) {
      setErrorMessage(
        t(
          "auth.dingtalkClientIdSecretRequired",
          "Please fill in Client ID and Client Secret",
        ),
      );
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);

    try {
      const name = displayName.trim() || `DingTalk · ${trimmedId.slice(0, 10)}`;
      const account = await createIntegrationAccount({
        platform: "dingtalk",
        externalId: trimmedId,
        displayName: name,
        credentials: {
          clientId: trimmedId,
          clientSecret: trimmedSecret,
        },
        bot: {
          name,
          description: t(
            "auth.dingtalkBotDescription",
            "Chat with openloomi via DingTalk",
          ),
          adapter: "dingtalk",
          enable: true,
        },
      });

      setStatus("completed");

      try {
        const cloudAuthToken =
          typeof window !== "undefined" ? getAuthToken() : null;
        const response = await fetch("/api/dingtalk/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cloudAuthToken ? { cloudAuthToken } : {}),
        });
        if (response.ok) {
          console.log("[DingTalk] Listener Started Successfully");
        }
      } catch (e) {
        console.warn("[DingTalk] Listener error:", e);
      }

      setSuccessAlertOpen(true);
    } catch (error) {
      setStatus("error");
      const msg =
        error instanceof Error ? error.message : t("common.operationFailed");
      setErrorMessage(msg);
    }
  }, [clientId, clientSecret, displayName, t]);

  const handleSuccessConfirm = useCallback(() => {
    router.push(getHomePath());
    router.refresh();
    handleClose();
    onSuccess?.();
  }, [router, handleClose, onSuccess]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleClose();
      }
    },
    [handleClose],
  );

  const formBody = (
    <>
      <p className="text-sm text-muted-foreground">
        {t(
          "auth.dingtalkDescription",
          "Create an enterprise internal app on DingTalk Open Platform, add a Stream mode bot, fill in Client ID (AppKey) and Client Secret below to chat with openloomi.",
        )}
      </p>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="dingtalk-client-id">
            {t("auth.dingtalkClientId", "Client ID (AppKey)")}
          </Label>
          <Input
            id="dingtalk-client-id"
            placeholder="dingxxxxxxxx"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={status === "connecting"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dingtalk-client-secret">
            {t("auth.dingtalkClientSecret", "Client Secret (AppSecret)")}
          </Label>
          <Input
            id="dingtalk-client-secret"
            type="password"
            placeholder="••••••••••••••••"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={status === "connecting"}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dingtalk-display-name">
            {t("auth.dingtalkDisplayName", "Display name (optional)")}
          </Label>
          <Input
            id="dingtalk-display-name"
            placeholder={t(
              "auth.dingtalkDisplayNamePlaceholder",
              "My DingTalk Bot",
            )}
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
          className="border-[#0089FF] text-[#0089FF] hover:bg-[#0089FF]/10"
        >
          {t("auth.dingtalkStepsLink", "Setup steps")}
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
          className="bg-[#0089FF] hover:bg-[#0078E0]"
        >
          {status === "connecting"
            ? t("auth.connecting", "Connecting...")
            : t("auth.dingtalkConnect", "Connect DingTalk")}
        </Button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <>
        {formBody}
        <DingTalkStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
        <DingTalkConnectSuccessAlert
          open={successAlertOpen}
          onOpenChange={setSuccessAlertOpen}
          onConfirm={handleSuccessConfirm}
        />
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
              <RemixIcon name="chat-smile" className="h-5 w-5 text-[#0089FF]" />
              {t("auth.dingtalkTitle", "Connect DingTalk")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "auth.dingtalkDescription",
                "Create an enterprise internal app on DingTalk Open Platform, add a Stream mode bot, fill in Client ID (AppKey) and Client Secret below to chat with openloomi.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="dingtalk-client-id">
                {t("auth.dingtalkClientId", "Client ID (AppKey)")}
              </Label>
              <Input
                id="dingtalk-client-id"
                placeholder="dingxxxxxxxx"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={status === "connecting"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dingtalk-client-secret">
                {t("auth.dingtalkClientSecret", "Client Secret (AppSecret)")}
              </Label>
              <Input
                id="dingtalk-client-secret"
                type="password"
                placeholder="••••••••••••••••"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                disabled={status === "connecting"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dingtalk-display-name">
                {t("auth.dingtalkDisplayName", "Display name (optional)")}
              </Label>
              <Input
                id="dingtalk-display-name"
                placeholder={t(
                  "auth.dingtalkDisplayNamePlaceholder",
                  "My DingTalk Bot",
                )}
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
              className="border-[#0089FF] text-[#0089FF] hover:bg-[#0089FF]/10"
            >
              {t("auth.dingtalkStepsLink", "Setup steps")}
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
              className="bg-[#0089FF] hover:bg-[#0078E0]"
            >
              {status === "connecting"
                ? t("auth.connecting", "Connecting...")
                : t("auth.dingtalkConnect", "Connect DingTalk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DingTalkStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
      <DingTalkConnectSuccessAlert
        open={successAlertOpen}
        onOpenChange={setSuccessAlertOpen}
        onConfirm={handleSuccessConfirm}
      />
    </>
  );
}
