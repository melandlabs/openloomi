/**
 * Category names mapping for CL-bench benchmarks.
 */

// CL-bench categories (professional tasks)
export const CLBENCH_CATEGORIES = [
  "Domain Knowledge Reasoning",
  "Language Understanding",
  "Information Extraction",
  "Text Generation",
] as const;

// CL-bench-Life categories (everyday life tasks)
export const CLBENCH_LIFE_CATEGORIES = [
  "Communication & Social Interactions",
  "Daily Life Planning",
  "Task Assistance",
] as const;

// Category display names mapping
export const CATEGORY_NAMES: Record<string, string> = {
  // CL-bench categories
  domain_knowledge_reasoning: "Domain Knowledge Reasoning",
  language_understanding: "Language Understanding",
  information_extraction: "Information Extraction",
  text_generation: "Text Generation",
  // CL-bench-Life categories
  "communication_&_social_interactions": "Communication & Social Interactions",
  daily_life_planning: "Daily Life Planning",
  task_assistance: "Task Assistance",
};

// Benchmark type
export type BenchmarkType = "clbench" | "clbench-life";

export function getCategories(benchmark: BenchmarkType): readonly string[] {
  return benchmark === "clbench" ? CLBENCH_CATEGORIES : CLBENCH_LIFE_CATEGORIES;
}
