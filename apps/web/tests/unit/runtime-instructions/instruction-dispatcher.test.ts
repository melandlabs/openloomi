import {
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  RuntimeInstructionSchema,
  type RuntimeDeliveryReceipt,
  type RuntimeInstruction,
  type RuntimeInstructionTransportPort,
} from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it } from "vitest";

import { RuntimeInstructionDispatcher } from "@/lib/ai/runtime-instructions/instruction-dispatcher";
import { RuntimeSessionRegistry } from "@/lib/ai/runtime-instructions/runtime-session-registry";

const OWNER_ID = "dispatcher-owner";
const SESSION_ID = "claude-runtime-session_nanoid";
const NOW = "2026-07-26T10:00:00.000Z";
const INSTRUCTION_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
] as const;

type DeliveryBehavior = (
  instruction: RuntimeInstruction,
) => RuntimeDeliveryReceipt | Promise<RuntimeDeliveryReceipt>;

class ScriptedTransport implements RuntimeInstructionTransportPort {
  readonly delivered: RuntimeInstruction[] = [];

  constructor(
    readonly runtimeSessionId: string,
    private readonly behavior: DeliveryBehavior = queuedReceipt,
  ) {}

  async deliver(
    instruction: RuntimeInstruction,
  ): Promise<RuntimeDeliveryReceipt> {
    this.delivered.push(structuredClone(instruction));
    return this.behavior(instruction);
  }

  async interrupt(): Promise<void> {}
}

function instruction(sequence: number): RuntimeInstruction {
  return RuntimeInstructionSchema.parse({
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: INSTRUCTION_IDS[sequence - 1],
    sequence,
    kind: "context.remove",
    deliveryMode: "next_boundary",
    targetSessionId: SESSION_ID,
    payload: { contextRefId: `context-${sequence}` },
    source: { type: "user", authority: "user" },
    idempotencyKey: `dispatcher-instruction-${sequence}`,
    issuedAt: NOW,
  });
}

function outbox(length = 2): RuntimeInstruction[] {
  return Array.from({ length }, (_, index) => instruction(index + 1));
}

function queuedReceipt(
  runtimeInstruction: RuntimeInstruction,
): RuntimeDeliveryReceipt {
  return {
    instructionId: runtimeInstruction.id,
    runtimeSessionId: runtimeInstruction.targetSessionId,
    state: "queued",
    recordedAt: NOW,
  };
}

