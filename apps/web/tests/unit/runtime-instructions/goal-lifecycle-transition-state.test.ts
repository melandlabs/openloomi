import {
  type AgentGoal,
  type GoalCommandIdentity,
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  type RuntimeInstructionDraft,
  createAgentGoal,
  transitionAgentGoal,
} from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it } from "vitest";

import {
  InMemoryAgentGoalState,
  type InMemoryGoalStateError,
} from "@/lib/ai/runtime-instructions/in-memory-goal-state";

const OWNER_ID = "lifecycle-state-owner";
const SESSION_ID = "lifecycle-state-session";
const STARTED_AT = new Date("2026-07-29T08:00:00.000Z");
const TRANSITIONED_AT = new Date("2026-07-29T08:01:00.000Z");

function uuid(value: number): string {
  return `50000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function command(
  idempotencyKey: string,
  fingerprintCharacter: string,
): GoalCommandIdentity {
  return {
    idempotencyKey,
    requestFingerprint: fingerprintCharacter.repeat(64),
  };
}

function newGoal(id: string, objective: string, now: Date): AgentGoal {
  return createAgentGoal({
    id,
    now,
    input: {
      objective,
      successCriteria: [
        {
          id: "lifecycle-complete",
          description: "The lifecycle transition completes",
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
    },
  });
}

function activationDraft(
  goal: AgentGoal,
  id: string,
  idempotencyKey: string,
): RuntimeInstructionDraft {
  return {
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id,
    goalId: goal.id,
    goalRevision: goal.revision,
    kind: "goal.activate",
    deliveryMode: "steer",
    targetSessionId: SESSION_ID,
    payload: { goal },
    source: { type: "user", authority: "user" },
    idempotencyKey,
    issuedAt: goal.updatedAt,
  };
}

async function activeState() {
  const state = new InMemoryAgentGoalState();
  const goal = newGoal(uuid(1), "Original Goal", STARTED_AT);
  await state.commitActivation({
    ownerId: OWNER_ID,
    runtimeSessionId: SESSION_ID,
    goal,
    instruction: activationDraft(goal, uuid(2), "initial-activation"),
    command: command("initial-activation", "a"),
  });
  return { state, goal };
}

function cancelInput(goal: AgentGoal) {
  const cancelledGoal = transitionAgentGoal({
    current: goal,
    expectedRevision: goal.revision,
    status: "cancelled",
    now: TRANSITIONED_AT,
  });
  const idempotencyKey = "cancel-primary";
  return {
    ownerId: OWNER_ID,
    runtimeSessionId: SESSION_ID,
    action: "cancel" as const,
    expectedRevision: goal.revision,
    expectedRunEpoch: 0,
    goal: cancelledGoal,
    instruction: {
      schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
      id: uuid(3),
      goalId: goal.id,
      goalRevision: cancelledGoal.revision,
      kind: "goal.cancel",
      deliveryMode: "interrupt_replace",
      targetSessionId: SESSION_ID,
      payload: {
        reason: "Cancel at the provider turn boundary",
        expectedRunEpoch: 0,
      },
      source: { type: "user", authority: "user" },
      idempotencyKey,
      issuedAt: cancelledGoal.updatedAt,
    } satisfies RuntimeInstructionDraft,
    command: command(idempotencyKey, "b"),
  };
}

describe("InMemoryAgentGoalState lifecycle transition barriers", () => {
  it("advances cancel through a durable boundary before releasing its slot", async () => {
    const { state, goal } = await activeState();
    const input = cancelInput(goal);
    const prepared = await state.prepareLifecycleTransition(input);

    expect(prepared.transition).toMatchObject({
      phase: "prepared",
      expectedRunEpoch: 0,
      runEpoch: 0,
      transitionedGoal: { goal: { status: "cancelled", revision: 2 } },
    });
    await expect(
      state.finalizeLifecycleTransition({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        goalId: goal.id,
        expectedRunEpoch: 0,
        nextRunEpoch: 1,
        command: input.command,
      }),
    ).rejects.toMatchObject({
      code: "invalid_commit",
    } satisfies Partial<InMemoryGoalStateError>);

    const boundary = await state.markLifecycleTransitionBoundary({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: goal.id,
      expectedRunEpoch: 0,
      nextRunEpoch: 1,
      command: input.command,
    });
    expect(boundary.transition).toMatchObject({
      phase: "boundary_observed",
      runEpoch: 1,
    });
    await expect(
      state.getRuntimeSessionRunEpoch(OWNER_ID, SESSION_ID),
    ).resolves.toBe(1);

    const nextGoal = newGoal(uuid(4), "Next Goal", TRANSITIONED_AT);
    await expect(
      state.commitActivation({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        goal: nextGoal,
        instruction: activationDraft(nextGoal, uuid(5), "activate-next"),
        command: command("activate-next", "c"),
      }),
    ).rejects.toMatchObject({
      code: "lifecycle_transition_in_progress",
    } satisfies Partial<InMemoryGoalStateError>);

    const finalized = await state.finalizeLifecycleTransition({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: goal.id,
      expectedRunEpoch: 0,
      nextRunEpoch: 1,
      command: input.command,
    });
    expect(finalized.transition.phase).toBe("finalized");
    await expect(
      state.commitActivation({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        goal: nextGoal,
        instruction: activationDraft(nextGoal, uuid(5), "activate-next"),
        command: command("activate-next", "c"),
      }),
    ).resolves.toMatchObject({
      goal: { goal: { id: nextGoal.id, status: "active" } },
    });
  });
});
