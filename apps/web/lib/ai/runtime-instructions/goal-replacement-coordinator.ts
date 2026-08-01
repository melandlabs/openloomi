import {
  CreateAgentGoalInputSchema,
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  RuntimeInstructionSchema,
  RuntimeInstructionSourceSchema,
  createAgentGoal,
  transitionAgentGoal,
  type AgentGoal,
  type AgentGoalReplacement,
  type AgentGoalStatePort,
  type CreateAgentGoalInput,
  type GoalCommandIdentity,
  type GoalReplacementCommit,
  type GoalSource,
  type RuntimeClockPort,
  type RuntimeIdGeneratorPort,
  type RuntimeInstructionDraft,
  type RuntimeInstructionSource,
  type RuntimeSessionLifecycleControlPort,
  type RuntimeTerminalInputHold,
  type RuntimeTurnBoundary,
  type RuntimeTurnTerminal,
} from "@openloomi/ai/agent/runtime-instructions";

import { createGoalCommandFingerprint } from "./command-fingerprint";
import {
  findUnauthorizedConstraintChange,
  findUnsupportedRuntimeConstraint,
  goalSourceMatchesCommand,
} from "./goal-command-policy";
import type {
  RuntimeInstructionDispatch,
  RuntimeInstructionDispatcher,
} from "./instruction-dispatcher";
import { KeyedSerialExecutor } from "./keyed-serial-executor";
import {
  recordRuntimeObservation,
  type RuntimeLifecycleObservationPort,
} from "./runtime-observation";
import type { RuntimeSessionRegistry } from "./runtime-session-registry";

export type GoalReplacementCommandSource =
  | {
      type: "user";
      authority: "user";
      sourceRef?: string;
    }
  | {
      type: "automation";
      authority: "automation";
      sourceRef: string;
    };

export interface ReplaceGoalCommand {
  ownerId: string;
  runtimeSessionId: string;
  goalId: string;
  expectedRevision: number;
  idempotencyKey: string;
  source: GoalReplacementCommandSource;
  reason: string;
  replacement: CreateAgentGoalInput;
}

export interface GoalReplacementResult {
  replacement: AgentGoalReplacement;
  deduplicated: boolean;
  controlDispatch: RuntimeInstructionDispatch;
  activationDispatch?: RuntimeInstructionDispatch;
  terminal?: RuntimeTurnTerminal;
  discardedInputIds: string[];
}

interface HeldReplacementBarrier {
  transport: RuntimeSessionLifecycleControlPort;
  boundary: RuntimeTurnBoundary;
  hold: RuntimeTerminalInputHold;
}

export type GoalReplacementCoordinatorErrorCode =
  | "goal_not_found"
  | "goal_session_mismatch"
  | "invalid_authority"
  | "invalid_command"
  | "invalid_runtime_response"
  | "invalid_runtime_state"
  | "run_epoch_conflict"
  | "runtime_changed"
  | "runtime_unavailable"
  | "terminal_timeout";

export class GoalReplacementCoordinatorError extends Error {
  constructor(
    public readonly code: GoalReplacementCoordinatorErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GoalReplacementCoordinatorError";
  }
}

/**
 * Coordinates the non-transactional provider boundary across durable state
 * phases:
 *
 * prepare replacement -> interrupt -> observe terminal -> record boundary ->
 * advance epoch -> finalize activation.
 *
 * The state adapter keeps a primary-slot reservation across those phases,
 * so no competing activation can enter while provider I/O is in flight.
 */
export class GoalReplacementCoordinator {
  private readonly commands = new KeyedSerialExecutor();
  private readonly terminalBarriers = new Map<string, HeldReplacementBarrier>();

