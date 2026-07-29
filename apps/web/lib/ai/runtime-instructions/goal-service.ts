import {
  AgentGoalUpdateSchema,
  CreateAgentGoalInputSchema,
  GoalContextReferenceSchema,
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  RuntimeInstructionSchema,
  RuntimeInstructionSourceSchema,
  canonicalJson,
  createAgentGoal,
  reviseAgentGoal,
  type AgentGoal,
  type AgentGoalStatePort,
  type AgentGoalUpdate,
  type CreateAgentGoalInput,
  type GoalCommandIdentity,
  type GoalConstraint,
  type GoalContextReference,
  type GoalInstructionCommit,
  type GoalSource,
  type PersistedAgentGoal,
  type RuntimeClockPort,
  type RuntimeIdGeneratorPort,
  type RuntimeInstructionDraft,
  type RuntimeInstructionSource,
} from "@openloomi/ai/agent/runtime-instructions";

import { createGoalCommandFingerprint } from "./command-fingerprint";
import {
  findUnauthorizedConstraintChange,
  findUnsupportedRuntimeConstraint,
  goalSourceMatchesCommand,
} from "./goal-command-policy";
import type {
  CancelGoalCommand,
  GoalLifecycleService,
  PauseGoalCommand,
  ResumeGoalCommand,
} from "./goal-lifecycle-service";
import { GoalServiceError } from "./goal-service-error";
import type {
  RuntimeInstructionDispatch,
  RuntimeInstructionDispatcher,
} from "./instruction-dispatcher";
import { KeyedSerialExecutor } from "./keyed-serial-executor";

export type TrustedGoalCommandSource =
  | {
      type: "user";
      authority: "user";
      sourceRef?: string;
    }
  | {
      type: "automation";
      authority: "automation";
      sourceRef: string;
    }
  | {
      type: "policy";
      authority: "organization_policy";
      sourceRef: string;
    };

export type GoalActivationCommandSource = Extract<
  TrustedGoalCommandSource,
  { type: "user" | "automation" }
>;

export type GoalLifecycleCommandSource = GoalActivationCommandSource;

export type ContextGoalCommandSource =
  | TrustedGoalCommandSource
  | {
      type: "connector";
      authority: "untrusted_data";
      sourceRef: string;
    };

interface GoalCommandBase<TSource> {
  ownerId: string;
  runtimeSessionId: string;
  idempotencyKey: string;
  source: TSource;
}

export interface ActivateGoalCommand extends GoalCommandBase<GoalActivationCommandSource> {
  goal: CreateAgentGoalInput;
}

export interface UpdateGoalCommand extends GoalCommandBase<TrustedGoalCommandSource> {
  goalId: string;
  expectedRevision: number;
  update: AgentGoalUpdate;
}

export interface UpsertGoalContextCommand extends GoalCommandBase<ContextGoalCommandSource> {
  goalId: string;
  expectedRevision: number;
  contextRef: GoalContextReference;
  deliveryMode?: "next_boundary" | "steer";
}

export interface RemoveGoalContextCommand extends GoalCommandBase<ContextGoalCommandSource> {
  goalId: string;
  expectedRevision: number;
  contextRefId: string;
  deliveryMode?: "next_boundary" | "steer";
}

export type {
  CancelGoalCommand,
  PauseGoalCommand,
  ResumeGoalCommand,
} from "./goal-lifecycle-service";

export interface GoalCommandResult {
  goal: PersistedAgentGoal;
  instruction: GoalInstructionCommit["instruction"];
  deduplicated: boolean;
  dispatch: RuntimeInstructionDispatch;
}

export {
  GoalServiceError,
  type GoalServiceErrorCode,
} from "./goal-service-error";

/**
 * Application service for the first in-memory Goal runtime vertical slice.
 *
 * The authoritative Goal and immutable instruction are committed before
 * delivery. Transport failure is reported explicitly and never rolls back the
 * outbox, so the same idempotent command can safely retry delivery later.
 */
export class GoalService {
  private readonly commands = new KeyedSerialExecutor();

