import type {
  AgentGoal,
  PersistedAgentGoal,
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
  RuntimeInstructionDraft,
} from "./types";

export interface GoalInstructionCommit {
  goal: PersistedAgentGoal;
  instruction: RuntimeInstruction;
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
}

/** Provider execution boundary. PR 3 supplies the Claude implementation. */
export interface RuntimeInstructionTransportPort {
  readonly runtimeSessionId: string;

  deliver(instruction: RuntimeInstruction): Promise<RuntimeDeliveryReceipt>;

  interrupt(input: { reason: string; expectedRunEpoch: number }): Promise<void>;
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
