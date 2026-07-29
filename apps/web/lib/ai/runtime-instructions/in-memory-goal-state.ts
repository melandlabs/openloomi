import {
  type AgentGoal,
  type AgentGoalLifecycleTransition,
  type AgentGoalReplacement,
  AgentGoalSchema,
  type AgentGoalStatePort,
  type GoalCommandIdentity,
  type GoalInstructionCommit,
  type GoalLifecycleTransitionAction,
  type GoalLifecycleTransitionCommit,
  type GoalReplacementCommit,
  type GoalStatus,
  type PersistedAgentGoal,
  type RuntimeInstruction,
  type RuntimeInstructionDraft,
  RuntimeInstructionSchema,
  assertGoalStatusTransition,
  canonicalJson,
} from "@openloomi/ai/agent/runtime-instructions";

import { KeyedSerialExecutor } from "./keyed-serial-executor";

interface StoredGoalInstructionCommit {
  goal: PersistedAgentGoal;
  instruction: RuntimeInstruction;
  requestFingerprint: string;
}

interface StoredGoalReplacement {
  replacement: AgentGoalReplacement;
  idempotencyKey: string;
  requestFingerprint: string;
}

interface StoredGoalLifecycleTransition {
  transition: AgentGoalLifecycleTransition;
  idempotencyKey: string;
  requestFingerprint: string;
}

interface GoalSessionSnapshot {
  ownerId: string;
  runtimeSessionId: string;
  primaryGoalId?: string;
  pendingLifecycleTransition?: StoredGoalLifecycleTransition;
  pendingReplacement?: StoredGoalReplacement;
  goals: Map<string, PersistedAgentGoal>;
  instructions: RuntimeInstruction[];
  commitsByIdempotencyKey: Map<string, StoredGoalInstructionCommit>;
  commitsByInstructionId: Map<string, StoredGoalInstructionCommit>;
  replacementsByIdempotencyKey: Map<string, StoredGoalReplacement>;
  replacementsByGoalId: Map<string, StoredGoalReplacement>;
  lifecycleTransitionsByIdempotencyKey: Map<
    string,
    StoredGoalLifecycleTransition
  >;
  lastInstructionSequence: number;
  runEpoch: number;
}

