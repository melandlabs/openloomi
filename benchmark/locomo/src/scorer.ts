/**
 * Category names mapping for LoCoMo benchmark.
 */

export const CATEGORY_NAMES: Record<string, string> = {
  "1": "single_hop",
  "2": "temporal",
  "3": "multi_hop",
  "4": "open_domain",
  "5": "adversarial", // Usually excluded from overall stats
};

export const CATEGORIES = [
  "single_hop",
  "temporal",
  "multi_hop",
  "open_domain",
];
