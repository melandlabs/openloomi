export type LifestyleImageSkillConfidence = "high" | "medium" | "low";

export interface LifestyleImageSkillDecision {
  matched: boolean;
  confidence: LifestyleImageSkillConfidence;
  hasReferenceImage: boolean;
  reason?: string;
  refinedPrompt?: string;
}

export type LifestyleImageSkillFallbackReason =
  | "empty_output"
  | "invalid_json"
  | "invalid_schema"
  | "intent_not_matched"
  | "confidence_not_high"
  | "classifier_unavailable"
  | "classifier_error";

export interface LifestyleImageSkillRouteResult {
  shouldGenerate: boolean;
  decision: LifestyleImageSkillDecision | null;
  fallbackReason?: LifestyleImageSkillFallbackReason;
}

const CONFIDENCE_VALUES = new Set<string>(["high", "medium", "low"]);

const FALLBACK_REASON_VALUES = new Set<string>([
  "empty_output",
  "invalid_json",
  "invalid_schema",
  "intent_not_matched",
  "confidence_not_high",
  "classifier_unavailable",
  "classifier_error",
]);

export function parseLifestyleImageSkillDecision(
  rawOutput: unknown,
): LifestyleImageSkillDecision | null {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) return null;

  return coerceLifestyleImageSkillDecision(parsed);
}

export function resolveLifestyleImageSkillRoute(
  rawOutput: unknown,
): LifestyleImageSkillRouteResult {
  if (isEmptySkillOutput(rawOutput)) {
    return {
      shouldGenerate: false,
      decision: null,
      fallbackReason: "empty_output",
    };
  }

  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return {
      shouldGenerate: false,
      decision: null,
      fallbackReason:
        typeof rawOutput === "string" ? "invalid_json" : "invalid_schema",
    };
  }

  const decision = coerceLifestyleImageSkillDecision(parsed);
  if (!decision) {
    return {
      shouldGenerate: false,
      decision: null,
      fallbackReason: "invalid_schema",
    };
  }

  if (!decision.matched) {
    return {
      shouldGenerate: false,
      decision,
      fallbackReason: "intent_not_matched",
    };
  }

  if (decision.confidence !== "high") {
    return {
      shouldGenerate: false,
      decision,
      fallbackReason: "confidence_not_high",
    };
  }

  return {
    shouldGenerate: true,
    decision,
  };
}

export function createLifestyleImageSkillFallbackRoute(
  fallbackReason: LifestyleImageSkillFallbackReason,
): LifestyleImageSkillRouteResult {
  return {
    shouldGenerate: false,
    decision: null,
    fallbackReason,
  };
}

export function shouldGenerateLifestyleImageFromClassifierFallback(input: {
  route: LifestyleImageSkillRouteResult;
  message: string;
  hasReferenceImage: boolean;
}): boolean {
  if (
    input.route.fallbackReason !== "classifier_unavailable" &&
    input.route.fallbackReason !== "classifier_error"
  ) {
    return false;
  }

  return isLikelyLifestyleImageGenerationRequest(
    input.message,
    input.hasReferenceImage,
  );
}

export function isLifestyleImageSkillRouteResult(
  value: unknown,
): value is LifestyleImageSkillRouteResult {
  const route = asPlainObject(value);
  if (!route) return false;
  if (typeof route.shouldGenerate !== "boolean") return false;

  const decision =
    route.decision === null
      ? null
      : parseLifestyleImageSkillDecision(route.decision);
  if (route.decision !== null && !decision) return false;
  if (route.shouldGenerate && !decision) return false;

  if (
    route.fallbackReason !== undefined &&
    !isLifestyleImageSkillFallbackReason(route.fallbackReason)
  ) {
    return false;
  }

  return true;
}

function coerceLifestyleImageSkillDecision(
  parsed: Record<string, unknown>,
): LifestyleImageSkillDecision | null {
  if (typeof parsed.matched !== "boolean") return null;
  if (!isLifestyleImageSkillConfidence(parsed.confidence)) return null;
  if (typeof parsed.hasReferenceImage !== "boolean") return null;

  const decision: LifestyleImageSkillDecision = {
    matched: parsed.matched,
    confidence: parsed.confidence,
    hasReferenceImage: parsed.hasReferenceImage,
  };

  if (typeof parsed.reason === "string") {
    const reason = parsed.reason.trim();
    if (reason) {
      decision.reason = reason;
    }
  } else if (parsed.reason !== undefined) {
    return null;
  }

  if (typeof parsed.refinedPrompt === "string") {
    const refinedPrompt = parsed.refinedPrompt.trim();
    if (refinedPrompt) {
      decision.refinedPrompt = refinedPrompt;
    }
  } else if (parsed.refinedPrompt !== undefined) {
    return null;
  }

  return decision;
}

function parseJsonObject(rawOutput: unknown): Record<string, unknown> | null {
  if (typeof rawOutput === "string") {
    try {
      return asPlainObject(JSON.parse(normalizeJsonOutput(rawOutput)));
    } catch {
      return null;
    }
  }

  return asPlainObject(rawOutput);
}

function normalizeJsonOutput(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedJson ? fencedJson[1].trim() : trimmed;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isLifestyleImageSkillConfidence(
  value: unknown,
): value is LifestyleImageSkillConfidence {
  return typeof value === "string" && CONFIDENCE_VALUES.has(value);
}

function isLifestyleImageSkillFallbackReason(
  value: unknown,
): value is LifestyleImageSkillFallbackReason {
  return typeof value === "string" && FALLBACK_REASON_VALUES.has(value);
}

function isEmptySkillOutput(rawOutput: unknown): boolean {
  return (
    rawOutput == null || (typeof rawOutput === "string" && !rawOutput.trim())
  );
}

function isLikelyLifestyleImageGenerationRequest(
  message: string,
  hasReferenceImage: boolean,
): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.trim()) return false;

  const wantsGeneration =
    /\b(generate|create|make|render|produce|design|compose)\b/.test(
      normalized,
    ) || /生成|生图|出图|做图|制图|画一张|画个|制作/.test(normalized);
  if (!wantsGeneration) return false;

  const mentionsImage =
    /\b(image|picture|photo|visual|mockup|render|png|jpg|jpeg)\b/.test(
      normalized,
    ) || /图片|照片|图像|视觉|效果图|渲染图/.test(normalized);

  const mentionsLifestyle =
    /\b(lifestyle|scene|setup|desk|room|interior|product|reference|style)\b/.test(
      normalized,
    ) || /生活方式|场景|桌面|室内|产品|参考图|风格/.test(normalized);

  if (hasReferenceImage) {
    return mentionsImage || mentionsLifestyle;
  }

  return mentionsImage && mentionsLifestyle;
}
