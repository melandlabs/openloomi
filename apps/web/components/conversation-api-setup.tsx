"use client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";

import { RemixIcon } from "@/components/remix-icon";
import { MISSING_API_KEY_REASON } from "@/lib/ai/conversation-api-configuration";
import { cn } from "@/lib/utils";

export function ConversationApiSetup({
  compact = false,
}: {
  compact?: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const openSettings = () => {
    router.push(`/?page=ai-api-settings&reason=${MISSING_API_KEY_REASON}`);
  };

  if (compact) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-primary/20 bg-background/95 p-4 shadow-sm">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <RemixIcon name="key_2" size="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {t(
              "settings.aiSetupCompactTitle",
              "Connect an AI provider to continue",
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              "settings.aiSetupCompactDescription",
              "Your chat history is safe. Add a conversation API configuration to send new messages.",
            )}
          </p>
        </div>
        <Button type="button" size="sm" onClick={openSettings}>
          {t("settings.aiSetupAction", "Set up provider")}
        </Button>
      </div>
    );
  }

  const requirements = [
    {
      icon: "key_2",
      label: t("settings.aiSetupApiKey", "API key"),
    },
    {
      icon: "link",
      label: t("settings.aiSetupEndpoint", "Endpoint"),
    },
    {
      icon: "brain",
      label: t("settings.aiSetupModel", "Model"),
    },
  ];

  return (
    <div className="flex min-h-full w-full items-center justify-center px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <RemixIcon name="key_2" size="size-6" />
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {t("settings.aiSetupEyebrow", "One-minute setup")}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t("settings.aiSetupTitle", "Connect your conversation model")}
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          {t(
            "settings.aiSetupDescription",
            "OpenLoomi needs an Anthropic-compatible provider before it can start a conversation. Your credentials are stored securely and can be changed later.",
          )}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-2">
          {requirements.map((requirement) => (
            <div
              key={requirement.label}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-4",
                "text-center text-xs font-medium text-foreground",
              )}
            >
              <RemixIcon
                name={requirement.icon}
                size="size-5"
                className="text-muted-foreground"
              />
              {requirement.label}
            </div>
          ))}
        </div>

        <Button
          type="button"
          className="mt-6 w-full"
          size="lg"
          onClick={openSettings}
        >
          {t("settings.aiSetupAction", "Set up provider")}
          <RemixIcon name="arrow_right" size="size-4" />
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t(
            "settings.aiSetupHint",
            "Already configured by your administrator? Reload after the system key is added.",
          )}
        </p>
      </section>
    </div>
  );
}
