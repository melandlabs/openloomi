import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { auth } from "@/app/(auth)/auth";
import { resolveLlmProvider } from "@/lib/ai/provider-resolver";
import {
  createLifestyleImageSkillFallbackRoute,
  resolveLifestyleImageSkillRoute,
  type LifestyleImageSkillRouteResult,
} from "@/lib/ai/image-generation/lifestyle-skill-router";
import { isTauriMode } from "@/lib/env/constants";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

const LIFESTYLE_IMAGE_SKILL_NAME = "openloomi-lifestyle-image";
const CLASSIFIER_TIMEOUT_MS = 45_000;

type LifestyleImageIntentRequestBody = {
  message?: unknown;
  hasReferenceImage?: unknown;
  model?: unknown;
};

type LifestyleImageIntentResponseBody = {
  success: true;
  route: LifestyleImageSkillRouteResult;
  model?: string;
};

export async function POST(request: Request) {
  const session = await auth().catch(() => null);
  if (!session?.user?.id && !isTauriMode()) {
    return new AppError("unauthorized:auth").toResponse();
  }

  const body = (await request.json().catch((error) => {
    console.error("[LifestyleImageIntent] Invalid request payload", error);
    return null;
  })) as LifestyleImageIntentRequestBody | null;

  const message = normalizeMessage(body?.message);
  if (!message) {
    return Response.json({
      success: true,
      route: createLifestyleImageSkillFallbackRoute("empty_output"),
    } satisfies LifestyleImageIntentResponseBody);
  }

  const hasReferenceImage = body?.hasReferenceImage === true;
  const skillInstructions = await readLifestyleImageSkillInstructions().catch(
    (error) => {
      console.error(
        "[LifestyleImageIntent] Failed to load lifestyle image skill",
        error,
      );
      return null;
    },
  );
  if (!skillInstructions) {
    return Response.json({
      success: true,
      route: createLifestyleImageSkillFallbackRoute("classifier_unavailable"),
    } satisfies LifestyleImageIntentResponseBody);
  }

  const provider = await resolveLlmProvider({
    userId: session?.user?.id,
    prefer: "chat_completions",
  });

  if (!provider) {
    return Response.json({
      success: true,
      route: createLifestyleImageSkillFallbackRoute("classifier_unavailable"),
    } satisfies LifestyleImageIntentResponseBody);
  }

  if (provider.flavor === "agent_runtime") {
    return Response.json({
      success: true,
      route: createLifestyleImageSkillFallbackRoute("classifier_unavailable"),
    } satisfies LifestyleImageIntentResponseBody);
  }

  try {
    const response = await provider.complete({
      system: buildLifestyleImageIntentSystemPrompt(skillInstructions),
      userContent: buildLifestyleImageIntentUserContent({
        message,
        hasReferenceImage,
      }),
      model: resolveModelOverride(body?.model, provider.flavor),
      maxTokens: 300,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
    });
    const route = normalizeReferenceImageFlag(
      resolveLifestyleImageSkillRoute(response.text),
      hasReferenceImage,
    );

    return Response.json({
      success: true,
      route,
      model: response.model,
    } satisfies LifestyleImageIntentResponseBody);
  } catch (error) {
    console.error("[LifestyleImageIntent] Classifier request failed", error);
    return Response.json({
      success: true,
      route: createLifestyleImageSkillFallbackRoute("classifier_error"),
    } satisfies LifestyleImageIntentResponseBody);
  }
}

function normalizeMessage(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveModelOverride(
  model: unknown,
  providerFlavor: "anthropic_http" | "openai_http" | "agent_runtime",
): string | undefined {
  if (providerFlavor === "agent_runtime") return undefined;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function buildLifestyleImageIntentSystemPrompt(
  skillInstructions: string,
): string {
  return [
    skillInstructions,
    "You are OpenLoomi's lifestyle image intent classifier.",
    "Return only JSON matching the skill's Output Contract.",
    "Do not include Markdown, prose, code fences, or tool calls.",
    "If the intent is unclear, invalid, negated, or only asks for image understanding, return matched false with confidence low.",
  ].join("\n\n");
}

function buildLifestyleImageIntentUserContent(input: {
  message: string;
  hasReferenceImage: boolean;
}): string {
  return [
    `Reference image uploaded: ${input.hasReferenceImage ? "true" : "false"}`,
    "Set hasReferenceImage to exactly the value above.",
    "",
    "User message:",
    input.message,
  ].join("\n");
}

function normalizeReferenceImageFlag(
  route: LifestyleImageSkillRouteResult,
  hasReferenceImage: boolean,
): LifestyleImageSkillRouteResult {
  if (!route.decision) return route;
  return {
    ...route,
    decision: {
      ...route.decision,
      hasReferenceImage,
    },
  };
}

async function readLifestyleImageSkillInstructions(): Promise<string> {
  const cwd = process.cwd();
  const parent = dirname(cwd);
  const grandParent = dirname(parent);
  const candidates = [
    join(cwd, "skills", LIFESTYLE_IMAGE_SKILL_NAME, "SKILL.md"),
    join(parent, "skills", LIFESTYLE_IMAGE_SKILL_NAME, "SKILL.md"),
    join(grandParent, "skills", LIFESTYLE_IMAGE_SKILL_NAME, "SKILL.md"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate, "utf8");
      if (content.trim()) return content;
    } catch {
      // Try the next dev/prod candidate path.
    }
  }

  throw new Error(`Unable to locate ${LIFESTYLE_IMAGE_SKILL_NAME}/SKILL.md`);
}
