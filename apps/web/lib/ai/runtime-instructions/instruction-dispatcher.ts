import {
  RuntimeInstructionSchema,
  canonicalJson,
  type RuntimeDeliveryReceipt,
  type RuntimeInstruction,
  type RuntimeInstructionTransportPort,
  type RuntimeSessionResolverPort,
} from "@openloomi/ai/agent/runtime-instructions";

import { KeyedSerialExecutor } from "./keyed-serial-executor";
import {
  recordRuntimeObservation,
  type RuntimeDeliveryJournalPort,
} from "./runtime-observation";

export interface RuntimeInstructionDrainInput {
  ownerId: string;
  runtimeSessionId: string;
  /** The command whose caller is waiting for a delivery result. */
  targetInstructionId: string;
}

export interface RuntimeInstructionControlInput extends RuntimeInstructionDrainInput {}

export interface RuntimeInstructionTransportDrainInput extends RuntimeInstructionDrainInput {
  transport: RuntimeInstructionTransportPort;
}

export type RuntimeInstructionControlBarrierPolicy =
  | "preserve_predecessors"
  | "supersede_predecessors";

export interface RuntimeInstructionControlBarrierInput extends RuntimeInstructionTransportDrainInput {
  predecessorPolicy: RuntimeInstructionControlBarrierPolicy;
  reason: string;
}

export interface RuntimeInstructionOutboxReader {
  listInstructions(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstruction[]>;
}

export type RuntimeInstructionDispatchFailure =
  | {
      status: "rejected";
      instructionId: string;
      receipt: RuntimeDeliveryReceipt;
    }
  | {
      status: "transport_failed";
      runtimeSessionId: string;
      instructionId: string;
      error: Error;
    };

export type RuntimeInstructionDispatch =
  | {
      status: "accepted";
      instructionId: string;
      receipt: RuntimeDeliveryReceipt;
    }
  | {
      status: "unavailable";
      runtimeSessionId: string;
      instructionId: string;
    }
  | {
      status: "superseded";
      runtimeSessionId: string;
      instructionId: string;
      reason: string;
    }
  | RuntimeInstructionDispatchFailure
  | {
      status: "deferred";
      runtimeSessionId: string;
      instructionId: string;
      blockedByInstructionId: string;
      failure: RuntimeInstructionDispatchFailure;
    };

export type RuntimeInstructionDispatcherErrorCode =
  | "invalid_drain"
  | "outbox_read_failed"
  | "outbox_progress_conflict";

export class RuntimeInstructionDispatcherError extends Error {
  constructor(
    public readonly code: RuntimeInstructionDispatcherErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RuntimeInstructionDispatcherError";
  }
}

interface AcceptedInstruction {
  instructionId: string;
  instruction: RuntimeInstruction;
  receipt: RuntimeDeliveryReceipt;
}

interface SupersededInstruction {
  instructionId: string;
  instruction: RuntimeInstruction;
  reason: string;
}

interface TransportProgress {
  acceptedThroughSequence: number;
  acceptedBySequence: Map<number, AcceptedInstruction>;
  supersededBySequence: Map<number, SupersededInstruction>;
  directlyAcceptedById: Map<string, AcceptedInstruction>;
}

interface ParsedDrain {
  ownerId: string;
  runtimeSessionId: string;
  instructions: RuntimeInstruction[];
  target: RuntimeInstruction;
}

/**
 * Drains an immutable Runtime Instruction outbox in strict sequence order.
 *
 * Progress belongs to one exact transport object. A temporarily unavailable
 * session can resume on the same transport without redelivery, while replacing
 * that transport starts a fresh replay at sequence 1. A failed predecessor is
 * never skipped: the requested target is returned as `deferred` instead.
 */
export class RuntimeInstructionDispatcher {
  private readonly deliveries = new KeyedSerialExecutor();
  private readonly progressByTransport = new WeakMap<
    RuntimeInstructionTransportPort,
    Map<string, TransportProgress>
  >();

  constructor(
    private readonly sessions: RuntimeSessionResolverPort,
    private readonly outbox: RuntimeInstructionOutboxReader,
    private readonly deliveryJournal?: RuntimeDeliveryJournalPort,
  ) {}

