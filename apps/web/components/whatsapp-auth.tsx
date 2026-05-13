"use client";

import { RemixIcon } from "@/components/remix-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button } from "@openloomi/ui";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface WhatsAppUserInfo {
  wid: string;
  pushName?: string;
  formattedNumber?: string;
}

type AuthStatus = "idle" | "pending" | "qr" | "pairing" | "completed" | "error";
type LoginMethod = "qr" | "phone";

interface WhatsAppAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (sessionKey: string, user: WhatsAppUserInfo) => Promise<void>;
  /** Pass existing WhatsApp accountId so the QR route can reuse the self-listener's socket */
  existingAccountId?: string;
  /** When true, renders form content inline without the Dialog wrapper */
  embedded?: boolean;
}

/**
 * WhatsApp authorization form component.
 * Supports standalone dialog mode (default) and embedded inline mode.
 */
export function WhatsAppAuthForm({
  isOpen,
  onClose,
  onSuccess,
  existingAccountId,
  embedded = false,
}: WhatsAppAuthFormProps) {
  const { t } = useTranslation();
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("qr");
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [qrValue, setQrValue] = useState<string>("");
  const [pairingCode, setPairingCode] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const closingRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const isGeneratingRef = useRef(false);
  // Use a ref to trigger the auto-generate effect, avoiding stale-closure issues
  const autoGenerateTriggerRef = useRef(0);

  // ========================================
  // Analytics tracking: session start time and step tracking
  // ========================================
  const sessionStartTimeRef = useRef<number>(Date.now());
  const stepStartTimeRef = useRef<number>(Date.now());
  const previousStepRef = useRef<string>("");

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    // Reset the active session ID to prevent stale polling
    activeSessionIdRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    clearPolling();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setQrValue("");
    setPairingCode("");
    setPhoneNumber("");
    setSessionId("");
    setStatus("idle");
    setErrorMessage(null);
  }, [clearPolling]);

  const handleClose = useCallback(() => {
    // Analytics tracking: modal closed
    const sessionDuration = Date.now() - sessionStartTimeRef.current;
    const hasProgress = sessionId || qrValue || pairingCode || phoneNumber;

    closingRef.current = true;
    cleanup();
    onClose();
    closingRef.current = false;
  }, [
    cleanup,
    onClose,
    loginMethod,
    status,
    sessionId,
    qrValue,
    pairingCode,
    phoneNumber,
  ]);

  const pollStatus = useCallback(
    async (activeSessionId: string) => {
      try {
        // Check if this session is still the active one
        if (activeSessionIdRef.current !== activeSessionId) {
          return; // Skip if this session is no longer active
        }

        const response = await fetch(
          `/api/whatsapp/status?sessionId=${encodeURIComponent(activeSessionId)}`,
        );

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          let errorMsg = t(
            "auth.submitError",
            "Failed to poll WhatsApp status",
          );
          if (errText) {
            try {
              const errData = JSON.parse(errText);
              if (errData?.error) errorMsg = errData.error;
            } catch {
              // ignore parse error
            }
          }
          throw new Error(errorMsg);
        }
        const data = await response.json();

        // Check again after async operation
        if (activeSessionIdRef.current !== activeSessionId) {
          return; // Skip if this session is no longer active
        }

        console.log("[WhatsApp] Poll status:", data.status, data);

        if (data.status === "completed") {
          clearPolling();
          setStatus("completed");

          if (!data.session) {
            throw new Error(
              t(
                "auth.whatsappMissingSession",
                "Missing WhatsApp session payload",
              ),
            );
          }

          const userInfo = (data.user ?? {}) as WhatsAppUserInfo;
          console.log("[WhatsApp] Login completed, session:", data.session);
          console.log("[WhatsApp] Login completed, calling onSuccess...");
          timerRef.current = setTimeout(async () => {
            try {
              await onSuccess(String(data.session), userInfo);
              console.log("[WhatsApp] onSuccess completed, closing...");
              handleClose();
            } catch (error) {
              console.error("[WhatsApp] onSuccess error:", error);
            }
          }, 2000);
        } else if (data.status === "error") {
          clearPolling();
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : t("auth.whatsappErrorGeneric"),
          );
        } else if (data.status === "qr_generated" && data.qr) {
          setStatus("qr");
          setQrValue(String(data.qr));
        } else if (data.status === "code_generated" && data.pairingCode) {
          setStatus("pairing");
          setPairingCode(String(data.pairingCode));
        }
      } catch (error) {
        console.error("[WhatsApp] Poll error:", error);
        if (closingRef.current) return;
        // Only set error state if this is still the active session
        if (activeSessionIdRef.current === activeSessionId) {
          clearPolling();
          setStatus("error");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : t("auth.whatsappErrorGeneric"),
          );
        }
      }
    },
    [clearPolling, handleClose, onSuccess, t],
  );

  const startPolling = useCallback(
    (activeSessionId: string) => {
      clearPolling();
      // Update the active session ID
      activeSessionIdRef.current = activeSessionId;
      pollingRef.current = setInterval(() => {
        void pollStatus(activeSessionId);
      }, 2_000);
    },
    [clearPolling, pollStatus],
  );

  const generateQr = useCallback(async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;

    setStatus("pending");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/whatsapp/generate-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existingAccountId ? { accountId: existingAccountId } : {},
        ),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        let errorMsg = t("auth.whatsappErrorGeneric");
        if (errText) {
          try {
            const errData = JSON.parse(errText);
            if (errData?.error) errorMsg = errData.error;
          } catch {
            // ignore parse error
          }
        }
        throw new Error(errorMsg);
      }
      const data = await response.json();

      if (!data.sessionId) {
        throw new Error(t("auth.whatsappErrorGeneric"));
      }

      // Analytics tracking: QR code generated successfully

      setSessionId(data.sessionId);
      setQrValue(data.qr ?? "");
      setStatus(data.qr ? "qr" : "pending");
      startPolling(data.sessionId);
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : t("auth.whatsappErrorGeneric"),
      );
    } finally {
      isGeneratingRef.current = false;
    }
  }, [existingAccountId, startPolling, t]);

  const generatePairingCode = useCallback(async () => {
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber.replace(/\D/g, ""))) {
      setErrorMessage(t("auth.invalidPhoneNumber", "Invalid phone number"));
      return;
    }

    setStatus("pending");
    setErrorMessage(null);

    try {
      const cleanPhone = phoneNumber.replace(/\D/g, "");
      const response = await fetch("/api/whatsapp/init-pairing-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        let errorMsg = t("auth.whatsappErrorGeneric");
        if (errText) {
          try {
            const errData = JSON.parse(errText);
            if (errData?.error) errorMsg = errData.error;
          } catch {
            // ignore parse error
          }
        }
        throw new Error(errorMsg);
      }
      const data = await response.json();

      if (!data.sessionId) {
        throw new Error(t("auth.whatsappErrorGeneric"));
      }

      setSessionId(data.sessionId);
      setPairingCode(data.pairingCode ?? "");
      setStatus(data.pairingCode ? "pairing" : "pending");

      // Analytics tracking: pairing code generated successfully

      startPolling(data.sessionId);
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : t("auth.whatsappErrorGeneric"),
      );
    }
  }, [phoneNumber, startPolling, t]);

  const [hasInitiated, setHasInitiated] = useState(false);

  const handleRegenerate = useCallback(() => {
    // Analytics tracking: regenerate

    if (loginMethod === "qr") {
      void generateQr();
    } else {
      void generatePairingCode();
    }
  }, [generateQr, generatePairingCode, loginMethod]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        // Analytics tracking: modal opened
        sessionStartTimeRef.current = Date.now();
        stepStartTimeRef.current = Date.now();
        previousStepRef.current = "";

        // Reset to QR mode and auto-generate QR code via the useEffect ref trigger
        setLoginMethod("qr");
        setStatus("idle");
        setErrorMessage(null);
        setQrValue("");
        setPairingCode("");
        setPhoneNumber("");
        setHasInitiated(false);
        autoGenerateTriggerRef.current += 1;
      } else {
        handleClose();
      }
    },
    [handleClose],
  );

  // ========================================
  // Analytics tracking: step change tracking
  // ========================================
  useEffect(() => {
    if (isOpen) {
      const now = Date.now();
      const stepDuration = now - stepStartTimeRef.current;

      // Record duration of the previous step
      if (previousStepRef.current && previousStepRef.current !== status) {
      }

      // Record new step view
      if (status && status !== previousStepRef.current) {
        previousStepRef.current = status;
        stepStartTimeRef.current = now;
      }
    }
  }, [isOpen, status, loginMethod]);

  useEffect(() => {
    if (isOpen && !hasInitiated && loginMethod === "qr") {
      setHasInitiated(true);
      // Auto-generate QR code when opening in QR mode
      void generateQr();
    }
    // Use autoGenerateTriggerRef in deps instead of generateQr to avoid
    // stale-closure issues (generateQr changes reference on every render due to
    // startPolling/pollStatus deps). isGeneratingRef guard prevents double-calls.
  }, [isOpen, hasInitiated, loginMethod, autoGenerateTriggerRef.current]);

  const renderContent = useMemo(() => {
    switch (status) {
      case "idle":
        // QR mode: if QR is already generated, don't show anything (QR will show in 'qr' status)
        // Phone mode: shows input form above, return null here
        return null;

      case "pending":
        return (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#d9d9d9] bg-[#faf9f6] p-6 text-center">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-[#25D366]"
            />
            <span className="text-sm text-[#6f6e69]">
              {loginMethod === "qr"
                ? t("auth.whatsappGeneratingQr", "Generating QR code...")
                : t(
                    "auth.whatsappGeneratingCode",
                    "Generating pairing code...",
                  )}
            </span>
          </div>
        );

      case "qr":
        return (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#d9d9d9] bg-[#faf9f6] p-4">
            <QRCodeSVG value={qrValue} size={200} />
            <div className="mt-2 text-xs text-[#6f6e69]">
              {t(
                "auth.whatsappScanSteps",
                "Open WhatsApp > Settings > Linked Devices > Link a Device",
              )}
            </div>
          </div>
        );

      case "pairing":
        return (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-[#d9d9d9] bg-[#faf9f6] p-6 text-center">
            <div className="text-sm font-medium text-gray-900">
              {t(
                "auth.whatsappEnterCodeTitle",
                "Enter this code on your phone",
              )}
            </div>
            <div className="flex items-center justify-center gap-2 text-3xl font-mono font-bold tracking-wider text-[#25D366]">
              {pairingCode.slice(0, 4)}-{pairingCode.slice(4)}
            </div>
            <div className="text-xs text-[#6f6e69] max-w-xs">
              {t(
                "auth.whatsappEnterCodeSteps",
                "Open WhatsApp > Settings > Linked Devices > Link with phone number instead",
              )}
            </div>
          </div>
        );

      case "completed":
        return (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-green-600"
            />
            <span className="text-sm font-medium text-green-700">
              {t("auth.whatsappSavingSession", "Saving session...")}
            </span>
            <p className="text-xs text-green-600">
              {t(
                "auth.whatsappPleaseWait",
                "Please don't close this window...",
              )}
            </p>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <RemixIcon
              name="error_warning"
              size="size-8"
              className="text-red-500"
            />
            <span className="text-sm font-medium text-red-700">
              {t("auth.whatsappError", "Something went wrong")}
            </span>
            {errorMessage && (
              <p className="text-xs text-red-600 max-w-xs">{errorMessage}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  }, [status, qrValue, pairingCode, errorMessage, t, loginMethod]);

  // Decide which buttons to display based on status
  const renderFooter = useMemo(() => {
    const regenerateLabel =
      loginMethod === "qr"
        ? t("auth.whatsappRegenerate", "Regenerate QR")
        : t("auth.whatsappRegenerateCode", "Regenerate Code");
    const regenerateIcon = loginMethod === "qr" ? "qr_code" : "smartphone";

    switch (status) {
      case "completed":
        return (
          <DialogFooter className="justify-center">
            <Button onClick={handleClose}>{t("common.ok", "OK")}</Button>
          </DialogFooter>
        );

      case "error":
        return (
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="default"
              onClick={handleRegenerate}
              className="gap-2 flex-1"
            >
              <RemixIcon name="refresh" size="size-4" />
              {t("auth.whatsappTryAgain", "Try Again")}
            </Button>
            <Button
              variant="secondary"
              onClick={handleClose}
              className="flex-1"
            >
              {t("common.cancel", "Cancel")}
            </Button>
          </DialogFooter>
        );

      default:
        return (
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              onClick={handleRegenerate}
              className="gap-2"
              disabled={status === "pending"}
            >
              <RemixIcon name={regenerateIcon} size="size-4" />
              {regenerateLabel}
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              {t("common.cancel", "Cancel")}
            </Button>
          </DialogFooter>
        );
    }
  }, [status, loginMethod, handleRegenerate, handleClose, t]);

  const innerContent = (
    <>
      {/* Login method toggle */}
      {status !== "completed" && status !== "pending" && (
        <div className="flex border-b">
          <button
            type="button"
            className={`flex-1 py-2 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
              loginMethod === "qr"
                ? "text-[#25D366] border-b-2 border-[#25D366]"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => {
              if (loginMethod !== "qr") {
                // Stop any existing polling from phone mode
                clearPolling();
                setLoginMethod("qr");
                setErrorMessage(null);
                setPairingCode("");
                setSessionId("");
                // Always reset to idle when switching to QR mode and regenerate QR
                setStatus("idle");
                setHasInitiated(false);
                void generateQr();
              }
            }}
          >
            <RemixIcon name="qr_code" size="size-4" />
            {t("auth.qrLogin", "QR Code")}
          </button>
          <button
            type="button"
            className={`flex-1 py-2 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
              loginMethod === "phone"
                ? "text-[#25D366] border-b-2 border-[#25D366]"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => {
              if (loginMethod !== "phone") {
                // Stop any existing polling from QR mode
                clearPolling();
                setLoginMethod("phone");
                setErrorMessage(null);
                setQrValue("");
                setPairingCode("");
                setSessionId("");
                // Always reset to idle when switching to phone mode
                setStatus("idle");
                setHasInitiated(false);
              }
            }}
          >
            <RemixIcon name="smartphone" size="size-4" />
            {t("auth.phoneLogin", "Phone Number")}
          </button>
        </div>
      )}

      {/* Phone number input for phone login method */}
      {loginMethod === "phone" && (status === "idle" || status === "error") && (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="whatsapp-phone"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t("auth.phoneNumber", "Phone Number")}
            </label>
            <input
              id="whatsapp-phone"
              type="tel"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="+8613800138000"
              className="w-full px-4 py-3 border border-slate-700 rounded-lg text-black bg-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-all"
            />
            <p className="text-xs text-slate-500 mt-1">
              {t(
                "auth.whatsappPhoneHint",
                "Enter your phone number with country code (e.g., +8613800138000)",
              )}
            </p>
          </div>
          <Button
            onClick={generatePairingCode}
            disabled={
              !phoneNumber ||
              /^\d{10,15}$/.test(phoneNumber.replace(/\D/g, "")) === false
            }
            className="w-full bg-[#25D366] hover:bg-[#1fb855] text-white"
          >
            {t("auth.getPairingCode", "Get Pairing Code")}
          </Button>
        </div>
      )}

      {/* Show content area */}
      {!(
        loginMethod === "phone" &&
        (status === "idle" || status === "error")
      ) && (
        <div className="flex flex-col items-center gap-4 py-4">
          {renderContent}
        </div>
      )}

      {renderFooter}
    </>
  );

  const description = t(
    "auth.whatsappConnectDescription",
    "Link your WhatsApp account to enable messaging features.",
  );

  if (embedded) {
    return (
      <>
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
        {innerContent}
      </>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md !z-[1010]" overlayClassName="z-[130]">
        <DialogHeader>
          <DialogTitle>
            {t("auth.whatsappConnectTitle", "Connect WhatsApp")}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {innerContent}
      </DialogContent>
    </Dialog>
  );
}
