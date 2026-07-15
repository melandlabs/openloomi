export type LifestyleImageTriggerConfidence = "high" | "medium" | "low";

export type LifestyleImageTriggerKind = "explicit_lifestyle_image_request";

export interface LifestyleImageTriggerDecision {
  matched: boolean;
  confidence: LifestyleImageTriggerConfidence;
  kind?: LifestyleImageTriggerKind;
  reason?: string;
}

const IMAGE_ACTION_PATTERNS = [
  /\b(generate|create|make|draw|render|design)\b/i,
  /生成|创建|做一?张|画一?张|出一?张|生图|制作/,
];

const LIFESTYLE_IMAGE_PATTERNS = [
  /\blifestyle\s+(image|picture|photo|portrait|visual|scene)\b/i,
  /\b(image|picture|photo|portrait|visual|scene)\s+.*\blifestyle\b/i,
  /生活方式(图片|照片|图像|视觉|场景|形象图|配图)/,
  /生活(照|照片|图片|场景|方式图)/,
  /个人(形象图|生活图|生活照)/,
];

const NEGATED_IMAGE_ACTION_PATTERNS = [
  /\b(do not|don't|dont|no need to|without)\s+(generate|create|make|draw|render|design)\b/i,
  /不要(生成|创建|做|画|出|制作)/,
  /不用(生成|创建|做|画|出|制作)/,
  /无需(生成|创建|做|画|出|制作)/,
  /别(生成|创建|做|画|出|制作)/,
];

const PROMPT_ONLY_PATTERNS = [
  /\blifestyle\s+(image|picture|photo|portrait|visual|scene)\s+prompt\b/i,
  /\bprompt\s+for\s+(a\s+)?lifestyle\s+(image|picture|photo|portrait|visual|scene)\b/i,
];

export function detectLifestyleImageTrigger(
  text: string | null | undefined,
): LifestyleImageTriggerDecision {
  const normalized = normalizeTriggerText(text);
  if (!normalized) {
    return { matched: false, confidence: "low" };
  }

  if (
    NEGATED_IMAGE_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return {
      matched: false,
      confidence: "low",
      reason: "negated_image_generation_request",
    };
  }

  if (PROMPT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      matched: false,
      confidence: "low",
      reason: "prompt_only_request",
    };
  }

  const hasImageAction = IMAGE_ACTION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const hasLifestyleImageTarget = LIFESTYLE_IMAGE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );

  if (hasImageAction && hasLifestyleImageTarget) {
    return {
      matched: true,
      confidence: "high",
      kind: "explicit_lifestyle_image_request",
      reason: "explicit_image_action_and_lifestyle_target",
    };
  }

  return { matched: false, confidence: "low" };
}

function normalizeTriggerText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}
