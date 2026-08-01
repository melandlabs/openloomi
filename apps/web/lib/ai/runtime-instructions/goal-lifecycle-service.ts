import {
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  RuntimeInstructionSchema,
  RuntimeInstructionSourceSchema,
  transitionAgentGoal,
  type AgentGoal,
  type AgentGoalLifecycleTransition,
  type AgentGoalStatePort,
  type GoalCommandIdentity,
  type GoalLifecycleTransitionAction,
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
import type {
  GoalCommandResult,
  GoalLifecycleCommandSource,
} from "./goal-service";
import { GoalServiceError } from "./goal-service-error";
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

interface GoalLifecycleCommand {
  ownerId: string;
  runtimeSessionId: string;
  goalId: string;
  expectedRevision: number;
  idempotencyKey: string;
  source: GoalLifecycleCommandSource;
  reason?: string;
}

export type PauseGoalCommand = GoalLifecycleCommand;
export type ResumeGoalCommand = GoalLifecycleCommand;
export type CancelGoalCommand = GoalLifecycleCommand;

interface ParsedLifecycleCommand {
  ownerId: string;
  runtimeSessionId: string;
  goalId: string;
  expectedRevision: number;
  idempotencyKey: string;
  source: GoalLifecycleCommandSource;
  reason?: string;
  command: GoalCommandIdentity;
}

interface HeldTerminalBarrier {
  transport: RuntimeSessionLifecycleControlPort;
  boundary: RuntimeTurnBoundary;
  hold: RuntimeTerminalInputHold;
}

/**
 * Applies Goal lifecycle operations at provider turn boundaries.
 *
 * Pause and cancel are control-plane operations: they never enter Claude's
 * normal input queue. Resume is a regular steer that releases retained input
 * only after the paused turn has become terminal.
 */
export class GoalLifecycleService {
  private readonly commands = new KeyedSerialExecutor();
  private readonly terminalBarriers = new Map<string, HeldTerminalBarrier>();

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
      throw new GoalServiceError(
        "invalid_command",
        "terminalTimeoutMs must be an integer between 1 and 300000",
      );
    }
  }

  pause(input: PauseGoalCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.interruptingTransition("pause", input),
    );
  }

  cancel(input: CancelGoalCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.interruptingTransition("cancel", input),
    );
  }

  resume(input: ResumeGoalCommand): Promise<GoalCommandResult> {
    return this.commands.run(commandScope(input), () =>
      this.resumeSerialized(input),
    );
  }

  private async interruptingTransition(
    action: GoalLifecycleTransitionAction,
    input: GoalLifecycleCommand,
  ): Promise<GoalCommandResult> {
    const command = parseLifecycleCommand(action, input);
    let stored = await this.state.findLifecycleTransitionByIdempotency({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      command: command.command,
    });
    const wasReplay = stored !== null;

    if (!stored) {
      const transport = await this.sessions.resolveLifecycle(
        command.ownerId,
        command.runtimeSessionId,
      );
      const expectedRunEpoch = transport
        ? this.captureLiveBoundary(transport).runEpoch
        : await this.state.getRuntimeSessionRunEpoch(
            command.ownerId,
            command.runtimeSessionId,
          );
      const current = await this.requireGoal(command);
      assertLifecycleAuthority(current, command.source);
      const now = this.clock.now();
      const goal = transitionAgentGoal({
        current,
        expectedRevision: command.expectedRevision,
        status: action === "pause" ? "paused" : "cancelled",
        now,
      });
      const instruction = instructionDraft({
        schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
        id: this.ids.generate(),
        goalId: goal.id,
        goalRevision: goal.revision,
        kind: action === "pause" ? "goal.pause" : "goal.cancel",
        deliveryMode: "interrupt_replace",
        targetSessionId: command.runtimeSessionId,
        payload: {
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          expectedRunEpoch,
        },
        source: command.source,
        idempotencyKey: command.idempotencyKey,
        issuedAt: now.toISOString(),
      });
      if (transport) this.assertCurrentTransport(command.ownerId, transport);
      stored = await this.state.prepareLifecycleTransition({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        action,
        expectedRevision: command.expectedRevision,
        expectedRunEpoch,
        goal,
        instruction,
        command: command.command,
      });
    }

    const transition = stored.transition;
    const transport = await this.sessions.resolveLifecycle(
      command.ownerId,
      command.runtimeSessionId,
    );
    if (!transport) {
      return lifecycleResult(
        transition,
        wasReplay,
        await this.dispatchControl(transition, command.ownerId),
      );
    }

    if (transition.phase === "finalized") {
      if (transport.runEpoch !== transition.runEpoch) {
        throw new GoalServiceError(
          "invalid_command",
          `Finalized ${transition.action} expects runEpoch ${transition.runEpoch}, live Runtime Session is ${transport.runEpoch}`,
        );
      }
      const controlDispatch = await this.dispatchControl(
        transition,
        command.ownerId,
      );
      if (controlDispatch.status !== "accepted") {
        return lifecycleResult(transition, wasReplay, controlDispatch);
      }
      await this.commitControlBarrier(transition, command.ownerId, transport);
      await this.finalizeObservation(transition, command.ownerId);
      return lifecycleResult(transition, wasReplay, controlDispatch);
    }

    if (
      transition.phase === "boundary_observed" &&
      transition.action !== "cancel"
    ) {
      throw new GoalServiceError(
        "invalid_command",
        "Only Goal cancellation may enter boundary_observed",
      );
    }

    if (transition.phase === "boundary_observed") {
      const controlDispatch = await this.dispatchControl(
        transition,
        command.ownerId,
      );
      if (controlDispatch.status !== "accepted") {
        return lifecycleResult(transition, wasReplay, controlDispatch);
      }
      this.assertCurrentTransport(command.ownerId, transport);
      if (transport.runEpoch === transition.expectedRunEpoch) {
        this.getOrCaptureTerminalBarrier(
          transition,
          command.ownerId,
          transport,
        );
      }
      const discardedInputIds = this.reconcileCancelEpoch(
        transition,
        transport,
      );
      await this.supersedeDiscardedInputs(
        transition,
        command.ownerId,
        discardedInputIds,
      );
      stored = await this.state.finalizeLifecycleTransition({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        goalId: transition.transitionedGoal.goal.id,
        expectedRunEpoch: transition.expectedRunEpoch,
        nextRunEpoch: transition.runEpoch,
        command: command.command,
      });
      await this.finalizeObservation(stored.transition, command.ownerId);
      this.releaseTerminalBarrier(transition.instruction.id);
      return lifecycleResult(stored.transition, wasReplay, controlDispatch);
    }

    if (
      transition.phase !== "prepared" ||
      transport.runEpoch !== transition.expectedRunEpoch
    ) {
      throw new GoalServiceError(
        "invalid_command",
        `${transition.phase} ${transition.action} expects runEpoch ${transition.expectedRunEpoch}, live Runtime Session is ${transport.runEpoch}`,
      );
    }
    const barrier = this.getOrCaptureTerminalBarrier(
      transition,
      command.ownerId,
      transport,
    );
    const controlDispatch = await this.dispatchControl(
      transition,
      command.ownerId,
    );
    if (controlDispatch.status !== "accepted") {
      // The authoritative transition remains prepared. Retaining the same
      // barrier prevents old input from leaking before an idempotent retry.
      return lifecycleResult(transition, wasReplay, controlDispatch);
    }
    this.assertCurrentTransport(command.ownerId, transport);
    const terminal =
      barrier.boundary.state === "idle"
        ? terminalAtBoundary(barrier.boundary)
        : await this.waitForTerminal(
            (signal) =>
              transport.waitForTurnTerminal({
                expectedRunEpoch: transition.expectedRunEpoch,
                afterTerminalSequence: barrier.boundary.terminalSequence,
                signal,
              }),
            command.runtimeSessionId,
          );
    this.validateTerminal(terminal, barrier.boundary);
    this.assertCurrentTransport(command.ownerId, transport);
    await this.commitControlBarrier(transition, command.ownerId, transport);

    const nextRunEpoch =
      transition.action === "cancel"
        ? transition.expectedRunEpoch + 1
        : transition.expectedRunEpoch;
    if (transition.action === "cancel") {
      stored = await this.state.markLifecycleTransitionBoundary({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        goalId: transition.transitionedGoal.goal.id,
        expectedRunEpoch: transition.expectedRunEpoch,
        nextRunEpoch,
        command: command.command,
      });
      const discardedInputIds = this.advanceAndValidate(
        stored.transition,
        transport,
      );
      await this.supersedeDiscardedInputs(
        stored.transition,
        command.ownerId,
        discardedInputIds,
      );
    }
    stored = await this.state.finalizeLifecycleTransition({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      goalId: transition.transitionedGoal.goal.id,
      expectedRunEpoch: transition.expectedRunEpoch,
      nextRunEpoch,
      command: command.command,
    });
    await this.finalizeObservation(stored.transition, command.ownerId);
    this.releaseTerminalBarrier(transition.instruction.id);
    return lifecycleResult(stored.transition, wasReplay, controlDispatch);
  }

  private async resumeSerialized(
    input: ResumeGoalCommand,
  ): Promise<GoalCommandResult> {
    const command = parseLifecycleCommand("resume", input);
    const replay = await this.state.findCommitByIdempotency({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      command: command.command,
    });
    if (replay) {
      return {
        ...replay,
        dispatch: await this.dispatcher.drain({
          ownerId: command.ownerId,
          runtimeSessionId: command.runtimeSessionId,
          targetInstructionId: replay.instruction.id,
        }),
      };
    }

    const current = await this.requireGoal(command);
    assertLifecycleAuthority(current, command.source);
    const now = this.clock.now();
    const goal = transitionAgentGoal({
      current,
      expectedRevision: command.expectedRevision,
      status: "active",
      now,
    });
    const instruction = instructionDraft({
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: this.ids.generate(),
      goalId: goal.id,
      goalRevision: goal.revision,
      kind: "goal.resume",
      deliveryMode: "steer",
      targetSessionId: command.runtimeSessionId,
      payload: command.reason === undefined ? {} : { reason: command.reason },
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      issuedAt: now.toISOString(),
    });
    const commit = await this.state.commitTransition({
      ownerId: command.ownerId,
      runtimeSessionId: command.runtimeSessionId,
      expectedRevision: command.expectedRevision,
      goal,
      instruction,
      command: command.command,
    });
    return {
      ...commit,
      dispatch: await this.dispatcher.drain({
        ownerId: command.ownerId,
        runtimeSessionId: command.runtimeSessionId,
        targetInstructionId: commit.instruction.id,
      }),
    };
  }

  private async requireGoal(
    command: ParsedLifecycleCommand,
  ): Promise<AgentGoal> {
    const persisted = await this.state.getGoal(command.ownerId, command.goalId);
    if (!persisted) {
      throw new GoalServiceError(
        "goal_not_found",
        `Goal ${command.goalId} does not exist for this owner`,
      );
    }
    if (persisted.runtimeSessionId !== command.runtimeSessionId) {
      throw new GoalServiceError(
        "goal_session_mismatch",
        `Goal ${command.goalId} belongs to a different Runtime Session`,
      );
    }
    return persisted.goal;
  }

  private captureLiveBoundary(
    transport: RuntimeSessionLifecycleControlPort,
  ): RuntimeTurnBoundary {
    const boundary = transport.captureTurnBoundary();
    this.validateBoundary(boundary, transport);
    return boundary;
  }

  private getOrCaptureTerminalBarrier(
    transition: AgentGoalLifecycleTransition,
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): HeldTerminalBarrier {
    const existing = this.terminalBarriers.get(transition.instruction.id);
    if (existing) {
      if (existing.transport !== transport) {
        throw new GoalServiceError(
          "invalid_command",
          `Runtime Session ${transition.runtimeSessionId} changed while its terminal input barrier was active`,
        );
      }
      return existing;
    }

    const captured = transport.captureTurnBoundaryAndHoldPendingInput(
      transition.expectedRunEpoch,
    );
    try {
      this.validateBoundary(captured.boundary, transport);
      this.validateHold(captured.hold, transition.expectedRunEpoch);
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
    this.terminalBarriers.set(transition.instruction.id, barrier);
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
      throw new GoalServiceError(
        "invalid_command",
        "Runtime Session returned an invalid turn boundary",
      );
    }
    if (
      boundary.state === "starting" ||
      boundary.state === "closed" ||
      boundary.state === "failed"
    ) {
      throw new GoalServiceError(
        "invalid_command",
        `Runtime Session cannot change Goal lifecycle while ${boundary.state}`,
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
      throw new GoalServiceError(
        "invalid_command",
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
      throw new GoalServiceError(
        "invalid_command",
        "Runtime Session returned a terminal event outside the captured turn boundary",
      );
    }
  }

  private advanceAndValidate(
    transition: AgentGoalLifecycleTransition,
    transport: RuntimeSessionLifecycleControlPort,
  ): string[] {
    const advanced = transport.advanceRunEpoch({
      expectedRunEpoch: transition.expectedRunEpoch,
      nextRunEpoch: transition.runEpoch,
    });
    if (
      advanced.previousRunEpoch !== transition.expectedRunEpoch ||
      advanced.runEpoch !== transition.runEpoch ||
      transport.runEpoch !== transition.runEpoch ||
      !Array.isArray(advanced.discardedInputIds)
    ) {
      throw new GoalServiceError(
        "invalid_command",
        "Runtime Session returned an invalid cancellation epoch advance",
      );
    }
    return [...advanced.discardedInputIds];
  }

  private reconcileCancelEpoch(
    transition: AgentGoalLifecycleTransition,
    transport: RuntimeSessionLifecycleControlPort,
  ): string[] {
    if (transport.runEpoch === transition.runEpoch) return [];
    if (transport.runEpoch !== transition.expectedRunEpoch) {
      throw new GoalServiceError(
        "invalid_command",
        `Goal cancellation epoch ${transition.runEpoch} cannot reconcile live Runtime Session epoch ${transport.runEpoch}`,
      );
    }
    return this.advanceAndValidate(transition, transport);
  }

  private releaseTerminalBarrier(instructionId: string): void {
    const barrier = this.terminalBarriers.get(instructionId);
    if (!barrier) return;
    this.terminalBarriers.delete(instructionId);
    barrier.hold.release();
  }

  private assertCurrentTransport(
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): void {
    if (this.sessions.isCurrent(ownerId, transport)) return;
    throw new GoalServiceError(
      "invalid_command",
      `Runtime Session ${transport.runtimeSessionId} changed during Goal lifecycle transition`,
    );
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
              new GoalServiceError(
                "invalid_command",
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
    transition: AgentGoalLifecycleTransition,
    ownerId: string,
  ): Promise<RuntimeInstructionDispatch> {
    return this.dispatcher.deliverControl({
      ownerId,
      runtimeSessionId: transition.runtimeSessionId,
      targetInstructionId: transition.instruction.id,
    });
  }

  private commitControlBarrier(
    transition: AgentGoalLifecycleTransition,
    ownerId: string,
    transport: RuntimeSessionLifecycleControlPort,
  ): Promise<string[]> {
    return this.dispatcher.commitControlBarrier({
      ownerId,
      runtimeSessionId: transition.runtimeSessionId,
      targetInstructionId: transition.instruction.id,
      transport,
      reason: `Superseded by Goal ${transition.action} ${transition.instruction.id}`,
      predecessorPolicy:
        transition.action === "pause"
          ? "preserve_predecessors"
          : "supersede_predecessors",
    });
  }

  private async finalizeObservation(
    transition: AgentGoalLifecycleTransition,
    ownerId: string,
  ): Promise<void> {
    const observations = this.observations;
    if (!observations) return;
    await recordRuntimeObservation("finalize lifecycle observation", () =>
      observations.finalizeControlInstruction({
        ownerId,
        runtimeSessionId: transition.runtimeSessionId,
        instructionId: transition.instruction.id,
        runEpoch: transition.expectedRunEpoch,
        status: transition.action === "pause" ? "paused" : "cancelled",
      }),
    );
  }

  private async supersedeDiscardedInputs(
    transition: AgentGoalLifecycleTransition,
    ownerId: string,
    instructionIds: string[],
  ): Promise<void> {
    const observations = this.observations;
    if (instructionIds.length === 0 || !observations) {
      return;
    }
    await recordRuntimeObservation(
      "record lifecycle-discarded deliveries",
      () =>
        observations.supersedeDeliveries({
          ownerId,
          runtimeSessionId: transition.runtimeSessionId,
          instructionIds,
          reason: `Discarded when Goal ${transition.action} crossed runEpoch ${transition.expectedRunEpoch}`,
        }),
    );
  }
}

function parseLifecycleCommand(
  action: GoalLifecycleTransitionAction | "resume",
  input: GoalLifecycleCommand,
): ParsedLifecycleCommand {
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
  const reason = lifecycleReason(input.reason);
  let source: RuntimeInstructionSource;
  try {
    source = RuntimeInstructionSourceSchema.parse(input.source);
  } catch (cause) {
    throw new GoalServiceError(
      "invalid_command",
      "Goal lifecycle command source is invalid",
      cause,
    );
  }
  if (source.type !== "user" && source.type !== "automation") {
    throw new GoalServiceError(
      "invalid_lifecycle_authority",
      `${source.type} sources cannot change Goal lifecycle state`,
    );
  }
  if (source.type === "automation" && source.sourceRef === undefined) {
    throw new GoalServiceError(
      "invalid_lifecycle_authority",
      "Automation lifecycle commands must identify their source",
    );
  }
  const typedSource = source as GoalLifecycleCommandSource;
  return {
    ownerId,
    runtimeSessionId,
    goalId,
    expectedRevision,
    idempotencyKey,
    source: typedSource,
    ...(reason === undefined ? {} : { reason }),
    command: {
      idempotencyKey,
      requestFingerprint: createGoalCommandFingerprint({
        kind: `goal.${action}`,
        runtimeSessionId,
        goalId,
        expectedRevision,
        source: typedSource,
        ...(reason === undefined ? {} : { reason }),
      }),
    },
  };
}

function assertLifecycleAuthority(
  goal: AgentGoal,
  source: GoalLifecycleCommandSource,
): void {
  if (source.type === "user") return;
  if (goal.source.type !== "user" && goal.source.id === source.sourceRef) {
    return;
  }
  throw new GoalServiceError(
    "invalid_lifecycle_authority",
    `Automation source ${source.sourceRef} cannot change lifecycle state for Goal ${goal.id} from source ${goal.source.id ?? goal.source.type}`,
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
    throw new GoalServiceError(
      "invalid_command",
      "Goal lifecycle command produced an invalid Runtime Instruction",
      cause,
    );
  }
}

function lifecycleResult(
  transition: AgentGoalLifecycleTransition,
  deduplicated: boolean,
  dispatch: RuntimeInstructionDispatch,
): GoalCommandResult {
  return {
    goal: transition.transitionedGoal,
    instruction: transition.instruction,
    deduplicated,
    dispatch,
  };
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

function lifecycleReason(reason: unknown): string | undefined {
  if (reason === undefined) return undefined;
  if (typeof reason !== "string") {
    throw new GoalServiceError(
      "invalid_command",
      "Lifecycle reason must be a string",
    );
  }
  const normalized = reason.trim();
  if (normalized.length === 0 || normalized.length > 4_000) {
    throw new GoalServiceError(
      "invalid_command",
      "Lifecycle reason must contain 1 to 4000 characters",
    );
  }
  return normalized;
}

function requiredIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim()
  ) {
    throw new GoalServiceError(
      "invalid_command",
      `${field} must contain 1 to 256 characters without surrounding whitespace`,
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
  input: Pick<GoalLifecycleCommand, "ownerId" | "runtimeSessionId">,
): string {
  return JSON.stringify([input.ownerId, input.runtimeSessionId]);
}
