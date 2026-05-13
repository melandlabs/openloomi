"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { useIntegrations, type IntegrationId } from "@/hooks/use-integrations";

export type AccountSelectorProps = {
  value: string | null;
  onChange: (accountId: string) => void;
  platforms?: IntegrationId[];
  botId?: string;
};

export function AccountSelector({
  value,
  onChange,
  platforms,
  botId,
}: AccountSelectorProps) {
  const { groupedByIntegration } = useIntegrations();
  const { t } = useTranslation();

  const platformNames = useMemo(
    () => ({
      telegram: t("platform.telegram", "Telegram"),
      whatsapp: t("platform.whatsapp", "WhatsApp"),
      slack: t("platform.slack", "Slack"),
      discord: t("platform.discord", "Discord"),
      gmail: t("platform.gmail", "Gmail"),
      outlook: t("platform.outlook", "Outlook"),
      linkedin: t("platform.linkedin", "LinkedIn"),
      twitter: t("platform.twitter", "X (Twitter)"),
      instagram: t("platform.instagram", "Instagram"),
      google_calendar: t("platform.googleCalendar", "Google Calendar"),
      outlook_calendar: t("platform.outlookCalendar", "Outlook Calendar"),
      teams: t("platform.teams", "Microsoft Teams"),
      facebook_messenger: t("platform.facebookMessenger", "Facebook Messenger"),
      google_drive: t("platform.googleDrive", "Google Drive"),
      google_docs: t("platform.googleDocs", "Google Docs"),
      hubspot: t("platform.hubspot", "HubSpot"),
      notion: t("platform.notion", "Notion"),
      github: t("platform.github", "GitHub"),
      asana: t("platform.asana", "Asana"),
      jira: t("platform.jira", "Jira"),
      linear: t("platform.linear", "Linear"),
      imessage: t("platform.imessage", "iMessage"),
      feishu: t("platform.feishu", "Lark/Feishu"),
      dingtalk: t("platform.dingtalk", "DingTalk"),
      qqbot: t("platform.qqbot", "QQ Bot"),
      weixin: t("platform.weixin"),
    }),
    [t],
  );

  let options = useMemo(() => {
    const defaultPlatforms: IntegrationId[] = [
      "telegram",
      "whatsapp",
      "slack",
      "discord",
      "gmail",
      "outlook",
      "google_calendar",
      "outlook_calendar",
      "teams",
      "facebook_messenger",
      "google_docs",
    ];
    const allowedPlatforms: IntegrationId[] = platforms ?? defaultPlatforms;

    return allowedPlatforms.flatMap(
      (platform) =>
        groupedByIntegration[platform]?.map((account) => ({
          id: account.id,
          botId: account.bot?.id,
          label: account.displayName,
          platform,
          platformLabel: platformNames[platform],
        })) ?? [],
    );
  }, [groupedByIntegration, platformNames, platforms]);

  if (botId) {
    options = options.filter((o) => o.botId === botId);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
        {t("chat.sendAs", "Send As")}
      </div>
      <div className="flex items-center min-h-[42px] rounded-xl border border-border/50 bg-white/95 p-2">
        <Select
          value={value ?? undefined}
          onValueChange={(accountId) => {
            onChange(accountId);
          }}
          disabled={options.length === 0}
        >
          <SelectTrigger className="h-[26px] w-full border-none bg-transparent p-0 text-left shadow-none focus:ring-0">
            <SelectValue
              placeholder={t("chat.pickAccount", "Choose account")}
            />
          </SelectTrigger>
          {options.length > 0 && (
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label} · {option.platformLabel}
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Select>
      </div>
    </div>
  );
}