  constructor(
    private readonly state: AgentGoalStatePort,
    private readonly dispatcher: RuntimeInstructionDispatcher,
    private readonly clock: RuntimeClockPort,
    private readonly ids: RuntimeIdGeneratorPort,
    private readonly lifecycle: GoalLifecycleService,
  ) {}

  activate(input: ActivateGoalCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.activateCommand(input),
    );
  }

  update(input: UpdateGoalCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.updateCommand(input),
    );
  }

  upsertContext(input: UpsertGoalContextCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.upsertContextCommand(input),
    );
  }

  removeContext(input: RemoveGoalContextCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.removeContextCommand(input),
    );
  }

  pause(input: PauseGoalCommand): Promise<GoalCommandResult> {
    return this.lifecycle.pause(input);
  }

  resume(input: ResumeGoalCommand): Promise<GoalCommandResult> {
    return this.lifecycle.resume(input);
  }

  cancel(input: CancelGoalCommand): Promise<GoalCommandResult> {
    return this.lifecycle.cancel(input);
  }

  private async activateCommand(
    input: ActivateGoalCommand,
  ): Promise<GoalCommandResult> {
    const base = parseCommandBase(input, false);
    const goalInput = parseCreateGoalInput(input.goal);
    assertSupportedConstraints(goalInput.constraints);
    assertGoalSourceProvenance(goalInput.source, base.source);
    assertConstraintChanges([], goalInput.constraints, base.source);
    if (goalInput.contextRefs.length > 0) {
      throw new GoalServiceError(
        "invalid_context_provenance",
        "Goal activation cannot embed unresolved context; add context through upsertContext",
      );
    }
    const command = commandIdentity(base.idempotencyKey, {
      kind: "goal.activate",
      runtimeSessionId: base.runtimeSessionId,
      source: base.source,
      goal: goalInput,
    });
    const replay = await this.findReplay(base, command);
    if (replay) return this.dispatch(base.ownerId, replay);

    const now = this.clock.now();
    const goal = createAgentGoal({
      id: this.ids.generate(),
      input: goalInput,
      now,
    });
    const instruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: goal.id,
      goalRevision: goal.revision,
      kind: "goal.activate",
      deliveryMode: "steer",
      targetSessionId: base.runtimeSessionId,
      payload: { goal },
      source: base.source,
      idempotencyKey: base.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    const commit = await this.state.commitActivation({
      ownerId: base.ownerId,
      runtimeSessionId: base.runtimeSessionId,
      goal,
      instruction,
      command,
    });
    return this.dispatch(base.ownerId, commit);
  }

  private async updateCommand(
    input: UpdateGoalCommand,
  ): Promise<GoalCommandResult> {
    const base = parseCommandBase(input, false);
    const update = parseGoalUpdate(input.update);
    if (update.contextRefs !== undefined) {
      throw new GoalServiceError(
        "invalid_command",
        "Goal context must be changed through upsertContext or removeContext",
      );
    }
    if (
      base.source.type === "policy" &&
      Object.keys(update).some((field) => field !== "constraints")
    ) {
      throw new GoalServiceError(
        "invalid_command",
        "Policy commands may only revise organization-policy constraints",
      );
    }
    if (update.constraints) assertSupportedConstraints(update.constraints);
    const goalId = requiredIdentifier(input.goalId, "goalId");
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const command = commandIdentity(base.idempotencyKey, {
      kind: "goal.update",
      runtimeSessionId: base.runtimeSessionId,
      goalId,
      expectedRevision,
      source: base.source,
      update,
    });
    const replay = await this.findReplay(base, command);
    if (replay) return this.dispatch(base.ownerId, replay);

    const current = await this.requireActiveGoal(
      base.ownerId,
      base.runtimeSessionId,
      goalId,
    );
    assertGoalUpdateAuthority(current.goal, base.source);
    const now = this.clock.now();
    const goal = reviseAgentGoal({
      current: current.goal,
      expectedRevision,
      update,
      now,
    });
    assertGoalChanged(current.goal, goal);
    assertConstraintChanges(
      current.goal.constraints,
      goal.constraints,
      base.source,
    );
    const instruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: goal.id,
      goalRevision: goal.revision,
      kind: "goal.update",
      deliveryMode: "steer",
      targetSessionId: base.runtimeSessionId,
      payload: { goal, previousRevision: expectedRevision },
      source: base.source,
      idempotencyKey: base.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    const commit = await this.state.commitRevision({
      ownerId: base.ownerId,
      runtimeSessionId: base.runtimeSessionId,
      expectedRevision,
      goal,
      instruction,
      command,
    });
    return this.dispatch(base.ownerId, commit);
  }

  private async upsertContextCommand(
    input: UpsertGoalContextCommand,
  ): Promise<GoalCommandResult> {
    const base = parseCommandBase(input, true);
    const contextRef = parseContextReference(input.contextRef);
    assertContextProvenance(contextRef, base.source);
    const deliveryMode = input.deliveryMode ?? "next_boundary";
    const goalId = requiredIdentifier(input.goalId, "goalId");
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const command = commandIdentity(base.idempotencyKey, {
      kind: "context.upsert",
      runtimeSessionId: base.runtimeSessionId,
      goalId,
      expectedRevision,
      source: base.source,
      deliveryMode,
      contextRef,
    });
    const replay = await this.findReplay(base, command);
    if (replay) return this.dispatch(base.ownerId, replay);

    const current = await this.requireActiveGoal(
      base.ownerId,
      base.runtimeSessionId,
      goalId,
    );
    const existingIndex = current.goal.contextRefs.findIndex(
      (candidate) => candidate.id === contextRef.id,
    );
    if (existingIndex >= 0) {
      assertExistingContextAuthority(
        current.goal.contextRefs[existingIndex],
        base.source,
        "replace",
      );
    }
    if (
      existingIndex >= 0 &&
      canonicalJson(current.goal.contextRefs[existingIndex]) ===
        canonicalJson(contextRef)
    ) {
      throw new GoalServiceError(
        "no_change",
        `Context reference ${contextRef.id} is already current`,
      );
    }

    const contextRefs = [...current.goal.contextRefs];
    if (existingIndex >= 0) contextRefs[existingIndex] = contextRef;
    else contextRefs.push(contextRef);
    const now = this.clock.now();
    const goal = reviseAgentGoal({
      current: current.goal,
      expectedRevision,
      update: { contextRefs },
      now,
    });
    const instruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: goal.id,
      goalRevision: goal.revision,
      kind: "context.upsert",
      deliveryMode,
      targetSessionId: base.runtimeSessionId,
      payload: { contextRef },
      source: base.source,
      idempotencyKey: base.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    const commit = await this.state.commitRevision({
      ownerId: base.ownerId,
      runtimeSessionId: base.runtimeSessionId,
      expectedRevision,
      goal,
      instruction,
      command,
    });
    return this.dispatch(base.ownerId, commit);
  }

  private async removeContextCommand(
    input: RemoveGoalContextCommand,
  ): Promise<GoalCommandResult> {
    const base = parseCommandBase(input, true);
    const contextRefId = requiredIdentifier(input.contextRefId, "contextRefId");
    const deliveryMode = input.deliveryMode ?? "next_boundary";
    const goalId = requiredIdentifier(input.goalId, "goalId");
    const expectedRevision = positiveInteger(
      input.expectedRevision,
      "expectedRevision",
    );
    const command = commandIdentity(base.idempotencyKey, {
      kind: "context.remove",
      runtimeSessionId: base.runtimeSessionId,
      goalId,
      expectedRevision,
      source: base.source,
      deliveryMode,
      contextRefId,
    });
    const replay = await this.findReplay(base, command);
    if (replay) return this.dispatch(base.ownerId, replay);

    const current = await this.requireActiveGoal(
      base.ownerId,
      base.runtimeSessionId,
      goalId,
    );
    const contextRef = current.goal.contextRefs.find(
      (candidate) => candidate.id === contextRefId,
    );
    if (!contextRef) {
      throw new GoalServiceError(
        "context_not_found",
        `Context reference ${contextRefId} does not exist on Goal ${goalId}`,
      );
    }
    assertExistingContextAuthority(contextRef, base.source, "remove");

    const now = this.clock.now();
    const goal = reviseAgentGoal({
      current: current.goal,
      expectedRevision,
      update: {
        contextRefs: current.goal.contextRefs.filter(
          (candidate) => candidate.id !== contextRefId,
        ),
      },
      now,
    });
    const instruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: goal.id,
      goalRevision: goal.revision,
      kind: "context.remove",
      deliveryMode,
      targetSessionId: base.runtimeSessionId,
      payload: { contextRefId },
      source: base.source,
      idempotencyKey: base.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    const commit = await this.state.commitRevision({
      ownerId: base.ownerId,
      runtimeSessionId: base.runtimeSessionId,
      expectedRevision,
      goal,
      instruction,
      command,
    });
    return this.dispatch(base.ownerId, commit);
  }

  getGoal(ownerId: string, goalId: string): Promise<PersistedAgentGoal | null> {
    return this.state.getGoal(ownerId, goalId);
  }

  getActivePrimaryGoal(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<PersistedAgentGoal | null> {
    return this.state.getActivePrimaryGoal(ownerId, runtimeSessionId);
  }

  getRuntimeSessionRunEpoch(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<number> {
    return this.state.getRuntimeSessionRunEpoch(
      requiredIdentifier(ownerId, "ownerId"),
      requiredIdentifier(runtimeSessionId, "runtimeSessionId"),
    );
  }

  replayPendingInstructions(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstructionDispatch | null> {
    return this.commands.run(
      commandScope({ ownerId, runtimeSessionId }),
      async () => {
        const parsedOwnerId = requiredIdentifier(ownerId, "ownerId");
        const parsedSessionId = requiredIdentifier(
          runtimeSessionId,
          "runtimeSessionId",
        );
        const instructions = await this.state.listInstructions(
          parsedOwnerId,
          parsedSessionId,
        );
        const latest = instructions.at(-1);
        if (!latest) return null;
        return this.dispatcher.drain({
          ownerId: parsedOwnerId,
          runtimeSessionId: parsedSessionId,
          targetInstructionId: latest.id,
        });
      },
    );
  }

  private findReplay(
    base: ParsedCommandBase,
    command: GoalCommandIdentity,
  ): Promise<GoalInstructionCommit | null> {
    return this.state.findCommitByIdempotency({
      ownerId: base.ownerId,
      runtimeSessionId: base.runtimeSessionId,
      command,
    });
  }

  private async requireActiveGoal(
    ownerId: string,
    runtimeSessionId: string,
    goalId: string,
  ): Promise<PersistedAgentGoal> {
    const goal = await this.requireGoal(ownerId, runtimeSessionId, goalId);
    if (goal.goal.status !== "active") {
      throw new GoalServiceError(
        "goal_not_active",
        `Goal ${goalId} is ${goal.goal.status}, not active`,
      );
    }
    return goal;
  }

  private async requireGoal(
    ownerId: string,
    runtimeSessionId: string,
    goalId: string,
  ): Promise<PersistedAgentGoal> {
    const goal = await this.state.getGoal(ownerId, goalId);
    if (!goal) {
      throw new GoalServiceError(
        "goal_not_found",
        `Goal ${goalId} does not exist for this owner`,
      );
    }
    if (goal.runtimeSessionId !== runtimeSessionId) {
      throw new GoalServiceError(
        "goal_session_mismatch",
        `Goal ${goalId} belongs to a different Runtime Session`,
      );
    }
    return goal;
  }

  private async dispatch(
    ownerId: string,
    commit: GoalInstructionCommit,
  ): Promise<GoalCommandResult> {
    return {
      goal: commit.goal,
      instruction: commit.instruction,
      deduplicated: commit.deduplicated,
      dispatch: await this.dispatcher.drain({
        ownerId,
        runtimeSessionId: commit.goal.runtimeSessionId,
        targetInstructionId: commit.instruction.id,
      }),
    };
  }
}

interface ParsedCommandBase {
  ownerId: string;
  runtimeSessionId: string;
  idempotencyKey: string;
  source: RuntimeInstructionSource;
}

function parseCommandBase(
  input: GoalCommandBase<TrustedGoalCommandSource | ContextGoalCommandSource>,
  allowConnector: boolean,
): ParsedCommandBase {
  const ownerId = requiredIdentifier(input.ownerId, "ownerId");
  const runtimeSessionId = requiredIdentifier(
    input.runtimeSessionId,
    "runtimeSessionId",
  );
  const idempotencyKey = requiredIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );

  try {
    const source = RuntimeInstructionSourceSchema.parse(input.source);
    if (!allowConnector && source.authority === "untrusted_data") {
      throw new GoalServiceError(
        "invalid_command",
        "Untrusted connector data cannot activate or revise a Goal",
      );
    }
    if (source.type === "automation" && !source.sourceRef) {
      throw new GoalServiceError(
        "invalid_command",
        "Automation Goal commands must identify their source",
      );
    }
    return { ownerId, runtimeSessionId, idempotencyKey, source };
  } catch (cause) {
    if (cause instanceof GoalServiceError) throw cause;
    throw new GoalServiceError(
      "invalid_command",
      "Goal command source is invalid",
      cause,
    );
  }
}

function parseCreateGoalInput(input: CreateAgentGoalInput) {
  try {
    return CreateAgentGoalInputSchema.parse(input);
  } catch (cause) {
    throw new GoalServiceError(
      "invalid_command",
      "Goal creation command is invalid",
      cause,
    );
  }
}

function parseGoalUpdate(update: AgentGoalUpdate): AgentGoalUpdate {
  try {
    return AgentGoalUpdateSchema.parse(update);
  } catch (cause) {
    throw new GoalServiceError(
      "invalid_command",
      "Goal update command is invalid",
      cause,
    );
  }
}

function parseContextReference(
  contextRef: GoalContextReference,
): GoalContextReference {
  try {
    return GoalContextReferenceSchema.parse(contextRef);
  } catch (cause) {
    throw new GoalServiceError(
      "invalid_command",
      "Goal context reference is invalid",
      cause,
    );
  }
}

function commandIdentity(
  idempotencyKey: string,
  command: unknown,
): GoalCommandIdentity {
  return {
    idempotencyKey,
    requestFingerprint: createGoalCommandFingerprint(command),
  };
}

function instructionDraft(
  draft: RuntimeInstructionDraft,
): RuntimeInstructionDraft {
  try {
    const parsed = RuntimeInstructionSchema.parse({ ...draft, sequence: 1 });
    const { sequence: _sequence, ...validated } = parsed;
    return validated as RuntimeInstructionDraft;
  } catch (cause) {
    throw new GoalServiceError(
      "invalid_command",
      "Goal command produced an invalid Runtime Instruction",
      cause,
    );
  }
}

function assertSupportedConstraints(
  constraints: AgentGoal["constraints"],
): void {
  const unsupported = findUnsupportedRuntimeConstraint(constraints);
  if (unsupported) {
    throw new GoalServiceError(
      "runtime_constraint_unsupported",
      `Runtime-enforced constraint ${unsupported.id} cannot be activated before a policy enforcement adapter is configured`,
    );
  }
}

function assertGoalSourceProvenance(
  goalSource: GoalSource,
  instructionSource: RuntimeInstructionSource,
): void {
  if (goalSourceMatchesCommand(goalSource, instructionSource)) return;

  throw new GoalServiceError(
    "invalid_goal_provenance",
    instructionSource.type === "automation"
      ? "An automation may only activate a non-user Goal carrying the same source reference"
      : "A user activation must carry a user-authored Goal source",
  );
}

function assertGoalUpdateAuthority(
  goal: AgentGoal,
  source: RuntimeInstructionSource,
): void {
  if (source.type === "user" || source.type === "policy") return;
  if (
    source.type === "automation" &&
    goal.source.type !== "user" &&
    goal.source.id === source.sourceRef
  ) {
    return;
  }

  throw new GoalServiceError(
    "invalid_goal_provenance",
    `Automation source ${source.sourceRef ?? "unknown"} cannot revise Goal ${goal.id} from source ${goal.source.id ?? goal.source.type}`,
  );
}

function assertConstraintChanges(
  current: GoalConstraint[],
  next: GoalConstraint[],
  source: RuntimeInstructionSource,
): void {
  const unauthorized = findUnauthorizedConstraintChange(current, next, source);
  if (!unauthorized) return;

  throw new GoalServiceError(
    "invalid_constraint_authority",
    `Command source ${source.type} cannot change ${unauthorized.authority} constraint ${unauthorized.id}`,
  );
}

function assertContextProvenance(
  contextRef: GoalContextReference,
  source: RuntimeInstructionSource,
): void {
  if (source.type === "connector") {
    if (
      contextRef.origin !== "connector" ||
      source.authority !== "untrusted_data" ||
      source.sourceRef !== contextRef.sourceRef
    ) {
      throw new GoalServiceError(
        "invalid_context_provenance",
        `Connector context ${contextRef.id} must preserve its untrusted source metadata`,
      );
    }
    return;
  }

  if (source.type === "user") {
    if (contextRef.origin === "user") return;
    throw new GoalServiceError(
      "invalid_context_provenance",
      `User context ${contextRef.id} cannot claim ${contextRef.origin} provenance`,
    );
  }

  if (
    (contextRef.origin === "memory" || contextRef.origin === "openloomi") &&
    contextRef.sourceRef !== undefined &&
    contextRef.sourceRef === source.sourceRef
  ) {
    return;
  }
  throw new GoalServiceError(
    "invalid_context_provenance",
    `${source.type} context ${contextRef.id} must preserve its OpenLoomi or memory source reference`,
  );
}

function assertExistingContextAuthority(
  contextRef: GoalContextReference,
  source: RuntimeInstructionSource,
  action: "remove" | "replace",
): void {
  if (source.type === "user") return;
  if (source.type === "connector") {
    assertContextProvenance(contextRef, source);
    return;
  }
  if (
    (contextRef.origin === "memory" || contextRef.origin === "openloomi") &&
    contextRef.sourceRef !== undefined &&
    contextRef.sourceRef === source.sourceRef
  ) {
    return;
  }
  throw new GoalServiceError(
    "invalid_context_provenance",
    `${source.type} source ${source.sourceRef ?? "unknown"} cannot ${action} ${contextRef.origin} context ${contextRef.id}`,
  );
}

function assertGoalChanged(current: AgentGoal, revised: AgentGoal): void {
  if (
    canonicalJson(goalBusinessState(current)) ===
    canonicalJson(goalBusinessState(revised))
  ) {
    throw new GoalServiceError(
      "no_change",
      "Goal update does not change authoritative Goal state",
    );
  }
}

function goalBusinessState(
  goal: AgentGoal,
): Omit<AgentGoal, "revision" | "updatedAt"> {
  const { revision: _revision, updatedAt: _updatedAt, ...state } = goal;
  return state;
}

const MAX_IDENTIFIER_CHARACTERS = 256;

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new GoalServiceError("invalid_command", `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new GoalServiceError("invalid_command", `${field} must not be empty`);
  }
  if (normalized !== value) {
    throw new GoalServiceError(
      "invalid_command",
      `${field} must not contain surrounding whitespace`,
    );
  }
  if (value.length > MAX_IDENTIFIER_CHARACTERS) {
    throw new GoalServiceError(
      "invalid_command",
      `${field} must not exceed ${MAX_IDENTIFIER_CHARACTERS} characters`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new GoalServiceError(
      "invalid_command",
      `${field} must be a positive integer`,
    );
  }
  return value as number;
}

function commandScope(
  input: Pick<GoalCommandBase<unknown>, "ownerId" | "runtimeSessionId">,
): string {
  return JSON.stringify([input.ownerId, input.runtimeSessionId]);
}