  drain(
    input: RuntimeInstructionDrainInput,
  ): Promise<RuntimeInstructionDispatch> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const targetInstructionId = requiredIdentifier(
      input.targetInstructionId,
      "targetInstructionId",
    );
    const scope = sessionScope(ownerId, runtimeSessionId);
    return this.deliveries.run(scope, async () =>
      this.drainSerialized(
        scope,
        await this.readCanonicalOutbox({
          ownerId,
          runtimeSessionId,
          targetInstructionId,
        }),
      ),
    );
  }

  /**
   * Drains only while the session resolver still points at the exact transport
   * that established the lifecycle boundary. The identity check is serialized
   * with delivery progress so an unregister/re-register ABA cannot redirect
   * the post-boundary drain to a different runtime instance.
   */
  drainOnTransport(
    input: RuntimeInstructionTransportDrainInput,
  ): Promise<RuntimeInstructionDispatch> {
    const parsedInput = parseDrainIdentifiers(input);
    assertTransportTargetsSession(
      input.transport,
      parsedInput.runtimeSessionId,
    );
    const scope = sessionScope(
      parsedInput.ownerId,
      parsedInput.runtimeSessionId,
    );
    return this.deliveries.run(scope, async () =>
      this.drainSerialized(
        scope,
        await this.readCanonicalOutbox(parsedInput),
        input.transport,
      ),
    );
  }

  /**
   * Delivers an interrupting lifecycle instruction without draining stale
   * predecessors. The instruction must still exist in the canonical outbox.
   */
  deliverControl(
    input: RuntimeInstructionControlInput,
  ): Promise<RuntimeInstructionDispatch> {
    const parsedInput = parseDrainIdentifiers(input);
    const scope = sessionScope(
      parsedInput.ownerId,
      parsedInput.runtimeSessionId,
    );
    return this.deliveries.run(scope, async () => {
      const parsed = await this.readCanonicalOutbox(parsedInput);
      assertControlInstruction(parsed.target);
      let transport: RuntimeInstructionTransportPort | null;
      try {
        transport = await this.resolveTransport(parsed);
      } catch (cause) {
        return transportFailure(
          parsed.runtimeSessionId,
          parsed.target.id,
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
      if (!transport) {
        return {
          status: "unavailable",
          runtimeSessionId: parsed.runtimeSessionId,
          instructionId: parsed.target.id,
        };
      }
      const progress = this.getProgress(transport, scope, parsed.instructions);
      const cached = progress.directlyAcceptedById.get(parsed.target.id);
      if (cached) return accepted(cached.receipt);
      const sequential = progress.acceptedBySequence.get(
        parsed.target.sequence,
      );
      if (sequential?.instructionId === parsed.target.id) {
        return accepted(sequential.receipt);
      }

      const result = await this.deliverOne(
        parsed.ownerId,
        transport,
        parsed.target,
      );
      if (result.status === "accepted") {
        progress.directlyAcceptedById.set(parsed.target.id, {
          instructionId: parsed.target.id,
          instruction: structuredClone(parsed.target),
          receipt: structuredClone(result.receipt),
        });
      }
      return result;
    });
  }

  /**
   * Commits an accepted control instruction as an outbox barrier after the
   * provider reached the terminal boundary. Depending on the lifecycle
   * operation, undelivered predecessors are either preserved for a later
   * resume or fenced as superseded before a new run epoch can drain.
   */
  commitControlBarrier(
    input: RuntimeInstructionControlBarrierInput,
  ): Promise<string[]> {
    const parsedInput = parseDrainIdentifiers(input);
    const predecessorPolicy = parseControlBarrierPolicy(
      input.predecessorPolicy,
    );
    const reason = requiredText(input.reason, "reason");
    const scope = sessionScope(
      parsedInput.ownerId,
      parsedInput.runtimeSessionId,
    );
    return this.deliveries.run(scope, async () => {
      const parsed = await this.readCanonicalOutbox(parsedInput);
      assertControlInstruction(parsed.target);
      const resolved = await this.resolveTransport(parsed);
      if (resolved !== input.transport) {
        throw new RuntimeInstructionDispatcherError(
          "outbox_progress_conflict",
          `Runtime Session ${parsed.runtimeSessionId} changed before its control barrier was committed`,
        );
      }
      const progress = this.getProgress(
        input.transport,
        scope,
        parsed.instructions,
      );
      const control =
        progress.directlyAcceptedById.get(parsed.target.id) ??
        progress.acceptedBySequence.get(parsed.target.sequence);
      if (!control) {
        throw new RuntimeInstructionDispatcherError(
          "outbox_progress_conflict",
          `Control instruction ${parsed.target.id} was not accepted by this transport`,
        );
      }

      progress.acceptedBySequence.set(parsed.target.sequence, control);
      if (predecessorPolicy === "preserve_predecessors") {
        advanceSettledPrefix(progress, parsed.instructions);
        return [];
      }

      const supersededInstructionIds: string[] = [];
      for (const instruction of parsed.instructions) {
        if (instruction.sequence > parsed.target.sequence) break;
        if (instruction.sequence <= progress.acceptedThroughSequence) continue;

        if (instruction.id !== parsed.target.id) {
          progress.supersededBySequence.set(instruction.sequence, {
            instructionId: instruction.id,
            instruction: structuredClone(instruction),
            reason,
          });
          supersededInstructionIds.push(instruction.id);
        }
      }
      advanceSettledPrefix(progress, parsed.instructions);
      if (supersededInstructionIds.length > 0) {
        await recordRuntimeObservation("record superseded deliveries", () =>
          this.deliveryJournal?.supersedeDeliveries({
            ownerId: parsed.ownerId,
            runtimeSessionId: parsed.runtimeSessionId,
            instructionIds: supersededInstructionIds,
            reason,
          }),
        );
      }
      return supersededInstructionIds;
    });
  }

  private async readCanonicalOutbox(input: {
    ownerId: string;
    runtimeSessionId: string;
    targetInstructionId: string;
  }): Promise<ParsedDrain> {
    let instructions: RuntimeInstruction[];
    try {
      instructions = await this.outbox.listInstructions(
        input.ownerId,
        input.runtimeSessionId,
      );
    } catch (cause) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_read_failed",
        `Failed to read the authoritative outbox for Runtime Session ${input.runtimeSessionId}`,
        cause,
      );
    }
    return parseOutbox({ ...input, instructions });
  }

