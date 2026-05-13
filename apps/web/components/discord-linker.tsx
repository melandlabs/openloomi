"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@openloomi/ui";
import { useTranslation } from "react-i18next";

type LinkStatus = "pending" | "success" | "error";

export function DiscordLinker({
  token,
  supportLink,
}: {
  token: string;
  supportLink: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LinkStatus>("pending");
  const [message, setMessage] = useState(t("discord.pendingMessage"));

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("discord.missingTokenError"));
      return;
    }

    const controller = new AbortController();

    const linkAccount = async () => {
      try {
        const response = await fetch("/api/discord/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(data.message ?? t("discord.defaultLinkError"));
        }

        setStatus("success");
        setMessage(t("discord.successMessage"));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error("[Discord] Link failed:", error);
        setStatus("error");
        setMessage((error as Error).message ?? t("discord.defaultRetryError"));
      }
    };

    void linkAccount();

    return () => controller.abort();
  }, [token, t]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold">{t("discord.title")}</h1>
      <p className="text-muted-foreground">{message}</p>

      {status === "success" ? (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/">{t("discord.backToConsoleBtn")}</Link>
          </Button>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/discord/login">{t("discord.retryBtn")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={supportLink}>{t("discord.contactSupportBtn")}</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button disabled>{t("discord.linkingBtn")}</Button>
        </div>
      )}
    </div>
  );
}
