import { z } from "zod";

import {
  AGENT_GOAL_LIMITS,
  DEFAULT_GOAL_MAX_TURNS,
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
} from "./constants";

const identifierSchema = z.string().trim().min(1).max(256);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const jsonScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    jsonScalarSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedJsonRecord(maxBytes: number) {
  return z
    .record(z.string(), jsonValueSchema)
    .refine(
      (value) => serializedByteLength(value) <= maxBytes,
      `Serialized value must not exceed ${maxBytes} bytes`,
    );
}

export const GoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "expired",
  "budget_limited",
  "failed",
]);

export const GoalCompletionPolicySchema = z.enum([
  "model_evaluator",
  "tool_evidence",
  "manual",
]);

export const GoalSourceSchema = z
  .object({
    type: z.enum(["user", "loop", "scheduled_job", "insight", "connector"]),
    id: identifierSchema.optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.type !== "user" && source.id === undefined) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `${source.type} Goals must identify their source`,
      });
    }
  });

export const GoalCriterionVerificationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("model_evidence") }).strict(),
  z
    .object({
      type: z.literal("command_result"),
      commandPattern: z.string().trim().min(1).max(1_024).optional(),
      expectedExitCode: z.int().min(-255).max(255),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      toolName: z.string().trim().min(1).max(256),
      expectedOutcome: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z.object({ type: z.literal("manual") }).strict(),
]);

export const GoalSuccessCriterionSchema = z
  .object({
    id: identifierSchema,
    description: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_GOAL_LIMITS.criterionDescriptionCharacters),
    verification: GoalCriterionVerificationSchema,
    required: z.boolean(),
  })
  .strict();

export const GoalConstraintSchema = z
  .object({
    id: identifierSchema,
    description: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_GOAL_LIMITS.constraintDescriptionCharacters),
    enforcement: z.enum(["model_guidance", "runtime_enforced"]),
    authority: z.enum(["user", "organization_policy", "automation"]),
    sourceRef: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict()
  .superRefine((constraint, context) => {
    if (
      (constraint.enforcement === "runtime_enforced" ||
        constraint.authority === "organization_policy") &&
      constraint.sourceRef === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRef"],
        message:
          "A runtime-enforced or organization-policy constraint must reference its source",
      });
    }
  });

export const GoalContextReferenceSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum([
      "insight",
      "entity",
      "project",
      "task",
      "decision",
      "document",
      "event",
      "connector_record",
      "custom",
    ]),
    refId: identifierSchema,
    label: z.string().trim().min(1).max(512).optional(),
    summary: z
      .string()
      .trim()
      .max(AGENT_GOAL_LIMITS.contextSummaryCharacters)
      .optional(),
    origin: z.enum(["connector", "memory", "user", "openloomi"]),
    sourceRef: z.string().trim().min(1).max(2_048).optional(),
    digest: sha256Schema.optional(),
    attributes: boundedJsonRecord(
      AGENT_GOAL_LIMITS.contextAttributesBytes,
    ).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.origin === "connector" && reference.sourceRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceRef"],
        message: "Connector context must identify its source",
      });
    }
  });

