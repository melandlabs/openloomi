import type { IntegrationId } from "@/hooks/use-integrations";
import {
  getIntegrationAccountsByUserId,
  weixinBotHasValidContextToken,
} from "@/lib/db/queries";
import { normalizeIntegrationPlatform } from "@/lib/integrations/connector-target";

export type MissingNotificationIntegrationReason =
  | "not_connected"
  | "invalid_context_token";

export type TaskIntegrationIssueCategory = "notification_channel" | "source";

export interface TaskIntegrationSourceRef {
  type: "file" | "channel" | "folder";
  name: string;
  id?: string;
  path?: string;
}

export interface TaskIntegrationIssue {
  category: TaskIntegrationIssueCategory;
  platform: IntegrationId;
  reason: MissingNotificationIntegrationReason;
  sourceRef?: TaskIntegrationSourceRef;
}

export interface TaskIntegrationCheckResult {
  ok: boolean;
  requiredPlatforms: IntegrationId[];
  missingPlatforms: IntegrationId[];
  issues: TaskIntegrationIssue[];
}

export interface MissingNotificationIntegration {
  platform: IntegrationId;
  reason: MissingNotificationIntegrationReason;
}

export interface NotificationChannelCheckResult {
  ok: boolean;
  requiredPlatforms: IntegrationId[];
  missingPlatforms: IntegrationId[];
  missingReasons: MissingNotificationIntegration[];
}

export interface TaskIntegrationSourceInput {
  type: "file" | "channel" | "folder";
  name: string;
  id?: string;
  path?: string;
}

function extractPlatformFromNotificationChannel(
  channel: string,
): IntegrationId | null {
  const trimmed = channel.trim();
  if (!trimmed) return null;

  const [candidate] = trimmed.split(":");
  return normalizeIntegrationPlatform(candidate || trimmed);
}

function extractPlatformFromSource(
  source: TaskIntegrationSourceInput,
): IntegrationId | null {
  if (source.type !== "channel") {
    return null;
  }

  const trimmed = source.name.trim();
  if (!trimmed) return null;

  const [candidate] = trimmed.split(":");
  return normalizeIntegrationPlatform(candidate || trimmed);
}

async function collectMissingPlatforms(params: {
  userId: string;
  requiredPlatforms: IntegrationId[];
}): Promise<MissingNotificationIntegration[]> {
  if (params.requiredPlatforms.length === 0) {
    return [];
  }

  const accounts = await getIntegrationAccountsByUserId({
    userId: params.userId,
  });
  const missingReasons: MissingNotificationIntegration[] = [];

  for (const platform of params.requiredPlatforms) {
    const platformAccounts = accounts.filter(
      (account) => account.platform === platform,
    );

    if (platformAccounts.length === 0) {
      missingReasons.push({ platform, reason: "not_connected" });
      continue;
    }

    if (platform !== "weixin") {
      continue;
    }

    let hasValidContextToken = false;
    for (const account of platformAccounts) {
      if (!account.bot?.id) continue;
      // WeChat proactive task usage requires a valid context token.
      // eslint-disable-next-line no-await-in-loop
      const valid = await weixinBotHasValidContextToken(
        params.userId,
        account.bot.id,
      );
      if (valid) {
        hasValidContextToken = true;
        break;
      }
    }

    if (!hasValidContextToken) {
      missingReasons.push({ platform, reason: "invalid_context_token" });
    }
  }

  return missingReasons;
}

export async function checkNotificationChannelPlatforms(input: {
  userId: string;
  notificationChannels: string[];
}): Promise<NotificationChannelCheckResult> {
  const requiredPlatforms = Array.from(
    new Set(
      input.notificationChannels
        .filter((value): value is string => typeof value === "string")
        .map(extractPlatformFromNotificationChannel)
        .filter((value): value is IntegrationId => value != null),
    ),
  );

  if (requiredPlatforms.length === 0) {
    return {
      ok: true,
      requiredPlatforms: [],
      missingPlatforms: [],
      missingReasons: [],
    };
  }

  const missingReasons = await collectMissingPlatforms({
    userId: input.userId,
    requiredPlatforms,
  });

  const missingPlatforms = missingReasons.map((item) => item.platform);
  return {
    ok: missingPlatforms.length === 0,
    requiredPlatforms,
    missingPlatforms,
    missingReasons,
  };
}

export async function checkTaskSourcePlatforms(input: {
  userId: string;
  sources: TaskIntegrationSourceInput[];
}): Promise<TaskIntegrationCheckResult> {
  const platformBySource = input.sources
    .filter(
      (source): source is TaskIntegrationSourceInput =>
        Boolean(source) &&
        typeof source.name === "string" &&
        source.type === "channel",
    )
    .map((source) => ({
      source,
      platform: extractPlatformFromSource(source),
    }))
    .filter(
      (
        item,
      ): item is {
        source: TaskIntegrationSourceInput;
        platform: IntegrationId;
      } => item.platform != null,
    );

  const requiredPlatforms = Array.from(
    new Set(platformBySource.map((item) => item.platform)),
  );
  if (requiredPlatforms.length === 0) {
    return {
      ok: true,
      requiredPlatforms: [],
      missingPlatforms: [],
      issues: [],
    };
  }

  const missingReasons = await collectMissingPlatforms({
    userId: input.userId,
    requiredPlatforms,
  });
  const missingReasonByPlatform = new Map(
    missingReasons.map((item) => [item.platform, item.reason]),
  );

  const issues: TaskIntegrationIssue[] = platformBySource.flatMap(
    ({ source, platform }) => {
      const reason = missingReasonByPlatform.get(platform);
      if (!reason) return [];
      return [
        {
          category: "source" as const,
          platform,
          reason,
          sourceRef: {
            type: source.type,
            name: source.name,
            ...(typeof source.id === "string" && source.id
              ? { id: source.id }
              : {}),
            ...(typeof source.path === "string" && source.path
              ? { path: source.path }
              : {}),
          },
        },
      ];
    },
  );

  const missingPlatforms = Array.from(
    new Set(issues.map((issue) => issue.platform)),
  );
  return {
    ok: missingPlatforms.length === 0,
    requiredPlatforms,
    missingPlatforms,
    issues,
  };
}

export async function checkTaskIntegrationRequirements(input: {
  userId: string;
  sources: TaskIntegrationSourceInput[];
  notificationChannels: string[];
}): Promise<TaskIntegrationCheckResult> {
  const [sourceCheck, notificationCheck] = await Promise.all([
    checkTaskSourcePlatforms({
      userId: input.userId,
      sources: input.sources,
    }),
    checkNotificationChannelPlatforms({
      userId: input.userId,
      notificationChannels: input.notificationChannels,
    }),
  ]);

  const issues: TaskIntegrationIssue[] = [
    ...sourceCheck.issues,
    ...notificationCheck.missingReasons.map((item) => ({
      category: "notification_channel" as const,
      platform: item.platform,
      reason: item.reason,
    })),
  ];

  return {
    ok: issues.length === 0,
    requiredPlatforms: Array.from(
      new Set([
        ...sourceCheck.requiredPlatforms,
        ...notificationCheck.requiredPlatforms,
      ]),
    ),
    missingPlatforms: Array.from(
      new Set([
        ...sourceCheck.missingPlatforms,
        ...notificationCheck.missingPlatforms,
      ]),
    ),
    issues,
  };
}
