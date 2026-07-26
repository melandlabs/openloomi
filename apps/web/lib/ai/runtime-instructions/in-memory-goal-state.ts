import {
  AgentGoalSchema,
  RuntimeInstructionSchema,
  canonicalJson,
  type AgentGoal,
  type AgentGoalStatePort,
  type GoalCommandIdentity,
  type GoalInstructionCommit,
  type GoalStatus,
  type PersistedAgentGoal,
  type RuntimeInstruction,
  type RuntimeInstructionDraft,
} from "@openloomi/ai/agent/runtime-instructions";

import { KeyedSerialExecutor } from "./keyed-serial-executor";

interface StoredGoalInstructionCommit {
  goal: PersistedAgentGoal;
  instruction: RuntimeInstruction;
  requestFingerprint: string;
}

interface GoalSessionSnapshot {
  ownerId: string;
  runtimeSessionId: string;
  primaryGoalId?: string;
  goals: Map<string, PersistedAgentGoal>;
  instructions: RuntimeInstruction[];
  commitsByIdempotencyKey: Map<string, StoredGoalInstructionCommit>;
  commitsByInstructionId: Map<string, StoredGoalInstructionCommit>;
  lastInstructionSequence: number;
}

export type InMemoryGoalStateErrorCode =
  | "active_primary_goal_conflict"
  | "goal_conflict"
  | "goal_not_found"
  | "idempotency_conflict"
  | "invalid_commit"
  | "revision_conflict";

export class InMemoryGoalStateError extends Error {
  constructor(
    public readonly code: InMemoryGoalStateErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InMemoryGoalStateError";
  }
}

/**
 * In-memory authoritative Goal state and immutable instruction outbox.
 *
 * Every owner mutation is serialized and applied to a copy-on-write session
 * snapshot. Owner-wide Goal identity, Goal state, idempotency identity,
 * session sequence and outbox instruction therefore become visible together
 * or not at all.
 */
export class InMemoryAgentGoalState implements AgentGoalStatePort {
  private readonly sessions = new Map<string, GoalSessionSnapshot>();
  private readonly mutations = new KeyedSerialExecutor();

  async getGoal(
    ownerId: string,
    goalId: string,
  ): Promise<PersistedAgentGoal | null> {
    const normalizedOwnerId = requiredIdentifier(ownerId, "ownerId");
    const normalizedGoalId = requiredIdentifier(goalId, "goalId");
    for (const snapshot of this.sessions.values()) {
      if (snapshot.ownerId !== normalizedOwnerId) continue;
      const goal = snapshot.goals.get(normalizedGoalId);
      if (goal) return clone(goal);
    }
    return null;
  }

  async getActivePrimaryGoal(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<PersistedAgentGoal | null> {
    const snapshot = this.sessions.get(
      sessionScope(
        requiredIdentifier(ownerId, "ownerId"),
        requiredIdentifier(runtimeSessionId, "runtimeSessionId"),
      ),
    );
    const goal = snapshot?.primaryGoalId
      ? snapshot.goals.get(snapshot.primaryGoalId)
      : undefined;
    return goal?.goal.status === "active" ? clone(goal) : null;
  }

  async findCommitByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit | null> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const stored = this.sessions
      .get(scope.key)
      ?.commitsByIdempotencyKey.get(command.idempotencyKey);
    if (!stored) return null;
    assertMatchingFingerprint(stored, command);
    return toCommit(stored, true);
  }