  private async drainSerialized(
    scope: string,
    input: ParsedDrain,
    expectedTransport?: RuntimeInstructionTransportPort,
  ): Promise<RuntimeInstructionDispatch> {
    let transport: RuntimeInstructionTransportPort | null;
    try {
      transport = await this.resolveTransport(input);
    } catch (cause) {
      return transportFailure(
        input.runtimeSessionId,
        input.target.id,
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }
    if (!transport) {
      return {
        status: "unavailable",
        runtimeSessionId: input.runtimeSessionId,
        instructionId: input.target.id,
      };
    }
    if (expectedTransport && transport !== expectedTransport) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_progress_conflict",
        `Runtime Session ${input.runtimeSessionId} changed before its outbox was drained`,
      );
    }
    const progress = this.getProgress(transport, scope, input.instructions);

    for (const instruction of input.instructions) {
      if (instruction.sequence <= progress.acceptedThroughSequence) continue;
      if (instruction.sequence !== progress.acceptedThroughSequence + 1) {
        throw new RuntimeInstructionDispatcherError(
          "outbox_progress_conflict",
          `Cannot deliver sequence ${instruction.sequence} after accepted sequence ${progress.acceptedThroughSequence}`,
        );
      }

      const alreadyAccepted = progress.acceptedBySequence.get(
        instruction.sequence,
      );
      if (alreadyAccepted) {
        assertSameProgressInstruction(alreadyAccepted, instruction);
        progress.acceptedThroughSequence = instruction.sequence;
        continue;
      }
      const superseded = progress.supersededBySequence.get(
        instruction.sequence,
      );
      if (superseded) {
        assertSameProgressInstruction(superseded, instruction);
        progress.acceptedThroughSequence = instruction.sequence;
        continue;
      }

      const uncommittedControl = progress.directlyAcceptedById.get(
        instruction.id,
      );
      if (uncommittedControl) {
        if (input.target.sequence <= progress.acceptedThroughSequence) break;
        if (input.target.id === instruction.id) {
          return accepted(uncommittedControl.receipt);
        }
        throw new RuntimeInstructionDispatcherError(
          "outbox_progress_conflict",
          `Control instruction ${instruction.id} reached the runtime but its terminal barrier has not been committed`,
        );
      }

      const result = await this.deliverOne(
        input.ownerId,
        transport,
        instruction,
      );
      if (result.status !== "accepted") {
        const acceptedTarget = progress.acceptedBySequence.get(
          input.target.sequence,
        );
        if (acceptedTarget?.instructionId === input.target.id) {
          return accepted(acceptedTarget.receipt);
        }
        if (instruction.id === input.target.id) return result;
        return {
          status: "deferred",
          runtimeSessionId: input.runtimeSessionId,
          instructionId: input.target.id,
          blockedByInstructionId: instruction.id,
          failure: result,
        };
      }

      progress.acceptedBySequence.set(instruction.sequence, {
        instructionId: instruction.id,
        instruction: structuredClone(instruction),
        receipt: structuredClone(result.receipt),
      });
      progress.acceptedThroughSequence = instruction.sequence;
    }