export type InMemoryGoalStateErrorCode =
  | "active_primary_goal_conflict"
  | "goal_conflict"
  | "goal_not_found"
  | "idempotency_conflict"
  | "invalid_commit"
  | "lifecycle_transition_in_progress"
  | "lifecycle_transition_not_found"
  | "replacement_in_progress"
  | "replacement_not_found"
  | "run_epoch_conflict"
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

  async getRuntimeSessionRunEpoch(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<number> {
    const scope = validatedScope(ownerId, runtimeSessionId);
    return this.sessions.get(scope.key)?.runEpoch ?? 0;
  }

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
    if (!stored) {
      const snapshot = this.sessions.get(scope.key);
      if (
        snapshot?.replacementsByIdempotencyKey.has(command.idempotencyKey) ||
        snapshot?.lifecycleTransitionsByIdempotencyKey.has(
          command.idempotencyKey,
        )
      ) {
        throwIdempotencyNamespaceConflict(command);
      }
      return null;
    }
    assertMatchingFingerprint(stored, command);
    return toCommit(stored, true);
  }

  async findReplacementByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit | null> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const stored = this.sessions
      .get(scope.key)
      ?.replacementsByIdempotencyKey.get(command.idempotencyKey);
    if (!stored) {
      const snapshot = this.sessions.get(scope.key);
      if (
        snapshot?.commitsByIdempotencyKey.has(command.idempotencyKey) ||
        snapshot?.lifecycleTransitionsByIdempotencyKey.has(
          command.idempotencyKey,
        )
      ) {
        throwIdempotencyNamespaceConflict(command);
      }
      return null;
    }
    assertMatchingReplacementFingerprint(stored, command);
    return toReplacementCommit(stored, true);
  }

  async findLifecycleTransitionByIdempotency(input: {
    ownerId: string;
    runtimeSessionId: string;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit | null> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const snapshot = this.sessions.get(scope.key);
    const stored = snapshot?.lifecycleTransitionsByIdempotencyKey.get(
      command.idempotencyKey,
    );
    if (!stored) {
      if (
        snapshot?.commitsByIdempotencyKey.has(command.idempotencyKey) ||
        snapshot?.replacementsByIdempotencyKey.has(command.idempotencyKey)
      ) {
        throwIdempotencyNamespaceConflict(command);
      }
      return null;
    }
    assertMatchingLifecycleFingerprint(stored, command);
    return toLifecycleTransitionCommit(stored, true);
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
      assertNoReplacementIdempotencyCollision(current, command);
      assertNoLifecycleIdempotencyCollision(current, command);

      assertNoPendingReplacement(current);
      assertNoPendingLifecycleTransition(current);
      const existingGoal = findOwnerGoalOrReservation(
        this.sessions,
        scope.ownerId,
        goal.id,
      );
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
      if (current) {
        assertNoReplacementIdempotencyCollision(current, command);
        assertNoLifecycleIdempotencyCollision(current, command);
        assertNoPendingReplacement(current);
        assertNoPendingLifecycleTransition(current);
      }

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

  async commitTransition(input: {
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
      if (current) {
        assertNoReplacementIdempotencyCollision(current, command);
        assertNoLifecycleIdempotencyCollision(current, command);
        assertNoPendingReplacement(current);
        assertNoPendingLifecycleTransition(current);
      }

      const persisted = current?.goals.get(goal.id);
      if (!current || !persisted) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${goal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (current.primaryGoalId !== goal.id) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          `Goal ${goal.id} is not the primary Goal for Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (persisted.goal.revision !== expectedRevision) {
        throw new InMemoryGoalStateError(
          "revision_conflict",
          `Expected Goal revision ${expectedRevision}, received ${persisted.goal.revision}`,
        );
      }

      const instruction = materializeInstruction(
        input.instruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertTransitionCommit(
        persisted.goal,
        goal,
        instruction,
        scope.runtimeSessionId,
        expectedRevision,
      );

      const transitioned: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal,
      };
      const stored = createStoredCommit(
        transitioned,
        instruction,
        command.requestFingerprint,
      );
      const next = copySnapshot(current);
      next.primaryGoalId = occupiesPrimarySlot(goal.status)
        ? goal.id
        : undefined;
      next.goals.set(goal.id, clone(transitioned));
      recordInstruction(next, command, stored);
      this.sessions.set(scope.key, next);
      return toCommit(stored, false);
    });
  }

  async prepareLifecycleTransition(input: {
    ownerId: string;
    runtimeSessionId: string;
    action: GoalLifecycleTransitionAction;
    expectedRevision: number;
    expectedRunEpoch: number;
    goal: AgentGoal;
    instruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const action = lifecycleTransitionAction(input.action);
    const goal = parseGoal(input.goal);
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const expectedRunEpoch = nonNegativeInteger(
      input.expectedRunEpoch,
      "expectedRunEpoch",
    );

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${goal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const duplicate = findIdempotentLifecycleTransition(current, command);
      if (duplicate) {
        return toLifecycleTransitionCommit(duplicate, true);
      }
      assertNoGoalCommandIdempotencyCollision(current, command);
      assertNoReplacementIdempotencyCollision(current, command);
      assertNoPendingReplacement(current);
      assertNoPendingLifecycleTransition(current);

      if (current.runEpoch !== expectedRunEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Expected Runtime Session epoch ${expectedRunEpoch}, received ${current.runEpoch}`,
        );
      }
      const persisted = current.goals.get(goal.id);
      if (!persisted) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${goal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (current.primaryGoalId !== goal.id) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          `Goal ${goal.id} is not the primary Goal for Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (persisted.goal.revision !== expectedRevision) {
        throw new InMemoryGoalStateError(
          "revision_conflict",
          `Expected Goal revision ${expectedRevision}, received ${persisted.goal.revision}`,
        );
      }

      const instruction = materializeInstruction(
        input.instruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertLifecycleTransitionPreparation(
        persisted.goal,
        goal,
        instruction,
        action,
        scope.runtimeSessionId,
        expectedRevision,
        expectedRunEpoch,
      );

      const transitionedGoal: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal,
      };
      const stored: StoredGoalLifecycleTransition = {
        transition: {
          ownerId: scope.ownerId,
          runtimeSessionId: scope.runtimeSessionId,
          action,
          transitionedGoal,
          instruction,
          expectedRunEpoch,
          runEpoch: expectedRunEpoch,
          phase: "prepared",
        },
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
      };
      const next = copySnapshot(current);
      // A prepared cancel still owns the slot until the interrupted provider
      // turn reaches its terminal boundary.
      next.primaryGoalId = goal.id;
      next.goals.set(goal.id, clone(transitionedGoal));
      recordAggregateInstruction(
        next,
        transitionedGoal,
        instruction,
        command.requestFingerprint,
      );
      storeLifecycleTransition(next, stored);
      next.pendingLifecycleTransition = clone(stored);
      this.sessions.set(scope.key, next);
      return toLifecycleTransitionCommit(stored, false);
    });
  }

  async markLifecycleTransitionBoundary(input: {
    ownerId: string;
    runtimeSessionId: string;
    goalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const goalId = requiredIdentifier(input.goalId, "goalId");
    const expectedRunEpoch = nonNegativeInteger(
      input.expectedRunEpoch,
      "expectedRunEpoch",
    );
    const nextRunEpoch = nonNegativeInteger(input.nextRunEpoch, "nextRunEpoch");

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "lifecycle_transition_not_found",
          `No lifecycle transition exists for Goal ${goalId} in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const stored = requireLifecycleTransition(current, command, goalId);
      assertLifecycleEpochRequest(stored, expectedRunEpoch, nextRunEpoch);
      if (
        stored.transition.phase === "boundary_observed" ||
        stored.transition.phase === "finalized"
      ) {
        return toLifecycleTransitionCommit(stored, true);
      }
      if (
        stored.transition.action !== "cancel" ||
        stored.transition.phase !== "prepared"
      ) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          `Only a prepared Goal cancel can record a Runtime Session terminal boundary`,
        );
      }
      assertPendingLifecycleTransition(current, stored);
      if (current.runEpoch !== expectedRunEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Expected Runtime Session epoch ${expectedRunEpoch}, received ${current.runEpoch}`,
        );
      }

      const updated = clone(stored);
      updated.transition.phase = "boundary_observed";
      updated.transition.runEpoch = nextRunEpoch;
      const next = copySnapshot(current);
      next.runEpoch = nextRunEpoch;
      // The cancelled Goal continues to reserve the primary slot until the
      // live runtime confirms it has advanced to the durable epoch.
      next.primaryGoalId = goalId;
      next.pendingLifecycleTransition = clone(updated);
      storeLifecycleTransition(next, updated);
      this.sessions.set(scope.key, next);
      return toLifecycleTransitionCommit(updated, false);
    });
  }

  async finalizeLifecycleTransition(input: {
    ownerId: string;
    runtimeSessionId: string;
    goalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalLifecycleTransitionCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const goalId = requiredIdentifier(input.goalId, "goalId");
    const expectedRunEpoch = nonNegativeInteger(
      input.expectedRunEpoch,
      "expectedRunEpoch",
    );
    const nextRunEpoch = nonNegativeInteger(input.nextRunEpoch, "nextRunEpoch");

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "lifecycle_transition_not_found",
          `No lifecycle transition exists for Goal ${goalId} in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const stored = requireLifecycleTransition(current, command, goalId);
      assertLifecycleEpochRequest(stored, expectedRunEpoch, nextRunEpoch);
      if (stored.transition.phase === "finalized") {
        return toLifecycleTransitionCommit(stored, true);
      }
      assertPendingLifecycleTransition(current, stored);
      if (
        (stored.transition.action === "pause" &&
          stored.transition.phase !== "prepared") ||
        (stored.transition.action === "cancel" &&
          stored.transition.phase !== "boundary_observed")
      ) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          stored.transition.action === "cancel"
            ? "A Goal cancel must record its provider terminal boundary before finalization"
            : "A Goal pause can only finalize directly from its prepared state",
        );
      }
      const requiredCurrentEpoch =
        stored.transition.action === "pause" ? expectedRunEpoch : nextRunEpoch;
      if (current.runEpoch !== requiredCurrentEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Expected Runtime Session epoch ${requiredCurrentEpoch}, received ${current.runEpoch}`,
        );
      }

      const updated = clone(stored);
      updated.transition.phase = "finalized";
      updated.transition.runEpoch = nextRunEpoch;
      const next = copySnapshot(current);
      next.runEpoch = nextRunEpoch;
      next.primaryGoalId =
        stored.transition.action === "pause" ? goalId : undefined;
      next.pendingLifecycleTransition = undefined;
      storeLifecycleTransition(next, updated);
      this.sessions.set(scope.key, next);
      return toLifecycleTransitionCommit(updated, false);
    });
  }

  async prepareReplacement(input: {
    ownerId: string;
    runtimeSessionId: string;
    expectedRevision: number;
    expectedRunEpoch: number;
    supersededGoal: AgentGoal;
    replacementGoal: AgentGoal;
    controlInstruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const supersededGoal = parseGoal(input.supersededGoal);
    const replacementGoal = parseGoal(input.replacementGoal);
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const expectedRunEpoch = nonNegativeInteger(
      input.expectedRunEpoch,
      "expectedRunEpoch",
    );

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${supersededGoal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const duplicate = findIdempotentReplacement(current, command);
      if (duplicate) return toReplacementCommit(duplicate, true);
      assertNoGoalCommandIdempotencyCollision(current, command);
      assertNoLifecycleIdempotencyCollision(current, command);
      assertNoPendingReplacement(current);
      assertNoPendingLifecycleTransition(current);

      if (current.runEpoch !== expectedRunEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Expected Runtime Session epoch ${expectedRunEpoch}, received ${current.runEpoch}`,
        );
      }
      const persisted = current.goals.get(supersededGoal.id);
      if (!persisted) {
        throw new InMemoryGoalStateError(
          "goal_not_found",
          `Goal ${supersededGoal.id} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (current.primaryGoalId !== supersededGoal.id) {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          `Goal ${supersededGoal.id} is not the primary Goal for Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      if (persisted.goal.revision !== expectedRevision) {
        throw new InMemoryGoalStateError(
          "revision_conflict",
          `Expected Goal revision ${expectedRevision}, received ${persisted.goal.revision}`,
        );
      }

      const existingReplacement = findOwnerGoalOrReservation(
        this.sessions,
        scope.ownerId,
        replacementGoal.id,
      );
      if (existingReplacement) {
        throw new InMemoryGoalStateError(
          "goal_conflict",
          `Goal ${replacementGoal.id} already exists in Runtime Session ${existingReplacement.runtimeSessionId} for this owner`,
        );
      }
      const controlInstruction = materializeInstruction(
        input.controlInstruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertReplacementPreparation(
        persisted.goal,
        supersededGoal,
        replacementGoal,
        controlInstruction,
        scope.runtimeSessionId,
        expectedRevision,
        expectedRunEpoch,
      );

      const superseded: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal: supersededGoal,
      };
      const replacement: PersistedAgentGoal = {
        ownerId: scope.ownerId,
        runtimeSessionId: scope.runtimeSessionId,
        slot: "primary",
        goal: replacementGoal,
      };
      const stored: StoredGoalReplacement = {
        replacement: {
          ownerId: scope.ownerId,
          runtimeSessionId: scope.runtimeSessionId,
          supersededGoal: superseded,
          replacementGoal: replacement,
          controlInstruction,
          expectedRunEpoch,
          runEpoch: expectedRunEpoch,
          phase: "prepared",
        },
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
      };
      const next = copySnapshot(current);
      next.primaryGoalId = replacementGoal.id;
      next.goals.set(supersededGoal.id, clone(superseded));
      recordAggregateInstruction(
        next,
        superseded,
        controlInstruction,
        command.requestFingerprint,
      );
      storeReplacement(next, stored);
      next.pendingReplacement = clone(stored);
      this.sessions.set(scope.key, next);
      return toReplacementCommit(stored, false);
    });
  }

  async markReplacementBoundary(input: {
    ownerId: string;
    runtimeSessionId: string;
    replacementGoalId: string;
    expectedRunEpoch: number;
    nextRunEpoch: number;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const replacementGoalId = requiredIdentifier(
      input.replacementGoalId,
      "replacementGoalId",
    );
    const expectedRunEpoch = nonNegativeInteger(
      input.expectedRunEpoch,
      "expectedRunEpoch",
    );
    const nextRunEpoch = nonNegativeInteger(input.nextRunEpoch, "nextRunEpoch");

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "replacement_not_found",
          `Replacement Goal ${replacementGoalId} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const stored = requireReplacement(current, command, replacementGoalId);
      assertReplacementEpochRequest(stored, expectedRunEpoch, nextRunEpoch);
      if (stored.replacement.phase !== "prepared") {
        return toReplacementCommit(stored, true);
      }
      assertPendingReplacement(current, stored);
      if (current.runEpoch !== expectedRunEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Expected Runtime Session epoch ${expectedRunEpoch}, received ${current.runEpoch}`,
        );
      }

      const updated = clone(stored);
      updated.replacement.phase = "boundary_observed";
      updated.replacement.runEpoch = nextRunEpoch;
      const next = copySnapshot(current);
      next.runEpoch = nextRunEpoch;
      next.pendingReplacement = clone(updated);
      storeReplacement(next, updated);
      this.sessions.set(scope.key, next);
      return toReplacementCommit(updated, false);
    });
  }

  async finalizeReplacement(input: {
    ownerId: string;
    runtimeSessionId: string;
    replacementGoalId: string;
    activationInstruction: RuntimeInstructionDraft;
    command: GoalCommandIdentity;
  }): Promise<GoalReplacementCommit> {
    const scope = validatedScope(input.ownerId, input.runtimeSessionId);
    const command = validateCommand(input.command);
    const replacementGoalId = requiredIdentifier(
      input.replacementGoalId,
      "replacementGoalId",
    );

    return this.mutations.run(ownerScope(scope.ownerId), () => {
      const current = this.sessions.get(scope.key);
      if (!current) {
        throw new InMemoryGoalStateError(
          "replacement_not_found",
          `Replacement Goal ${replacementGoalId} does not exist in Runtime Session ${scope.runtimeSessionId}`,
        );
      }
      const stored = requireReplacement(current, command, replacementGoalId);
      if (stored.replacement.phase === "activated") {
        return toReplacementCommit(stored, true);
      }
      if (stored.replacement.phase !== "boundary_observed") {
        throw new InMemoryGoalStateError(
          "invalid_commit",
          "A replacement cannot activate before its Runtime Session boundary is observed",
        );
      }
      assertPendingReplacement(current, stored);
      if (current.runEpoch !== stored.replacement.runEpoch) {
        throw new InMemoryGoalStateError(
          "run_epoch_conflict",
          `Replacement epoch ${stored.replacement.runEpoch} does not match Runtime Session epoch ${current.runEpoch}`,
        );
      }

      const activationInstruction = materializeInstruction(
        input.activationInstruction,
        command,
        current.lastInstructionSequence + 1,
      );
      assertReplacementActivation(
        stored.replacement,
        activationInstruction,
        scope.runtimeSessionId,
      );

      const updated = clone(stored);
      updated.replacement.phase = "activated";
      updated.replacement.activationInstruction = activationInstruction;
      const next = copySnapshot(current);
      next.primaryGoalId = replacementGoalId;
      next.goals.set(
        replacementGoalId,
        clone(stored.replacement.replacementGoal),
      );
      recordAggregateInstruction(
        next,
        stored.replacement.replacementGoal,
        activationInstruction,
        command.requestFingerprint,
      );
      next.pendingReplacement = undefined;
      storeReplacement(next, updated);
      this.sessions.set(scope.key, next);
      return toReplacementCommit(updated, false);
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
    replacementsByIdempotencyKey: new Map(),
    replacementsByGoalId: new Map(),
    lifecycleTransitionsByIdempotencyKey: new Map(),
    lastInstructionSequence: 0,
    runEpoch: 0,
  };
}

function copySnapshot(snapshot: GoalSessionSnapshot): GoalSessionSnapshot {
  return {
    ...snapshot,
    goals: new Map(snapshot.goals),
    instructions: [...snapshot.instructions],
    commitsByIdempotencyKey: new Map(snapshot.commitsByIdempotencyKey),
    commitsByInstructionId: new Map(snapshot.commitsByInstructionId),
    replacementsByIdempotencyKey: new Map(
      snapshot.replacementsByIdempotencyKey,
    ),
    replacementsByGoalId: new Map(snapshot.replacementsByGoalId),
    lifecycleTransitionsByIdempotencyKey: new Map(
      snapshot.lifecycleTransitionsByIdempotencyKey,
    ),
    pendingLifecycleTransition:
      snapshot.pendingLifecycleTransition === undefined
        ? undefined
        : clone(snapshot.pendingLifecycleTransition),
    pendingReplacement:
      snapshot.pendingReplacement === undefined
        ? undefined
        : clone(snapshot.pendingReplacement),
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

function findIdempotentReplacement(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): StoredGoalReplacement | null {
  const stored = snapshot.replacementsByIdempotencyKey.get(
    command.idempotencyKey,
  );
  if (!stored) return null;
  assertMatchingReplacementFingerprint(stored, command);
  return stored;
}

function findIdempotentLifecycleTransition(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): StoredGoalLifecycleTransition | null {
  const stored = snapshot.lifecycleTransitionsByIdempotencyKey.get(
    command.idempotencyKey,
  );
  if (!stored) return null;
  assertMatchingLifecycleFingerprint(stored, command);
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

function assertMatchingReplacementFingerprint(
  stored: StoredGoalReplacement,
  command: GoalCommandIdentity,
): void {
  if (stored.requestFingerprint !== command.requestFingerprint) {
    throw new InMemoryGoalStateError(
      "idempotency_conflict",
      `Idempotency key ${command.idempotencyKey} was already used for a different Goal replacement`,
    );
  }
}

function assertMatchingLifecycleFingerprint(
  stored: StoredGoalLifecycleTransition,
  command: GoalCommandIdentity,
): void {
  if (stored.requestFingerprint !== command.requestFingerprint) {
    throw new InMemoryGoalStateError(
      "idempotency_conflict",
      `Idempotency key ${command.idempotencyKey} was already used for a different Goal lifecycle transition`,
    );
  }
}

function assertNoReplacementIdempotencyCollision(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): void {
  if (snapshot.replacementsByIdempotencyKey.has(command.idempotencyKey)) {
    throwIdempotencyNamespaceConflict(command);
  }
}

function assertNoGoalCommandIdempotencyCollision(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): void {
  if (snapshot.commitsByIdempotencyKey.has(command.idempotencyKey)) {
    throwIdempotencyNamespaceConflict(command);
  }
}

function assertNoLifecycleIdempotencyCollision(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
): void {
  if (
    snapshot.lifecycleTransitionsByIdempotencyKey.has(command.idempotencyKey)
  ) {
    throwIdempotencyNamespaceConflict(command);
  }
}

function throwIdempotencyNamespaceConflict(
  command: GoalCommandIdentity,
): never {
  throw new InMemoryGoalStateError(
    "idempotency_conflict",
    `Idempotency key ${command.idempotencyKey} was already used by another Runtime Goal command`,
  );
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

function assertReplacementPreparation(
  previousGoal: AgentGoal,
  supersededGoal: AgentGoal,
  replacementGoal: AgentGoal,
  instruction: RuntimeInstruction,
  runtimeSessionId: string,
  expectedRevision: number,
  expectedRunEpoch: number,
): void {
  try {
    assertGoalStatusTransition(previousGoal.status, "cancelled");
  } catch (cause) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Goal replacement cannot supersede a ${previousGoal.status} Goal`,
      cause,
    );
  }

  const expectedSupersededGoal: AgentGoal = {
    ...previousGoal,
    revision: expectedRevision + 1,
    status: "cancelled",
    updatedAt: supersededGoal.updatedAt,
  };
  if (
    supersededGoal.id === replacementGoal.id ||
    supersededGoal.revision !== expectedRevision + 1 ||
    Date.parse(supersededGoal.updatedAt) < Date.parse(previousGoal.updatedAt) ||
    canonicalJson(expectedSupersededGoal) !== canonicalJson(supersededGoal) ||
    replacementGoal.revision !== 1 ||
    replacementGoal.status !== "active"
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Replacement preparation must only cancel the current Goal and reserve a distinct active revision-one Goal",
    );
  }
  if (
    instruction.kind !== "control.interrupt" ||
    instruction.deliveryMode !== "interrupt_replace" ||
    instruction.targetSessionId !== runtimeSessionId ||
    instruction.goalId !== supersededGoal.id ||
    instruction.goalRevision !== supersededGoal.revision ||
    instruction.payload.replacementGoalId !== replacementGoal.id ||
    instruction.payload.expectedRunEpoch !== expectedRunEpoch
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Replacement preparation requires a matching control.interrupt instruction and run epoch",
    );
  }
}

function assertReplacementActivation(
  replacement: AgentGoalReplacement,
  instruction: RuntimeInstruction,
  runtimeSessionId: string,
): void {
  assertActivationCommit(
    replacement.replacementGoal.goal,
    instruction,
    runtimeSessionId,
  );
  if (
    canonicalJson(instruction.source) !==
      canonicalJson(replacement.controlInstruction.source) ||
    Date.parse(instruction.issuedAt) <
      Date.parse(replacement.controlInstruction.issuedAt)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Replacement activation must preserve command authority and monotonic instruction time",
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

function assertTransitionCommit(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  instruction: RuntimeInstruction,
  runtimeSessionId: string,
  expectedRevision: number,
): void {
  if (
    previousGoal.status !== "paused" ||
    goal.status !== "active" ||
    goal.revision !== expectedRevision + 1 ||
    instruction.kind !== "goal.resume" ||
    instruction.deliveryMode !== "steer" ||
    instruction.targetSessionId !== runtimeSessionId ||
    instruction.goalId !== goal.id ||
    instruction.goalRevision !== goal.revision
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "An ordinary Goal transition may only resume a paused Goal with its matching steer instruction",
    );
  }

  try {
    assertGoalStatusTransition(previousGoal.status, goal.status);
  } catch (cause) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Goal lifecycle transition ${previousGoal.status} -> ${goal.status} is invalid`,
      cause,
    );
  }

  const expected: AgentGoal = {
    ...previousGoal,
    revision: expectedRevision + 1,
    status: goal.status,
    updatedAt: goal.updatedAt,
  };
  if (
    Date.parse(goal.updatedAt) < Date.parse(previousGoal.updatedAt) ||
    canonicalJson(expected) !== canonicalJson(goal)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "A Goal lifecycle commit may change only status, revision, and updatedAt",
    );
  }
}

function assertLifecycleTransitionPreparation(
  previousGoal: AgentGoal,
  goal: AgentGoal,
  instruction: RuntimeInstruction,
  action: GoalLifecycleTransitionAction,
  runtimeSessionId: string,
  expectedRevision: number,
  expectedRunEpoch: number,
): void {
  const expectedStatus = action === "pause" ? "paused" : "cancelled";
  const instructionExpectedRunEpoch =
    instruction.kind === "goal.pause" || instruction.kind === "goal.cancel"
      ? instruction.payload.expectedRunEpoch
      : undefined;
  const validSourceStatus =
    action === "pause"
      ? previousGoal.status === "active"
      : previousGoal.status === "active" || previousGoal.status === "paused";
  if (
    !validSourceStatus ||
    goal.status !== expectedStatus ||
    goal.revision !== expectedRevision + 1 ||
    instruction.kind !== `goal.${action}` ||
    instruction.deliveryMode !== "interrupt_replace" ||
    instruction.targetSessionId !== runtimeSessionId ||
    instruction.goalId !== goal.id ||
    instruction.goalRevision !== goal.revision ||
    instructionExpectedRunEpoch !== expectedRunEpoch
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `A Goal ${action} barrier must advance the authoritative Goal exactly once with its matching interrupting steer instruction`,
    );
  }

  try {
    assertGoalStatusTransition(previousGoal.status, goal.status);
  } catch (cause) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `Goal lifecycle transition ${previousGoal.status} -> ${goal.status} is invalid`,
      cause,
    );
  }

  const expected: AgentGoal = {
    ...previousGoal,
    revision: expectedRevision + 1,
    status: expectedStatus,
    updatedAt: goal.updatedAt,
  };
  if (
    Date.parse(goal.updatedAt) < Date.parse(previousGoal.updatedAt) ||
    canonicalJson(expected) !== canonicalJson(goal)
  ) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `A Goal ${action} barrier may change only status, revision, and updatedAt`,
    );
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