  async commitActivation(input: {
    ownerId: string;
    runtimeSessionId: string;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const goal = parseGoal(input.goal);

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current =
        this.sessions.get(scope.key) ??
        emptySnapshot(scope.ownerId, scope.runtimeSessionId);
      const duplicate = findIdempotentCommit(current, command);
      if (duplicate) return toCommit(duplicate, true);

      const existingGoal = findOwnerGoal(this.sessions, scope.ownerId, goal.id);
      if (existingGoal) {
        throw new InMemoryGoalStateError(
          "goal_conflict",
          `Goal ${goal.id} already exists in Runtime Session ${existingGoal.runtimeSessionId} for this owner`,
        );
      }

      const primary = current.primaryGoalId
        ? current.goals.get(current.primaryGoalId)
        : undefined;
      if (primary && occupiesPrimarySlot(primary.goal.status)) {
        throw new InMemoryGoalStateError(
          "active_primary_goal_conflict",
          `Runtime Session ${scope.runtimeSessionId} already has primary Goal ${primary.goal.id}`,
        );
      }

      const instruction = materializeInstruction(
        input.instruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertActivationCommit(goal, instruction, scope.runtimeSessionId);

      const persisted: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal,
      };
      const stored = createStoredCommit(
        persisted,
        instruction,
        command.requestFingerprint,
      );
      const next = copySnapshot(current);
      next.primaryGoalId = goal.id;
      next.goals.set(goal.id, clone(persisted));
      recordInstruction(next, command, stored);
      this.sessions.set(scope.key, next);
      return toCommit(stored, false);
    });
  }

  async commitRevision(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalInstructionCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const goal = parseGoal(input.goal);
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      const duplicate = current ? findIdempotentCommit(current, command) : null;
      if (duplicate) return toCommit(duplicate, true);

      const persisted = current?.goals.get(goal.id);
      if (!current || !persisted) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${goal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (
        current.primaryGoalId !== goal.id ||
        persisted.goal.status !== "active"
      ) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          `Goal ${goal.id} is not the active primary Goal for Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (persisted.goal.revision !== expectedRevision) {
        throw new InMemoryGoalStateError(
          "revision_conflict",
          `Expected Goal revision ${expectedRevision}, received ${persisted.goal.revision}`,
        );
      }
      if (
        goal.revision !== expectedRevision + 1 ||
        goal.createdAt !== persisted.goal.createdAt ||
        goal.status !== "active" ||
        canonicalJson(goal.source) !== canonicalJson(persisted.goal.source) ||
        Date.parse(goal.updatedAt) < Date.parse(persisted.goal.updatedAt)
      ) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          "A Goal revision commit must advance the active Goal exactly once without changing immutable state or moving time backwards",
        );
      }

      const instruction = materializeInstruction(
        input.instruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertRevisionCommit(
        persisted.goal,
        goal,
        instruction,
        scope.runtimeSessionId,
        expectedRevision,
      );

      const revised: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal,
      };
      const stored = createStoredCommit(
        revised,
        instruction,
        command.requestFingerprint,
      );
      const next = copySnapshot(current);
      next.goals.set(goal.id, clone(revised));
      recordInstruction(next, command, stored);
      this.sessions.set(scope.key, next);
      return toCommit(stored, false);
    });
  }

  async listInstructions(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstruction[]> {
    const scope = validatedScope(ownerId, runtimeSessionId);
    return clone(this.sessions.get(scope.key)?.instructions ?? []);
  }
}

function emptySnapshot(
  ownerId: string,
  runtimeSessionId: string,
): GoalSessionSnapshot {
  return {
    ownerId,
    runtimeSessionId,
    goals: new Map(),
    instructions: [],
    commitsByIdempotencyKey: new Map(),
    commitsByInstructionId: new Map(),
    lastInstructionSequence: 0,
  };
}

function copySnapshot(snapshot: GoalSessionSnapshot): GoalSessionSnapshot {
  return {
    ...snapshot,
    goals: new Map(snapshot.goals),
    instructions: [...snapshot.instructions],
    commitsByIdempotencyKey: new Map(snapshot.commitsByIdempotencyKey),
    commitsByInstructionId: new Map(snapshot.commitsByInstructionId),
  };
}

function findIdempotentCommit(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): StoredGoalInstructionCommit | null {
  const stored = snapshot.commitsByIdempotencyKey.get(command.idempotencyKey);
  if (!stored) return null;
  assertMatchingFingerprint(stored, command);
  return stored;
}

function assertMatchingFingerprint(
  stored: StoredGoalInstructionCommit,
  command: GoalCommandIdentity,
): void {
  if (stored.requestFingerprint !== command.requestFingerprint) {
    throw new InMemoryGoalStateError(
      "idempotency_conflict",
      `Idempotency key ${command.idempotencyKey} was already used for a different Goal command`,
    );
  }
}

function materializeInstruction(
  draft: RuntimeInstructionDraft,
  command: GoalCommandIdentity,
  sequence: number,
): RuntimeInstruction {
  if (draft.idempotencyKey !== command.idempotencyKey) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Instruction and Goal command idempotency keys must match",
    );
  }
  try {
    return RuntimeInstructionSchema.parse({ ...draft, sequence });
  } catch (cause) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Runtime Instruction draft is invalid",
      cause,
    );
  }
}

function assertActivationCommit(
  goal: AgentGoal,
  instruction: RuntimeInstruction,
  runtimeSessionId: string,
): void {
  if (
    goal.revision !== 1 ||
    goal.status !== "active" ||
    instruction.kind !== "goal.activate" ||
    instruction.targetSessionId !== runtimeSessionId ||
    instruction.goalId !== goal.id ||
    instruction.goalRevision !== goal.revision ||
    canonicalJson(instruction.payload.goal) !== canonicalJson(goal)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Activation must atomically commit an active revision-one Goal and its matching instruction",
    );
  }
}

function assertRevisionCommit(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  instruction: RuntimeInstruction,
  runtimeSessionId: string,
  expectedRevision: number,
): void {
  const supportedKind =
    instruction.kind === "goal.update" ||
    instruction.kind === "context.upsert" ||
    instruction.kind === "context.remove";
  if (
    !supportedKind ||
    instruction.targetSessionId !== runtimeSessionId ||
    instruction.goalId !== goal.id ||
    instruction.goalRevision !== goal.revision
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Goal revision commits must use a supported update instruction with matching identity",
    );
  }

  switch (instruction.kind) {
    case "goal.update":
      if (
        instruction.payload.previousRevision !== expectedRevision ||
        canonicalJson(instruction.payload.goal) !== canonicalJson(goal) ||
        canonicalJson(previousGoal.contextRefs) !==
          canonicalJson(goal.contextRefs)
      ) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          "A Goal update instruction must contain the authoritative Goal revision, preserve context, and identify its exact previous revision",
        );
      }
      return;
    case "context.upsert":
      assertContextUpsertTransition(
        previousGoal,
        goal,
        instruction.payload.contextRef,
      );
      return;
    case "context.remove":
      assertContextRemoveTransition(
        previousGoal,
        goal,
        instruction.payload.contextRefId,
      );
      return;
  }
}

function assertContextUpsertTransition(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  contextRef: AgentGoal["contextRefs"][number],
): void {
  const contextRefs = clone(previousGoal.contextRefs);
  const existingIndex = contextRefs.findIndex(
    (candidate) => candidate.id === contextRef.id,
  );
  if (
    existingIndex >= 0 &&
    canonicalJson(contextRefs[existingIndex]) === canonicalJson(contextRef)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Context upsert ${contextRef.id} does not change authoritative Goal context`,
    );
  }
  if (existingIndex >= 0) contextRefs[existingIndex] = clone(contextRef);
  else contextRefs.push(clone(contextRef));

  assertExactContextTransition(previousGoal, goal, contextRefs, "upsert");
}

