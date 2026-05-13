"use client";

import { RemixIcon } from "@/components/remix-icon";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "./toast";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSWRConfig } from "swr";
import { TelegramLoginWidget } from "./telegram-login-widget";
import { isTauri as checkIsTauri, openUrl } from "@/lib/tauri";
import {
  createIntegrationAccount,
  updateIntegrationAccountCredentials,
  type CreatedIntegrationAccount,
} from "@/lib/integrations/client";
import { getAuthToken } from "@/lib/auth/token-manager";
import { getHomePath } from "@/lib/utils";
import {
  getTgUserNameString,
  type TgUserInfo,
} from "@openloomi/integrations/channels/sources/types";

export const PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
export const CODE_REGEX = /^\d{4,6}$/;
// Login timeout (seconds)
const LOGIN_TIMEOUT = 120;
// Interval to prevent duplicate requests (milliseconds)
const QR_REQUEST_THROTTLE = 120000;

interface TelegramTokenFormProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
  // For reconnection: if provided, will update existing account instead of creating new
  reconnectAccountId?: string;
  /** When true, renders form content inline without the fullscreen overlay wrapper */
  embedded?: boolean;
}

export function TelegramTokenForm({
  isOpen,
  onClose,
  isMobile = false,
  reconnectAccountId,
  embedded = false,
}: TelegramTokenFormProps) {
  const captchaId = useId();
  const { t } = useTranslation();
  const { data: session } = useSession();
  const router = useRouter();
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastQrRequestTimeRef = useRef<number>(0);

  // ========================================
  // Analytics tracking: session start time
  // ========================================
  const sessionStartTimeRef = useRef<number>(Date.now());
  const stepStartTimeRef = useRef<number>(Date.now());
  const previousStepRef = useRef<string>("");

  // Detect if running in Tauri environment
  const [isTauri, setIsTauri] = useState(false);

  // Login method: phone (SMS code), qr (QR code) or fast (quick login)
  const [loginMethod, setLoginMethod] = useState<"phone" | "qr" | "fast">(
    "phone",
  );

  // QR code login steps: generate QR, wait for confirmation, enter 2FA password
  const [qrStep, setQrStep] = useState<"generate" | "confirming" | "password">(
    "generate",
  );

  // Preserve original state
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [phoneNumber, setPhoneNumber] = useState("+86");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [qrPassword, setQrPassword] = useState(""); // 2FA password for QR login
  const [sessionId, setSessionId] = useState("");
  const [isSendPhoneLoading, setIsSendPhoneLoading] = useState(false);
  const [isSendCodeLoading, setIsSendCodeLoading] = useState(false);
  const [isSendPasswordLoading, setIsSendPasswordLoading] = useState(false);
  const [isSubmittingQrPassword, setIsSubmittingQrPassword] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  // QR code login related state
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isWaitingForConfirmation, setIsWaitingForConfirmation] =
    useState(false);
  const [qrTimeoutCountdown, setQrTimeoutCountdown] = useState(LOGIN_TIMEOUT);
  const [hasQrError, setHasQrError] = useState(false);

  // Security Prompt
  const [showSecurityPrompt, setShowSecurityPrompt] = useState(true);

  // ========================================
  // Analytics tracking: track step changes
  // ========================================
  const trackStepChange = useCallback(
    (newStep: string) => {
      if (!isOpen) return;

      const now = Date.now();
      const stepDuration = now - stepStartTimeRef.current;

      // Record duration of previous step
      if (previousStepRef.current) {
      }

      // Record new step view

      previousStepRef.current = newStep;
      stepStartTimeRef.current = now;
    },
    [isOpen, loginMethod],
  );

  // Track phone login step changes
  useEffect(() => {
    trackStepChange(`phone_${step}`);
  }, [step, trackStepChange]);

  // Track QR code login step changes
  useEffect(() => {
    if (loginMethod === "qr") {
      trackStepChange(`qr_${qrStep}`);
    }
  }, [qrStep, loginMethod, trackStepChange]);

  // ========================================
  // Analytics tracking: modal open/close
  // ========================================
  useEffect(() => {
    if (isOpen) {
      // Reset session start time
      sessionStartTimeRef.current = Date.now();
      stepStartTimeRef.current = Date.now();
      previousStepRef.current = "";
    }
  }, [isOpen, loginMethod, reconnectAccountId]);

  // ========================================
  // Detect Tauri environment
  // ========================================
  useEffect(() => {
    const checkTauri = async () => {
      try {
        await import("@tauri-apps/api/core");
        setIsTauri(true);
      } catch {
        setIsTauri(false);
        // If not in Tauri environment and current method is fast, switch to phone
        if (loginMethod === "fast") {
          setLoginMethod("phone");
        }
      }
    };

    checkTauri();
  }, []);

  const showCodeHintToast = useCallback(() => {
    toast({
      type: "success",
      duration: 6000,
      description: (
        <div className="flex flex-col gap-3 text-left">
          <div className="flex items-center justify-start">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <Image
                src="/images/telegram-code-hint.jpg"
                alt={t("auth.codeHintAlt")}
                width={320}
                height={200}
                className="size-auto max-h-24"
                sizes="192px"
              />
            </div>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">
              {t("auth.codeHintTitle")}
            </p>
            <p className="mt-1 text-xs leading-4 text-gray-600">
              {t("auth.codeHintDesc")}
            </p>
          </div>
        </div>
      ),
    });
  }, [t]);

  const { mutate: mutateIntegrationAccounts } = useSWRConfig();

  const completeTelegramAuth = useCallback(
    async (
      tgSession: string,
      userInfo: TgUserInfo | null | undefined,
      userId: number | null | undefined,
    ) => {
      if (!tgSession) {
        throw new Error("Missing Telegram session");
      }

      const displayName = getTgUserNameString(userInfo ?? {});
      const normalizedName =
        displayName || userInfo?.userName || "Telegram account";

      try {
        const metadata = {
          userId: userId ?? null,
          userName: userInfo?.userName ?? null,
          firstName: userInfo?.firstName ?? null,
          lastName: userInfo?.lastName ?? null,
          telegramLastError: null,
        };

        const credentials = {
          sessionKey: tgSession,
          user: userInfo ?? null,
          userId: userId ?? null,
        };

        let account: CreatedIntegrationAccount;

        if (reconnectAccountId) {
          // Reconnection mode: update the existing account
          account = await updateIntegrationAccountCredentials(
            reconnectAccountId,
            credentials,
            metadata,
          );
          toast({
            type: "success",
            description: t(
              "auth.telegramReconnectSuccess",
              "Telegram reconnected successfully",
            ),
          });
        } else {
          // Create new account
          account = await createIntegrationAccount({
            platform: "telegram",
            externalId: userId ? String(userId) : tgSession,
            displayName: normalizedName,
            metadata,
            credentials,
            bot: {
              name: `Telegram · ${normalizedName}`,
              description:
                "Automatically created through Telegram authorization",
              adapter: "telegram",
              enable: true,
            },
          });
          toast({ type: "success", description: t("auth.telegramLogin") });
          router.push(getHomePath());
          router.refresh();
        }

        await mutateIntegrationAccounts("/api/integrations");

        // Initialize Telegram User Listener for self-message monitoring
        const currentUserId = session?.user?.id;
        if (currentUserId) {
          try {
            // Get cloud auth token for AI API configuration
            const cloudAuthToken = getAuthToken() || undefined;
            const response = await fetch(
              `/api/telegram/user-listener/init?userId=${encodeURIComponent(currentUserId)}${cloudAuthToken ? `&authToken=${encodeURIComponent(cloudAuthToken)}` : ""}`,
              { method: "GET" },
            );
            if (response.ok) {
              console.log("[Telegram] User Listener initialized successfully");
            }
          } catch (error) {
            console.error(
              "[Telegram] Failed to initialize User Listener:",
              error,
            );
          }
        }

        // Show usage hint after successful connection
        toast({
          type: "info",
          description: t("auth.telegramLoginHint"),
        });

        onClose();
      } catch (error) {
        toast({
          type: "error",
          description:
            error instanceof Error ? error.message : t("auth.submitError"),
        });
        throw error;
      }
    },
    [mutateIntegrationAccounts, onClose, router, t, reconnectAccountId],
  );

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter" || e.keyCode === 13) {
      e.preventDefault();
      action();
    }
  };

  // Handle phone number input
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleanedPhone = e.target.value.trim().replace(/\s+/g, "");
    setPhoneNumber(cleanedPhone);
    if (error) setError("");
  };

  // Handle verification code input
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVerificationCode(e.target.value);
    if (error) setError("");
  };

  // Handle password input
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (error) setError("");
  };

  // Handle 2FA password input for QR code login
  const handleQrPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQrPassword(e.target.value);
    if (error) setError("");
  };

  // Send phone number to get verification code
  const handleSendPhone = async () => {
    if (!PHONE_REGEX.test(phoneNumber)) {
      setError(t("auth.invalidPhoneNumber"));
      return;
    }
    try {
      setIsSendPhoneLoading(true);
      setError("");

      const response = await fetch("/api/telegram/init-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber, sessionId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t("auth.submitError"));
      }
      if ("error" in data && data.error) {
        if (data.error.includes("PHONE_CODE_INVALID")) {
          setError(t("auth.wrongSubmitCode"));
        } else if (data.error.includes("PASSWORD_HASH_INVALID")) {
          setError(t("auth.wrongPassword"));
        } else if (data.error.includes("AUTH_USER_CANCEL")) {
          setError(t("auth.authUserCancel"));
        } else {
          setError(data.error);
        }
      }
      // Check if code is required
      if (data.requiresCode) {
        setSessionId(data.sessionId);
        setStep("code");
        setCountdown(LOGIN_TIMEOUT);
        showCodeHintToast();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("auth.sendFailedAndTryAgain"),
      );
    } finally {
      setIsSendPhoneLoading(false);
    }
  };

  // Submit verification code
  const handleTgSubmitCode = async () => {
    if (!CODE_REGEX.test(verificationCode)) {
      setError(t("auth.invalidSubmitCode"));
      return;
    }

    try {
      setIsSendCodeLoading(true);
      setError("");

      const response = await fetch("/api/telegram/submit-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          code: verificationCode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t("auth.submitError"));
      }
      if ("error" in data && data.error) {
        if (data.error.includes("PHONE_CODE_INVALID")) {
          setError(t("auth.wrongSubmitCode"));
        } else if (data.error.includes("PASSWORD_HASH_INVALID")) {
          setError(t("auth.wrongPassword"));
        } else if (data.error.includes("AUTH_USER_CANCEL")) {
          setError(t("auth.authUserCancel"));
        } else {
          setError(data.error);
        }
      }
      // Check if password is required
      if (data.requiresPassword) {
        setStep("password");
      } else if (data.success && data.user && data.session) {
        await completeTelegramAuth(
          data.session,
          data.user as TgUserInfo | undefined,
          typeof data.userId === "number" ? data.userId : null,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.submitError"));
    } finally {
      setIsSendCodeLoading(false);
    }
  };

  // Submit 2FA password
  const handleTgSubmitPassword = async () => {
    if (!password) {
      setError(t("auth.enterPassword"));
      return;
    }

    try {
      setIsSendPasswordLoading(true);
      setError("");

      const response = await fetch("/api/telegram/submit-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error.includes("INVALID_PASSWORD")) {
          setError(t("auth.invalidPassword"));
        } else if (data.error.includes("PASSWORD_ATTEMPTS_EXCEEDED")) {
          setError(t("auth.passwordAttemptsExceeded"));
          setTimeout(() => {
            setStep("phone");
            setPassword("");
          }, 3000);
        } else {
          throw new Error(data.error || t("auth.passwordError"));
        }
        return;
      }

      if (data.success && data.user && data.session) {
        await completeTelegramAuth(
          data.session,
          data.user as TgUserInfo | undefined,
          typeof data.userId === "number" ? data.userId : null,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.passwordError"));
    } finally {
      setIsSendPasswordLoading(false);
    }
  };

  // Submit 2FA password for QR code login
  const handleQrSubmitPassword = async () => {
    if (!qrPassword) {
      setError(t("auth.enterPassword"));
      return;
    }

    try {
      setIsSubmittingQrPassword(true);
      setError("");

      const response = await fetch("/api/telegram/submit-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          password: qrPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error.includes("INVALID_PASSWORD")) {
          setError(t("auth.invalidPassword"));
        } else if (data.error.includes("PASSWORD_ATTEMPTS_EXCEEDED")) {
          setError(t("auth.passwordAttemptsExceeded"));
          setTimeout(() => {
            // Reset QR code login flow
            resetQrState();
          }, 3000);
        } else {
          throw new Error(data.error || t("auth.passwordError"));
        }
        return;
      }

      if (data.success && data.user && data.session) {
        await completeTelegramAuth(
          data.session,
          data.user as TgUserInfo | undefined,
          typeof data.userId === "number" ? data.userId : null,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.passwordError"));
    } finally {
      setIsSubmittingQrPassword(false);
    }
  };

  // Resend verification code
  const handleResendCode = async () => {
    if (countdown > 0) return;

    try {
      setIsSendCodeLoading(true);
      setError("");

      const response = await fetch("/api/telegram/init-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber, sessionId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t("auth.submitError"));
      }

      setSessionId(data.sessionId);
      setVerificationCode("");
      setCountdown(LOGIN_TIMEOUT);
      showCodeHintToast();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.submitError"));
    } finally {
      setIsSendCodeLoading(false);
    }
  };

  // Reset QR code state
  const resetQrState = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setQrCodeUrl("");
    setIsGeneratingQr(false);
    setIsWaitingForConfirmation(false);
    setQrPassword("");
    setError("");
    setHasQrError(false);
    setQrTimeoutCountdown(LOGIN_TIMEOUT);
  }, []);

  // Generate login QR code and wait for confirmation
  const generateQrCodeAndWait = useCallback(async () => {
    // Prevent duplicate calls: skip if already generating or has error
    if (isGeneratingQr || hasQrError) return;

    // Throttle control: prevent multiple calls in short time
    const now = Date.now();
    if (now - lastQrRequestTimeRef.current < QR_REQUEST_THROTTLE) {
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      setIsGeneratingQr(true);
      setError("");
      setIsWaitingForConfirmation(false);
      setQrStep("confirming");
      lastQrRequestTimeRef.current = now;

      // Step 1: Generate QR code
      const qrResponse = await fetch("/api/telegram/generate-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const qrData = await qrResponse.json();
      if (!qrResponse.ok) {
        throw new Error(qrData.error || t("auth.qrGenerateError"));
      }

      setQrCodeUrl(qrData.qrUrl);
      setSessionId(qrData.sessionId);
      setIsGeneratingQr(false);
      setIsWaitingForConfirmation(true);
      setQrTimeoutCountdown(LOGIN_TIMEOUT);

      // Step 2: Wait for user scan confirmation (backend handles waiting logic)
      const confirmResponse = await Promise.race([
        fetch(
          `/api/telegram/wait-qr-confirmation?sessionId=${qrData.sessionId}`,
          {
            method: "GET",
          },
        ),
        // Frontend timeout control (as safety measure)
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(t("auth.qrTimeout"))),
            LOGIN_TIMEOUT * 1000,
          ),
        ),
      ]);

      const confirmData = await (confirmResponse as Response).json();

      if (confirmData.requiresPassword) {
        setQrStep("password");
        setIsWaitingForConfirmation(false);
        return;
      }

      // Login successful
      if (confirmData.success && confirmData.user && confirmData.session) {
        await completeTelegramAuth(
          confirmData.session,
          confirmData.user as TgUserInfo | undefined,
          typeof confirmData.userId === "number" ? confirmData.userId : null,
        );
      }
    } catch (err) {
      // Ignore abort errors (user cancelled)
      if (!(err instanceof Error) || err.name !== "AbortError") {
        const errorMsg =
          err instanceof Error ? err.message : t("auth.qrProcessError");
        setError(errorMsg);
        setHasQrError(true);

        if (errorMsg === t("auth.qrTimeout")) {
          setTimeout(() => {
            if (loginMethod === "qr" && qrStep === "confirming") {
              resetQrState();
              generateQrCodeAndWait();
            }
          }, 2000);
        }
      }
      setQrStep("generate");
    } finally {
      setIsGeneratingQr(false);
      setIsWaitingForConfirmation(false);
    }
  }, [
    completeTelegramAuth,
    hasQrError,
    isGeneratingQr,
    loginMethod,
    qrStep,
    resetQrState,
    t,
  ]);

  // Cancel QR code login
  const cancelQrLogin = () => {
    resetQrState();
  };

  // Refresh QR code - ensure error state is reset
  const refreshQrCode = () => {
    // Analytics tracking: QR refresh

    // Reset error state and QR code state to allow regeneration
    resetQrState();
    // Reset throttle timestamp, allow immediate refresh
    lastQrRequestTimeRef.current = 0;
    setTimeout(() => {
      generateQrCodeAndWait();
    }, 300);
  };

  // Countdown effect
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // QR code timeout countdown
  useEffect(() => {
    if (isWaitingForConfirmation && qrTimeoutCountdown > 0) {
      const timer = setTimeout(() => {
        setQrTimeoutCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
    if (qrTimeoutCountdown === 0 && isWaitingForConfirmation) {
      // Analytics tracking: QR expired

      setError(t("auth.qrTimeout"));
      setIsWaitingForConfirmation(false);
      setQrStep("generate");

      // Auto-refresh QR code after timeout
      setTimeout(() => {
        if (loginMethod === "qr") {
          refreshQrCode();
        }
      }, 2000);
    }
  }, [isWaitingForConfirmation, loginMethod, qrTimeoutCountdown, sessionId, t]);

  // Handle login method switch - optimized logic
  useEffect(() => {
    // Skip if component is not open
    if (!isOpen) return;

    // Cancel any ongoing QR code requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (loginMethod === "qr") {
      // Generate QR code when switching to QR login
      setTimeout(() => {
        generateQrCodeAndWait();
      }, 300);
    } else {
      resetQrState();
    }

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [generateQrCodeAndWait, isOpen, loginMethod, resetQrState]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleClose = () => {
    // Analytics tracking: modal close
    const sessionDuration = Date.now() - sessionStartTimeRef.current;
    const hasProgress = sessionId || verificationCode || password || qrPassword;

    resetQrState();
    onClose();
  };

  if (!isOpen && !embedded) return null;

  if (showSecurityPrompt) {
    return (
      <div
        className={`fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center animate-fade-in ${isMobile ? "p-4" : ""}`}
      >
        <div
          className={`${
            isMobile
              ? "bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col"
              : "bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4"
          } transition-all duration-300 animate-scale-in overflow-y-auto`}
          style={{
            maxHeight: isMobile ? "85vh" : "70vh",
          }}
        >
          {/* Title bar */}
          <div
            className={`${isMobile ? "p-4 border-b flex justify-between items-center" : "flex justify-between items-center mt-4 mb-4 mx-4"}`}
          >
            <h3 className="text-xl font-semibold text-gray-900 flex items-center">
              <RemixIcon
                name="send_plane"
                size="size-5"
                className="mr-2 text-sky-500"
              />
              {t("securityPrompt.title")}
            </h3>

            <button
              type="button"
              onClick={handleClose}
              className={`${
                isMobile
                  ? "p-2 rounded-full hover:bg-gray-100 transition-colors bg-gray-100"
                  : "p-1 rounded-full hover:bg-gray-100 transition-colors"
              }`}
              aria-label={t("common.close")}
            >
              <RemixIcon
                name="close"
                size={isMobile ? "size-6" : "size-5"}
                className="text-gray-700"
              />
            </button>
          </div>

          <div
            className={`${isMobile ? "flex-1 overflow-y-auto p-4" : "overflow-y-auto max-h-[60vh]"}`}
          >
            <div className="space-y-6">
              <p className="text-gray-700">{t("securityPrompt.description")}</p>

              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900">
                  {t("securityPrompt.commitmentTitle")}
                </h4>

                {/* Permissions description */}
                <div className="space-y-4 pl-2 border-l-2 border-blue-100">
                  <div>
                    <h5 className="font-medium text-gray-900">
                      {t("securityPrompt.permissions.readMessages")}
                    </h5>
                    <p className="text-sm text-gray-600 mt-1">
                      {t("securityPrompt.permissions.readMessagesDesc")}
                    </p>
                  </div>

                  <div>
                    <h5 className="font-medium text-gray-900">
                      {t("securityPrompt.permissions.sendMessages")}
                    </h5>
                    <p className="text-sm text-gray-600 mt-1">
                      {t("securityPrompt.permissions.sendMessagesDesc")}
                    </p>
                  </div>

                  <div>
                    <h5 className="font-medium text-gray-900">
                      {t("securityPrompt.permissions.viewGroups")}
                    </h5>
                    <p className="text-sm text-gray-600 mt-1">
                      {t("securityPrompt.permissions.viewGroupsDesc")}
                    </p>
                  </div>
                </div>

                {checkIsTauri() ? (
                  <button
                    type="button"
                    onClick={() => openUrl("https://app.openloomi.ai/privacy")}
                    className="text-sky-500 hover:underline text-sm flex items-center bg-transparent border-none cursor-pointer p-0"
                  >
                    {t("securityPrompt.learnMore")}
                  </button>
                ) : (
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-500 hover:underline text-sm flex items-center"
                  >
                    {t("securityPrompt.learnMore")}
                  </a>
                )}

                {/* Authorization steps */}
                <div className="mt-6">
                  <h4 className="text-lg font-medium text-gray-900 mb-2">
                    {t("securityPrompt.stepsTitle")}
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {t("securityPrompt.stepsDesc")}
                  </p>

                  <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-700">
                    <li>{t("securityPrompt.step1")}</li>
                    <li>{t("securityPrompt.step2")}</li>
                    <li>{t("securityPrompt.step3")}</li>
                    <li>{t("securityPrompt.step4")}</li>
                    <li>{t("securityPrompt.step5")}</li>
                  </ol>
                </div>

                {/* Privacy notice */}
                <div className="p-3 bg-amber-50 rounded-lg mt-4">
                  <p className="text-xs text-amber-800">
                    {t("securityPrompt.privacyNotice")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Continue button */}
          <div className={`${isMobile ? "p-4 border-t" : "mt-6"}`}>
            <button
              type="button"
              onClick={() => setShowSecurityPrompt(false)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sky-500 text-white hover:bg-sky-600 font-medium rounded-lg transition-all"
            >
              {t("securityPrompt.continueButton")}
              <RemixIcon name="arrow_right" size="size-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const telegramInner = (
    <>
      {/* Login method switch tabs */}
      <div className="flex border-b px-4 sm:px-6">
        {/* Phone number login */}
        <button
          type="button"
          className={`flex-1 py-2 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
            loginMethod === "phone"
              ? "text-sky-500 border-b-2 border-sky-500"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => {
            if (loginMethod !== "phone") {
              // Analytics tracking: method switch

              if (loginMethod === "qr") {
                cancelQrLogin();
              }
              setLoginMethod("phone");
            }
          }}
          disabled={qrStep === "password" || isGeneratingQr}
        >
          <RemixIcon name="smartphone" size="size-4" />
          {t("auth.phoneLogin")}
        </button>

        {/* QR code login */}
        <button
          type="button"
          className={`flex-1 py-2 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
            loginMethod === "qr"
              ? "text-sky-500 border-b-2 border-sky-500"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => {
            if (loginMethod !== "qr") {
              // Analytics tracking: method switch

              setLoginMethod("qr");
            }
          }}
          disabled={qrStep === "password" || isGeneratingQr}
        >
          <RemixIcon name="qr_code" size="size-4" />
          {t("auth.qrLogin")}
        </button>

        {/* Quick login tab - only shown in Tauri environment as the third tab */}
        {isTauri && (
          <button
            type="button"
            className={`flex-1 py-2 px-4 flex items-center justify-center gap-2 font-medium transition-colors ${
              loginMethod === "fast"
                ? "text-sky-500 border-b-2 border-sky-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => {
              if (loginMethod !== "fast") {
                // Analytics tracking: method switch

                if (loginMethod === "qr") {
                  cancelQrLogin();
                }
                setLoginMethod("fast");
              }
            }}
            disabled={qrStep === "password" || isGeneratingQr}
          >
            <RemixIcon name="zap" size="size-4" />
            {t("auth.quickLogin", "Quick login")}
          </button>
        )}
      </div>

      {/* Content area */}
      <div
        className={`flex-1 overflow-y-auto ${isMobile ? "p-4" : "px-6 py-4"}`}
      >
        <div className="space-y-4">
          <div className={isMobile ? "" : "p-6"}>
            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded-lg flex items-center gap-2 text-red-800 text-sm">
                <RemixIcon name="error_warning" size="size-4" />
                <span>{error}</span>
              </div>
            )}

            {/* Phone login flow */}
            {loginMethod === "phone" &&
              (step === "phone" ? (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor={captchaId}
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t("auth.phone")}
                    </label>
                    <div className="relative">
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={handlePhoneChange}
                        placeholder="+8613800138000"
                        className={`w-full px-4 py-${isMobile ? "3" : "3"} border border-slate-700 rounded-lg text-black bg-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-${isMobile ? "lg" : "base"}`}
                        autoComplete="tel"
                        onKeyDown={(e) => handleKeyDown(e, handleSendPhone)}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {t("auth.inputPhoneNumber")}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSendPhone}
                    disabled={
                      isSendPhoneLoading || !PHONE_REGEX.test(phoneNumber)
                    }
                    className={`w-full flex items-center justify-center gap-2 px-4 py-${isMobile ? "3" : "3"} bg-sky-500 text-white hover:bg-sky-600 font-medium rounded-lg transition-all disabled:bg-slate-700 disabled:cursor-not-allowed text-${isMobile ? "lg" : "base"}`}
                  >
                    {isSendPhoneLoading ? (
                      <RemixIcon
                        name="loader_2"
                        size="size-5"
                        className="animate-spin"
                      />
                    ) : (
                      <RemixIcon name="arrow_right" size="size-5" />
                    )}
                    {t("auth.sendCode")}
                  </button>
                </div>
              ) : step === "code" ? (
                <div className="space-y-4">
                  {/* Verification code input section */}
                  <div>
                    <label
                      htmlFor={captchaId}
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t("auth.code")}
                    </label>
                    <div className="relative">
                      <input
                        type={isMobile ? "tel" : "text"}
                        value={verificationCode}
                        onChange={handleCodeChange}
                        placeholder={t("auth.codePlaceHolder")}
                        className={`w-full px-4 py-${isMobile ? "3" : "3"} border border-slate-700 rounded-lg text-black bg-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-${isMobile ? "lg" : "base"}`}
                        maxLength={6}
                        onKeyDown={(e) => handleKeyDown(e, handleTgSubmitCode)}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {t("auth.sentCode")}, {t("auth.seeInTelegramApp")}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("phone");
                      }}
                      className="mt-2 text-xs font-medium text-sky-600 hover:underline"
                    >
                      {t("auth.changePhone")}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isSendCodeLoading || countdown > 0}
                    className={`w-full flex items-center justify-center gap-1 rounded-lg border border-sky-500 px-4 py-${isMobile ? "3" : "3"} text-sky-600 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 text-${isMobile ? "lg" : "base"}`}
                  >
                    {countdown > 0 ? (
                      <span>{t("auth.resendAfter", { countdown })}</span>
                    ) : (
                      <>
                        <RemixIcon name="refresh" size="size-4" />
                        <span>{t("auth.resend")}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleTgSubmitCode}
                    disabled={
                      isSendCodeLoading || !CODE_REGEX.test(verificationCode)
                    }
                    className={`w-full flex items-center justify-center gap-2 px-4 py-${isMobile ? "3" : "3"} bg-sky-500 text-white hover:bg-sky-600 font-medium rounded-lg transition-all disabled:bg-slate-700 disabled:cursor-not-allowed text-${isMobile ? "lg" : "base"}`}
                  >
                    {isSendCodeLoading ? (
                      <RemixIcon
                        name="loader_2"
                        size="size-5"
                        className="animate-spin"
                      />
                    ) : (
                      <RemixIcon name="check" size="size-5" />
                    )}
                    {t("auth.finishLogin")}
                  </button>
                </div>
              ) : (
                // Password step
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor={captchaId}
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t("auth.twoStepVerification")}
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        value={password}
                        onChange={handlePasswordChange}
                        placeholder={t("auth.enterPassword")}
                        className={`w-full px-4 py-${isMobile ? "3" : "3"} border border-slate-700 rounded-lg text-black bg-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-${isMobile ? "lg" : "base"}`}
                        onKeyDown={(e) =>
                          handleKeyDown(e, handleTgSubmitPassword)
                        }
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {t("auth.passwordRequiredDesc")}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      cancelQrLogin();
                      setLoginMethod("phone");
                      setStep("phone");
                    }}
                    className="text-xs font-medium text-sky-600 hover:underline"
                  >
                    {t("auth.changePhone")}
                  </button>

                  <button
                    type="button"
                    onClick={handleTgSubmitPassword}
                    disabled={isSendPasswordLoading || !password}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-${isMobile ? "3" : "3"} bg-sky-500 text-white hover:bg-sky-600 font-medium rounded-lg transition-all disabled:bg-slate-700 disabled:cursor-not-allowed text-${isMobile ? "lg" : "base"}`}
                  >
                    {isSendPasswordLoading ? (
                      <RemixIcon
                        name="loader_2"
                        size="size-5"
                        className="animate-spin"
                      />
                    ) : (
                      <RemixIcon name="check" size="size-5" />
                    )}
                    {t("auth.submitPassword")}
                  </button>
                </div>
              ))}

            {/* QR code login flow (supports 2FA password) */}
            {loginMethod === "qr" && (
              <div className="space-y-6 items-center justify-center">
                {/* Generate QR code and wait for confirmation steps */}
                {(qrStep === "generate" || qrStep === "confirming") && (
                  <>
                    <div className="text-center">
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        {t("auth.scanQrTitle")}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {t("auth.scanQrDesc")}
                      </p>

                      {isWaitingForConfirmation && (
                        <div className="mt-2 flex items-center justify-center gap-1 text-sm text-gray-600">
                          <RemixIcon name="clock" size="size-3.5" />
                          <span>
                            {t("auth.qrExpiresIn", {
                              seconds: qrTimeoutCountdown,
                            })}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="relative bg-white p-4 rounded-lg shadow-md border border-gray-200 flex items-center justify-center">
                      {isGeneratingQr ? (
                        <RemixIcon
                          name="loader_2"
                          size="size-10"
                          className="animate-spin text-sky-500"
                        />
                      ) : qrCodeUrl ? (
                        <>
                          <QRCodeSVG
                            value={qrCodeUrl}
                            size={200}
                            bgColor="#ffffff"
                            fgColor="#000000"
                            level="H"
                          />
                        </>
                      ) : (
                        <div className="text-center text-gray-500 p-8">
                          {t("auth.noQrCode")}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      {isWaitingForConfirmation ? (
                        <button
                          type="button"
                          onClick={cancelQrLogin}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-3 font-medium text-white transition hover:bg-red-600"
                        >
                          <RemixIcon name="close" size="size-5" />
                          {t("auth.cancelQrLogin")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={refreshQrCode}
                          disabled={isGeneratingQr}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-3 font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isGeneratingQr ? (
                            <RemixIcon
                              name="loader_2"
                              size="size-5"
                              className="animate-spin"
                            />
                          ) : (
                            <RemixIcon name="refresh" size="size-5" />
                          )}
                          {t("auth.refreshQr")}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          cancelQrLogin();
                          setLoginMethod("phone");
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-3 font-medium text-gray-800 transition hover:bg-gray-200"
                      >
                        <RemixIcon name="smartphone" size="size-5" />
                        {t("auth.usePhoneLogin")}
                      </button>
                    </div>
                  </>
                )}

                {/* 2FA password step for QR code login */}
                {qrStep === "password" && (
                  <div className="space-y-4 w-full">
                    <div className="text-center">
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        {t("auth.twoStepVerification")}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {t("auth.passwordRequiredDesc")}
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor={`${captchaId}-qr-password`}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        {t("auth.enterPassword")}
                      </label>
                      <div className="relative">
                        <input
                          type="password"
                          value={qrPassword}
                          onChange={handleQrPasswordChange}
                          placeholder={t("auth.enterPassword")}
                          className={`w-full px-4 py-${isMobile ? "3" : "3"} border border-slate-700 rounded-lg text-black bg-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-${isMobile ? "lg" : "base"}`}
                          onKeyDown={(e) =>
                            handleKeyDown(e, handleQrSubmitPassword)
                          }
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleQrSubmitPassword}
                      disabled={isSubmittingQrPassword || !qrPassword}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-${isMobile ? "3" : "3"} bg-sky-500 text-white hover:bg-sky-600 font-medium rounded-lg transition-all disabled:bg-slate-700 disabled:cursor-not-allowed text-${isMobile ? "lg" : "base"}`}
                    >
                      {isSubmittingQrPassword ? (
                        <RemixIcon
                          name="loader_2"
                          size="size-5"
                          className="animate-spin"
                        />
                      ) : (
                        <RemixIcon name="check" size="size-5" />
                      )}
                      {t("auth.submitPassword")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Quick login flow (Deep Link - Tauri only) */}
            {loginMethod === "fast" && (
              <div className="space-y-6 items-center justify-center">
                <div className="text-center">
                  <h4 className="text-lg font-medium text-gray-900 mb-2">
                    {t("auth.quickLoginTitle", "One-click authorized login")}
                  </h4>
                  <p className="text-sm text-gray-500">
                    {t(
                      "auth.quickLoginDesc",
                      "If Telegram Desktop is installed locally, you can log in directly using the existing session without entering a phone number or verification code",
                    )}
                  </p>
                </div>

                <div className="flex items-center justify-center">
                  <TelegramLoginWidget
                    onSuccess={async (data) => {
                      console.log(
                        "[Telegram] Desktop session auth success:",
                        data,
                      );
                      // Backend has already created the account and bot
                      // Frontend just needs to show success toast, refresh data and close dialog
                      toast({
                        type: "success",
                        description: t(
                          "auth.telegramImportSuccess",
                          "Telegram Desktop session imported successfully",
                        ),
                      });

                      // Refresh integrations list
                      await mutateIntegrationAccounts("/api/integrations");

                      // Initialize Telegram User Listener for self-message monitoring
                      const currentUserId = session?.user?.id;
                      if (currentUserId) {
                        try {
                          // Get cloud auth token for AI API configuration
                          const cloudAuthToken = getAuthToken() || undefined;
                          const response = await fetch(
                            `/api/telegram/user-listener/init?userId=${encodeURIComponent(currentUserId)}${cloudAuthToken ? `&authToken=${encodeURIComponent(cloudAuthToken)}` : ""}`,
                            { method: "GET" },
                          );
                          if (response.ok) {
                            console.log(
                              "[Telegram] User Listener initialized successfully",
                            );
                          }
                        } catch (error) {
                          console.error(
                            "[Telegram] Failed to initialize User Listener:",
                            error,
                          );
                        }
                      }

                      // Show usage hint after successful connection
                      toast({
                        type: "info",
                        description: t("auth.telegramLoginHint"),
                      });

                      // Navigate to home page
                      router.push(getHomePath());
                      router.refresh();

                      // Close dialog
                      onClose();
                    }}
                    onError={(error) => {
                      console.error(
                        "[Telegram] Desktop session auth error:",
                        error,
                      );
                      // Detect AUTH_KEY_UNREGISTERED error, provide friendly message
                      if (
                        typeof error === "string" &&
                        error.includes("AUTH_KEY_UNREGISTERED")
                      ) {
                        setError(t("auth.desktopSessionExpired"));
                      } else {
                        setError(error);
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return telegramInner;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center animate-fade-in ${isMobile ? "p-4" : "p-6"}`}
    >
      <div
        className={`${
          isMobile
            ? "bg-white rounded-xl shadow-2xl w-full max-w-md mx-auto flex flex-col overflow-y-auto"
            : "bg-white rounded-xl shadow-2xl w-full max-w-xl mx-auto flex flex-col overflow-y-auto"
        } transition-all duration-300 animate-scale-in`}
        style={{
          maxHeight: isMobile
            ? "calc(100dvh - 32px)"
            : "min(720px, calc(100vh - 64px))",
        }}
      >
        {/* Title bar */}
        <div
          className={`${isMobile ? "p-4 border-b flex justify-between items-center" : "flex justify-between items-center mb-4 mx-4 mt-4"}`}
        >
          <h3 className="text-xl font-semibold text-gray-900 flex items-center">
            <RemixIcon
              name="send_plane"
              size="size-5"
              className="mr-2 text-sky-500"
            />
            Telegram {t("common.authorizeBtn")}
          </h3>
          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            className={`${
              isMobile
                ? "p-2 rounded-full hover:bg-gray-100 transition-colors bg-gray-100"
                : "p-1 rounded-full hover:bg-gray-100 transition-colors"
            }`}
            aria-label={t("common.close")}
          >
            <RemixIcon
              name="close"
              size={isMobile ? "size-6" : "size-5"}
              className="text-gray-700"
            />
          </button>
        </div>
        {telegramInner}
      </div>
    </div>
  );
}
