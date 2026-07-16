import type { z } from "zod";

import type {
  AgentGoalSchema,
  AgentGoalUpdateSchema,
  CreateAgentGoalInputSchema,
  DeliveryStateSchema,
  GoalCompletionPolicySchema,
  GoalConstraintSchema,
  GoalContextReferenceSchema,
  GoalCriterionVerificationSchema,
  GoalEvaluationResultSchema,
  GoalEvidenceSchema,
  GoalEvidenceTypeSchema,
  GoalRunStatusSchema,
  GoalSourceSchema,
  GoalStatusSchema,
  GoalSuccessCriterionSchema,
  RuntimeInstructionDeliveryModeSchema,
  RuntimeInstructionKindSchema,
  RuntimeInstructionSchema,
  RuntimeInstructionSourceSchema,
  RuntimeProviderSchema,
  RuntimeSessionStateSchema,
} from "./schema";

export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type GoalCompletionPolicy = z.infer<typeof GoalCompletionPolicySchema>;
export type GoalSource = z.infer<typeof GoalSourceSchema>;
export type GoalCriterionVerification = z.infer<
  typeof GoalCriterionVerificationSchema
>;
export type GoalSuccessCriterion = z.infer<typeof GoalSuccessCriterionSchema>;
export type GoalConstraint = z.infer<typeof GoalConstraintSchema>;
export type GoalContextReference = z.infer<typeof GoalContextReferenceSchema>;
export type AgentGoal = z.infer<typeof AgentGoalSchema>;
export type CreateAgentGoalInput = z.input<typeof CreateAgentGoalInputSchema>;
export type ParsedCreateAgentGoalInput = z.output<
  typeof CreateAgentGoalInputSchema
>;
export type AgentGoalUpdate = z.infer<typeof AgentGoalUpdateSchema>;
export type GoalEvaluationResult = z.infer<typeof GoalEvaluationResultSchema>;
export type RuntimeInstructionKind = z.infer<
  typeof RuntimeInstructionKindSchema
>;
export type RuntimeInstructionDeliveryMode = z.infer<
  typeof RuntimeInstructionDeliveryModeSchema
>;
export type RuntimeInstructionSource = z.infer<
  typeof RuntimeInstructionSourceSchema
>;
export type RuntimeInstruction = z.infer<typeof RuntimeInstructionSchema>;
export type RuntimeProvider = z.infer<typeof RuntimeProviderSchema>;
export type RuntimeSessionState = z.infer<typeof RuntimeSessionStateSchema>;
export type GoalRunStatus = z.infer<typeof GoalRunStatusSchema>;
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;
export type GoalEvidenceType = z.infer<typeof GoalEvidenceTypeSchema>;
export type GoalEvidence = z.infer<typeof GoalEvidenceSchema>;

export interface AgentRuntimeSession {
  id: string;
  ownerId: string;
  provider: RuntimeProvider;
  providerSessionId?: string;
  workingDirectory?: string;
  state: RuntimeSessionState;
  runEpoch: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedAgentGoal {
  ownerId: string;
  runtimeSessionId: string;
  slot: "primary";
  goal: AgentGoal;
}

export interface AgentGoalRun {
  id: string;
  ownerId: string;
  goalId: string;
  goalRevision: number;
  runtimeSessionId: string;
  providerSessionId?: string;
  runEpoch: number;
  status: GoalRunStatus;
  turnsUsed: number;
  tokensUsed: number;
  startedAt: string;
  lastActivityAt: string;
  completedAt?: string;
  lastEvaluation?: GoalEvaluationResult;
}

export interface RuntimeInstructionDelivery {
  id: string;
  ownerId: string;
  instructionId: string;
  runtimeSessionId: string;
  goalRunId?: string;
  state: DeliveryState;
  attempt: number;
  leaseToken?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  providerEventId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeDeliveryReceipt {
  instructionId: string;
  runtimeSessionId: string;
  state: Extract<DeliveryState, "queued" | "written_to_sdk" | "rejected">;
  providerEventId?: string;
  recordedAt: string;
  reason?: string;
}