    const target = progress.acceptedBySequence.get(input.target.sequence);
    if (target?.instructionId === input.target.id) {
      return accepted(target.receipt);
    }
    const supersededTarget = progress.supersededBySequence.get(
      input.target.sequence,
    );
    if (supersededTarget?.instructionId === input.target.id) {
      return {
        status: "superseded",
        runtimeSessionId: input.runtimeSessionId,
        instructionId: input.target.id,
        reason: supersededTarget.reason,
      };
    }
    throw new RuntimeInstructionDispatcherError(
      "outbox_progress_conflict",
      `Target instruction ${input.target.id} was not reached by the contiguous outbox drain`,
    );
  }

  private async resolveTransport(
    input: ParsedDrain,
  ): Promise<RuntimeInstructionTransportPort | null> {
    const transport = await this.sessions.resolve(
      input.ownerId,
      input.runtimeSessionId,
    );
    if (
      transport !== null &&
      transport.runtimeSessionId !== input.runtimeSessionId
    ) {
      throw new Error(
        "Runtime resolver returned a transport for a different session",
      );
    }
    return transport;
  }

  private getProgress(
    transport: RuntimeInstructionTransportPort,
    scope: string,
    instructions: readonly RuntimeInstruction[],
  ): TransportProgress {
    let transportProgress = this.progressByTransport.get(transport);
    if (!transportProgress) {
      transportProgress = new Map();
      this.progressByTransport.set(transport, transportProgress);
    }
    let progress = transportProgress.get(scope);
    if (!progress) {
      progress = {
        acceptedThroughSequence: 0,
        acceptedBySequence: new Map(),
        supersededBySequence: new Map(),
        directlyAcceptedById: new Map(),
      };
      transportProgress.set(scope, progress);
    } else {
      assertCompatibleProgress(progress, instructions);
    }
    return progress;
  }

  private async deliverOne(
    ownerId: string,
    transport: RuntimeInstructionTransportPort,
    instruction: RuntimeInstruction,
  ): Promise<
    | Extract<RuntimeInstructionDispatch, { status: "accepted" }>
    | RuntimeInstructionDispatchFailure
  > {
    try {
      await recordRuntimeObservation("prepare instruction delivery", () =>
        this.deliveryJournal?.prepareDelivery({ ownerId, instruction }),
      );
      const receipt = validateReceipt(
        await transport.deliver(instruction),
        instruction,
      );
      await recordRuntimeObservation(
        "record instruction delivery receipt",
        () =>
          this.deliveryJournal?.recordDeliveryReceipt({
            ownerId,
            instruction,
            receipt,
          }),
      );
      return receipt.state === "rejected"
        ? {
            status: "rejected",
            instructionId: instruction.id,
            receipt,
          }
        : accepted(receipt);
    } catch (cause) {
      return transportFailure(
        instruction.targetSessionId,
        instruction.id,
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }
  }
}

