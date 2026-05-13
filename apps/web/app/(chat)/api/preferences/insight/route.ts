import { auth } from "@/app/(auth)/auth";
import {
  getUserInsightSettings,
  getUserRoles,
  updateUserInsightSettings,
  upsertUserRole,
  removeUserRole,
  getLatestSurveyByUserId,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { formatToLocalTime } from "@/lib/utils";
import { NextResponse } from "next/server";
import { z } from "zod";

const MANUAL_ROLE_SOURCE = "profile";
const MAX_MANUAL_ROLE_SELECTIONS = 4;

const MAX_IDENTITY_INDUSTRIES = 4;
const MAX_IDENTITY_DESCRIPTION_LENGTH = 5000;

const insightSettingsSchema = z.object({
  language: z.string().max(64).optional(),
  focusPeople: z.array(z.string().max(128)).max(50).optional(),
  focusTopics: z.array(z.string().max(128)).max(50).optional(),
  refreshIntervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  roleKeys: z.array(z.string().max(128)).optional(),
  aiSoulPrompt: z.string().max(5000).optional(),
  /** User-filled industry list, max 4 items (multi-select + custom) */
  industries: z
    .array(z.string().max(128))
    .max(MAX_IDENTITY_INDUSTRIES)
    .optional(),
  /** User-filled work description, max 5000 characters */
  workDescription: z.string().max(MAX_IDENTITY_DESCRIPTION_LENGTH).optional(),
});

const DEFAULT_SETTINGS = {
  focusPeople: [] as string[],
  focusTopics: [] as string[],
  language: "",
  refreshIntervalMinutes: 30,
  aiSoulPrompt: null as string | null,
};

const sanitizeList = (values: string[] | undefined) => {
  if (!values) return undefined;

  // Optimize: combine map and filter into single iteration
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
};

/**
 * Normalize role key list: support preset roles and user-defined roles, deduplicate, max MAX_MANUAL_ROLE_SELECTIONS items
 */
const normalizeRoleKeys = (values: string[] | undefined) => {
  if (!values) return undefined;

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 128 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
      if (result.length >= MAX_MANUAL_ROLE_SELECTIONS) break;
    }
  }

  return result;
};

async function buildRolePreferencePayload(userId: string) {
  const roles = await getUserRoles(userId);
  return {
    assigned: roles.map((role) => ({
      role: role.roleKey,
      source: role.source,
      confidence: role.confidence,
      lastConfirmedAt: role.lastConfirmedAt
        ? role.lastConfirmedAt.toISOString()
        : null,
    })),
    manual: roles
      .filter((role) => role.source === MANUAL_ROLE_SOURCE)
      .map((role) => role.roleKey),
    limit: MAX_MANUAL_ROLE_SELECTIONS,
  };
}

const serializeSettings = (settings: {
  focusPeople: string[];
  focusTopics: string[];
  language: string;
  refreshIntervalMinutes: number;
  lastUpdated: Date;
  lastMessageProcessedAt: Date | null;
  lastActiveAt: Date | null;
  activityTier: "high" | "medium" | "low" | "dormant";
  aiSoulPrompt?: string | null;
}) => ({
  focusPeople: settings.focusPeople,
  focusTopics: settings.focusTopics,
  language: settings.language,
  refreshIntervalMinutes: settings.refreshIntervalMinutes,
  lastUpdated: formatToLocalTime(settings.lastUpdated),
  lastMessageProcessedAt: settings.lastMessageProcessedAt
    ? formatToLocalTime(settings.lastMessageProcessedAt)
    : null,
  lastActiveAt: settings.lastActiveAt
    ? formatToLocalTime(settings.lastActiveAt)
    : null,
  activityTier: settings.activityTier,
  aiSoulPrompt: settings.aiSoulPrompt ?? null,
});

/**
 * Build identity summary: Prioritize manually filled in insight settings (identityIndustries / identityWorkDescription), otherwise fallback to survey
 */
