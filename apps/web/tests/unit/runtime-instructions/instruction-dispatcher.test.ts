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
  "20000000-0000-4000-8000-000000000004",
] as const;
const GOAL_ID = "30000000-0000-4000-8000-000000000001";

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

function lifecycleInstruction(
  sequence: number,
  kind: "goal.pause" | "goal.cancel" | "goal.resume",
): RuntimeInstruction {
  return RuntimeInstructionSchema.parse({
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: INSTRUCTION_IDS[sequence - 1],
    sequence,
    kind,
    goalId: GOAL_ID,
    goalRevision: sequence,
    deliveryMode:
      kind === "goal.resume" ? "steer" : ("interrupt_replace" as const),
    targetSessionId: SESSION_ID,
    payload:
      kind === "goal.resume"
        ? {}
        : { expectedRunEpoch: 0, reason: `${kind} test` },
    source: { type: "user", authority: "user" },
    idempotencyKey: `dispatcher-${kind}-${sequence}`,
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

describe("RuntimeInstructionDispatcher control barriers", () => {
  it("preserves pause predecessors and later drains them without redelivering the pause", async () => {
    const instructions = [
      instruction(1),
      lifecycleInstruction(2, "goal.pause"),
    ];
    const transport = new ScriptedTransport(SESSION_ID);
    const dispatcher = registeredDispatcher(transport, instructions);

    await dispatcher.deliverControl({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[1].id,
    });
    await expect(
      dispatcher.commitControlBarrier({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[1].id,
        transport,
        predecessorPolicy: "preserve_predecessors",
        reason: "Pause retains pending work",
      }),
    ).resolves.toEqual([]);

    instructions.push(lifecycleInstruction(3, "goal.resume"));
    await expect(
      dispatcher.drainOnTransport({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[2].id,
        transport,
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      instructionId: instructions[2].id,
    });
    expect(transport.delivered.map(({ id }) => id)).toEqual([
      instructions[1].id,
      instructions[0].id,
      instructions[2].id,
    ]);
  });

  it("supersedes cancel predecessors while allowing later instructions to drain", async () => {
    const instructions = [
      instruction(1),
      lifecycleInstruction(2, "goal.cancel"),
    ];
    const transport = new ScriptedTransport(SESSION_ID);
    const dispatcher = registeredDispatcher(transport, instructions);

    await dispatcher.deliverControl({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[1].id,
    });
    await expect(
      dispatcher.commitControlBarrier({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[1].id,
        transport,
        predecessorPolicy: "supersede_predecessors",
        reason: "Cancel fences pending work",
      }),
    ).resolves.toEqual([instructions[0].id]);

    instructions.push(instruction(3));
    await expect(
      dispatcher.drainOnTransport({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[2].id,
        transport,
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      instructionId: instructions[2].id,
    });
    await expect(
      dispatcher.drain({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        targetInstructionId: instructions[0].id,
      }),
    ).resolves.toMatchObject({
      status: "superseded",
      instructionId: instructions[0].id,
    });
    expect(transport.delivered.map(({ id }) => id)).toEqual([
      instructions[1].id,
      instructions[2].id,
    ]);
  });

  it("fails a serialized drain when the registered transport changes during its outbox read", async () => {
    const instructions = outbox(1);
    const sessions = new RuntimeSessionRegistry();
    const first = new ScriptedTransport(SESSION_ID);
    const firstRegistration = sessions.register({
      ownerId: OWNER_ID,
      transport: first,
    });
    let continueRead!: () => void;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readCanContinue = new Promise<void>((resolve) => {
      continueRead = resolve;
    });
    const dispatcher = new RuntimeInstructionDispatcher(sessions, {
      async listInstructions() {
        markReadStarted();
        await readCanContinue;
        return structuredClone(instructions);
      },
    });

    const drain = dispatcher.drainOnTransport({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      targetInstructionId: instructions[0].id,
      transport: first,
    });
    await readStarted;
    firstRegistration.release();
    const replacement = new ScriptedTransport(SESSION_ID);
    sessions.register({ ownerId: OWNER_ID, transport: replacement });
    continueRead();

    await expect(drain).rejects.toMatchObject({
      code: "outbox_progress_conflict",
      message: expect.stringContaining("changed before its outbox was drained"),
    });
    expect(first.delivered).toEqual([]);
    expect(replacement.delivered).toEqual([]);
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
