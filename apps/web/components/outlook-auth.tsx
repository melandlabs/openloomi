"use client";

import { useState, type FormEvent } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { Button, Input, Label } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { toast } from "./toast";
import { openUrl } from "@/lib/tauri";

export interface OutlookAuthSubmission {
  email: string;
  appPassword: string;
  name?: string;
}

interface OutlookAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: OutlookAuthSubmission) => Promise<void>;
  /** When true, renders form content inline without the overlay wrapper */
  embedded?: boolean;
}

export function OutlookAuthForm({
  isOpen,
  onClose,
  onSubmit,
  embedded = false,
}: OutlookAuthFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );

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
    } else if (appPassword.replace(/\s/g, "").length < 8) {
      newErrors.password = t(
        "auth.invalidAppPassword",
        "App password must be at least 8 characters.",
      );
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    const cleanedPassword = appPassword.replace(/\s/g, "");

    try {
      // Validate credentials with Outlook IMAP server
      const response = await fetch("/api/outlook/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, appPassword: cleanedPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ??
            t("auth.validationFailed", "Outlook validation failed"),
        );
      }

      const userName = name.trim() || data?.name || email.split("@")[0];

      await onSubmit({
        email,
        appPassword: cleanedPassword,
        name: userName,
      });

      toast({
        type: "success",
        description: t("auth.outlookSuccess"),
      });
      onClose();
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : t("auth.outlookFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen && !embedded) return null;

  const formContent = (
    <>
      <p className="mb-6 text-sm text-gray-500">
        {t("auth.outlookAppPasswordDesc")}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="outlook-email">{t("common.email")}</Label>
          <Input
            id="outlook-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="your.email@outlook.com"
            disabled={isLoading}
            className={errors.email ? "border-red-500" : ""}
          />
          {errors.email && (
            <p className="text-sm text-red-500">{errors.email}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="outlook-app-password">
              {t("auth.appPassword")}
            </Label>
            <button
              type="button"
              onClick={() =>
                openUrl(
                  "https://support.microsoft.com/en-us/account-billing/how-to-get-and-use-app-passwords-5896ed9b-4263-e681-128a-a6f2979a7944",
                )
              }
              className="text-sm text-blue-500 hover:underline"
            >
              {t("auth.getAppPassword")}
            </button>
          </div>
          <Input
            id="outlook-app-password"
            type="password"
            value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)}
            placeholder={t("auth.outlookAppPasswordPlaceholder")}
            disabled={isLoading}
            className={errors.password ? "border-red-500" : ""}
          />
          {errors.password && (
            <p className="text-sm text-red-500">{errors.password}</p>
          )}
          <p className="text-xs text-gray-500">
            {t(
              "auth.outlookAppPasswordNote",
              "Enter your Outlook app password.",
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="outlook-name">
            {t("common.name", "Name (optional)")}
          </Label>
          <Input
            id="outlook-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Display name (optional)"
            disabled={isLoading}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            className="bg-[#0F7BFF] text-white hover:bg-[#0c62ca]"
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
              t("common.connect")
            )}
          </Button>
        </div>
      </form>
    </>
  );

  if (embedded) {
    return formContent;
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
          {t("auth.outlookAppPasswordTitle")}
        </h3>
        {formContent}
      </div>
    </div>
  );
}
