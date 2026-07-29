import type {
  CreateAgentGoalInput,
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
  RuntimeRunEpochAdvanceResult,
  RuntimeSessionLifecycleControlPort,
  RuntimeSessionState,
  RuntimeTurnBoundary,
  RuntimeTurnTerminal,
} from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it } from "vitest";

import type { ReplaceGoalCommand } from "@/lib/ai/runtime-instructions/goal-replacement-coordinator";
import { createInMemoryAgentGoalRuntime } from "@/lib/ai/runtime-instructions/runtime";
import {
  DeterministicRuntimeIds,
  FixedRuntimeClock,
} from "../../helpers/goal-runtime";

const OWNER_ID = "replacement-coordinator-owner";
const SESSION_ID = "replacement-coordinator-session";
const NOW = new Date("2026-07-29T10:00:00.000Z");

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface TerminalWaiter {
  expectedRunEpoch: number;
  afterTerminalSequence: number;
  deferred: Deferred<RuntimeTurnTerminal>;
}

type ControlOutcome = "queued" | "rejected";

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ControlledLifecycleTransport implements RuntimeSessionLifecycleControlPort {
  readonly delivered: RuntimeInstruction[] = [];
  readonly waitRequests: Array<{
    expectedRunEpoch: number;
    afterTerminalSequence: number;
  }> = [];
  readonly epochAdvances: Array<{
    expectedRunEpoch: number;
    nextRunEpoch: number;
  }> = [];
  readonly terminalWaitStarted = deferred<void>();

  runEpoch = 0;
  state: RuntimeSessionState = "running";
  controlAttempts = 0;
  providerInterrupts = 0;
  directInterrupts = 0;

  private terminalSequence = 0;
  private readonly terminalHistory: RuntimeTurnTerminal[] = [];
  private readonly terminalWaiters = new Set<TerminalWaiter>();
  private readonly pendingInputs: Array<{ id: string; runEpoch: number }> = [];
  private readonly controlOutcomes: ControlOutcome[] = [];

  constructor(readonly runtimeSessionId: string) {}

  enqueuePending(id: string, runEpoch = this.runEpoch): void {
    this.pendingInputs.push({ id, runEpoch });
  }

  pendingIds(): string[] {
    return this.pendingInputs.map(({ id }) => id);
  }

  rejectNextControl(): void {
    this.controlOutcomes.push("rejected");
  }

  async deliver(
    instruction: RuntimeInstruction,
  ): Promise<RuntimeDeliveryReceipt> {
    this.delivered.push(structuredClone(instruction));
    if (instruction.kind === "control.interrupt") {
      this.controlAttempts++;
      const outcome = this.controlOutcomes.shift() ?? "queued";
      if (outcome === "rejected") {
        return receipt(instruction, "rejected", "provider rejected interrupt");
      }
      this.providerInterrupts++;
    }
    return receipt(instruction, "queued");
  }

  async interrupt(): Promise<void> {
    this.directInterrupts++;
  }

  captureTurnBoundary(): RuntimeTurnBoundary {
    const boundary = {
      runtimeSessionId: this.runtimeSessionId,
      runEpoch: this.runEpoch,
      terminalSequence: this.terminalSequence,
      state: this.state,
    } satisfies RuntimeTurnBoundary;
    return boundary;
  }

  captureTurnBoundaryAndHoldPendingInput(expectedRunEpoch: number) {
    if (expectedRunEpoch !== this.runEpoch) {
      throw new Error(`Cannot hold stale runEpoch ${expectedRunEpoch}`);
    }
    const hold = {
      runEpoch: expectedRunEpoch,
      release() {},
    };
    const boundary = this.captureTurnBoundary();
    return { boundary, hold };
  }

  waitForTurnTerminal(input: {
    expectedRunEpoch: number;
    afterTerminalSequence: number;
  }): Promise<RuntimeTurnTerminal> {
    this.waitRequests.push({ ...input });
    this.terminalWaitStarted.resolve();
    const observed = this.terminalHistory.find(
      (terminal) =>
        terminal.runEpoch === input.expectedRunEpoch &&
        terminal.terminalSequence > input.afterTerminalSequence,
    );
    if (observed) return Promise.resolve(structuredClone(observed));

    const waiter: TerminalWaiter = {
      ...input,
      deferred: deferred<RuntimeTurnTerminal>(),
    };
    this.terminalWaiters.add(waiter);
    return waiter.deferred.promise;
  }

  advanceRunEpoch(input: {
    expectedRunEpoch: number;
    nextRunEpoch: number;
  }): RuntimeRunEpochAdvanceResult {
    if (
      input.expectedRunEpoch !== this.runEpoch ||
      input.nextRunEpoch !== this.runEpoch + 1
    ) {
      throw new Error(
        `Invalid epoch advance ${input.expectedRunEpoch} -> ${input.nextRunEpoch}`,
      );
    }
    this.epochAdvances.push({ ...input });
    const discardedInputIds = this.pendingInputs
      .filter(({ runEpoch }) => runEpoch === input.expectedRunEpoch)
      .map(({ id }) => id);
    for (let index = this.pendingInputs.length - 1; index >= 0; index--) {
      if (this.pendingInputs[index]?.runEpoch === input.expectedRunEpoch) {
        this.pendingInputs.splice(index, 1);
      }
    }
    const previousRunEpoch = this.runEpoch;
    this.runEpoch = input.nextRunEpoch;
    this.state = "idle";
    return {
      previousRunEpoch,
      runEpoch: this.runEpoch,
      discardedInputIds,
    };
  }

  emitTerminal(runEpoch = this.runEpoch): RuntimeTurnTerminal {
    this.state = "idle";
    const terminal = {
      runtimeSessionId: this.runtimeSessionId,
      runEpoch,
      terminalSequence: ++this.terminalSequence,
      state: "idle",
    } satisfies RuntimeTurnTerminal;
    this.terminalHistory.push(terminal);
    for (const waiter of [...this.terminalWaiters]) {
      if (
        waiter.expectedRunEpoch === terminal.runEpoch &&
        waiter.afterTerminalSequence < terminal.terminalSequence
      ) {
        this.terminalWaiters.delete(waiter);
        waiter.deferred.resolve(structuredClone(terminal));
      }
    }
    return terminal;
  }

  failTerminal(error: unknown): void {
    for (const waiter of this.terminalWaiters) {
      waiter.deferred.reject(error);
    }
    this.terminalWaiters.clear();
  }
}

