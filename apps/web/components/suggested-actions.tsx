"use client";

/**
 * Data structure for suggested conversation prompts.
 */
export interface SuggestedPrompt {
  id: string;
  title: string;
  emoji: string;
  type: "event_based" | "pattern_based" | "role_based";
  reasoning: string;
  related_insight_ids: string[];
}

/**
 * Get all default suggested options.
 */
export function getAllDefaultSuggestions(
  t: (key: string) => string,
): SuggestedPrompt[] {
  return [
    {
      id: "presentation",
      title: t("common.suggestedCards.presentation.title"),
      emoji: "📊",
      type: "role_based" as const,
      reasoning: "Create presentation",
      related_insight_ids: [],
    },
    {
      id: "frontendDesign",
      title: t("common.suggestedCards.frontendDesign.title"),
      emoji: "🖥️",
      type: "role_based" as const,
      reasoning: "Frontend design for openloomi website introduction page",
      related_insight_ids: [],
    },
    {
      id: "linkedinPost",
      title: t("common.suggestedCards.linkedinPost.title"),
      emoji: "📈",
      type: "role_based" as const,
      reasoning: "Event tracking creation",
      related_insight_ids: [],
    },
    {
      id: "productCopy",
      title: t("common.suggestedCards.productCopy.title"),
      emoji: "✍️",
      type: "role_based" as const,
      reasoning: "Product copy optimization",
      related_insight_ids: [],
    },
    {
      id: "algorithmicArt",
      title: t("common.suggestedCards.algorithmicArt.title"),
      emoji: "🎨",
      type: "role_based" as const,
      reasoning: "Algorithmic art creation",
      related_insight_ids: [],
    },
    {
      id: "aiNews",
      title: t("common.suggestedCards.aiNews.title"),
      emoji: "📰",
      type: "role_based" as const,
      reasoning: "AI industry news research",
      related_insight_ids: [],
    },
  ];
}

/**
 * Simple seeded random number generator (Linear Congruential Generator).
 * Ensures the same seed produces the same random sequence.
 */
function seededRandom(seed: number): () => number {
  let currentSeed = seed;
  return () => {
    // Linear congruential generator parameters (using common parameter combination)
    currentSeed = (currentSeed * 1664525 + 1013904223) % 2 ** 32;
    return currentSeed / 2 ** 32;
  };
}

/**
 * Generate a numeric seed from a string.
 */
function hashStringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Randomly select a specified number of suggestions from default suggestions.
 * Uses chatId as the seed to ensure the same chatId produces the same random selection.
 * @param t - Translation function
 * @param count - Number of suggestions to select
 * @param seed - Optional seed value (usually chatId); uses true random if not provided
 */
export function getRandomDefaultSuggestions(
  t: (key: string) => string,
  count = 2,
  seed?: string,
): SuggestedPrompt[] {
  const allSuggestions = getAllDefaultSuggestions(t);
  // If seed is provided, use deterministic random; otherwise use true random
  const random = seed
    ? seededRandom(hashStringToSeed(seed))
    : () => Math.random();

  // Use Fisher-Yates shuffle algorithm to randomly shuffle
  const shuffled = [...allSuggestions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