  constructor(
    private readonly state: AgentGoalStatePort,
    private readonly dispatcher: RuntimeInstructionDispatcher,
    private readonly sessions: RuntimeSessionRegistry,
    private readonly clock: RuntimeClockPort,
    private readonly ids: RuntimeIdGeneratorPort,
    private readonly terminalTimeoutMs = 30_000,
    private readonly observations?: RuntimeLifecycleObservationPort,
  ) {
    if (
      !Number.isInteger(terminalTimeoutMs) ||
      terminalTimeoutMs <= 0 ||
      terminalTimeoutMs > 300_000
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_command",
        "terminalTimeoutMs must be an integer between 1 and 300000",
      );
    }
  }

  replace(input: ReplaceGoalCommand): Promise<GoalReplacementResult> {
    return this.commands.run(commandScope(input), () =>
      this.replaceSerialized(input),
    );
  }

  private async replaceSerialized(
    input: ReplaceGoalCommand,
  ): Promise<GoalReplacementResult> {
    const command = parseReplacementCommand(input);
    let stored = await this.state.findReplacementByIdempotency({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      command: command.identity,
    });

    if (!stored) {
      const transport = await this.requireLifecycleTransport(
        command.ownerId,
        command.runtimeSessionId,
      );
      const boundary = this.captureLiveBoundary(transport);

      const current = await this.state.getGoal(command.ownerId, command.goalId);
      if (!current) {
        throw new GoalReplacementCoordinatorError(
          "goal_not_found",
          `Goal ${command.goalId} does not exist for this owner`,
        );
      }
      if (current.runtimeSessionId !== command.runtimeSessionId) {
        throw new GoalReplacementCoordinatorError(
          "goal_session_mismatch",
          `Goal ${command.goalId} belongs to a different Runtime Session`,
        );
      }
      assertLifecycleAuthority(current.goal, command.source);

      const now = this.clock.now();
      const supersededGoal = transitionAgentGoal({
        current: current.goal,
        expectedRevision: command.expectedRevision,
        status: "cancelled",
        now,
      });
      const replacementGoal = createAgentGoal({
        id: this.ids.generate(),
        input: command.replacement,
        now,
      });
      const controlInstruction = instructionDraft({
        schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
        id: this.ids.generate(),
        goalId: supersededGoal.id,
        goalRevision: supersededGoal.revision,
        kind: "control.interrupt",
        deliveryMode: "interrupt_replace",
        targetSessionId: command.runtimeSessionId,
        payload: {
          reason: command.reason,
          expectedRunEpoch: boundary.runEpoch,
          replacementGoalId: replacementGoal.id,
        },
        source: command.source,
        idempotencyKey: command.idempotencyKey,
        issuedAt: now.toISOString(),
      });

      this.assertCurrentTransport(command.ownerId, transport);
      stored = await this.state.prepareReplacement({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        expectedRevision: command.expectedRevision,
        expectedRunEpoch: boundary.runEpoch,
        supersededGoal,
        replacementGoal,
        controlInstruction,
        command: command.identity,
      });
    }

    return this.continueReplacement(command, stored);
  }

  private async continueReplacement(
    command: ParsedReplacementCommand,
    initialCommit: GoalReplacementCommit,
  ): Promise<GoalReplacementResult> {
    let stored = initialCommit;
    const wasReplay = initialCommit.deduplicated;
    let replacement = stored.replacement;
    if (replacement.phase === "activated") {
      const live = await this.sessions.resolveLifecycle(
        command.ownerId,
        command.runtimeSessionId,
      );
      if (live && live.runEpoch !== replacement.runEpoch) {
        throw new GoalReplacementCoordinatorError(
          "run_epoch_conflict",
          `Activated replacement is at runEpoch ${replacement.runEpoch}, live Runtime Session is ${live.runEpoch}`,
        );
      }
      const controlDispatch = live
        ? await this.dispatchOnTransport(
            replacement.controlInstruction,
            command.ownerId,
            live,
          )
        : await this.dispatch(replacement.controlInstruction, command.ownerId);
      const activationDispatch = live
        ? await this.dispatchOnTransport(
            requireActivationInstruction(replacement),
            command.ownerId,
            live,
          )
        : await this.dispatch(
            requireActivationInstruction(replacement),
            command.ownerId,
          );
      await this.finalizeControlObservation(replacement, command.ownerId);
      return {
        replacement,
        deduplicated: wasReplay,
        controlDispatch,
        activationDispatch,
        discardedInputIds: [],
      };
    }

    const transport = await this.sessions.resolveLifecycle(
      command.ownerId,
      command.runtimeSessionId,
    );
    if (!transport) {
      return {
        replacement,
        deduplicated: stored.deduplicated,
        controlDispatch: await this.dispatchControl(
          replacement.controlInstruction,
          command.ownerId,
        ),
        discardedInputIds: [],
      };
    }

    let terminal: RuntimeTurnTerminal | undefined;
    let discardedInputIds: string[] = [];
    let controlDispatch: RuntimeInstructionDispatch;
    if (replacement.phase === "prepared") {
      if (transport.runEpoch !== replacement.expectedRunEpoch) {
        throw new GoalReplacementCoordinatorError(
          "run_epoch_conflict",
          `Replacement expects runEpoch ${replacement.expectedRunEpoch}, live Runtime Session is ${transport.runEpoch}`,
        );
      }
      const barrier = this.getOrCaptureTerminalBarrier(
        replacement,
        command.ownerId,
        transport,
      );
      controlDispatch = await this.dispatchControl(
        replacement.controlInstruction,
        command.ownerId,
      );
      if (controlDispatch.status !== "accepted") {
        return {
          replacement,
          deduplicated: wasReplay,
          controlDispatch,
          discardedInputIds,
        };
      }
      this.assertCurrentTransport(command.ownerId, transport);
      terminal =
        barrier.boundary.state === "idle"
          ? terminalAtBoundary(barrier.boundary)
          : await this.waitForTerminal(
              (signal) =>
                transport.waitForTurnTerminal({
                  expectedRunEpoch: replacement.expectedRunEpoch,
                  afterTerminalSequence: barrier.boundary.terminalSequence,
                  signal,
                }),
              command.runtimeSessionId,
            );
      this.validateTerminal(terminal, barrier.boundary);
      this.assertCurrentTransport(command.ownerId, transport);
      await this.commitControlBarrier(
        replacement.controlInstruction,
        command.ownerId,
        transport,
      );

      stored = await this.state.markReplacementBoundary({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        replacementGoalId: replacement.replacementGoal.goal.id,
        expectedRunEpoch: replacement.expectedRunEpoch,
        nextRunEpoch: replacement.expectedRunEpoch + 1,
        command: command.identity,
      });
      replacement = stored.replacement;
      discardedInputIds = this.advanceAndValidate(replacement, transport);
      await this.supersedeDiscardedInputs(
        replacement,
        command.ownerId,
        discardedInputIds,
      );
      this.releaseTerminalBarrier(replacement.controlInstruction.id);
    } else {
      if (replacement.phase !== "boundary_observed") {
        throw new GoalReplacementCoordinatorError(
          "invalid_command",
          `Cannot continue Goal replacement from phase ${replacement.phase}`,
        );
      }
      if (transport.runEpoch === replacement.expectedRunEpoch) {
        this.getOrCaptureTerminalBarrier(
          replacement,
          command.ownerId,
          transport,
        );
      }
      controlDispatch = await this.dispatchControl(
        replacement.controlInstruction,
        command.ownerId,
      );
      if (controlDispatch.status !== "accepted") {
        return {
          replacement,
          deduplicated: wasReplay,
          controlDispatch,
          discardedInputIds,
        };
      }
      await this.commitControlBarrier(
        replacement.controlInstruction,
        command.ownerId,
        transport,
      );
      discardedInputIds = this.reconcileLiveEpoch(replacement, transport);
      await this.supersedeDiscardedInputs(
        replacement,
        command.ownerId,
        discardedInputIds,
      );
      this.releaseTerminalBarrier(replacement.controlInstruction.id);
    }

    this.assertCurrentTransport(command.ownerId, transport);
    const now = this.clock.now();
    const activationInstruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: replacement.replacementGoal.goal.id,
      goalRevision: replacement.replacementGoal.goal.revision,
      kind: "goal.activate",
      deliveryMode: "steer",
      targetSessionId: command.runtimeSessionId,
      payload: { goal: replacement.replacementGoal.goal },
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    stored = await this.state.finalizeReplacement({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      replacementGoalId: replacement.replacementGoal.goal.id,
      activationInstruction,
      command: command.identity,
    });
    replacement = stored.replacement;
    await this.finalizeControlObservation(replacement, command.ownerId);
    const activationDispatch = await this.dispatchOnTransport(
      requireActivationInstruction(replacement),
      command.ownerId,
      transport,
    );

    return {
      replacement,
      deduplicated: wasReplay,
      controlDispatch,
      activationDispatch,
      ...(terminal === undefined ? {} : { terminal }),
      discardedInputIds,
    };
  }

  private async requireLifecycleTransport(
    ownerId: string,
    runtimeSessionId: string,
  ) {
    const transport = await this.sessions.resolveLifecycle(
      ownerId,
      runtimeSessionId,
    );
    if (!transport) {
      throw new GoalReplacementCoordinatorError(
        "runtime_unavailable",
        `Runtime Session ${runtimeSessionId} must be live before preparing a Goal replacement`,
      );
    }
    return transport;
  }

  private reconcileLiveEpoch(
    replacement: AgentGoalReplacement,
    transport: RuntimeSessionLifecycleControlPort,
  ): string[] {
    if (transport.runEpoch === replacement.runEpoch) return [];
    if (transport.runEpoch !== replacement.expectedRunEpoch) {
      throw new GoalReplacementCoordinatorError(
        "run_epoch_conflict",
        `Live Runtime Session epoch ${transport.runEpoch} cannot reconcile replacement epoch ${replacement.runEpoch}`,
      );
    }
    return this.advanceAndValidate(replacement, transport);
  }

  private advanceAndValidate(
    replacement: AgentGoalReplacement,
    transport: RuntimeSessionLifecycleControlPort,
  ): string[] {
    const advanced = transport.advanceRunEpoch({
      expectedRunEpoch: replacement.expectedRunEpoch,
      nextRunEpoch: replacement.runEpoch,
    });
    if (
      advanced.previousRunEpoch !== replacement.expectedRunEpoch ||
      advanced.runEpoch !== replacement.runEpoch ||
      transport.runEpoch !== replacement.runEpoch ||
      !Array.isArray(advanced.discardedInputIds) ||
      advanced.discardedInputIds.some(
        (id) => typeof id !== "string" || id.length === 0,
      )
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_runtime_response",
        "Runtime Session returned an invalid runEpoch advance result",
      );
    }
    return [...advanced.discardedInputIds];
  }

  private captureLiveBoundary(
    transport: RuntimeSessionLifecycleControlPort,
  ): RuntimeTurnBoundary {
    const boundary = transport.captureTurnBoundary();
    this.validateBoundary(boundary, transport);
    return boundary;
  }

  private getOrCaptureTerminalBarrier(
    replacement: AgentGoalReplacement,
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): HeldReplacementBarrier {
    const instructionId = replacement.controlInstruction.id;
    const existing = this.terminalBarriers.get(instructionId);
    if (existing) {
      if (existing.transport !== transport) {
        throw new GoalReplacementCoordinatorError(
          "runtime_changed",
          `Runtime Session ${replacement.runtimeSessionId} changed while its terminal input barrier was active`,
        );
      }
      return existing;
    }

    const captured = transport.captureTurnBoundaryAndHoldPendingInput(
      replacement.expectedRunEpoch,
    );
    try {
      this.validateBoundary(captured.boundary, transport);
      this.validateHold(captured.hold, replacement.expectedRunEpoch);
    } catch (error) {
      captured.hold.release();
      throw error;
    }
    this.assertCurrentTransport(ownerId, transport);
    const barrier = {
      transport,
      boundary: captured.boundary,
      hold: captured.hold,
    };
    this.terminalBarriers.set(instructionId, barrier);
    return barrier;
  }

  private validateBoundary(
    boundary: RuntimeTurnBoundary,
    transport: RuntimeSessionLifecycleControlPort,
  ): void {
    if (
      boundary.runtimeSessionId !== transport.runtimeSessionId ||
      boundary.runEpoch !== transport.runEpoch ||
      !Number.isInteger(boundary.terminalSequence) ||
      boundary.terminalSequence < 0
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_runtime_response",
        "Runtime Session returned an invalid turn boundary",
      );
    }
    if (
      boundary.state === "starting" ||
      boundary.state === "closed" ||
      boundary.state === "failed"
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_runtime_state",
        `Runtime Session cannot replace a Goal while ${boundary.state}`,
      );
    }
  }

  private validateHold(
    hold: RuntimeTerminalInputHold,
    expectedRunEpoch: number,
  ): void {
    if (
      hold.runEpoch !== expectedRunEpoch ||
      typeof hold.release !== "function"
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_runtime_response",
        "Runtime Session returned an invalid terminal input hold",
      );
    }
  }

  private validateTerminal(
    terminal: RuntimeTurnTerminal,
    boundary: RuntimeTurnBoundary,
  ): void {
    const validSequence =
      boundary.state === "idle"
        ? terminal.terminalSequence === boundary.terminalSequence
        : terminal.terminalSequence > boundary.terminalSequence;
    if (
      terminal.runtimeSessionId !== boundary.runtimeSessionId ||
      terminal.runEpoch !== boundary.runEpoch ||
      terminal.state !== "idle" ||
      !Number.isInteger(terminal.terminalSequence) ||
      !validSequence
    ) {
      throw new GoalReplacementCoordinatorError(
        "invalid_runtime_response",
        "Runtime Session returned a terminal event outside the captured turn boundary",
      );
    }
  }

  private assertCurrentTransport(
    ownerId: string,
    transport: NonNullable<
      Awaited<ReturnType<RuntimeSessionRegistry["resolveLifecycle"]>>
    >,
  ): void {
    if (this.sessions.isCurrent(ownerId, transport)) return;
    throw new GoalReplacementCoordinatorError(
      "runtime_changed",
      `Runtime Session ${transport.runtimeSessionId} changed during Goal replacement`,
    );
  }

  private releaseTerminalBarrier(instructionId: string): void {
    const barrier = this.terminalBarriers.get(instructionId);
    if (!barrier) return;
    this.terminalBarriers.delete(instructionId);
    barrier.hold.release();
  }

  private async waitForTerminal(
    wait: (signal: AbortSignal) => Promise<RuntimeTurnTerminal>,
    runtimeSessionId: string,
  ): Promise<RuntimeTurnTerminal> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        wait(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new GoalReplacementCoordinatorError(
                "terminal_timeout",
                `Runtime Session ${runtimeSessionId} did not reach a terminal turn boundary within ${this.terminalTimeoutMs}ms`,
              ),
            );
          }, this.terminalTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
    }
  }

  private dispatchControl(
    instruction: AgentGoalReplacement["controlInstruction"],
    ownerId: string,
  ): Promise<RuntimeInstructionDispatch> {
    return this.dispatcher.deliverControl({
      ownerId,
      runtimeSessionId: instruction.targetSessionId,
      targetInstructionId: instruction.id,
    });
  }

  private commitControlBarrier(
    instruction: AgentGoalReplacement["controlInstruction"],
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): Promise<string[]> {
    return this.dispatcher.commitControlBarrier({
      ownerId,
      runtimeSessionId: instruction.targetSessionId,
      targetInstructionId: instruction.id,
      transport,
      reason: `Superseded by Goal replacement ${instruction.id}`,
      predecessorPolicy: "supersede_predecessors",
    });
  }

  private async finalizeControlObservation(
    replacement: AgentGoalReplacement,
    ownerId: string,
  ): Promise<void> {
    const observations = this.observations;
    if (!observations) return;
    await recordRuntimeObservation("finalize replacement observation", () =>
      observations.finalizeControlInstruction({
        ownerId,
        runtimeSessionId: replacement.runtimeSessionId,
        instructionId: replacement.controlInstruction.id,
        runEpoch: replacement.expectedRunEpoch,
        status: "cancelled",
      }),
    );
  }

  private async supersedeDiscardedInputs(
    replacement: AgentGoalReplacement,
    ownerId: string,
    instructionIds: string[],
  ): Promise<void> {
    const observations = this.observations;
    if (instructionIds.length === 0 || !observations) {
      return;
    }
    await recordRuntimeObservation(
      "record replacement-discarded deliveries",
      () =>
        observations.supersedeDeliveries({
          ownerId,
          runtimeSessionId: replacement.runtimeSessionId,
          instructionIds,
          reason: `Discarded when Goal replacement crossed runEpoch ${replacement.expectedRunEpoch}`,
        }),
    );
  }

  private dispatch(
    instruction: AgentGoalReplacement["controlInstruction"],
    ownerId: string,
  ): Promise<RuntimeInstructionDispatch> {
    return this.dispatcher.drain({
      ownerId,
      runtimeSessionId: instruction.targetSessionId,
      targetInstructionId: instruction.id,
    });
  }

  private dispatchOnTransport(
    instruction: AgentGoalReplacement["controlInstruction"],
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): Promise<RuntimeInstructionDispatch> {
    return this.dispatcher.drainOnTransport({
      ownerId,
      runtimeSessionId: instruction.targetSessionId,
      targetInstructionId: instruction.id,
      transport,
    });
  }
}

