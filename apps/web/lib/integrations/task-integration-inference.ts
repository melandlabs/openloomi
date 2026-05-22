import type { IntegrationId } from "@/hooks/use-integrations";

export type InferredTaskSource = {
  type: "channel";
  name: string;
};

export type InferredTaskIntegrationRequirements = {
  sources: InferredTaskSource[];
  notificationChannels: string[];
};

type PlatformRule = {
  platform: IntegrationId;
  label: string;
  patterns: RegExp[];
  labelPatterns?: string[];
};

const SOURCE_PLATFORM_RULES: PlatformRule[] = [
  {
    platform: "gmail",
    label: "Gmail",
    patterns: [
      /\bgmail\b/i,
      /谷歌邮箱/i,
      /google\s*mail/i,
      /(?:我的|从|读取|拉取|整理|分析|监控|检查|查看).{0,12}(?:邮箱|邮件)/i,
      /(?:邮箱|邮件).{0,12}(?:拉取|读取|整理|分析|监控|检查|查看)/i,
    ],
  },
  {
    platform: "outlook",
    label: "Outlook",
    patterns: [/\boutlook\b/i, /微软邮箱/i],
  },
  {
    platform: "slack",
    label: "Slack",
    patterns: [/\bslack\b/i],
  },
  {
    platform: "telegram",
    label: "Telegram",
    patterns: [/\btelegram\b/i, /\btg\b/i],
  },
  {
    platform: "discord",
    label: "Discord",
    patterns: [/\bdiscord\b/i],
  },
  {
    platform: "notion",
    label: "Notion",
    patterns: [/\bnotion\b/i],
  },
  {
    platform: "twitter",
    label: "X/Twitter",
    labelPatterns: ["推特", "tweets?"],
    patterns: [
      /\btwitter\b/i,
      /\btweet(?:s)?\b/i,
      /推特/i,
      /(?:从|读取|拉取|整理|分析|监控|检查|查看).{0,12}(?:推文|提及|私信)/i,
      /(?:推文|提及|私信).{0,12}(?:读取|拉取|整理|分析|监控|检查|查看)/i,
    ],
  },
];

/** Email platforms can serve as both data sources and notification channels. */
const EMAIL_PLATFORMS = new Set<IntegrationId>(["gmail", "outlook"]);

const NOTIFICATION_INTENT_PATTERN =
  /(?:发送|发到|推送|通知|同步|send|notify|push|post|发给).{0,20}/i;

/** Patterns that strongly indicate a source (read/pull) intent for email platforms. */
const EMAIL_SOURCE_STRONG_PATTERNS: RegExp[] = [
  /(?:从|读取|拉取|整理|分析|监控|检查|查看).{0,12}(?:邮箱|邮件|收件箱|inbox|email)/i,
  /(?:邮箱|邮件|收件箱|inbox).{0,12}(?:拉取|读取|整理|分析|监控|检查|查看)/i,
];

/** Patterns that strongly indicate a notification (send/push) intent for email platforms. */
const EMAIL_NOTIFICATION_STRONG_PATTERNS: RegExp[] = [
  /(?:通过|用|使用).{0,10}(?:gmail|outlook|邮箱|邮件|email).{0,10}(?:发送|发到|通知|推送|发给|send|notify|push)/i,
  /(?:发送|发到|通知|推送|发给).{0,10}(?:gmail|outlook|邮箱|邮件|email)/i,
  /(?:邮件|email).{0,6}(?:发送|发到|通知|推送|发给|send|notify|push)/i,
];

function hasAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function isNotificationIntent(text: string, platform: IntegrationId) {
  if (EMAIL_PLATFORMS.has(platform)) {
    // For email platforms, check both brand name and generic email terms
    const platformPattern = new RegExp(platform.replace("_", "[_\\s-]?"), "i");
    const hasPlatformMention =
      platformPattern.test(text) || /(?:邮箱|邮件|email)/i.test(text);
    if (!hasPlatformMention) return false;

    return EMAIL_NOTIFICATION_STRONG_PATTERNS.some((p) => p.test(text));
  }

  const platformPattern = new RegExp(platform.replace("_", "[_\\s-]?"), "i");
  if (!platformPattern.test(text)) return false;

  return NOTIFICATION_INTENT_PATTERN.test(text);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSourceIntent(text: string, rule: PlatformRule) {
  if (!hasAnyPattern(text, rule.patterns)) return false;

  if (EMAIL_PLATFORMS.has(rule.platform)) {
    // If there is explicit source intent (read/pull patterns), always include
    if (EMAIL_SOURCE_STRONG_PATTERNS.some((p) => p.test(text))) {
      return true;
    }
    // If notification intent is detected but no explicit source intent,
    // this platform is used purely for notification → don't classify as source
    if (EMAIL_NOTIFICATION_STRONG_PATTERNS.some((p) => p.test(text))) {
      return false;
    }
    // Mentioning email/gmail without clear send or read intent → default to source
    // ("分析邮件", "检查邮箱" etc. are already matched by rule.patterns)
    return true;
  }

  const escapedLabels = new Set([
    rule.label,
    ...rule.label.split("/"),
    rule.platform,
  ]);
  const labelAlt = [
    ...Array.from(escapedLabels).map(escapeRegex),
    ...(rule.labelPatterns ?? []),
  ].join("|");

  return new RegExp(
    `(?:从|读取|拉取|整理|分析|监控|检查|查看)\\s*(?:我的)?\\s*(?:${labelAlt})|(?:${labelAlt}).{0,16}(?:读取|拉取|整理|分析|监控|检查|查看|消息|频道|channel|messages)`,
    "i",
  ).test(text);
}

export function inferTaskIntegrationRequirementsFromText(
  text: string,
): InferredTaskIntegrationRequirements {
  const trimmed = text.trim();
  if (!trimmed) {
    return { sources: [], notificationChannels: [] };
  }

  const sourcePlatforms = SOURCE_PLATFORM_RULES.filter((rule) =>
    isSourceIntent(trimmed, rule),
  );
  const notificationPlatforms = SOURCE_PLATFORM_RULES.filter((rule) =>
    isNotificationIntent(trimmed, rule.platform),
  );

  return {
    sources: sourcePlatforms.map((rule) => ({
      type: "channel",
      name: `${rule.platform}:__required__::${rule.label}`,
    })),
    notificationChannels: notificationPlatforms.map(
      (rule) => `${rule.platform}:__required__`,
    ),
  };
}
