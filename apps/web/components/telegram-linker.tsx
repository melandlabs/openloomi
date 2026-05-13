"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { openUrl } from "@/lib/tauri";

type LinkStatus = "pending" | "success" | "error";

export function TelegramLinker({
  token,
  botLink,
  supportLink,
}: {
  token: string;
  botLink: string;
  supportLink: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LinkStatus>("pending");
  const [message, setMessage] = useState(t("telegram.pendingMessage"));

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("telegram.error.missingToken"));
      return;
    }

    const controller = new AbortController();

    const linkAccount = async () => {
      try {
        const response = await fetch("/api/telegram/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(data.message ?? t("telegram.error.default"));
        }

        setStatus("success");
        setMessage(t("telegram.success.message"));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error("[Telegram] Link failed:", error);
        setStatus("error");
        setMessage((error as Error).message ?? t("telegram.error.linkFailed"));
      }
    };

    void linkAccount();

    return () => controller.abort();
  }, [token, t]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold">{t("telegram.title")}</h1>
      <p className="text-muted-foreground">{message}</p>

      {status === "success" ? (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/">{t("telegram.actions.backToConsole")}</Link>
          </Button>
          <Button variant="outline" onClick={() => openUrl(botLink)}>
            {t("telegram.actions.openTelegram")}
          </Button>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/telegram/login">{t("telegram.actions.retry")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={supportLink}>
              {t("telegram.actions.contactSupport")}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button disabled>{t("telegram.actions.binding")}</Button>
        </div>
      )}
    </div>
  );
}
