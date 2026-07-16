import { z } from "zod";

import {
  AgentGoalSchema,
  AgentGoalUpdateSchema,
  CreateAgentGoalInputSchema,
} from "./schema";
import { assertGoalStatusTransition } from "./state-machine";
import type {
  AgentGoal,
  AgentGoalUpdate,
  CreateAgentGoalInput,
  GoalStatus,
} from "./types";

export type AgentGoalDomainErrorCode =
  | "invalid_goal"
  | "revision_conflict"
  | "invalid_transition";

export class AgentGoalDomainError extends Error {
  constructor(
    public readonly code: AgentGoalDomainErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentGoalDomainError";
  }
}

export function createAgentGoal(params: {
  id: string;
  input: CreateAgentGoalInput;
  now: Date;
}): AgentGoal {
  try {
    const input = CreateAgentGoalInputSchema.parse(params.input);
    return AgentGoalSchema.parse({
      ...input,
      id: params.id,
      revision: 1,
      status: "active",
      createdAt: params.now.toISOString(),
      updatedAt: params.now.toISOString(),
    });
  } catch (error) {
    throw invalidGoal("Goal creation input is invalid", error);
  }
}

export function reviseAgentGoal(params: {
  current: AgentGoal;
  expectedRevision: number;
  update: AgentGoalUpdate;
  now: Date;
}): AgentGoal {
  assertExpectedRevision(params.current, params.expectedRevision);
  assertMonotonicTime(params.current, params.now);

  try {
    const update = AgentGoalUpdateSchema.parse(params.update);
    return AgentGoalSchema.parse({
      ...params.current,
      ...definedFields(update),
      deadline: optionalUpdate(update, "deadline", params.current.deadline),
      maxTurns: optionalUpdate(update, "maxTurns", params.current.maxTurns),
      maxTokens: optionalUpdate(update, "maxTokens", params.current.maxTokens),
      maxDurationSeconds: optionalUpdate(
        update,
        "maxDurationSeconds",
        params.current.maxDurationSeconds,
      ),
      revision: params.current.revision + 1,
      updatedAt: params.now.toISOString(),
    });
  } catch (error) {
    throw invalidGoal("Goal revision is invalid", error);
  }
}

export function transitionAgentGoal(params: {
  current: AgentGoal;
  expectedRevision: number;
  status: GoalStatus;
  now: Date;
}): AgentGoal {
  assertExpectedRevision(params.current, params.expectedRevision);
  assertMonotonicTime(params.current, params.now);

  try {
    assertGoalStatusTransition(params.current.status, params.status);
  } catch (error) {
    throw new AgentGoalDomainError(
      "invalid_transition",
      error instanceof Error ? error.message : "Goal transition is invalid",
      error,
    );
  }

  try {
    return AgentGoalSchema.parse({
      ...params.current,
      status: params.status,
      revision: params.current.revision + 1,
      updatedAt: params.now.toISOString(),
    });
  } catch (error) {
    throw invalidGoal("Transitioned Goal is invalid", error);
  }
}

function assertExpectedRevision(
  goal: AgentGoal,
  expectedRevision: number,
): void {
  if (goal.revision !== expectedRevision) {
    throw new AgentGoalDomainError(
      "revision_conflict",
      `Expected Goal revision ${expectedRevision}, received ${goal.revision}`,
    );
  }
}

function assertMonotonicTime(goal: AgentGoal, now: Date): void {
  if (now.getTime() < Date.parse(goal.updatedAt)) {
    throw new AgentGoalDomainError(
      "invalid_goal",
      `Goal update time ${now.toISOString()} is earlier than ${goal.updatedAt}`,
    );
  }
}

function definedFields(update: AgentGoalUpdate): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(update).filter(
      ([key, value]) =>
        value !== undefined &&
        value !== null &&
        !["deadline", "maxTurns", "maxTokens", "maxDurationSeconds"].includes(
          key,
        ),
    ),
  );
}

function optionalUpdate<T>(
  update: AgentGoalUpdate,
  key: keyof Pick<
    AgentGoalUpdate,
    "deadline" | "maxTurns" | "maxTokens" | "maxDurationSeconds"
  >,
  current: T | undefined,
): T | undefined {
  if (!Object.hasOwn(update, key)) return current;
  const value = update[key];
  return value === null ? undefined : (value as T | undefined);
}

function invalidGoal(message: string, cause: unknown): AgentGoalDomainError {
  const detail =
    cause instanceof z.ZodError ? `: ${cause.issues[0]?.message}` : "";
  return new AgentGoalDomainError("invalid_goal", `${message}${detail}`, cause);
}
