/**
 * Category names mapping for LongMemEval benchmark.
 */

export const QUESTION_TYPE_NAMES: Record<string, string> = {
  "single-session-user": "single-session-user",
  "single-session-preference": "single-session-preference",
  "single-session-assistant": "single-session-assistant",
  "multi-session": "multi-session",
  "temporal-reasoning": "temporal-reasoning",
  "knowledge-update": "knowledge-update",
};

export const QUESTION_TYPES = [
  "single-session-user",
  "single-session-preference",
  "single-session-assistant",
  "multi-session",
  "temporal-reasoning",
  "knowledge-update",
];