function parseOutbox(input: {
  ownerId: string;
  runtimeSessionId: string;
  targetInstructionId: string;
  instructions: readonly RuntimeInstruction[];
}): ParsedDrain {
  if (!Array.isArray(input.instructions) || input.instructions.length === 0) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      "Runtime Instruction outbox must contain at least one instruction",
    );
  }

  let instructions: RuntimeInstruction[];
  try {
    instructions = input.instructions.map((instruction) =>
      RuntimeInstructionSchema.parse(instruction),
    );
  } catch (cause) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      "Runtime Instruction outbox contains an invalid instruction",
      cause,
    );
  }

  const instructionIds = new Set<string>();
  for (const [index, instruction] of instructions.entries()) {
    const expectedSequence = index + 1;
    if (instruction.sequence !== expectedSequence) {
      throw new RuntimeInstructionDispatcherError(
        "invalid_drain",
        `Complete outbox must contain contiguous sequences starting at 1; expected ${expectedSequence}, received ${instruction.sequence}`,
      );
    }
    if (instruction.targetSessionId !== input.runtimeSessionId) {
      throw new RuntimeInstructionDispatcherError(
        "invalid_drain",
        "Every instruction in one outbox drain must target the same Runtime Session",
      );
    }
    if (instructionIds.has(instruction.id)) {
      throw new RuntimeInstructionDispatcherError(
        "invalid_drain",
        `Outbox contains duplicate instruction ID ${instruction.id}`,
      );
    }
    instructionIds.add(instruction.id);
  }

  const target = instructions.find(
    (instruction) => instruction.id === input.targetInstructionId,
  );
  if (!target) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `Target instruction ${input.targetInstructionId} is not present in the outbox`,
    );
  }
  return {
    ownerId: input.ownerId,
    runtimeSessionId: input.runtimeSessionId,
    instructions,
    target,
  };
}

function assertCompatibleProgress(
  progress: TransportProgress,
  instructions: readonly RuntimeInstruction[],
): void {
  if (instructions.length < progress.acceptedThroughSequence) {
    throw new RuntimeInstructionDispatcherError(
      "outbox_progress_conflict",
      `Complete outbox ended at sequence ${instructions.length}, before accepted sequence ${progress.acceptedThroughSequence}`,
    );
  }
  for (
    let sequence = 1;
    sequence <= progress.acceptedThroughSequence;
    sequence++
  ) {
    const acceptedInstruction = progress.acceptedBySequence.get(sequence);
    const supersededInstruction = progress.supersededBySequence.get(sequence);
    const suppliedInstruction = instructions[sequence - 1];
    const settledInstruction = acceptedInstruction ?? supersededInstruction;
    if (
      !settledInstruction ||
      settledInstruction.instructionId !== suppliedInstruction.id ||
      canonicalJson(settledInstruction.instruction) !==
        canonicalJson(suppliedInstruction)
    ) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_progress_conflict",
        `Outbox instruction at sequence ${sequence} differs from the instruction already accepted by this transport`,
      );
    }
  }

  for (const directlyAccepted of progress.directlyAcceptedById.values()) {
    const suppliedInstruction = instructions.find(
      ({ id }) => id === directlyAccepted.instructionId,
    );
    if (
      !suppliedInstruction ||
      canonicalJson(directlyAccepted.instruction) !==
        canonicalJson(suppliedInstruction)
    ) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_progress_conflict",
        `Directly accepted control instruction ${directlyAccepted.instructionId} differs from the authoritative outbox`,
      );
    }
  }
}

function advanceSettledPrefix(
  progress: TransportProgress,
  instructions: readonly RuntimeInstruction[],
): void {
  while (progress.acceptedThroughSequence < instructions.length) {
    const nextSequence = progress.acceptedThroughSequence + 1;
    const suppliedInstruction = instructions[nextSequence - 1];
    const settledInstruction =
      progress.acceptedBySequence.get(nextSequence) ??
      progress.supersededBySequence.get(nextSequence);
    if (!settledInstruction) return;
    assertSameProgressInstruction(settledInstruction, suppliedInstruction);
    progress.acceptedThroughSequence = nextSequence;
  }
}