interface ParsedReplacementCommand {
  ownerId: string;
  runtimeSessionId: string;
  goalId: string;
  expectedRevision: number;
  idempotencyKey: string;
  source: RuntimeInstructionSource;
  reason: string;
  replacement: ReturnType<typeof CreateAgentGoalInputSchema.parse>;
  identity: GoalCommandIdentity;
}

function parseReplacementCommand(
  input: ReplaceGoalCommand,
): ParsedReplacementCommand {
  const ownerId = requiredIdentifier(input.ownerId, "ownerId");
  const runtimeSessionId = requiredIdentifier(
    input.runtimeSessionId,
    "runtimeSessionId",
  );
  const goalId = requiredIdentifier(input.goalId, "goalId");
  const idempotencyKey = requiredIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const expectedRevision = positiveInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const reason = requiredText(input.reason, "reason", 4_000);

  let source: RuntimeInstructionSource;
  let replacement: ReturnType<typeof CreateAgentGoalInputSchema.parse>;
  try {
    source = RuntimeInstructionSourceSchema.parse(input.source);
    replacement = CreateAgentGoalInputSchema.parse(input.replacement);
  } catch (cause) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      "Goal replacement command is invalid",
      cause,
    );
  }
  if (source.type !== "user" && source.type !== "automation") {
    throw new GoalReplacementCoordinatorError(
      "invalid_authority",
      `${source.type} sources cannot replace a Goal`,
    );
  }
  if (source.type === "automation" && source.sourceRef === undefined) {
    throw new GoalReplacementCoordinatorError(
      "invalid_authority",
      "Automation Goal replacements must identify their source",
    );
  }
  if (replacement.contextRefs.length > 0) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      "A replacement Goal cannot embed unresolved context",
    );
  }
  const unsupported = findUnsupportedRuntimeConstraint(replacement.constraints);
  if (unsupported) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      `Runtime-enforced constraint ${unsupported.id} cannot be activated before a policy enforcement adapter is configured`,
    );
  }
  assertGoalSource(replacement.source, source);
  const unauthorized = findUnauthorizedConstraintChange(
    [],
    replacement.constraints,
    source,
  );
  if (unauthorized) {
    throw new GoalReplacementCoordinatorError(
      "invalid_authority",
      `Command source ${source.type} cannot set ${unauthorized.authority} constraint ${unauthorized.id}`,
    );
  }

  const identity = {
    idempotencyKey,
    requestFingerprint: createGoalCommandFingerprint({
      kind: "goal.replace",
      runtimeSessionId,
      goalId,
      expectedRevision,
      source,
      reason,
      replacement,
    }),
  };
  return {
    ownerId,
    runtimeSessionId,
    goalId,
    expectedRevision,
    idempotencyKey,
    source,
    reason,
    replacement,
    identity,
  };
}

