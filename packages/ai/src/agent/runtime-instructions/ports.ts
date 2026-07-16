import type {
  AgentGoal,
  PersistedAgentGoal,
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
} from "./types";

export interface GoalInstructionCommit {
  goal: PersistedAgentGoal;
  instruction: RuntimeInstruction;
  deduplicated: boolean;
}

/**
 * Atomic persistence boundary for authoritative Goal state and its immutable
 * instruction outbox entry. Implementations must not commit one without the
 * other and must scope every lookup and mutation to ownerId.
 */
export interface AgentGoalStatePort {
  getGoal(ownerId: string, goalId: string): Promise<PersistedAgentGoal | null>;

  getActivePrimaryGoal(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<PersistedAgentGoal | null>;

  commitActivation(input: {
    ownerId: string;
    runtimeSessionId: string;
    goal: AgentGoal;
    instruction: RuntimeInstruction;
  }): Promise<GoalInstructionCommit>;

  commitRevision(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    goal: AgentGoal;
    instruction: RuntimeInstruction;
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