function assertSameProgressInstruction(
  settledInstruction: AcceptedInstruction | SupersededInstruction,
  suppliedInstruction: RuntimeInstruction,
): void {
  if (
    settledInstruction.instructionId !== suppliedInstruction.id ||
    canonicalJson(settledInstruction.instruction) !==
      canonicalJson(suppliedInstruction)
  ) {
    throw new RuntimeInstructionDispatcherError(
      "outbox_progress_conflict",
      `Outbox instruction at sequence ${suppliedInstruction.sequence} differs from the instruction already settled by this transport`,
    );
  }
}

function parseDrainIdentifiers(
  input: RuntimeInstructionDrainInput,
): RuntimeInstructionDrainInput {
  return {
    ownerId: requiredIdentifier(input.ownerId, "ownerId"),
    runtimeSessionId: requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    ),
    targetInstructionId: requiredIdentifier(
      input.targetInstructionId,
      "targetInstructionId",
    ),
  };
}

function parseControlBarrierPolicy(
  value: unknown,
): RuntimeInstructionControlBarrierPolicy {
  if (value !== "preserve_predecessors" && value !== "supersede_predecessors") {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      "predecessorPolicy must be preserve_predecessors or supersede_predecessors",
    );
  }
  return value;
}

function assertTransportTargetsSession(
  transport: RuntimeInstructionTransportPort,
  runtimeSessionId: string,
): void {
  if (
    !transport ||
    typeof transport !== "object" ||
    transport.runtimeSessionId !== runtimeSessionId
  ) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      "Expected transport must belong to the Runtime Session being drained",
    );
  }
}

function assertControlInstruction(instruction: RuntimeInstruction): void {
  if (
    instruction.deliveryMode !== "interrupt_replace" ||
    (instruction.kind !== "control.interrupt" &&
      instruction.kind !== "goal.pause" &&
      instruction.kind !== "goal.cancel")
  ) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `Instruction ${instruction.id} is not an interrupting lifecycle control`,
    );
  }
}

function validateReceipt(
  candidate: RuntimeDeliveryReceipt,
  instruction: RuntimeInstruction,
): RuntimeDeliveryReceipt {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Runtime transport returned an invalid delivery receipt");
  }
  if (
    candidate.instructionId !== instruction.id ||
    candidate.runtimeSessionId !== instruction.targetSessionId
  ) {
    throw new Error(
      "Runtime transport returned a receipt for a different instruction or session",
    );
  }
  if (
    candidate.state !== "queued" &&
    candidate.state !== "written_to_sdk" &&
    candidate.state !== "rejected"
  ) {
    throw new Error(
      `Runtime transport returned unsupported receipt state ${String(candidate.state)}`,
    );
  }
  if (
    typeof candidate.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.recordedAt))
  ) {
    throw new Error(
      "Runtime transport returned a receipt without a valid recordedAt timestamp",
    );
  }
  if (
    candidate.providerEventId !== undefined &&
    (typeof candidate.providerEventId !== "string" ||
      candidate.providerEventId.length === 0)
  ) {
    throw new Error("Runtime transport returned an invalid providerEventId");
  }
  if (
    candidate.reason !== undefined &&
    (typeof candidate.reason !== "string" || candidate.reason.length === 0)
  ) {
    throw new Error("Runtime transport returned an invalid rejection reason");
  }
  return structuredClone(candidate);
}

function accepted(
  receipt: RuntimeDeliveryReceipt,
): Extract<RuntimeInstructionDispatch, { status: "accepted" }> {
  return {
    status: "accepted",
    instructionId: receipt.instructionId,
    receipt: structuredClone(receipt),
  };
}

function transportFailure(
  runtimeSessionId: string,
  instructionId: string,
  error: Error,
): Extract<RuntimeInstructionDispatchFailure, { status: "transport_failed" }> {
  return {
    status: "transport_failed",
    runtimeSessionId,
    instructionId,
    error,
  };
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized !== value
  ) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `${field} must contain 1 to 256 characters without surrounding whitespace`,
    );
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4_000) {
    throw new RuntimeInstructionDispatcherError(
      "invalid_drain",
      `${field} must contain 1 to 4000 characters`,
    );
  }
  return normalized;
}

function sessionScope(ownerId: string, runtimeSessionId: string): string {
  return JSON.stringify([ownerId, runtimeSessionId]);
}
