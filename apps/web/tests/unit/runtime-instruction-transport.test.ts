import {
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  type RuntimeInstruction,
  RuntimeInstructionSchema,
} from "@openloomi/ai/agent/runtime-instructions";
import {
  AgentSupplementalInputQueue,
  SupplementalInputRuntimeInstructionTransport,
} from "@openloomi/ai/agent/supplemental-input";
import { describe, expect, it, vi } from "vitest";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const INSTRUCTION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-20T01:00:00.000Z");

function instruction(
  overrides: Partial<RuntimeInstruction> = {},
): RuntimeInstruction {
  return RuntimeInstructionSchema.parse({
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: INSTRUCTION_ID,
    sequence: 1,
    kind: "context.remove",
    deliveryMode: "next_boundary",
    targetSessionId: SESSION_ID,
    payload: { contextRefId: "jira-176" },
    source: { type: "user", authority: "user" },
    idempotencyKey: "context-remove-1",
    issuedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  });
}

function transport(queue: AgentSupplementalInputQueue, runEpoch = 4) {
  return new SupplementalInputRuntimeInstructionTransport({
    runtimeSessionId: SESSION_ID,
    runEpoch,
    queue,
    now: () => NOW,
  });
}

describe("SupplementalInputRuntimeInstructionTransport", () => {
  it("formats next-boundary instructions and holds them as inform input", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });
    const receipt = await transport(queue).deliver(instruction());

    expect(receipt).toEqual({
      instructionId: INSTRUCTION_ID,
      runtimeSessionId: SESSION_ID,
      state: "queued",
      recordedAt: NOW.toISOString(),
    });
    expect(queue.hasPending()).toBe(true);
    const [pending] = queue.takePendingInform();
    expect(pending).toMatchObject({
      id: INSTRUCTION_ID,
      intent: "inform",
      createdAt: "2026-07-20T00:00:00.000Z",
    });
    expect(pending?.content).toContain("<openloomi_runtime_instruction");
    expect(pending?.content).toContain('delivery_mode="next_boundary"');
  });

  it("maps steer and interrupt-replace delivery to immediate input", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });
    const interrupt = vi.fn(async () => {});
    queue.setInterruptHandler(interrupt);
    const runtimeTransport = transport(queue);
    const iterator = queue[Symbol.asyncIterator]();

    const steer = instruction({ deliveryMode: "steer" });
    const steerInput = iterator.next();
    await expect(runtimeTransport.deliver(steer)).resolves.toMatchObject({
      state: "queued",
    });
    await expect(steerInput).resolves.toMatchObject({
      value: { id: INSTRUCTION_ID, intent: "steer" },
    });

    const replacement = RuntimeInstructionSchema.parse({
      ...instruction(),
      id: "55555555-5555-4555-8555-555555555555",
      sequence: 2,
      kind: "control.interrupt",
      deliveryMode: "interrupt_replace",
      payload: { reason: "replace the active goal" },
      idempotencyKey: "interrupt-2",
    });
    const replacementInput = iterator.next();
    await expect(runtimeTransport.deliver(replacement)).resolves.toMatchObject({
      state: "queued",
    });
    await expect(replacementInput).resolves.toMatchObject({
      value: { id: replacement.id, intent: "steer" },
    });
    expect(interrupt).toHaveBeenCalledTimes(2);
    queue.close();
  });

  it("rejects wrong-session and expired instructions before queueing", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });
    const runtimeTransport = transport(queue);

    await expect(
      runtimeTransport.deliver(
        instruction({ targetSessionId: OTHER_SESSION_ID }),
      ),
    ).resolves.toMatchObject({
      state: "rejected",
      reason: expect.stringContaining("not"),
    });
    await expect(
      runtimeTransport.deliver(
        instruction({ expiresAt: "2026-07-20T00:30:00.000Z" }),
      ),
    ).resolves.toMatchObject({
      state: "rejected",
      reason: "Runtime Instruction has expired",
    });
    expect(queue.hasPending()).toBe(false);
  });

  it("returns a rejection receipt for malformed runtime input", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });

    await expect(
      transport(queue).deliver(null as unknown as RuntimeInstruction),
    ).resolves.toMatchObject({
      instructionId: "invalid-runtime-instruction",
      state: "rejected",
      reason: expect.stringContaining("Invalid Runtime Instruction"),
    });
    expect(queue.hasPending()).toBe(false);
  });

  it("returns an idempotent queued receipt for duplicate instructions", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });
    const runtimeTransport = transport(queue);

    await runtimeTransport.deliver(instruction());
    await expect(
      runtimeTransport.deliver(instruction()),
    ).resolves.toMatchObject({
      state: "queued",
      reason: "Instruction was already queued",
    });
    await expect(
      runtimeTransport.deliver(
        instruction({
          goalId: "11111111-1111-4111-8111-111111111111",
          goalRevision: 1,
        }),
      ),
    ).resolves.toMatchObject({
      state: "rejected",
      reason: expect.stringContaining("different Goal revision"),
    });
    expect(queue.size).toBe(1);
  });

  it("reports queue backpressure as a rejected delivery", async () => {
    const queue = new AgentSupplementalInputQueue({
      maxPendingInputs: 1,
      runEpoch: 4,
    });
    const runtimeTransport = transport(queue);
    await runtimeTransport.deliver(instruction());

    await expect(
      runtimeTransport.deliver(
        instruction({
          id: "66666666-6666-4666-8666-666666666666",
          sequence: 2,
          idempotencyKey: "context-remove-2",
        }),
      ),
    ).resolves.toMatchObject({
      state: "rejected",
      reason: expect.stringContaining("full:"),
    });
  });

  it("fences direct interrupts by run epoch and surfaces provider failures", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 4 });
    const runtimeTransport = transport(queue);

    await expect(
      runtimeTransport.interrupt({ reason: "stale", expectedRunEpoch: 3 }),
    ).rejects.toMatchObject({
      code: "invalid_run_epoch",
    });
    await expect(
      runtimeTransport.interrupt({
        reason: "no provider",
        expectedRunEpoch: 4,
      }),
    ).rejects.toMatchObject({
      code: "interrupt_unavailable",
    });

    queue.setInterruptHandler(() => {
      throw new Error("provider failed");
    });
    await expect(
      runtimeTransport.interrupt({ reason: "replace", expectedRunEpoch: 4 }),
    ).rejects.toMatchObject({
      code: "interrupt_failed",
      cause: expect.objectContaining({ message: "provider failed" }),
    });
  });
});
