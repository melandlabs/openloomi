"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
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
import { FeishuStepsDialog } from "@/components/feishu-steps-dialog";
import { FeishuConnectSuccessAlert } from "@/components/feishu-connect-success-alert";
import { getAuthToken } from "@/lib/auth/token-manager";
import { getHomePath } from "@/lib/utils";

type AuthStatus = "idle" | "connecting" | "completed" | "error";

/** QR scan registration flow: aligned with Feishu official device code interface (same as OpenClaw) */
type ScanPhase =
  | "idle"
  | "loading"
  | "polling"
  | "success"
  | "failed"
  | "unavailable";

interface FeishuAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When true, do not render Dialog wrapper, only embed form content */
  embedded?: boolean;
}

async function postRegistrationCancel() {
  try {
    await fetch("/api/integrations/feishu/registration/cancel", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* Ignore */
  }
}

/**
 * Feishu connection: defaults to using Feishu official "App Registration" device code scan (same source as OpenClaw); manual credential entry available on failure
 */
export function FeishuAuthForm({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
}: FeishuAuthFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [successAlertOpen, setSuccessAlertOpen] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const pollMsRef = useRef(5000);

  const resetState = useCallback(() => {
    setStatus("idle");
    setAppId("");
    setAppSecret("");
    setDisplayName("");
    setErrorMessage(null);
    setSuccessAlertOpen(false);
    setScanPhase("idle");
    setQrUrl(null);
    setUserCode(null);
    pollMsRef.current = 5000;
    setShowManual(false);
  }, []);

  const handleClose = useCallback(() => {
    void postRegistrationCancel();
    resetState();
    onClose();
  }, [resetState, onClose]);

  /** Automatically initiate device code registration after dialog opens (no additional user configuration required) */
  useEffect(() => {
    if (!embedded && !isOpen) return;
    let cancelled = false;

    const run = async () => {
      setScanPhase("loading");
      setErrorMessage(null);
      setShowManual(false);
      try {
        const res = await fetch("/api/integrations/feishu/registration/start", {
          method: "POST",
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          qrUrl?: string;
          userCode?: string;
          pollIntervalSec?: number;
          error?: string;
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.qrUrl) {
          setScanPhase("unavailable");
          setShowManual(true);
          setErrorMessage(
            data.message ||
              data.error ||
              t(
                "auth.feishuScanUnavailable",
                "Scan-to-create is not available. You can enter App ID and App Secret manually.",
              ),
          );
          return;
        }
        setQrUrl(data.qrUrl);
        setUserCode(data.userCode ?? null);
        pollMsRef.current = (data.pollIntervalSec ?? 5) * 1000;
        setScanPhase("polling");
      } catch (e) {
        if (!cancelled) {
          setScanPhase("unavailable");
          setShowManual(true);
          setErrorMessage(
            e instanceof Error ? e.message : t("common.operationFailed"),
          );
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, embedded, t]);

  /** Poll until success, failure, or component unmount */
  useEffect(() => {
    if (scanPhase !== "polling" || !qrUrl) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      timeoutId = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/integrations/feishu/registration/poll", {
          method: "POST",
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
          pollIntervalSec?: number;
        };
        if (cancelled) return;

        if (data.status === "success") {
          setScanPhase("success");
          try {
            const cloudAuthToken =
              typeof window !== "undefined" ? getAuthToken() : null;
            await fetch("/api/feishu/listener/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cloudAuthToken ? { cloudAuthToken } : {}),
            });
          } catch (e) {
            console.warn("[Feishu] Listener error:", e);
          }
          setStatus("completed");
          setSuccessAlertOpen(true);
          return;
        }

        if (
          data.status === "denied" ||
          data.status === "expired" ||
          data.status === "no_session" ||
          data.status === "invalid_session"
        ) {
          setScanPhase("failed");
          setErrorMessage(
            data.status === "denied"
              ? t("auth.feishuScanDenied", "Authorization was denied.")
              : data.status === "expired"
                ? t(
                    "auth.feishuScanExpired",
                    "The scan session expired. Close and try again.",
                  )
                : t(
                    "auth.feishuScanSessionLost",
                    "Session expired. Close the dialog and open Lark/Feishu again.",
                  ),
          );
          return;
        }

        if (data.status === "error") {
          setScanPhase("failed");
          setErrorMessage(
            data.message || t("common.operationFailed", "Operation failed"),
          );
          return;
        }

        const nextMs =
          data.pollIntervalSec != null
            ? data.pollIntervalSec * 1000
            : pollMsRef.current;
        pollMsRef.current = nextMs;
        schedule(nextMs);
      } catch (e) {
        if (!cancelled) {
          schedule(pollMsRef.current);
        }
      }
    };

    schedule(pollMsRef.current);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [scanPhase, qrUrl, t]);

  const handleConnect = useCallback(async () => {
    const trimmedAppId = appId.trim();
    const trimmedSecret = appSecret.trim();
    if (!trimmedAppId || !trimmedSecret) {
      setErrorMessage(
        t(
          "auth.feishuAppIdSecretRequired",
          "Please fill in App ID and App Secret",
        ),
      );
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);

    try {
      const name =
        displayName.trim() || `Lark/Feishu · ${trimmedAppId.slice(0, 12)}`;
      await createIntegrationAccount({
        platform: "feishu",
        externalId: trimmedAppId,
        displayName: name,
        credentials: {
          appId: trimmedAppId,
          appSecret: trimmedSecret,
        },
        bot: {
          name,
          description: t(
            "auth.feishuBotDescription",
            "Chat with openloomi via Lark/Feishu",
          ),
          adapter: "feishu",
          enable: true,
        },
      });

      setStatus("completed");

      try {
        const cloudAuthToken =
          typeof window !== "undefined" ? getAuthToken() : null;
        const response = await fetch("/api/feishu/listener/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cloudAuthToken ? { cloudAuthToken } : {}),
        });
        if (response.ok) {
          console.log("[Feishu] Listener initialized successfully");
        }
      } catch (e) {
        console.warn("[Feishu] Listener error:", e);
      }

      setSuccessAlertOpen(true);
    } catch (error) {
      setStatus("error");
      const msg =
        error instanceof Error ? error.message : t("common.operationFailed");
      setErrorMessage(msg);
    }
  }, [appId, appSecret, displayName, t]);

  const handleFeishuSuccessConfirm = useCallback(() => {
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

  const scanDescription = t(
    "auth.feishuScanDescription",
    "Use the Lark/Feishu app on your phone to scan the QR code. No App ID or App Secret input is required.",
  );

  const manualFields = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="feishu-app-id">{t("auth.feishuAppId", "App ID")}</Label>
        <Input
          id="feishu-app-id"
          placeholder="cli_xxxxxxxxxx"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          disabled={status === "connecting"}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="feishu-app-secret">
          {t("auth.feishuAppSecret", "App Secret")}
        </Label>
        <Input
          id="feishu-app-secret"
          type="password"
          placeholder="••••••••••••••••"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          disabled={status === "connecting"}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="feishu-display-name">
          {t("auth.feishuDisplayName", "Display name (optional)")}
        </Label>
        <Input
          id="feishu-display-name"
          placeholder={t("auth.feishuDisplayNamePlaceholder", "My Lark/Feishu")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={status === "connecting"}
        />
      </div>
    </div>
  );

  const scanBlock = (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-center text-sm text-muted-foreground">
        {scanDescription}
      </p>
      {scanPhase === "loading" && (
        <p className="text-sm text-muted-foreground">
          {t("auth.feishuScanPreparing", "Preparing QR code…")}
        </p>
      )}
      {scanPhase === "polling" && qrUrl && (
        <>
          <div className="rounded-lg border border-border bg-white p-3">
            <QRCodeSVG value={qrUrl} size={200} level="M" marginSize={1} />
          </div>
          {userCode ? (
            <p className="text-center text-xs text-muted-foreground">
              {t("auth.feishuUserCodeHint", "If prompted, enter code:")}{" "}
              <span className="font-mono font-semibold text-foreground">
                {userCode}
              </span>
            </p>
          ) : null}
          <p className="text-center text-sm text-muted-foreground">
            {t(
              "auth.feishuScanWaiting",
              "Waiting for you to confirm in Lark/Feishu…",
            )}
          </p>
        </>
      )}
      {(scanPhase === "failed" || scanPhase === "unavailable") && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowManual((v) => !v)}
        >
          {showManual
            ? t("auth.feishuHideManual", "Hide manual entry")
            : t("auth.feishuManualEntryTitle", "Enter credentials manually")}
        </Button>
      )}
    </div>
  );

  const footerButtons = (
    <div className="flex w-full flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setStepsOpen(true)}
        disabled={status === "connecting"}
        className="border-[#3370FF] text-[#3370FF] hover:bg-[#3370FF]/10"
      >
        {t("auth.feishuStepsLink", "Setup steps")}
      </Button>
      {!embedded && (
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          disabled={status === "connecting"}
        >
          {t("common.cancel", "Cancel")}
        </Button>
      )}
      {showManual && (
        <Button
          type="button"
          onClick={handleConnect}
          disabled={status === "connecting"}
          className="bg-[#3370FF] hover:bg-[#2860E6]"
        >
          {status === "connecting"
            ? t("auth.connecting", "Connecting...")
            : t("auth.feishuConnect", "Connect Lark/Feishu")}
        </Button>
      )}
    </div>
  );

  if (embedded) {
    return (
      <>
        {scanBlock}
        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
        {showManual && (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                "auth.feishuDescription",
                "Create an enterprise self-built app on Lark/Feishu Open Platform and enable bot capability, select Use long connection to receive events and subscribe to im.message.receive_v1, fill in the credentials below to chat with openloomi.",
              )}
            </p>
            {manualFields}
          </>
        )}
        {footerButtons}
        <FeishuStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
        <FeishuConnectSuccessAlert
          open={successAlertOpen}
          onOpenChange={setSuccessAlertOpen}
          onConfirm={handleFeishuSuccessConfirm}
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
              <RemixIcon name="chat-smile" className="h-5 w-5 text-[#3370FF]" />
              {t("auth.feishuTitle", "Connect Lark/Feishu")}
            </DialogTitle>
            <DialogDescription>{scanDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            {scanBlock}
            {showManual && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "auth.feishuDescription",
                    "Create an enterprise self-built app on Lark/Feishu Open Platform and enable bot capability, select Use long connection to receive events and subscribe to im.message.receive_v1, fill in the credentials below to chat with openloomi.",
                  )}
                </p>
                {manualFields}
              </>
            )}
            {errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            {footerButtons}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FeishuStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
      <FeishuConnectSuccessAlert
        open={successAlertOpen}
        onOpenChange={setSuccessAlertOpen}
        onConfirm={handleFeishuSuccessConfirm}
      />
    </>
  );
}
