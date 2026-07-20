import {
  RuntimeInstructionSchema,
  formatRuntimeInstruction,
} from "../runtime-instructions";
import type { RuntimeInstructionTransportPort } from "../runtime-instructions/ports";
import type {
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
} from "../runtime-instructions/types";
import type { AgentSupplementalInput } from "../types";
import {
  type AgentSupplementalInputQueue,
  AgentSupplementalInputQueueError,
} from "./queue";

export type SupplementalInputRuntimeTransportErrorCode =
  | "invalid_run_epoch"
  | "interrupt_unavailable"
  | "interrupt_failed";

export class SupplementalInputRuntimeTransportError extends Error {
  constructor(
    public readonly code: SupplementalInputRuntimeTransportErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SupplementalInputRuntimeTransportError";
  }
}

/**
 * Adapts validated OpenLoomi Runtime Instructions to a live agent input queue.
 *
 * The transport reports `queued`, not `written_to_sdk`: resolving an async
 * iterator waiter is still an in-process handoff. Provider event correlation
 * will advance the durable delivery state in the later event/evidence layer.
 */
export class SupplementalInputRuntimeInstructionTransport implements RuntimeInstructionTransportPort {
  readonly runtimeSessionId: string;

  private readonly queue: AgentSupplementalInputQueue;
  private readonly now: () => Date;
  private readonly acceptedInstructionIdentities = new Map<string, string>();

  constructor(input: {
    runtimeSessionId: string;
    runEpoch: number;
    queue: AgentSupplementalInputQueue;
    now?: () => Date;
  }) {
    if (!Number.isInteger(input.runEpoch) || input.runEpoch < 0) {
      throw new SupplementalInputRuntimeTransportError(
        "invalid_run_epoch",
        "Runtime transport runEpoch must be a non-negative integer",
      );
    }
    if (input.queue.getRunEpoch() !== input.runEpoch) {
      throw new SupplementalInputRuntimeTransportError(
        "invalid_run_epoch",
        `Input queue runEpoch ${input.queue.getRunEpoch()} does not match transport runEpoch ${input.runEpoch}`,
      );
    }
    this.runtimeSessionId = input.runtimeSessionId;
    this.queue = input.queue;
    this.now = input.now ?? (() => new Date());
  }

  async deliver(
    candidate: RuntimeInstruction,
  ): Promise<RuntimeDeliveryReceipt> {
    const parsed = RuntimeInstructionSchema.safeParse(candidate);
    if (!parsed.success) {
      return this.rejected(
        instructionIdFrom(candidate),
        `Invalid Runtime Instruction: ${parsed.error.issues[0]?.message ?? "unknown validation error"}`,
      );
    }

    const instruction = parsed.data;
    if (instruction.targetSessionId !== this.runtimeSessionId) {
      return this.rejected(
        instruction.id,
        `Instruction targets Runtime Session ${instruction.targetSessionId}, not ${this.runtimeSessionId}`,
      );
    }
    if (
      instruction.expiresAt !== undefined &&
      Date.parse(instruction.expiresAt) <= this.now().getTime()
    ) {
      return this.rejected(instruction.id, "Runtime Instruction has expired");
    }

    const identity = instructionRevisionIdentity(instruction);
    const acceptedIdentity = this.acceptedInstructionIdentities.get(
      instruction.id,
    );
    if (acceptedIdentity !== undefined && acceptedIdentity !== identity) {
      return this.rejected(
        instruction.id,
        "Instruction ID was already accepted for a different Goal revision",
      );
    }

    try {
      const result = await this.queue.enqueue({
        id: instruction.id,
        content: formatRuntimeInstruction(instruction),
        createdAt: instruction.issuedAt,
        runEpoch: this.queue.getRunEpoch(),
        intent:
          instruction.deliveryMode === "next_boundary" ? "inform" : "steer",
      });

      if (result.status === "duplicate") {
        this.acceptedInstructionIdentities.set(instruction.id, identity);
        return this.queued(instruction.id, "Instruction was already queued");
      }
      this.acceptedInstructionIdentities.set(instruction.id, identity);
      if (result.interrupt.status === "unavailable") {
        return this.queued(
          instruction.id,
          "Interrupt handler is unavailable; instruction remains accepted for SDK delivery",
        );
      }
      if (result.interrupt.status === "failed") {
        return this.queued(
          instruction.id,
          `Provider interrupt failed; instruction remains accepted for SDK delivery: ${result.interrupt.error.message}`,
        );
      }
      return this.queued(instruction.id);
    } catch (error) {
      const reason =
        error instanceof AgentSupplementalInputQueueError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      return this.rejected(instruction.id, reason);
    }
  }

  async interrupt(input: {
    reason: string;
    expectedRunEpoch: number;
  }): Promise<void> {
    const activeRunEpoch = this.queue.getRunEpoch();
    if (input.expectedRunEpoch !== activeRunEpoch) {
      throw new SupplementalInputRuntimeTransportError(
        "invalid_run_epoch",
        `Expected run epoch ${input.expectedRunEpoch}, active epoch is ${activeRunEpoch}`,
      );
    }

    const result = await this.queue.interrupt();
    if (result.status === "completed") return;
    if (result.status === "failed") {
      throw new SupplementalInputRuntimeTransportError(
        "interrupt_failed",
        `Provider interrupt failed: ${result.error.message}`,
        result.error,
      );
    }
    throw new SupplementalInputRuntimeTransportError(
      "interrupt_unavailable",
      `Provider interrupt is unavailable: ${input.reason}`,
    );
  }

  advanceRunEpoch(nextRunEpoch: number): AgentSupplementalInput[] {
    const activeRunEpoch = this.queue.getRunEpoch();
    if (!Number.isInteger(nextRunEpoch) || nextRunEpoch <= activeRunEpoch) {
      throw new SupplementalInputRuntimeTransportError(
        "invalid_run_epoch",
        `nextRunEpoch must be greater than active run epoch ${activeRunEpoch}`,
      );
    }
    return this.queue.advanceRunEpoch(nextRunEpoch);
  }

  private queued(
    instructionId: string,
    reason?: string,
  ): RuntimeDeliveryReceipt {
    return {
      instructionId,
      runtimeSessionId: this.runtimeSessionId,
      state: "queued",
      recordedAt: this.now().toISOString(),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  private rejected(
    instructionId: string,
    reason: string,
  ): RuntimeDeliveryReceipt {
    return {
      instructionId,
      runtimeSessionId: this.runtimeSessionId,
      state: "rejected",
      recordedAt: this.now().toISOString(),
      reason,
    };
  }
}

function instructionIdFrom(candidate: unknown): string {
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "id" in candidate &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0
  ) {
    return candidate.id;
  }
  return "invalid-runtime-instruction";
}

function instructionRevisionIdentity(instruction: RuntimeInstruction): string {
  return [
    instruction.goalId ?? "no-goal",
    instruction.goalRevision?.toString() ?? "no-revision",
  ].join(":");
}
