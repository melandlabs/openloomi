import {
  RuntimeInstructionSchema,
  canonicalJson,
  type RuntimeDeliveryReceipt,
  type RuntimeInstruction,
  type RuntimeInstructionTransportPort,
  type RuntimeSessionResolverPort,
} from "@openloomi/ai/agent/runtime-instructions";

import { KeyedSerialExecutor } from "./keyed-serial-executor";

export interface RuntimeInstructionDrainInput {
  ownerId: string;
  runtimeSessionId: string;
  /** The command whose caller is waiting for a delivery result. */
  targetInstructionId: string;
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

interface TransportProgress {
  acceptedThroughSequence: number;
  acceptedBySequence: Map<number, AcceptedInstruction>;
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
  ): Promise<RuntimeInstructionDispatch> {
    let transport: RuntimeInstructionTransportPort | null;
    try {
      transport = await this.sessions.resolve(
        input.ownerId,
        input.runtimeSessionId,
      );
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
    if (transport.runtimeSessionId !== input.runtimeSessionId) {
      return transportFailure(
        input.runtimeSessionId,
        input.target.id,
        new Error(
          "Runtime resolver returned a transport for a different session",
        ),
      );
    }

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
      };
      transportProgress.set(scope, progress);
    } else {
      assertCompatibleProgress(progress, input.instructions);
    }

    for (const instruction of input.instructions) {
      if (instruction.sequence <= progress.acceptedThroughSequence) continue;
      if (instruction.sequence !== progress.acceptedThroughSequence + 1) {
        throw new RuntimeInstructionDispatcherError(
          "outbox_progress_conflict",
          `Cannot deliver sequence ${instruction.sequence} after accepted sequence ${progress.acceptedThroughSequence}`,
        );
      }

      const result = await this.deliverOne(transport, instruction);
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
    if (!target || target.instructionId !== input.target.id) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_progress_conflict",
        `Target instruction ${input.target.id} was not reached by the contiguous outbox drain`,
      );
    }
    return accepted(target.receipt);
  }

  private async deliverOne(
    transport: RuntimeInstructionTransportPort,
    instruction: RuntimeInstruction,
  ): Promise<
    | Extract<RuntimeInstructionDispatch, { status: "accepted" }>
    | RuntimeInstructionDispatchFailure
  > {
    try {
      const receipt = validateReceipt(
        await transport.deliver(instruction),
        instruction,
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
    const suppliedInstruction = instructions[sequence - 1];
    if (
      !acceptedInstruction ||
      acceptedInstruction.instructionId !== suppliedInstruction.id ||
      canonicalJson(acceptedInstruction.instruction) !==
        canonicalJson(suppliedInstruction)
    ) {
      throw new RuntimeInstructionDispatcherError(
        "outbox_progress_conflict",
        `Outbox instruction at sequence ${sequence} differs from the instruction already accepted by this transport`,
      );
    }
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

function sessionScope(ownerId: string, runtimeSessionId: string): string {
  return JSON.stringify([ownerId, runtimeSessionId]);
}
