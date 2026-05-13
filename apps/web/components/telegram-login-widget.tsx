"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { openUrl } from "@/lib/tauri";

type TelegramLoginWidgetProps = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
};

type TelegramDesktopInfo = {
  installed: boolean;
  has_session: boolean;
  accounts: Array<{
    user_id: number;
    phone: string;
    first_name: string;
    last_name?: string;
    username?: string;
    is_premium: boolean;
  }>;
  data_path?: string;
  is_app_store_version?: boolean;
};

/**
 * Telegram Login Widget component - Quick login
 * Auto-detects local Telegram Desktop in Tauri environment and reads session
 */
export function TelegramLoginWidget({
  onSuccess,
  onError,
}: TelegramLoginWidgetProps) {
  const { t } = useTranslation();
  const [isTauri, setIsTauri] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<TelegramDesktopInfo | null>(
    null,
  );
  const [isLoadingDesktop, setIsLoadingDesktop] = useState(false);
  const [showCustomPath, setShowCustomPath] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [isValidatingPath, setIsValidatingPath] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  useEffect(() => {
    // Detect if running in Tauri environment
    const checkTauri = async () => {
      try {
        await import("@tauri-apps/api/core");
        setIsTauri(true);
        // Detect local Telegram Desktop
        await detectTelegramDesktop();
      } catch {
        setIsTauri(false);
      }
    };

    checkTauri();
  }, []);

  // Detect local Telegram Desktop
  const detectTelegramDesktop = async () => {
    setIsLoadingDesktop(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<TelegramDesktopInfo>("detect_telegram_desktop");
      console.log("[Telegram] Desktop info:", info);
      setDesktopInfo(info);
    } catch (error) {
      console.error("[Telegram] Failed to detect Telegram Desktop:", error);
    } finally {
      setIsLoadingDesktop(false);
    }
  };

  // Validate custom path
  const validateCustomPath = async (path?: string) => {
    const targetPath = path || customPath;
    if (!targetPath) return;

    setIsValidatingPath(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<TelegramDesktopInfo>(
        "check_custom_telegram_path",
        {
          path: targetPath,
        },
      );
      console.log("[Telegram] Custom path info:", info);
      setDesktopInfo(info);
    } catch (error) {
      console.error("[Telegram] Failed to validate custom path:", error);
      setDesktopInfo({
        installed: false,
        has_session: false,
        accounts: [],
        data_path: `${targetPath}\nValidation failed: ${error}`,
      });
    } finally {
      setIsValidatingPath(false);
    }
  };

  // Login using local Telegram Desktop session
  const handleUseDesktopSession = async () => {
    setIsLoggingIn(true);
    setLoginSuccess(false);
    try {
      console.log("[Telegram] Attempting to use desktop session");

      const isTauriEnv =
        typeof window !== "undefined" &&
        //@ts-ignore
        window.__TAURI__;

      if (!isTauriEnv) {
        if (onError) {
          onError(
            t(
              "telegram.loginWidget.tauriOnly",
              "Quick login is only supported in the desktop app",
            ),
          );
        }
        return;
      }

      const response = await fetch("/api/telegram/login-with-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tdataPath: desktopInfo?.data_path || "",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Session login failed");
      }

      const result = await response.json();
      console.log("[Telegram] Session login success:", result);

      setLoginSuccess(true);

      // Immediately call onSuccess, let parent component handle subsequent logic (show toast, refresh, close dialog)
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (error) {
      console.error("[Telegram] Failed to login with desktop session:", error);
      setLoginSuccess(false);
      if (onError) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : t(
                "telegram.loginWidget.sessionReadFailed",
                "Failed to read session, please retry",
              );
        onError(errorMsg);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-0 shadow-none">
      <CardContent className="flex flex-col items-center gap-4 p-0">
        {isTauri ? (
          // Tauri environment: detect local Telegram Desktop
          <>
            {isLoadingDesktop ? (
              <div className="flex items-center gap-2 text-gray-600">
                <RemixIcon
                  name="loader_2"
                  size="size-5"
                  className="animate-spin"
                />
                <span>
                  {t(
                    "telegram.loginWidget.detecting",
                    "Detecting Telegram Desktop...",
                  )}
                </span>
              </div>
            ) : desktopInfo?.installed && desktopInfo.has_session ? (
              // Detected local Telegram Desktop with session
              <div className="w-full space-y-3">
                <div className="flex items-center gap-2 text-green-600">
                  <RemixIcon name="circle_check" size="size-5" />
                  <span className="font-medium">
                    {t(
                      "telegram.loginWidget.detected",
                      "Local Telegram Desktop detected",
                    )}
                  </span>
                </div>

                {/* Important notice */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-900">
                    <span className="font-medium">
                      {t(
                        "telegram.loginWidget.importantNotice",
                        "Important notice:",
                      )}
                    </span>
                    {t(
                      "telegram.loginWidget.officialDownloadWarning",
                      "Please make sure to download from the official website (not Microsoft Store or App Store), otherwise please use phone login or QR code scan.",
                    )}
                    <button
                      type="button"
                      onClick={() => openUrl("https://desktop.telegram.org/")}
                      className="underline hover:text-amber-700 ml-1"
                    >
                      desktop.telegram.org
                    </button>
                  </p>
                </div>

                {desktopInfo.accounts.length > 0 ? (
                  <div className="space-y-2">
                    {desktopInfo.accounts.map((account) => (
                      <button
                        key={account.user_id}
                        type="button"
                        onClick={handleUseDesktopSession}
                        disabled={isLoggingIn || loginSuccess}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-sky-500 text-white hover:bg-sky-600 disabled:bg-sky-400 disabled:cursor-not-allowed rounded-lg transition-all"
                      >
                        {isLoggingIn ? (
                          <RemixIcon
                            name="loader_2"
                            size="size-5"
                            className="animate-spin"
                          />
                        ) : loginSuccess ? (
                          <RemixIcon name="circle_check" size="size-5" />
                        ) : (
                          <RemixIcon name="smartphone" size="size-5" />
                        )}
                        <div className="flex-1 text-left">
                          <div className="font-medium">
                            {isLoggingIn
                              ? t(
                                  "telegram.loginWidget.loggingIn",
                                  "Signing in...",
                                )
                              : loginSuccess
                                ? t(
                                    "telegram.loginWidget.loginSuccess",
                                    "Login successful!",
                                  )
                                : `${account.first_name} ${account.last_name || ""}`}
                          </div>
                          {!isLoggingIn && !loginSuccess && (
                            <div className="text-sm text-sky-100">
                              {account.phone}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  // No account info parsed but session detected, show generic login button
                  <button
                    type="button"
                    onClick={handleUseDesktopSession}
                    disabled={isLoggingIn || loginSuccess}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sky-500 text-white hover:bg-sky-600 disabled:bg-sky-400 disabled:cursor-not-allowed font-medium rounded-lg transition-all"
                  >
                    {isLoggingIn ? (
                      <RemixIcon
                        name="loader_2"
                        size="size-5"
                        className="animate-spin"
                      />
                    ) : loginSuccess ? (
                      <RemixIcon name="circle_check" size="size-5" />
                    ) : (
                      <RemixIcon name="smartphone" size="size-5" />
                    )}
                    <span>
                      {isLoggingIn
                        ? t("telegram.loginWidget.loggingIn", "Signing in...")
                        : loginSuccess
                          ? t(
                              "telegram.loginWidget.loginSuccess",
                              "Login successful!",
                            )
                          : t(
                              "telegram.loginWidget.useLocalSession",
                              "Login using local Telegram Desktop session",
                            )}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              // No local session detected
              <div className="w-full space-y-3">
                {/* Custom path option */}
                {!showCustomPath ? (
                  <div className="text-center space-y-3">
                    <p className="text-sm text-gray-500">
                      {t(
                        "telegram.loginWidget.needDesktop",
                        "Quick login requires local Telegram Desktop installation",
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {t(
                        "telegram.loginWidget.downloadFromOfficial",
                        "Please download from the official website (not Microsoft Store or App Store)",
                      )}{" "}
                      <button
                        type="button"
                        onClick={() => openUrl("https://desktop.telegram.org/")}
                        className="text-sky-500 hover:underline"
                      >
                        desktop.telegram.org
                      </button>
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowCustomPath(true)}
                      className="text-sm text-sky-500 hover:text-sky-600 hover:underline"
                    >
                      {t(
                        "telegram.loginWidget.specifyCustomPath",
                        "Or specify a custom client path",
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <label
                      htmlFor="telegram-path"
                      className="text-sm font-medium text-gray-700"
                    >
                      {t(
                        "telegram.loginWidget.pathLabel",
                        "Telegram Desktop path:",
                      )}
                    </label>

                    {/* macOS shortcut buttons */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomPath("/Applications/Telegram Desktop.app");
                          validateCustomPath(
                            "/Applications/Telegram Desktop.app",
                          );
                        }}
                        className="text-xs px-2 py-1 bg-sky-100 text-sky-700 hover:bg-sky-200 rounded"
                      >
                        /Applications/Telegram Desktop.app
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const homeDir = process.env.HOME || "~";
                          const path = `${homeDir}/Library/Application Support/Telegram Desktop`;
                          setCustomPath(path);
                          validateCustomPath(path);
                        }}
                        className="text-xs px-2 py-1 bg-sky-100 text-sky-700 hover:bg-sky-200 rounded"
                      >
                        ~/Library/Application Support/...
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => validateCustomPath()}
                        disabled={!customPath || isValidatingPath}
                        className="flex-1 px-3 py-2 bg-sky-500 text-white hover:bg-sky-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                      >
                        {isValidatingPath ? (
                          <span className="flex items-center justify-center gap-2">
                            <RemixIcon
                              name="loader_2"
                              size="size-4"
                              className="animate-spin"
                            />
                            {t(
                              "telegram.loginWidget.validating",
                              "Validating...",
                            )}
                          </span>
                        ) : (
                          t(
                            "telegram.loginWidget.validatePath",
                            "Validate path",
                          )
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomPath(false);
                          setCustomPath("");
                        }}
                        className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors text-sm"
                      >
                        {t("common.cancel", "Cancel")}
                      </button>
                    </div>

                    {/* Validation result hints */}
                    {desktopInfo?.data_path && (
                      <div className="text-xs whitespace-pre-wrap">
                        {desktopInfo.data_path.includes(
                          "Path does not exist",
                        ) ||
                        desktopInfo.data_path.includes(
                          "Data directory does not exist",
                        ) ||
                        desktopInfo.data_path.includes("Cannot determine") ||
                        desktopInfo.data_path.includes("Validation failed") ? (
                          <div className="text-red-600 bg-red-50 p-2 rounded border border-red-200">
                            ⚠️ {desktopInfo.data_path}
                          </div>
                        ) : desktopInfo.data_path.includes(
                            "The data directory should be located at",
                          ) ? (
                          <div className="text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                            💡 {desktopInfo.data_path}
                          </div>
                        ) : desktopInfo.data_path !== customPath ? (
                          <div className="text-gray-600">
                            {t(
                              "telegram.loginWidget.currentPath",
                              "Current path",
                            )}
                            : {desktopInfo.data_path}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          // Non-Tauri environment prompt
          <div className="text-center text-sm text-gray-500">
            <p>
              {t(
                "telegram.loginWidget.tauriOnly",
                "Quick login is only supported in the desktop app",
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
