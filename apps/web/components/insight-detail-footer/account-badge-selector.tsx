"use client";

import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { RemixIcon } from "@/components/remix-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { useIntegrations, type IntegrationId } from "@/hooks/use-integrations";
import IntegrationIcon from "@/components/integration-icon";
import { cn } from "@/lib/utils";

export type AccountBadgeSelectorProps = {
  value: string | null;
  onChange: (accountId: string) => void;
  platforms?: IntegrationId[];
  botId?: string;
  /** Filter to only accounts with a bot (bot.id exists) */
  botOnly?: boolean;
};

/**
 * Account selector Badge component
 * Displays platform icon and account name in badge style
 */
export function AccountBadgeSelector({
  value,
  onChange,
  platforms,
  botId,
  botOnly,
}: AccountBadgeSelectorProps) {
  const { groupedByIntegration, accounts } = useIntegrations();
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

  if (botOnly) {
    options = options.filter((o) => !!o.botId);
  }

  const selectedAccount = useMemo(() => {
    if (!value) return null;
    return accounts.find((account) => account.id === value);
  }, [value, accounts]);

  const selectedOption = useMemo(() => {
    if (!selectedAccount) return null;
    return options.find((o) => o.id === selectedAccount.id);
  }, [selectedAccount, options]);

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(accountId) => {
        onChange(accountId);
      }}
      disabled={options.length === 0}
    >
      <SelectTrigger
        hideIcon
        className={cn(
          "h-7 gap-1.5 border-border/50 bg-muted/50 hover:bg-muted/70 px-2.5 py-1 text-xs font-medium transition-colors",
          "focus:ring-1 focus:ring-primary/20",
        )}
      >
        {selectedOption && selectedAccount ? (
          <div className="flex items-center gap-1.5">
            <div className="flex shrink-0 items-center justify-center">
              <IntegrationIcon platform={selectedOption.platform} />
            </div>
            <span className="truncate max-w-[120px]">
              {selectedAccount.displayName}
            </span>
            <RemixIcon
              name="chevron_down"
              size="size-3"
              className="shrink-0 opacity-50"
            />
          </div>
        ) : (
          <>
            <SelectValue
              placeholder={t("chat.pickAccount", "Choose account")}
            />
            <RemixIcon
              name="chevron_down"
              size="size-3"
              className="shrink-0 opacity-50"
            />
          </>
        )}
      </SelectTrigger>
      {options.length > 0 && (
        <SelectContent>
          {options.map((option) => {
            const account = accounts.find((acc) => acc.id === option.id);
            return (
              <SelectItem key={option.id} value={option.id}>
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 items-center justify-center">
                    <IntegrationIcon platform={option.platform} />
                  </div>
                  <span>{account?.displayName ?? option.label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      )}
    </Select>
  );
}
