export const RUNTIME_INSTRUCTION_SCHEMA_VERSION = "1" as const;

export const DEFAULT_GOAL_MAX_TURNS = 12;

export const AGENT_GOAL_LIMITS = {
  objectiveCharacters: 8_000,
  successCriteria: 64,
  criterionDescriptionCharacters: 2_000,
  constraints: 64,
  constraintDescriptionCharacters: 2_000,
  contextReferences: 128,
  contextSummaryCharacters: 8_000,
  contextAttributesBytes: 32 * 1024,
  instructionPayloadBytes: 256 * 1024,
  evidencePayloadBytes: 256 * 1024,
  idempotencyKeyCharacters: 256,
} as const;