function recordAggregateInstruction(
  snapshot: GoalSessionSnapshot,
  goal: PersistedAgentGoal,
  instruction: RuntimeInstruction,
  requestFingerprint: string,
): void {
  const instructionCollision = snapshot.commitsByInstructionId.get(
    instruction.id,
  );
  if (instructionCollision) {
    throw new InMemoryGoalStateError(
      "idempotency_conflict",
      `Instruction ID ${instruction.id} is already present in the outbox`,
    );
  }
  snapshot.instructions.push(clone(instruction));
  snapshot.commitsByInstructionId.set(
    instruction.id,
    clone({ goal, instruction, requestFingerprint }),
  );
  snapshot.lastInstructionSequence = instruction.sequence;
}

function storeReplacement(
  snapshot: GoalSessionSnapshot,
  stored: StoredGoalReplacement,
): void {
  snapshot.replacementsByIdempotencyKey.set(
    stored.idempotencyKey,
    clone(stored),
  );
  snapshot.replacementsByGoalId.set(
    stored.replacement.replacementGoal.goal.id,
    clone(stored),
  );
}

function storeLifecycleTransition(
  snapshot: GoalSessionSnapshot,
  stored: StoredGoalLifecycleTransition,
): void {
  snapshot.lifecycleTransitionsByIdempotencyKey.set(
    stored.idempotencyKey,
    clone(stored),
  );
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

function toReplacementCommit(
  stored: StoredGoalReplacement,
  deduplicated: boolean,
): GoalReplacementCommit {
  return {
    replacement: clone(stored.replacement),
    deduplicated,
  };
}

function toLifecycleTransitionCommit(
  stored: StoredGoalLifecycleTransition,
  deduplicated: boolean,
): GoalLifecycleTransitionCommit {
  return {
    transition: clone(stored.transition),
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

function requireReplacement(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
  replacementGoalId: string,
): StoredGoalReplacement {
  const stored = snapshot.replacementsByIdempotencyKey.get(
    command.idempotencyKey,
  );
  if (!stored) {
    if (
      snapshot.commitsByIdempotencyKey.has(command.idempotencyKey) ||
      snapshot.lifecycleTransitionsByIdempotencyKey.has(command.idempotencyKey)
    ) {
      throwIdempotencyNamespaceConflict(command);
    }
    throw new InMemoryGoalStateError(
      "replacement_not_found",
      `No Goal replacement exists for idempotency key ${command.idempotencyKey}`,
    );
  }
  assertMatchingReplacementFingerprint(stored, command);
  if (stored.replacement.replacementGoal.goal.id !== replacementGoalId) {
    throw new InMemoryGoalStateError(
      "replacement_not_found",
      `Replacement Goal ${replacementGoalId} does not match the stored replacement`,
    );
  }
  return stored;
}

function requireLifecycleTransition(
  snapshot: GoalSessionSnapshot,
  command: GoalCommandIdentity,
  goalId: string,
): StoredGoalLifecycleTransition {
  const stored = snapshot.lifecycleTransitionsByIdempotencyKey.get(
    command.idempotencyKey,
  );
  if (!stored) {
    if (
      snapshot.commitsByIdempotencyKey.has(command.idempotencyKey) ||
      snapshot.replacementsByIdempotencyKey.has(command.idempotencyKey)
    ) {
      throwIdempotencyNamespaceConflict(command);
    }
    throw new InMemoryGoalStateError(
      "lifecycle_transition_not_found",
      `No Goal lifecycle transition exists for idempotency key ${command.idempotencyKey}`,
    );
  }
  assertMatchingLifecycleFingerprint(stored, command);
  if (stored.transition.transitionedGoal.goal.id !== goalId) {
    throw new InMemoryGoalStateError(
      "lifecycle_transition_not_found",
      `Goal ${goalId} does not match the stored lifecycle transition`,
    );
  }
  return stored;
}

function assertNoPendingReplacement(snapshot: GoalSessionSnapshot): void {
  if (!snapshot.pendingReplacement) return;
  throw new InMemoryGoalStateError(
    "replacement_in_progress",
    `Runtime Session ${snapshot.runtimeSessionId} is reserving replacement Goal ${snapshot.pendingReplacement.replacement.replacementGoal.goal.id}`,
  );
}

function assertNoPendingLifecycleTransition(
  snapshot: GoalSessionSnapshot,
): void {
  if (!snapshot.pendingLifecycleTransition) return;
  const transition = snapshot.pendingLifecycleTransition.transition;
  throw new InMemoryGoalStateError(
    "lifecycle_transition_in_progress",
    `Runtime Session ${snapshot.runtimeSessionId} is finalizing ${transition.action} for Goal ${transition.transitionedGoal.goal.id}`,
  );
}

function assertPendingReplacement(
  snapshot: GoalSessionSnapshot,
  stored: StoredGoalReplacement,
): void {
  const pending = snapshot.pendingReplacement;
  if (
    !pending ||
    pending.idempotencyKey !== stored.idempotencyKey ||
    pending.replacement.replacementGoal.goal.id !==
      stored.replacement.replacementGoal.goal.id
  ) {
    throw new InMemoryGoalStateError(
      "replacement_not_found",
      `Replacement Goal ${stored.replacement.replacementGoal.goal.id} is not the pending primary reservation`,
    );
  }
}

function assertPendingLifecycleTransition(
  snapshot: GoalSessionSnapshot,
  stored: StoredGoalLifecycleTransition,
): void {
  const pending = snapshot.pendingLifecycleTransition;
  if (
    !pending ||
    pending.idempotencyKey !== stored.idempotencyKey ||
    pending.transition.transitionedGoal.goal.id !==
      stored.transition.transitionedGoal.goal.id
  ) {
    throw new InMemoryGoalStateError(
      "lifecycle_transition_not_found",
      `Lifecycle transition for Goal ${stored.transition.transitionedGoal.goal.id} is not the pending primary reservation`,
    );
  }
}

function assertReplacementEpochRequest(
  stored: StoredGoalReplacement,
  expectedRunEpoch: number,
  nextRunEpoch: number,
): void {
  if (
    expectedRunEpoch !== stored.replacement.expectedRunEpoch ||
    nextRunEpoch !== expectedRunEpoch + 1
  ) {
    throw new InMemoryGoalStateError(
      "run_epoch_conflict",
      `Replacement must advance Runtime Session epoch ${stored.replacement.expectedRunEpoch} exactly once`,
    );
  }
  if (
    stored.replacement.phase !== "prepared" &&
    stored.replacement.runEpoch !== nextRunEpoch
  ) {
    throw new InMemoryGoalStateError(
      "run_epoch_conflict",
      `Replacement already observed Runtime Session epoch ${stored.replacement.runEpoch}`,
    );
  }
}

function assertLifecycleEpochRequest(
  stored: StoredGoalLifecycleTransition,
  expectedRunEpoch: number,
  nextRunEpoch: number,
): void {
  const requiredNextRunEpoch =
    stored.transition.action === "pause"
      ? stored.transition.expectedRunEpoch
      : stored.transition.expectedRunEpoch + 1;
  if (
    expectedRunEpoch !== stored.transition.expectedRunEpoch ||
    nextRunEpoch !== requiredNextRunEpoch
  ) {
    throw new InMemoryGoalStateError(
      "run_epoch_conflict",
      `Goal ${stored.transition.action} must finalize Runtime Session epoch ${stored.transition.expectedRunEpoch} as epoch ${requiredNextRunEpoch}`,
    );
  }
  if (
    stored.transition.phase === "finalized" &&
    stored.transition.runEpoch !== nextRunEpoch
  ) {
    throw new InMemoryGoalStateError(
      "run_epoch_conflict",
      `Goal ${stored.transition.action} already finalized Runtime Session epoch ${stored.transition.runEpoch}`,
    );
  }
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

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      `${field} must be a non-negative integer`,
    );
  }
  return value as number;
}

function lifecycleTransitionAction(
  value: unknown,
): GoalLifecycleTransitionAction {
  if (value !== "pause" && value !== "cancel") {
    throw new InMemoryGoalStateError(
      "invalid_commit",
      "Lifecycle transition action must be pause or cancel",
    );
  }
  return value;
}

function sessionScope(ownerId: string, runtimeSessionId: string): string {
  return JSON.stringify([ownerId, runtimeSessionId]);
}

function ownerScope(ownerId: string): string {
  return JSON.stringify([ownerId]);
}

function findOwnerGoalOrReservation(
  sessions: ReadonlyMap<string, GoalSessionSnapshot>,
  ownerId: string,
  goalId: string,
): PersistedAgentGoal | null {
  for (const snapshot of sessions.values()) {
    if (snapshot.ownerId !== ownerId) continue;
    const goal = snapshot.goals.get(goalId);
    if (goal) return goal;
    const reserved = snapshot.pendingReplacement?.replacement.replacementGoal;
    if (reserved?.goal.id === goalId) return reserved;
  }
  return null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