describe("RuntimeInstructionDispatcher ordered outbox drain", () => {
  it("keeps an unavailable predecessor pending, then replays in order for each replacement transport", async () => {
    const sessions = new RuntimeSessionRegistry();
    const instructions = outbox();
    const dispatcher = new RuntimeInstructionDispatcher(
      sessions,
      fixedOutbox(instructions),
    );

    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      runtimeSessionId: SESSION_ID,
      instructionId: instructions[0].id,
    });

    const first = new ScriptedTransport(SESSION_ID);
    const firstRegistration = sessions.register({
      ownerId: OWNER_ID,
      transport: first,
    });
    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      instructionId: instructions[0].id,
    });
    expect(first.delivered.map(({ id }) => id)).toEqual(
      instructions.map(({ id }) => id),
    );

    // The exact same transport remembers its contiguous accepted prefix.
    await dispatcher.drain({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[1].id,
    });
    expect(first.delivered).toHaveLength(2);

    firstRegistration.release();
    const replacement = new ScriptedTransport(SESSION_ID);
    sessions.register({ ownerId: OWNER_ID, transport: replacement });
    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      instructionId: instructions[0].id,
    });
    expect(replacement.delivered.map(({ id }) => id)).toEqual(
      instructions.map(({ id }) => id),
    );
  });

  it("defers the target when a predecessor is rejected", async () => {
    const instructions = outbox();
    const transport = new ScriptedTransport(SESSION_ID, (item) => ({
      ...queuedReceipt(item),
      state: "rejected",
      reason: "provider rejected the instruction",
    }));
    const dispatcher = registeredDispatcher(transport, instructions);

    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[1].id,
      }),
    ).resolves.toMatchObject({
      status: "deferred",
      instructionId: instructions[1].id,
      blockedByInstructionId: instructions[0].id,
      failure: {
        status: "rejected",
        instructionId: instructions[0].id,
      },
    });
    expect(transport.delivered.map(({ id }) => id)).toEqual([
      instructions[0].id,
    ]);
  });

  it("defers the target when a predecessor delivery throws", async () => {
    const instructions = outbox();
    const transport = new ScriptedTransport(SESSION_ID, async () => {
      throw new Error("provider unavailable");
    });
    const dispatcher = registeredDispatcher(transport, instructions);

    const result = await dispatcher.drain({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[1].id,
    });
    expect(result).toMatchObject({
      status: "deferred",
      instructionId: instructions[1].id,
      blockedByInstructionId: instructions[0].id,
      failure: {
        status: "transport_failed",
        instructionId: instructions[0].id,
        error: expect.objectContaining({ message: "provider unavailable" }),
      },
    });
    expect(transport.delivered.map(({ id }) => id)).toEqual([
      instructions[0].id,
    ]);
  });

  it("defers the target when a predecessor returns a mismatched receipt", async () => {
    const instructions = outbox();
    const transport = new ScriptedTransport(SESSION_ID, (item) => ({
      ...queuedReceipt(item),
      instructionId: INSTRUCTION_IDS[2],
    }));
    const dispatcher = registeredDispatcher(transport, instructions);

    const result = await dispatcher.drain({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[1].id,
    });
    expect(result).toMatchObject({
      status: "deferred",
      instructionId: instructions[1].id,
      blockedByInstructionId: instructions[0].id,
      failure: {
        status: "transport_failed",
        instructionId: instructions[0].id,
        error: expect.objectContaining({
          message: expect.stringContaining("different instruction or session"),
        }),
      },
    });
    expect(transport.delivered.map(({ id }) => id)).toEqual([
      instructions[0].id,
    ]);
  });

  it("returns the failure directly when the failed instruction is the target", async () => {
    const instructions = outbox();
    const transport = new ScriptedTransport(SESSION_ID, (item) => ({
      ...queuedReceipt(item),
      state: "rejected",
      reason: "invalid instruction",
    }));
    const dispatcher = registeredDispatcher(transport, instructions);

    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      instructionId: instructions[0].id,
    });
    expect(transport.delivered).toHaveLength(1);
  });

  it("reports resolver failures without losing the target identity", async () => {
    const instructions = outbox(1);
    const dispatcher = new RuntimeInstructionDispatcher(
      {
        async resolve() {
          throw new Error("registry unavailable");
        },
      },
      fixedOutbox(instructions),
    );

    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toMatchObject({
      status: "transport_failed",
      runtimeSessionId: SESSION_ID,
      instructionId: instructions[0].id,
      error: expect.objectContaining({ message: "registry unavailable" }),
    });
  });

  it("fails closed when the authoritative outbox cannot be read", async () => {
    const instructions = outbox(1);
    const dispatcher = new RuntimeInstructionDispatcher(
      new RuntimeSessionRegistry(),
      {
        async listInstructions() {
          throw new Error("state unavailable");
        },
      },
    );

    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).rejects.toMatchObject({
      code: "outbox_read_failed",
      cause: expect.objectContaining({ message: "state unavailable" }),
    });
  });
});

function registeredDispatcher(
  transport: RuntimeInstructionTransportPort,
  instructions: RuntimeInstruction[],
): RuntimeInstructionDispatcher {
  const sessions = new RuntimeSessionRegistry();
  sessions.register({ ownerId: OWNER_ID, transport });
  return new RuntimeInstructionDispatcher(sessions, fixedOutbox(instructions));
}

function fixedOutbox(instructions: RuntimeInstruction[]) {
  return {
    async listInstructions(ownerId: string, runtimeSessionId: string) {
      expect(ownerId).toBe(OWNER_ID);
      expect(runtimeSessionId).toBe(SESSION_ID);
      return structuredClone(instructions);
    },
  };
}
