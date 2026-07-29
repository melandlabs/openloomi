export type GoalServiceErrorCode =
  | "context_not_found"
  | "goal_not_active"
  | "goal_not_found"
  | "goal_session_mismatch"
  | "invalid_command"
  | "invalid_constraint_authority"
  | "invalid_context_provenance"
  | "invalid_goal_provenance"
  | "invalid_lifecycle_authority"
  | "no_change"
  | "runtime_constraint_unsupported";

export class GoalServiceError extends Error {
  constructor(
    public readonly code: GoalServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GoalServiceError";
  }
}