async function buildIdentitySummary(
  userId: string,
  settings?: {
    identityIndustries?: string[] | null;
    identityWorkDescription?: string | null;
  } | null,
) {
  const fromSettings =
    settings &&
    (settings.identityIndustries != null ||
      settings.identityWorkDescription != null);
  const industries =
    fromSettings &&
    settings.identityIndustries &&
    settings.identityIndustries.length > 0
      ? settings.identityIndustries
      : null;
  const workDescription =
    fromSettings && typeof settings.identityWorkDescription === "string"
      ? settings.identityWorkDescription
      : null;

  if (industries != null || workDescription != null) {
    return {
      industries: industries ?? [],
      primaryIndustry: industries?.[0] ?? null,
      workDescription,
      lastUpdated: formatToLocalTime(new Date()),
    };
  }

  const latestSurvey = await getLatestSurveyByUserId(userId);
  if (!latestSurvey) {
    return {
      industries: [],
      primaryIndustry: null,
      workDescription: null,
      lastUpdated: null,
    };
  }
  const surveyIndustries = latestSurvey.industry
    ? latestSurvey.industry
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  return {
    industries: surveyIndustries,
    primaryIndustry: surveyIndustries[0] ?? null,
    workDescription: latestSurvey.workDescription ?? null,
    lastUpdated: latestSurvey.submittedAt
      ? formatToLocalTime(latestSurvey.submittedAt)
      : null,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const settings = await getUserInsightSettings(session.user.id);
  const payload = settings
    ? serializeSettings(settings)
    : serializeSettings({
        ...DEFAULT_SETTINGS,
        lastUpdated: new Date(),
        lastMessageProcessedAt: null,
        lastActiveAt: null,
        activityTier: "low",
      });

  return NextResponse.json({
    ...payload,
    roles: await buildRolePreferencePayload(session.user.id),
    identity: await buildIdentitySummary(session.user.id, settings),
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const rawPayload = await request.json().catch((error) => {
    console.error("[Insight Preferences] Invalid JSON", error);
    return null;
  });
  if (!rawPayload) {
    return new AppError(
      "bad_request:insight",
      "Invalid insight preference payload",
    ).toResponse();
  }

  let payload: z.infer<typeof insightSettingsSchema>;
  try {
    payload = insightSettingsSchema.parse(rawPayload);
  } catch (error) {
    console.error("[Insight Preferences] Invalid payload", error);
    return new AppError(
      "bad_request:insight",
      "Invalid insight preference payload",
    ).toResponse();
  }

  try {
    const current = await getUserInsightSettings(session.user.id);
    const shouldUpdateRoles = Object.prototype.hasOwnProperty.call(
      rawPayload,
      "roleKeys",
    );
    const normalizedRoleKeys = shouldUpdateRoles
      ? normalizeRoleKeys(payload.roleKeys ?? [])
      : undefined;

    if (
      normalizedRoleKeys &&
      normalizedRoleKeys.length > MAX_MANUAL_ROLE_SELECTIONS
    ) {
      return new AppError(
        "bad_request:insight",
        `You can select up to ${MAX_MANUAL_ROLE_SELECTIONS} roles.`,
      ).toResponse();
    }

    const base = current
      ? {
          focusPeople: current.focusPeople,
          focusTopics: current.focusTopics,
          language: current.language,
          refreshIntervalMinutes: current.refreshIntervalMinutes,
          lastUpdated: current.lastUpdated,
          lastMessageProcessedAt: current.lastMessageProcessedAt,
          lastActiveAt: current.lastActiveAt,
          activityTier: current.activityTier,
          aiSoulPrompt: current.aiSoulPrompt ?? null,
          identityIndustries: current.identityIndustries ?? null,
          identityWorkDescription: current.identityWorkDescription ?? null,
        }
      : {
          ...DEFAULT_SETTINGS,
          lastUpdated: new Date(),
          lastMessageProcessedAt: null,
          lastActiveAt: null,
          activityTier: "low" as const,
          aiSoulPrompt: null,
          identityIndustries: null,
          identityWorkDescription: null,
        };

    const sanitizedIndustries =
      payload.industries != null
        ? (sanitizeList(payload.industries) ?? []).slice(
            0,
            MAX_IDENTITY_INDUSTRIES,
          )
        : undefined;
    const workDescriptionValue = Object.prototype.hasOwnProperty.call(
      rawPayload,
      "workDescription",
    )
      ? payload.workDescription?.slice(0, MAX_IDENTITY_DESCRIPTION_LENGTH) ||
        null
      : undefined;

    const nextSettings = {
      ...base,
      focusPeople: sanitizeList(payload.focusPeople) ?? base.focusPeople,
      focusTopics: sanitizeList(payload.focusTopics) ?? base.focusTopics,
      language:
        typeof payload.language === "string" ? payload.language : base.language,
      refreshIntervalMinutes:
        payload.refreshIntervalMinutes ?? base.refreshIntervalMinutes,
      aiSoulPrompt:
        typeof payload.aiSoulPrompt === "string"
          ? payload.aiSoulPrompt.trim()
          : base.aiSoulPrompt,
      identityIndustries:
        sanitizedIndustries !== undefined
          ? sanitizedIndustries
          : base.identityIndustries,
      identityWorkDescription:
        workDescriptionValue !== undefined
          ? workDescriptionValue
          : base.identityWorkDescription,
      lastUpdated: new Date(),
    };

    await updateUserInsightSettings(session.user.id, nextSettings);

    if (shouldUpdateRoles) {
      const normalized = normalizedRoleKeys ?? [];
      const existingRoles = await getUserRoles(session.user.id);
      const manualRoles = existingRoles.filter(
        (role) => role.source === MANUAL_ROLE_SOURCE,
      );
      const manualSet = new Set(manualRoles.map((role) => role.roleKey));
      const desiredSet = new Set(normalized);
      const now = new Date();

      for (const roleKey of normalized) {
        if (manualSet.has(roleKey)) continue;
        await upsertUserRole({
          userId: session.user.id,
          roleKey,
          source: MANUAL_ROLE_SOURCE,
          confidence: 0.9,
          evidence: {
            kind: "user_preference",
            updatedAt: now.toISOString(),
          },
          lastConfirmedAt: now,
        });
      }

      for (const role of manualRoles) {
        if (desiredSet.has(role.roleKey)) continue;
        await removeUserRole({
          userId: session.user.id,
          roleKey: role.roleKey,
          source: MANUAL_ROLE_SOURCE,
        });
      }
    }

    return NextResponse.json({
      ...serializeSettings(nextSettings),
      roles: await buildRolePreferencePayload(session.user.id),
      identity: await buildIdentitySummary(session.user.id, nextSettings),
    });
  } catch (error) {
    console.error("[Insight Preferences] Failed to update settings", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:insight",
      "Unable to update insight preferences",
    ).toResponse();
  }
}
