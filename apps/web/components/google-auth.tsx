"use client";

import { useState } from "react";
import { RemixIcon } from "@/components/remix-icon";
import {
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { toast } from "./toast";
import { openUrl } from "@/lib/tauri";

export interface GoogleUserInfo {
  email: string;
  name?: string;
}

export interface GoogleAuthSubmission {
  email: string;
  appPassword: string;
  name?: string;
}

interface GoogleAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: GoogleAuthSubmission) => Promise<void>;
  /** When true, renders form content inline without the overlay wrapper */
  embedded?: boolean;
}

type AuthMethod = "apppassword" | "oauth";

const GMAIL_OAUTH_ENABLED =
  process.env.NEXT_PUBLIC_GMAIL_OAUTH_ENABLED === "true";

export function GoogleAuthForm({
  isOpen,
  onClose,
  onSubmit,
  embedded = false,
}: GoogleAuthFormProps) {
  const { t, i18n } = useTranslation();
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    GMAIL_OAUTH_ENABLED ? "oauth" : "apppassword",
  );
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );

  const appPasswordDocUrl = i18n.language.startsWith("zh")
    ? "https://support.google.com/accounts/answer/185833?hl=zh-Hans"
    : "https://support.google.com/accounts/answer/185833";

  const validateForm = (): boolean => {
    const newErrors: { email?: string; password?: string } = {};
    let isValid = true;

    if (!email.trim()) {
      newErrors.email = t("auth.emailRequired");
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t("auth.invalidEmail");
      isValid = false;
    }

    if (!appPassword.trim()) {
      newErrors.password = t("auth.passwordRequired");
      isValid = false;
    } else if (appPassword.replace(/\s/g, "").length !== 16) {
      newErrors.password = t("auth.invalidAppPassword");
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    const cleanedPassword = appPassword.replace(/\s/g, "");

    try {
      const response = await fetch("/api/google/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, appPassword: cleanedPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        const errorCode = data?.errorCode;
        const errorMessage = errorCode
          ? t(`auth.${errorCode}`, { defaultValue: data?.error })
          : (data?.error ??
            t("auth.validationFailed", "Google validation failed"));
        throw new Error(errorMessage);
      }

      const userName = data?.name ?? email.split("@")[0];

      await onSubmit({
        email,
        appPassword: cleanedPassword,
        name: userName,
      });

      toast({
        type: "success",
        description: t("auth.googleSuccess"),
      });
      onClose();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast({
        type: "error",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen && !embedded) {
    return null;
  }

  const handleOAuthConnect = () => {
    if (typeof window !== "undefined") {
      openUrl("/api/gmail/oauth");
    }
    onClose();
  };

  const formInner = (
    <>
      <p className="mb-6 text-sm text-gray-500">
        {GMAIL_OAUTH_ENABLED
          ? t("auth.googleAppPasswordDesc", "Choose a connection method")
          : t(
              "auth.googleAppPasswordDescOnly",
              "Connect your Gmail account using App Password",
            )}
      </p>

      {GMAIL_OAUTH_ENABLED ? (
        <Tabs
          value={authMethod}
          onValueChange={(v) => setAuthMethod(v as AuthMethod)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="oauth">
              {t("auth.oauthMethod", "OAuth")}
            </TabsTrigger>
            <TabsTrigger value="apppassword">
              {t("auth.appPasswordMethod", "App Password")}
            </TabsTrigger>
          </TabsList>

          {authMethod === "oauth" && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                {t(
                  "auth.oauthMethodDesc",
                  "Connect using Google OAuth. Recommended for better security.",
                )}
              </p>
              <Button
                type="button"
                onClick={handleOAuthConnect}
                className="w-full bg-[#1A73E8] text-white hover:bg-[#1558b0]"
              >
                {t("auth.connectWithOAuth", "Connect with OAuth")}
              </Button>
            </div>
          )}

          {authMethod === "apppassword" && (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="google-email">{t("common.email")}</Label>
                <Input
                  id="google-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="your.email@gmail.com"
                  disabled={isLoading}
                  className={errors.email ? "border-red-500" : ""}
                />
                {errors.email && (
                  <p className="text-sm text-red-500">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="google-app-password">
                    {t("auth.appPassword")}
                  </Label>
                  <button
                    type="button"
                    onClick={() =>
                      openUrl("https://myaccount.google.com/apppasswords")
                    }
                    className="text-sm text-blue-500 hover:underline"
                  >
                    {t("auth.getAppPassword")}
                  </button>
                </div>
                <Input
                  id="google-app-password"
                  type="password"
                  value={appPassword}
                  onChange={(event) => setAppPassword(event.target.value)}
                  placeholder="16 characters, no spaces"
                  disabled={isLoading}
                  className={errors.password ? "border-red-500" : ""}
                />
                {errors.password && (
                  <p className="text-sm text-red-500">{errors.password}</p>
                )}
                <p className="text-xs text-gray-500">
                  {t("auth.appPasswordNote")}
                </p>
                <p className="text-xs text-gray-500">
                  <button
                    type="button"
                    onClick={() => openUrl(appPasswordDocUrl)}
                    className="text-blue-500 hover:underline"
                  >
                    {t("auth.appPasswordDocLink")}
                  </button>
                </p>
              </div>

              <Button
                type="submit"
                className="w-full bg-red-500 text-white hover:bg-red-600"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <RemixIcon
                      name="loader_2"
                      size="size-4"
                      className="mr-2 animate-spin"
                    />
                    {t("common.authenticating")}
                  </>
                ) : (
                  t("common.authorizeBtn")
                )}
              </Button>
            </form>
          )}
        </Tabs>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="google-email">{t("common.email")}</Label>
            <Input
              id="google-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="your.email@gmail.com"
              disabled={isLoading}
              className={errors.email ? "border-red-500" : ""}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="google-app-password">
                {t("auth.appPassword")}
              </Label>
              <button
                type="button"
                onClick={() =>
                  openUrl("https://myaccount.google.com/apppasswords")
                }
                className="text-sm text-blue-500 hover:underline"
              >
                {t("auth.getAppPassword")}
              </button>
            </div>
            <Input
              id="google-app-password"
              type="password"
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
              placeholder="16 characters, no spaces"
              disabled={isLoading}
              className={errors.password ? "border-red-500" : ""}
            />
            {errors.password && (
              <p className="text-sm text-red-500">{errors.password}</p>
            )}
            <p className="text-xs text-gray-500">{t("auth.appPasswordNote")}</p>
            <p className="text-xs text-gray-500">
              <button
                type="button"
                onClick={() => openUrl(appPasswordDocUrl)}
                className="text-blue-500 hover:underline"
              >
                {t("auth.appPasswordDocLink")}
              </button>
            </p>
          </div>

          <Button
            type="submit"
            className="w-full bg-red-500 text-white hover:bg-red-600"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <RemixIcon
                  name="loader_2"
                  size="size-4"
                  className="mr-2 animate-spin"
                />
                {t("common.authenticating")}
              </>
            ) : (
              t("common.authorizeBtn")
            )}
          </Button>
        </form>
      )}

      <div className="mt-4 space-y-1 text-xs text-gray-500">
        <p>{t("auth.googleNote1")}</p>
        <p>{t("auth.googleNote2")}</p>
      </div>
    </>
  );

  if (embedded) {
    return formInner;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="button"
        tabIndex={0}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClose();
          }
        }}
      />

      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
          aria-label={t("common.close")}
        >
          <RemixIcon name="close" size="size-5" />
        </button>

        <h3 className="mb-1 text-xl font-bold text-gray-900">
          {t("auth.googleAppPasswordTitle", "Connect Gmail")}
        </h3>
        {formInner}
      </div>
    </div>
  );
}
