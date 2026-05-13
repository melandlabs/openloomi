/**
 * Platform Registry for Insight Processing
 *
 * Provides dynamic adapter loading for platform-specific integrations.
 * This allows importing only the necessary adapter for a given platform
 * instead of bundling all adapters upfront.
 */

// Registry record type
type AdapterModule = {
  [key: string]: unknown;
};

/**
 * Registry mapping platform names to their adapter module paths
 * Each adapter is loaded dynamically when requested
 */
export const platformAdapterPaths: Record<
  string,
  () => Promise<AdapterModule>
> = {
  slack: () => import("../integrations/slack"),
  discord: () => import("../integrations/discord"),
  telegram: () => import("@openloomi/integrations/telegram"),
  whatsapp: () => import("../integrations/whatsapp"),
  teams: () => import("../integrations/teams"),
  facebook_messenger: () =>
    import("@openloomi/integrations/facebook-messenger"),
  linkedin: () => import("@openloomi/integrations/linkedin"),
  instagram: () => import("@openloomi/integrations/instagram"),
  google_calendar: () => import("@openloomi/integrations/calendar"),
  outlook_calendar: () => import("@openloomi/integrations/calendar"),
  imessage: () => import("../integrations/imessage"),
  feishu: () => import("@openloomi/integrations/feishu"),
  dingtalk: () => import("@openloomi/integrations/dingtalk"),
  gmail: () => import("../integrations/gmail"),
  rss: () => import("@openloomi/rss"),
  jira: () => import("../integrations/jira"),
  linear: () => import("../integrations/linear"),
  google_docs: () => import("@openloomi/integrations/google-docs"),
  hubspot: () => import("@openloomi/integrations/hubspot"),
  notion: () => import("@/lib/files/notion"),
  qqbot: () => import("@openloomi/integrations/qqbot"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdapterConstructor = new (...args: any[]) => unknown;

/**
 * Get an adapter instance for a given platform
 * Uses dynamic import to only load the necessary adapter
 */
export async function getPlatformAdapter<T = unknown>(
  platform: string,
  adapterName: string,
  config: Record<string, unknown>,
): Promise<T> {
  const getModule = platformAdapterPaths[platform];
  if (!getModule) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const module = await getModule();
  const AdapterClass = module[adapterName] as AdapterConstructor | undefined;
  if (!AdapterClass) {
    throw new Error(
      `Adapter ${adapterName} not found for platform ${platform}`,
    );
  }

  return new AdapterClass(config) as T;
}

/**
 * Get all available platform names
 */
export function getAvailablePlatforms(): string[] {
  return Object.keys(platformAdapterPaths);
}