function receipt(
  instruction: RuntimeInstruction,
  state: "queued" | "rejected",
  reason?: string,
): RuntimeDeliveryReceipt {
  return {
    instructionId: instruction.id,
    runtimeSessionId: instruction.targetSessionId,
    state,
    recordedAt: NOW.toISOString(),
    ...(reason === undefined ? {} : { reason }),
  };
}

function goalInput(
  objective: string,
  overrides: Partial<CreateAgentGoalInput> = {},
): CreateAgentGoalInput {
  return {
    objective,
    successCriteria: [
      {
        id: "replacement-finished",
        description: "The replacement Goal is activated safely",
        verification: { type: "manual" },
        required: true,
      },
    ],
    constraints: [],
    contextRefs: [],
    priority: 80,
    maxTurns: 8,
    completionPolicy: "manual",
    source: { type: "user" },
    ...overrides,
  };
}

function createHarness() {
  const runtime = createInMemoryAgentGoalRuntime({
    clock: new FixedRuntimeClock(NOW),
    idGenerator: new DeterministicRuntimeIds("40000000"),
  });
  const transport = new ControlledLifecycleTransport(SESSION_ID);
  let registration = runtime.sessions.register({
    ownerId: OWNER_ID,
    transport,
  });

  return {
    runtime,
    transport,
    release() {
      registration.release();
    },
    register(candidate = transport) {
      registration = runtime.sessions.register({
        ownerId: OWNER_ID,
        transport: candidate,
      });
      return registration;
    },
  };
}

async function activateOriginal(
  harness: ReturnType<typeof createHarness>,
  idempotencyKey = "activate-original",
) {
  return harness.runtime.goals.activate({
    ownerId: OWNER_ID,
    runtimeSessionId: SESSION_ID,
    idempotencyKey,
    source: userSource(),
    goal: goalInput("Complete the original Goal"),
  });
}

function replacementCommand(
  goalId: string,
  overrides: Partial<ReplaceGoalCommand> = {},
): ReplaceGoalCommand {
  return {
    ownerId: OWNER_ID,
    runtimeSessionId: SESSION_ID,
    goalId,
    expectedRevision: 1,
    idempotencyKey: "replace-original",
    source: userSource(),
    reason: "A higher-priority Goal supersedes the current work",
    replacement: goalInput("Complete the replacement Goal"),
    ...overrides,
  };
}