const agentGoalObjectSchema = z
  .object({
    id: z.uuid(),
    revision: z.int().positive(),
    objective: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_GOAL_LIMITS.objectiveCharacters),
    successCriteria: z
      .array(GoalSuccessCriterionSchema)
      .min(1)
      .max(AGENT_GOAL_LIMITS.successCriteria),
    constraints: z
      .array(GoalConstraintSchema)
      .max(AGENT_GOAL_LIMITS.constraints),
    contextRefs: z
      .array(GoalContextReferenceSchema)
      .max(AGENT_GOAL_LIMITS.contextReferences),
    priority: z.int().min(0).max(100),
    status: GoalStatusSchema,
    deadline: isoDateTimeSchema.optional(),
    maxTurns: z.int().positive().max(10_000).optional(),
    maxTokens: z.int().positive().max(100_000_000).optional(),
    maxDurationSeconds: z
      .int()
      .positive()
      .max(30 * 24 * 60 * 60)
      .optional(),
    completionPolicy: GoalCompletionPolicySchema,
    source: GoalSourceSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

type GoalInvariantFields = Pick<
  z.infer<typeof agentGoalObjectSchema>,
  | "successCriteria"
  | "constraints"
  | "contextRefs"
  | "deadline"
  | "maxTurns"
  | "maxTokens"
  | "maxDurationSeconds"
  | "createdAt"
  | "updatedAt"
>;

function validateGoalInvariants(
  goal: GoalInvariantFields,
  context: z.RefinementCtx,
): void {
  if (
    goal.deadline === undefined &&
    goal.maxTurns === undefined &&
    goal.maxTokens === undefined &&
    goal.maxDurationSeconds === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxTurns"],
      message: "A Goal must define a deadline or at least one execution budget",
    });
  }

  if (Date.parse(goal.updatedAt) < Date.parse(goal.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Goal updatedAt cannot be earlier than createdAt",
    });
  }

  for (const [field, values] of [
    ["successCriteria", goal.successCriteria],
    ["constraints", goal.constraints],
    ["contextRefs", goal.contextRefs],
  ] as const) {
    const ids = new Set<string>();
    for (const value of values) {
      if (ids.has(value.id)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} contains duplicate id ${value.id}`,
        });
      }
      ids.add(value.id);
    }
  }
}

export const AgentGoalSchema = agentGoalObjectSchema.superRefine(
  validateGoalInvariants,
);

export const CreateAgentGoalInputSchema = agentGoalObjectSchema
  .omit({
    id: true,
    revision: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    constraints: agentGoalObjectSchema.shape.constraints.default([]),
    contextRefs: agentGoalObjectSchema.shape.contextRefs.default([]),
    maxTurns: z.int().positive().max(10_000).default(DEFAULT_GOAL_MAX_TURNS),
  });

export const AgentGoalUpdateSchema = z
  .object({
    objective: agentGoalObjectSchema.shape.objective.optional(),
    successCriteria: agentGoalObjectSchema.shape.successCriteria.optional(),
    constraints: agentGoalObjectSchema.shape.constraints.optional(),
    contextRefs: agentGoalObjectSchema.shape.contextRefs.optional(),
    priority: agentGoalObjectSchema.shape.priority.optional(),
    deadline: agentGoalObjectSchema.shape.deadline.nullable().optional(),
    maxTurns: agentGoalObjectSchema.shape.maxTurns.nullable().optional(),
    maxTokens: agentGoalObjectSchema.shape.maxTokens.nullable().optional(),
    maxDurationSeconds: agentGoalObjectSchema.shape.maxDurationSeconds
      .nullable()
      .optional(),
    completionPolicy: agentGoalObjectSchema.shape.completionPolicy.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "A Goal update must change at least one field",
  });

export const GoalEvaluationResultSchema = z
  .object({
    completed: z.boolean(),
    confidence: z.number().min(0).max(1),
    satisfiedCriteria: z
      .array(identifierSchema)
      .max(AGENT_GOAL_LIMITS.successCriteria),
    missingCriteria: z
      .array(identifierSchema)
      .max(AGENT_GOAL_LIMITS.successCriteria),
    evidence: z
      .array(
        z
          .object({
            criterionId: identifierSchema,
            evidenceIds: z.array(z.uuid()).max(256),
          })
          .strict(),
      )
      .max(AGENT_GOAL_LIMITS.successCriteria),
    reason: z.string().trim().min(1).max(8_000),
    nextInstruction: z.string().trim().min(1).max(8_000).optional(),
  })
  .strict()
  .superRefine((evaluation, context) => {
    const satisfied = new Set(evaluation.satisfiedCriteria);
    const missing = new Set(evaluation.missingCriteria);

    if (satisfied.size !== evaluation.satisfiedCriteria.length) {
      context.addIssue({
        code: "custom",
        path: ["satisfiedCriteria"],
        message: "Satisfied criteria must not contain duplicate ids",
      });
    }
    if (missing.size !== evaluation.missingCriteria.length) {
      context.addIssue({
        code: "custom",
        path: ["missingCriteria"],
        message: "Missing criteria must not contain duplicate ids",
      });
    }
    if ([...satisfied].some((criterionId) => missing.has(criterionId))) {
      context.addIssue({
        code: "custom",
        path: ["missingCriteria"],
        message: "A criterion cannot be both satisfied and missing",
      });
    }
    if (evaluation.completed && evaluation.missingCriteria.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["completed"],
        message: "A completed evaluation cannot contain missing criteria",
      });
    }
  });

export const RuntimeInstructionKindSchema = z.enum([
  "goal.activate",
  "goal.update",
  "goal.pause",
  "goal.resume",
  "goal.cancel",
  "goal.continue",
  "context.upsert",
  "context.remove",
  "constraint.upsert",
  "constraint.remove",
  "control.interrupt",
]);

export const RuntimeInstructionDeliveryModeSchema = z.enum([
  "steer",
  "next_boundary",
  "interrupt_replace",
]);

export const RuntimeInstructionSourceSchema = z
  .object({
    type: z.enum(["user", "automation", "connector", "policy"]),
    authority: z.enum([
      "user",
      "organization_policy",
      "automation",
      "untrusted_data",
    ]),
    sourceRef: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict()
  .superRefine((source, context) => {
    const requiredAuthority = {
      user: "user",
      automation: "automation",
      connector: "untrusted_data",
      policy: "organization_policy",
    } as const;
    if (source.authority !== requiredAuthority[source.type]) {
      context.addIssue({
        code: "custom",
        path: ["authority"],
        message: `${source.type} instructions require ${requiredAuthority[source.type]} authority`,
      });
    }
    if (
      (source.type === "connector" || source.type === "policy") &&
      source.sourceRef === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRef"],
        message: `${source.type} instructions must identify their source`,
      });
    }
  });

const instructionEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_INSTRUCTION_SCHEMA_VERSION),
    id: z.uuid(),
    sequence: z.int().positive(),
    goalId: z.uuid().optional(),
    goalRevision: z.int().positive().optional(),
    deliveryMode: RuntimeInstructionDeliveryModeSchema,
    targetSessionId: z.uuid(),
    source: RuntimeInstructionSourceSchema,
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_GOAL_LIMITS.idempotencyKeyCharacters),
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.optional(),
  })
  .strict();

const optionalReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(4_000).optional() })
  .strict();

const goalInstructionEnvelopeSchema = instructionEnvelopeSchema.extend({
  goalId: z.uuid(),
  goalRevision: z.int().positive(),
});

const remainingExecutionBudgetSchema = z
  .object({
    turns: z.int().nonnegative().optional(),
    tokens: z.int().nonnegative().optional(),
    durationSeconds: z.int().nonnegative().optional(),
    deadline: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (budget) =>
      (budget.turns ?? 0) > 0 ||
      (budget.tokens ?? 0) > 0 ||
      (budget.durationSeconds ?? 0) > 0 ||
      budget.deadline !== undefined,
    {
      message: "A continuation must have remaining execution budget",
    },
  );

export const RuntimeInstructionSchema = z
  .discriminatedUnion("kind", [
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.activate"),
      payload: z.object({ goal: AgentGoalSchema }).strict(),
    }),
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.update"),
      payload: z
        .object({
          goal: AgentGoalSchema,
          previousRevision: z.int().positive(),
        })
        .strict(),
    }),
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.pause"),
      payload: optionalReasonSchema,
    }),
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.resume"),
      payload: optionalReasonSchema,
    }),
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.cancel"),
      payload: optionalReasonSchema,
    }),
    goalInstructionEnvelopeSchema.extend({
      kind: z.literal("goal.continue"),
      payload: z
        .object({
          missingCriteria: z
            .array(
              z
                .object({
                  id: identifierSchema,
                  description: z.string().trim().min(1).max(2_000),
                })
                .strict(),
            )
            .min(1)
            .max(AGENT_GOAL_LIMITS.successCriteria),
          reason: z.string().trim().min(1).max(8_000),
          remainingBudget: remainingExecutionBudgetSchema,
        })
        .strict(),
    }),
    instructionEnvelopeSchema.extend({
      kind: z.literal("context.upsert"),
      payload: z.object({ contextRef: GoalContextReferenceSchema }).strict(),
    }),
    instructionEnvelopeSchema.extend({
      kind: z.literal("context.remove"),
      payload: z.object({ contextRefId: identifierSchema }).strict(),
    }),
    instructionEnvelopeSchema.extend({
      kind: z.literal("constraint.upsert"),
      payload: z.object({ constraint: GoalConstraintSchema }).strict(),
    }),
    instructionEnvelopeSchema.extend({
      kind: z.literal("constraint.remove"),
      payload: z.object({ constraintId: identifierSchema }).strict(),
    }),
    instructionEnvelopeSchema.extend({
      kind: z.literal("control.interrupt"),
      payload: z
        .object({
          reason: z.string().trim().min(1).max(4_000),
          replacementGoalId: z.uuid().optional(),
        })
        .strict(),
    }),
  ])
  .superRefine((instruction, context) => {
    if (
      (instruction.goalId === undefined) !==
      (instruction.goalRevision === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["goalRevision"],
        message: "goalId and goalRevision must be supplied together",
      });
    }
    if (
      instruction.expiresAt !== undefined &&
      Date.parse(instruction.expiresAt) <= Date.parse(instruction.issuedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Instruction expiry must be later than its issue time",
      });
    }
    if (
      serializedByteLength(instruction.payload) >
      AGENT_GOAL_LIMITS.instructionPayloadBytes
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "Instruction payload exceeds the serialized size limit",
      });
    }
    if (
      instruction.source.authority === "untrusted_data" &&
      !instruction.kind.startsWith("context.")
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "authority"],
        message: "Untrusted data may only produce context instructions",
      });
    }
    if (
      instruction.kind === "control.interrupt" &&
      instruction.deliveryMode !== "interrupt_replace"
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveryMode"],
        message: "control.interrupt requires interrupt_replace delivery",
      });
    }
    if (
      (instruction.kind === "goal.activate" ||
        instruction.kind === "goal.update") &&
      (instruction.payload.goal.id !== instruction.goalId ||
        instruction.payload.goal.revision !== instruction.goalRevision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", "goal"],
        message: "Instruction and payload Goal identity/revision must match",
      });
    }
    if (
      instruction.kind === "goal.activate" &&
      instruction.payload.goal.status !== "active"
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", "goal", "status"],
        message: "A goal.activate instruction requires an active Goal",
      });
    }
    if (
      instruction.kind === "goal.update" &&
      instruction.payload.previousRevision + 1 !== instruction.goalRevision
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", "previousRevision"],
        message: "A Goal update must advance exactly one revision",
      });
    }
    if (instruction.kind === "goal.continue") {
      const criterionIds = instruction.payload.missingCriteria.map(
        (criterion) => criterion.id,
      );
      if (new Set(criterionIds).size !== criterionIds.length) {
        context.addIssue({
          code: "custom",
          path: ["payload", "missingCriteria"],
          message: "Continuation criteria must not contain duplicate ids",
        });
      }
      if (
        instruction.payload.remainingBudget.deadline !== undefined &&
        Date.parse(instruction.payload.remainingBudget.deadline) <=
          Date.parse(instruction.issuedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["payload", "remainingBudget", "deadline"],
          message: "A continuation deadline must be later than its issue time",
        });
      }
    }
  });

export const RuntimeProviderSchema = z.literal("claude");

export const RuntimeSessionStateSchema = z.enum([
  "starting",
  "idle",
  "running",
  "evaluating",
  "interrupted",
  "closed",
  "failed",
]);

export const GoalRunStatusSchema = z.enum([
  "queued",
  "running",
  "evaluating",
  "continuing",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "budget_limited",
  "failed",
]);

export const DeliveryStateSchema = z.enum([
  "pending",
  "leased",
  "queued",
  "written_to_sdk",
  "observed",
  "applied",
  "completed",
  "rejected",
  "expired",
  "superseded",
  "cancelled",
  "failed",
]);

export const GoalEvidenceTypeSchema = z.enum([
  "command_result",
  "tool_result",
  "test_result",
  "file_change",
  "agent_report",
  "hook_result",
  "manual_attestation",
  "evaluation",
]);

export const GoalEvidenceSchema = z
  .object({
    id: z.uuid(),
    goalId: z.uuid(),
    goalRunId: z.uuid(),
    goalRevision: z.int().positive(),
    instructionId: z.uuid().optional(),
    criterionId: identifierSchema.optional(),
    type: GoalEvidenceTypeSchema,
    sourceEventId: identifierSchema,
    summary: z.string().trim().min(1).max(8_000),
    success: z.boolean().optional(),
    payload: jsonValueSchema,
    observedAt: isoDateTimeSchema,
  })
  .strict()
  .refine(
    (evidence) =>
      serializedByteLength(evidence.payload) <=
      AGENT_GOAL_LIMITS.evidencePayloadBytes,
    { path: ["payload"], message: "Evidence payload exceeds the size limit" },
  );