function assertGoalSource(
  goalSource: GoalSource,
  source: RuntimeInstructionSource,
): void {
  if (goalSourceMatchesCommand(goalSource, source)) return;
  throw new GoalReplacementCoordinatorError(
    "invalid_authority",
    "Replacement Goal source does not match the command authority",
  );
}

function assertLifecycleAuthority(
  goal: AgentGoal,
  source: RuntimeInstructionSource,
): void {
  if (source.type === "user") return;
  if (
    source.type === "automation" &&
    goal.source.type !== "user" &&
    goal.source.id === source.sourceRef
  ) {
    return;
  }
  throw new GoalReplacementCoordinatorError(
    "invalid_authority",
    `Command source cannot replace Goal ${goal.id}`,
  );
}

function instructionDraft(
  draft: RuntimeInstructionDraft,
): RuntimeInstructionDraft {
  try {
    const parsed = RuntimeInstructionSchema.parse({ ...draft, sequence: 1 });
    const { sequence: _sequence, ...validated } = parsed;
    return validated as RuntimeInstructionDraft;
  } catch (cause) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      "Goal replacement produced an invalid Runtime Instruction",
      cause,
    );
  }
}

function requireActivationInstruction(replacement: AgentGoalReplacement) {
  if (!replacement.activationInstruction) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      "Activated Goal replacement is missing its activation instruction",
    );
  }
  return replacement.activationInstruction;
}

function requiredIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim()
  ) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      `${field} must contain 1 to 256 characters without surrounding whitespace`,
    );
  }
  return value;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      `${field} must contain 1 to ${max} characters`,
    );
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new GoalReplacementCoordinatorError(
      "invalid_command",
      `${field} must be a positive integer`,
    );
  }
  return value as number;
}

function commandScope(
  input: Pick<ReplaceGoalCommand, "ownerId" | "runtimeSessionId">,
): string {
  return JSON.stringify([input.ownerId, input.runtimeSessionId]);
}

function terminalAtBoundary(
  boundary: RuntimeTurnBoundary,
): RuntimeTurnTerminal {
  return {
    runtimeSessionId: boundary.runtimeSessionId,
    runEpoch: boundary.runEpoch,
    terminalSequence: boundary.terminalSequence,
    state: "idle",
  };
}
