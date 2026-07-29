import type {
  AgentGoal,
  AgentGoalLifecycleTransition,
  AgentGoalReplacement,
  GoalLifecycleTransitionAction,
  PersistedAgentGoal,
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
  RuntimeInstructionDraft,
  RuntimeRunEpochAdvanceResult,
  RuntimeTurnBoundary,
  RuntimeTurnBoundaryInputHold,
  RuntimeTurnTerminal,
} from "./types";

export interface GoalInstructionCommit {
  goal: PersistedAgentGoal;
  instruction: RuntimeInstruction;
  deduplicated: boolean;
}

export interface GoalReplacementCommit {
  replacement: AgentGoalReplacement;
  deduplicated: boolean;
}

export interface GoalLifecycleTransitionCommit {
  transition: AgentGoalLifecycleTransition;
  deduplicated: boolean;
}

export interface GoalCommandIdentity {
  idempotencyKey: string;
  requestFingerprint: string;
}

/**
 * Atomic persistence boundary for authoritative Goal state and its immutable
 * instruction outbox entry. The adapter assigns the session-monotonic
 * instruction sequence in the same critical section as the Goal mutation.
 * Implementations must not commit one without the other and must scope every
 * lookup and mutation to ownerId.
 */
export interface AgentGoalStatePort {
  getRuntimeSessionRunEpoch(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<number>;

  getGoal(ownerId: string, goalId: string): Promise<PersistedAgentGoal | null>;

  getActivePrimaryGoal(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<PersistedAgentGoal | null>;

  listInstructions(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstruction[]>;

  findCommitByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit | null>;

  findReplacementByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit | null>;

  findLifecycleTransitionByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit | null>;

  commitActivation(input: {
    ownerId: string;
    runtimeSessionId: string;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit>;

  commitRevision(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit>;

  commitTransition(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit>;

  prepareLifecycleTransition(input: {
    ownerId: string;
    runtimeSessionId: string;
    action: GoalLifecycleTransitionAction;
    expectedRevision: number;
    expectedRunEpoch: number;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit>;

  markLifecycleTransitionBoundary(input: {
    ownerId: string;
    runtimeSessionId: string;
    goalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit>;

  finalizeLifecycleTransition(input: {
    ownerId: string;
    runtimeSessionId: string;
    goalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit>;

  prepareReplacement(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    expectedRunEpoch: number;
    supersededGoal: AgentGoal;
    replacementGoal: AgentGoal;
    controlInstruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit>;

  markReplacementBoundary(input: {
    ownerId: string;
    runtimeSessionId: string;
    replacementGoalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit>;

  finalizeReplacement(input: {
    ownerId: string;
    runtimeSessionId: string;
    replacementGoalId: string;
    activationInstruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit>;
}

/** Provider execution boundary. PR 3 supplies the Claude implementation. */
export interface RuntimeInstructionTransportPort {
  readonly runtimeSessionId: string;

  deliver(instruction: RuntimeInstruction): Promise<RuntimeDeliveryReceipt>;

  interrupt(input: { reason: string; expectedRunEpoch: number }): Promise<void>;
}

/**
 * Optional control plane implemented by long-lived runtimes that can safely
 * replace one Goal run with another inside the same provider session.
 */
export interface RuntimeSessionLifecycleControlPort extends RuntimeInstructionTransportPort {
  readonly runEpoch: number;

  captureTurnBoundary(): RuntimeTurnBoundary;

  /**
   * Acquires the input fence and captures the provider boundary in one
   * synchronous runtime operation, so an SDK handoff cannot occur between
   * those two observations.
   */
  captureTurnBoundaryAndHoldPendingInput(
    expectedRunEpoch: number,
  ): RuntimeTurnBoundaryInputHold;

  waitForTurnTerminal(input: {
    expectedRunEpoch: number;
    afterTerminalSequence: number;
    signal?: AbortSignal;
  }): Promise<RuntimeTurnTerminal>;

  advanceRunEpoch(input: {
    expectedRunEpoch: number;
    nextRunEpoch: number;
  }): RuntimeRunEpochAdvanceResult;
}

export interface RuntimeSessionResolverPort {
  resolve(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstructionTransportPort | null>;
}

export interface RuntimeClockPort {
  now(): Date;
}

export interface RuntimeIdGeneratorPort {
  generate(): string;
}
