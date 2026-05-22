import type { IntegrationId } from "@/hooks/use-integrations";

const ALL_INTEGRATION_PLATFORMS: IntegrationId[] = [
  "telegram",
  "whatsapp",
  "slack",
  "discord",
  "gmail",
  "outlook",
  "linkedin",
  "instagram",
  "twitter",
  "google_calendar",
  "outlook_calendar",
  "teams",
  "facebook_messenger",
  "google_drive",
  "google_docs",
  "hubspot",
  "notion",
  "github",
  "asana",
  "jira",
  "linear",
  "imessage",
  "feishu",
  "dingtalk",
  "qqbot",
  "weixin",
];

const COMING_SOON_PLATFORMS = new Set<IntegrationId>([
  "google_drive",
  "github",
  "google_calendar",
  "instagram",
  "facebook_messenger",
  "teams",
  "asana",
  "jira",
  "linear",
]);

export function isIntegrationPlatformConnectable(platform: IntegrationId) {
  if (COMING_SOON_PLATFORMS.has(platform)) return false;

  switch (platform) {
    case "google_docs":
      return process.env.NEXT_PUBLIC_GOOGLE_DOCS_ENABLED === "true";
    case "outlook_calendar":
      return process.env.NEXT_PUBLIC_OUTLOOK_CALENDAR_ENABLED === "true";
    default:
      return true;
  }
}

export function getConnectableIntegrationPlatforms(): IntegrationId[] {
  return ALL_INTEGRATION_PLATFORMS.filter((platform) =>
    isIntegrationPlatformConnectable(platform),
  );
}

/**
 * Whether a platform should be surfaced in the main integration grid.
 *
 * Connectability ("may a new connection be initiated?") is not the same
 * gate as visibility. A coming-soon platform with no accounts stays in
 * the "coming soon" group; one with existing accounts must remain
 * visible so legacy / beta-path connections stay manageable instead of
 * disappearing from the UI.
 */
export function isIntegrationPlatformVisible(
  platform: IntegrationId,
  options: { hasConnectedAccounts: boolean } = { hasConnectedAccounts: false },
): boolean {
  if (isIntegrationPlatformConnectable(platform)) return true;
  return options.hasConnectedAccounts;
}
