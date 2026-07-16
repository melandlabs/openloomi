import type {
  DeliveryState,
  GoalRunStatus,
  GoalStatus,
  RuntimeSessionState,
} from "./types";

const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> = {
  active: [
    "paused",
    "blocked",
    "completed",
    "cancelled",
    "expired",
    "budget_limited",
    "failed",
  ],
  paused: ["active", "cancelled", "expired", "failed"],
  blocked: ["active", "cancelled", "expired", "failed"],
  completed: [],
  cancelled: [],
  expired: [],
  budget_limited: [],
  failed: [],
};

const RUN_TRANSITIONS: Readonly<
  Record<GoalRunStatus, readonly GoalRunStatus[]>
> = {
  queued: ["running", "paused", "cancelled", "failed"],
  running: [
    "evaluating",
    "continuing",
    "paused",
    "blocked",
    "completed",
    "cancelled",
    "budget_limited",
    "failed",
  ],
  evaluating: [
    "continuing",
    "blocked",
    "completed",
    "budget_limited",
    "failed",
  ],
  continuing: [
    "running",
    "evaluating",
    "paused",
    "blocked",
    "cancelled",
    "budget_limited",
    "failed",
  ],
  paused: ["running", "cancelled", "failed"],
  blocked: ["running", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  budget_limited: [],
  failed: [],
};

const SESSION_TRANSITIONS: Readonly<
  Record<RuntimeSessionState, readonly RuntimeSessionState[]>
> = {
  starting: ["idle", "running", "closed", "failed"],
  idle: ["running", "closed", "failed"],
  running: ["idle", "evaluating", "interrupted", "closed", "failed"],
  evaluating: ["running", "idle", "interrupted", "closed", "failed"],
  interrupted: ["running", "idle", "closed", "failed"],
  closed: [],
  failed: [],
};

const DELIVERY_TRANSITIONS: Readonly<
  Record<DeliveryState, readonly DeliveryState[]>
> = {
  pending: ["leased", "expired", "superseded", "cancelled", "failed"],
  leased: ["pending", "queued", "expired", "superseded", "cancelled", "failed"],
  queued: [
    "written_to_sdk",
    "rejected",
    "expired",
    "superseded",
    "cancelled",
    "failed",
  ],
  written_to_sdk: ["observed", "rejected", "failed"],
  observed: ["applied", "rejected", "failed"],
  applied: ["completed", "failed"],
  completed: [],
  rejected: [],
  expired: [],
  superseded: [],
  cancelled: [],
  failed: [],
};

export class AgentRuntimeStateTransitionError extends Error {
  constructor(entity: string, current: string, next: string) {
    super(`Invalid ${entity} state transition: ${current} -> ${next}`);
    this.name = "AgentRuntimeStateTransitionError";
  }
}

function assertTransition<T extends string>(
  entity: string,
  transitions: Readonly<Record<T, readonly T[]>>,
  current: T,
  next: T,
): void {
  if (!transitions[current].includes(next)) {
    throw new AgentRuntimeStateTransitionError(entity, current, next);
  }
}

export function assertGoalStatusTransition(
  current: GoalStatus,
  next: GoalStatus,
): void {
  assertTransition("Goal", GOAL_TRANSITIONS, current, next);
}

export function assertGoalRunStatusTransition(
  current: GoalRunStatus,
  next: GoalRunStatus,
): void {
  assertTransition("Goal Run", RUN_TRANSITIONS, current, next);
}

export function assertRuntimeSessionStateTransition(
  current: RuntimeSessionState,
  next: RuntimeSessionState,
): void {
  assertTransition("Runtime Session", SESSION_TRANSITIONS, current, next);
}

export function assertDeliveryStateTransition(
  current: DeliveryState,
  next: DeliveryState,
): void {
  assertTransition("Instruction Delivery", DELIVERY_TRANSITIONS, current, next);
}