function assertContextRemoveTransition(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  contextRefId: string,
): void {
  if (
    !previousGoal.contextRefs.some((candidate) => candidate.id === contextRefId)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Context remove ${contextRefId} does not reference existing authoritative Goal context`,
    );
  }
  assertExactContextTransition(
    previousGoal,
    goal,
    previousGoal.contextRefs.filter(
      (candidate) => candidate.id !== contextRefId,
    ),
    "remove",
  );
}

function assertExactContextTransition(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  contextRefs: AgentGoal["contextRefs"],
  operation: "upsert" | "remove",
): void {
  const expected: AgentGoal = {
    ...previousGoal,
    revision: goal.revision,
    updatedAt: goal.updatedAt,
    contextRefs,
  };
  if (canonicalJson(expected) !== canonicalJson(goal)) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Context ${operation} must change only the referenced authoritative Goal context`,
    );
  }
}

function createStoredCommit(
  goal: PersistedAgentGoal,
  instruction: RuntimeInstruction,
  requestFingerprint: string,
): StoredGoalInstructionCommit {
  return clone({ goal, instruction, requestFingerprint });
}

function recordInstruction(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
  stored: StoredGoalInstructionCommit,
): void {
  const instructionCollision = snapshot.commitsByInstructionId.get(
    stored.instruction.id,
  );
  if (instructionCollision) {
    throw new InMemoryGoalStateError(
      "idempotency_conflict",
      `Instruction ID ${stored.instruction.id} is already present in the outbox`,
    );
  }
  snapshot.instructions.push(clone(stored.instruction));
  snapshot.commitsByIdempotencyKey.set(command.idempotencyKey, clone(stored));
  snapshot.commitsByInstructionId.set(stored.instruction.id, clone(stored));
  snapshot.lastInstructionSequence = stored.instruction.sequence;
}

function toCommit(
  stored: StoredGoalInstructionCommit,
  deduplicated: boolean,
): GoalInstructionCommit {
  return {
    goal: clone(stored.goal),
    instruction: clone(stored.instruction),
    deduplicated,
  };
}

function parseGoal(candidate: AgentGoal): AgentGoal {
  try {
    return AgentGoalSchema.parse(candidate);
  } catch (cause) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Goal state is invalid",
      cause,
    );
  }
}

function validateCommand(command: GoalCommandIdentity): GoalCommandIdentity {
  const idempotencyKey = requiredIdentifier(
    command.idempotencyKey,
    "idempotencyKey",
  );
  if (!/^[a-f0-9]{64}$/i.test(command.requestFingerprint)) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Goal command request fingerprint must be a SHA-256 digest",
    );
  }
  return { idempotencyKey, requestFingerprint: command.requestFingerprint };
}

function occupiesPrimarySlot(status: GoalStatus): boolean {
  return status === "active" || status === "paused" || status === "blocked";
}

function validatedScope(ownerId: string, runtimeSessionId: string) {
  const normalizedOwnerId = requiredIdentifier(ownerId, "ownerId");
  const normalizedSessionId = requiredIdentifier(
    runtimeSessionId,
    "runtimeSessionId",
  );
  return {
    ownerId: normalizedOwnerId,
    runtimeSessionId: normalizedSessionId,
    key: sessionScope(normalizedOwnerId, normalizedSessionId),
  };
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized !== value
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `${field} must contain 1 to 256 characters without surrounding whitespace`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `${field} must be a positive integer`,
    );
  }
  return value as number;
}

function sessionScope(ownerId: string, runtimeSessionId: string): string {
  return JSON.stringify([ownerId, runtimeSessionId]);
}

function ownerScope(ownerId: string): string {
  return JSON.stringify([ownerId]);
}

function findOwnerGoal(
  sessions: ReadonlyMap<string, GoalSessionSnapshot>,
  ownerId: string,
  goalId: string,
): PersistedAgentGoal | null {
  for (const snapshot of sessions.values()) {
    if (snapshot.ownerId !== ownerId) continue;
    const goal = snapshot.goals.get(goalId);
    if (goal) return goal;
  }
  return null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