function userSource() {
  return { type: "user", authority: "user" } as const;
}

async function expectNotSettled(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe("GoalReplacementCoordinator", () => {
  it("waits for the captured terminal boundary before advancing the epoch and activating the reserved Goal", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);
    const command = replacementCommand(activated.goal.goal.id);
    harness.transport.enqueuePending("old-context-inform");

    const replacing = harness.runtime.replacements.replace(command);
    await harness.transport.terminalWaitStarted.promise;

    await expectNotSettled(replacing);
    expect(harness.transport.runEpoch).toBe(0);
    expect(harness.transport.epochAdvances).toEqual([]);
    expect(harness.transport.pendingIds()).toEqual(["old-context-inform"]);
    const beforeTerminal = await harness.runtime.state.listInstructions(
      OWNER_ID,
      SESSION_ID,
    );
    expect(beforeTerminal.map(({ kind }) => kind)).toEqual([
      "goal.activate",
      "control.interrupt",
    ]);
    const control = beforeTerminal[1];
    expect(control).toMatchObject({
      sequence: 2,
      goalId: activated.goal.goal.id,
      goalRevision: 2,
      kind: "control.interrupt",
      payload: {
        expectedRunEpoch: 0,
        replacementGoalId: expect.any(String),
      },
    });
    if (control?.kind !== "control.interrupt") {
      throw new Error("Expected a replacement control instruction");
    }
    await expect(
      harness.runtime.state.getGoal(
        OWNER_ID,
        control.payload.replacementGoalId as string,
      ),
    ).resolves.toBeNull();

    const terminal = harness.transport.emitTerminal(0);
    const result = await replacing;

    expect(result).toMatchObject({
      replacement: {
        phase: "activated",
        expectedRunEpoch: 0,
        runEpoch: 1,
      },
      terminal,
      discardedInputIds: ["old-context-inform"],
      controlDispatch: { status: "accepted" },
      activationDispatch: { status: "accepted" },
    });
    expect(harness.transport.runEpoch).toBe(1);
    expect(harness.transport.epochAdvances).toEqual([
      { expectedRunEpoch: 0, nextRunEpoch: 1 },
    ]);
    expect(harness.transport.pendingIds()).toEqual([]);
    expect(harness.transport.providerInterrupts).toBe(1);
    expect(harness.transport.directInterrupts).toBe(0);

    const outbox = await harness.runtime.state.listInstructions(
      OWNER_ID,
      SESSION_ID,
    );
    expect(outbox.map(({ sequence, kind }) => ({ sequence, kind }))).toEqual([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "control.interrupt" },
      { sequence: 3, kind: "goal.activate" },
    ]);
    expect(outbox[2]).toMatchObject({
      goalId: control.payload.replacementGoalId,
      goalRevision: 1,
    });
    await expect(
      harness.runtime.goals.getActivePrimaryGoal(OWNER_ID, SESSION_ID),
    ).resolves.toEqual(result.replacement.replacementGoal);
  });

  it("keeps a rejected interrupt prepared and resumes the same replacement on an idempotent retry", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);
    const command = replacementCommand(activated.goal.goal.id);
    harness.transport.rejectNextControl();

    const rejected = await harness.runtime.replacements.replace(command);

    expect(rejected).toMatchObject({
      replacement: { phase: "prepared" },
      deduplicated: false,
      controlDispatch: {
        status: "rejected",
        receipt: { reason: "provider rejected interrupt" },
      },
    });
    expect(rejected.activationDispatch).toBeUndefined();
    expect(harness.transport.runEpoch).toBe(0);
    expect(harness.transport.epochAdvances).toEqual([]);
    await expect(
      harness.runtime.state.getGoal(
        OWNER_ID,
        rejected.replacement.replacementGoal.goal.id,
      ),
    ).resolves.toBeNull();

    const retrying = harness.runtime.replacements.replace(command);
    await harness.transport.terminalWaitStarted.promise;
    harness.transport.emitTerminal(0);
    const retried = await retrying;

    expect(retried.replacement.phase).toBe("activated");
    expect(retried.deduplicated).toBe(true);
    expect(retried.replacement.replacementGoal.goal.id).toBe(
      rejected.replacement.replacementGoal.goal.id,
    );
    expect(retried.replacement.controlInstruction.id).toBe(
      rejected.replacement.controlInstruction.id,
    );
    expect(harness.transport.controlAttempts).toBe(2);
    expect(harness.transport.providerInterrupts).toBe(1);
  });

  it("rejects replacement constraints that exceed the command authority", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);

    await expect(
      harness.runtime.replacements.replace(
        replacementCommand(activated.goal.goal.id, {
          replacement: goalInput("Unauthorized policy replacement", {
            constraints: [
              {
                id: "organization-only",
                description: "Pretend to be an organization policy",
                enforcement: "model_guidance",
                authority: "organization_policy",
                sourceRef: "policy:privacy",
              },
            ],
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_authority" });
    await expect(
      harness.runtime.state.listInstructions(OWNER_ID, SESSION_ID),
    ).resolves.toHaveLength(1);
  });

  it("returns stable IDs for an activated-command retry without interrupting or advancing the runtime again", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);
    const command = replacementCommand(activated.goal.goal.id);
    const replacing = harness.runtime.replacements.replace(command);
    await harness.transport.terminalWaitStarted.promise;
    harness.transport.emitTerminal(0);
    const first = await replacing;
    const deliveredBeforeRetry = structuredClone(harness.transport.delivered);

    const retry = await harness.runtime.replacements.replace(command);

    expect(retry.deduplicated).toBe(true);
    expect(retry.replacement).toEqual(first.replacement);
    expect(retry.replacement.controlInstruction.id).toBe(
      first.replacement.controlInstruction.id,
    );
    expect(retry.replacement.activationInstruction?.id).toBe(
      first.replacement.activationInstruction?.id,
    );
    expect(harness.transport.delivered).toEqual(deliveredBeforeRetry);
    expect(harness.transport.providerInterrupts).toBe(1);
    expect(harness.transport.epochAdvances).toHaveLength(1);
  });

  it("fails closed when the registered transport changes while waiting for the old terminal", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);
    const replacing = harness.runtime.replacements.replace(
      replacementCommand(activated.goal.goal.id),
    );
    await harness.transport.terminalWaitStarted.promise;

    harness.release();
    const replacementTransport = new ControlledLifecycleTransport(SESSION_ID);
    harness.register(replacementTransport);
    harness.transport.emitTerminal(0);

    await expect(replacing).rejects.toMatchObject({ code: "runtime_changed" });
    expect(harness.transport.runEpoch).toBe(0);
    expect(replacementTransport.runEpoch).toBe(0);
    expect(replacementTransport.delivered).toEqual([]);
    const outbox = await harness.runtime.state.listInstructions(
      OWNER_ID,
      SESSION_ID,
    );
    expect(outbox.map(({ kind }) => kind)).toEqual([
      "goal.activate",
      "control.interrupt",
    ]);
    const control = outbox[1];
    if (control?.kind !== "control.interrupt") {
      throw new Error("Expected a replacement control instruction");
    }
    await expect(
      harness.runtime.state.getGoal(
        OWNER_ID,
        control.payload.replacementGoalId as string,
      ),
    ).resolves.toBeNull();
  });

  it("fails closed when terminal observation fails", async () => {
    const harness = createHarness();
    const activated = await activateOriginal(harness);
    const replacing = harness.runtime.replacements.replace(
      replacementCommand(activated.goal.goal.id),
    );
    await harness.transport.terminalWaitStarted.promise;

    harness.transport.failTerminal(new Error("terminal stream closed"));

    await expect(replacing).rejects.toThrow("terminal stream closed");
    expect(harness.transport.runEpoch).toBe(0);
    expect(harness.transport.epochAdvances).toEqual([]);
    const outbox = await harness.runtime.state.listInstructions(
      OWNER_ID,
      SESSION_ID,
    );
    expect(outbox.map(({ kind }) => kind)).toEqual([
      "goal.activate",
      "control.interrupt",
    ]);
    const control = outbox[1];
    if (control?.kind !== "control.interrupt") {
      throw new Error("Expected a replacement control instruction");
    }
    await expect(
      harness.runtime.state.getGoal(
        OWNER_ID,
        control.payload.replacementGoalId as string,
      ),
    ).resolves.toBeNull();
  });
});
