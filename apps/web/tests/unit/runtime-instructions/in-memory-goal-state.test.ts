import {
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  createAgentGoal,
  reviseAgentGoal,
  type AgentGoal,
  type AgentGoalUpdate,
  type CreateAgentGoalInput,
  type GoalCommandIdentity,
  type GoalContextReference,
  type RuntimeInstructionDraft,
} from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it } from "vitest";

import {
  InMemoryAgentGoalState,
  type InMemoryGoalStateError,
} from "@/lib/ai/runtime-instructions/in-memory-goal-state";

const OWNER_ID = "owner-store-invariants";
const SESSION_A = "runtime-session-a";
const SESSION_B = "runtime-session-b";
const CREATED_AT = new Date("2026-07-26T10:00:00.000Z");

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function goalInput(
  objective: string,
  overrides: Partial<CreateAgentGoalInput> = {},
): CreateAgentGoalInput {
  return {
    objective,
    successCriteria: [
      {
        id: "store-invariants",
        description: "The Store preserves every authoritative invariant",
        verification: { type: "model_evidence" },
        required: true,
      },
    ],
    constraints: [],
    contextRefs: [],
    priority: 70,
    maxTurns: 8,
    completionPolicy: "model_evaluator",
    source: { type: "user" },
    ...overrides,
  };
}

function newGoal(
  id: string,
  objective: string,
  overrides: Partial<CreateAgentGoalInput> = {},
): AgentGoal {
  return createAgentGoal({
    id,
    input: goalInput(objective, overrides),
    now: CREATED_AT,
  });
}

function revisedGoal(
  current: AgentGoal,
  update: AgentGoalUpdate,
  minute: number,
): AgentGoal {
  return reviseAgentGoal({
    current,
    expectedRevision: current.revision,
    update,
    now: new Date(`2026-07-26T10:${String(minute).padStart(2, "0")}:00.000Z`),
  });
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

function activationDraft(input: {
  goal: AgentGoal;
  runtimeSessionId: string;
  instructionId: string;
  idempotencyKey: string;
  payloadGoal?: AgentGoal;
}): RuntimeInstructionDraft {
  return {
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: input.instructionId,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    kind: "goal.activate",
    deliveryMode: "steer",
    targetSessionId: input.runtimeSessionId,
    payload: { goal: input.payloadGoal ?? input.goal },
    source: { type: "user", authority: "user" },
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.goal.updatedAt,
  };
}

function updateDraft(input: {
  goal: AgentGoal;
  runtimeSessionId: string;
  instructionId: string;
  idempotencyKey: string;
  payloadGoal?: AgentGoal;
  previousRevision?: number;
}): RuntimeInstructionDraft {
  return {
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: input.instructionId,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    kind: "goal.update",
    deliveryMode: "steer",
    targetSessionId: input.runtimeSessionId,
    payload: {
      goal: input.payloadGoal ?? input.goal,
      previousRevision:
        input.previousRevision ?? Math.max(1, input.goal.revision - 1),
    },
    source: { type: "user", authority: "user" },
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.goal.updatedAt,
  };
}

function contextUpsertDraft(input: {
  goal: AgentGoal;
  contextRef: GoalContextReference;
  instructionId: string;
  idempotencyKey: string;
}): RuntimeInstructionDraft {
  return {
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: input.instructionId,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    kind: "context.upsert",
    deliveryMode: "next_boundary",
    targetSessionId: SESSION_A,
    payload: { contextRef: input.contextRef },
    source: { type: "user", authority: "user" },
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.goal.updatedAt,
  };
}

function contextRemoveDraft(input: {
  goal: AgentGoal;
  contextRefId: string;
  instructionId: string;
  idempotencyKey: string;
}): RuntimeInstructionDraft {
  return {
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: input.instructionId,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    kind: "context.remove",
    deliveryMode: "next_boundary",
    targetSessionId: SESSION_A,
    payload: { contextRefId: input.contextRefId },
    source: { type: "user", authority: "user" },
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.goal.updatedAt,
  };
}

async function commitActivation(
  state: InMemoryAgentGoalState,
  input: {
    goal: AgentGoal;
    runtimeSessionId: string;
    instructionId: string;
    idempotencyKey: string;
    fingerprintCharacter: string;
    payloadGoal?: AgentGoal;
  },
) {
  return state.commitActivation({
    ownerId: OWNER_ID,
    runtimeSessionId: input.runtimeSessionId,
    goal: input.goal,
    instruction: activationDraft(input),
    command: command(input.idempotencyKey, input.fingerprintCharacter),
  });
}

async function expectInvalidCommit(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: "invalid_commit",
  } satisfies Partial<InMemoryGoalStateError>);
}

describe("InMemoryAgentGoalState invariants", () => {
  it("atomically accepts only one direct concurrent activation per session", async () => {
    const state = new InMemoryAgentGoalState();
    const firstGoal = newGoal(uuid(1), "First concurrent Goal");
    const secondGoal = newGoal(uuid(2), "Second concurrent Goal");

    const results = await Promise.allSettled([
      commitActivation(state, {
        goal: firstGoal,
        runtimeSessionId: SESSION_A,
        instructionId: uuid(101),
        idempotencyKey: "activate-first",
        fingerprintCharacter: "a",
      }),
      commitActivation(state, {
        goal: secondGoal,
        runtimeSessionId: SESSION_A,
        instructionId: uuid(102),
        idempotencyKey: "activate-second",
        fingerprintCharacter: "b",
      }),
    ]);

    const fulfilled = results.find((result) => result.status === "fulfilled");
    const rejected = results.find((result) => result.status === "rejected");
    expect(fulfilled?.status).toBe("fulfilled");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "active_primary_goal_conflict" },
    });
    if (!fulfilled || fulfilled.status !== "fulfilled") {
      throw new Error("Expected one activation to commit");
    }
    await expect(
      state.getActivePrimaryGoal(OWNER_ID, SESSION_A),
    ).resolves.toEqual(fulfilled.value.goal);
    await expect(state.listInstructions(OWNER_ID, SESSION_A)).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        id: fulfilled.value.instruction.id,
      }),
    ]);
  });

  it("enforces owner-wide Goal IDs across runtime sessions under concurrency", async () => {
    const state = new InMemoryAgentGoalState();
    const sharedGoalId = uuid(3);
    const firstGoal = newGoal(sharedGoalId, "Goal in session A");
    const secondGoal = newGoal(sharedGoalId, "Goal in session B");

    const results = await Promise.allSettled([
      commitActivation(state, {
        goal: firstGoal,
        runtimeSessionId: SESSION_A,
        instructionId: uuid(103),
        idempotencyKey: "cross-session-a",
        fingerprintCharacter: "c",
      }),
      commitActivation(state, {
        goal: secondGoal,
        runtimeSessionId: SESSION_B,
        instructionId: uuid(104),
        idempotencyKey: "cross-session-b",
        fingerprintCharacter: "d",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: { code: "goal_conflict" },
    });
    const stored = await state.getGoal(OWNER_ID, sharedGoalId);
    expect(stored?.runtimeSessionId).toMatch(
      new RegExp(`^(${SESSION_A}|${SESSION_B})$`),
    );
    const losingSession =
      stored?.runtimeSessionId === SESSION_A ? SESSION_B : SESSION_A;
    await expect(
      state.listInstructions(OWNER_ID, losingSession),
    ).resolves.toEqual([]);
  });

  it("makes direct concurrent revision CAS atomic at the Store boundary", async () => {
    const state = new InMemoryAgentGoalState();
    const activeGoal = newGoal(uuid(4), "Goal before concurrent revisions");
    await commitActivation(state, {
      goal: activeGoal,
      runtimeSessionId: SESSION_A,
      instructionId: uuid(105),
      idempotencyKey: "activate-before-revisions",
      fingerprintCharacter: "e",
    });
    const firstRevision = revisedGoal(activeGoal, { priority: 80 }, 1);
    const secondRevision = revisedGoal(activeGoal, { priority: 90 }, 1);

    const results = await Promise.allSettled([
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: firstRevision,
        instruction: updateDraft({
          goal: firstRevision,
          runtimeSessionId: SESSION_A,
          instructionId: uuid(106),
          idempotencyKey: "revision-first",
        }),
        command: command("revision-first", "1"),
      }),
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: secondRevision,
        instruction: updateDraft({
          goal: secondRevision,
          runtimeSessionId: SESSION_A,
          instructionId: uuid(107),
          idempotencyKey: "revision-second",
        }),
        command: command("revision-second", "2"),
      }),
    ]);

    const fulfilled = results.find((result) => result.status === "fulfilled");
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: { code: "revision_conflict" },
    });
    if (!fulfilled || fulfilled.status !== "fulfilled") {
      throw new Error("Expected one revision to commit");
    }
    await expect(state.getGoal(OWNER_ID, activeGoal.id)).resolves.toEqual(
      fulfilled.value.goal,
    );
    await expect(
      state.listInstructions(OWNER_ID, SESSION_A),
    ).resolves.toMatchObject([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "goal.update" },
    ]);
  });

  it("rejects activation and update payloads that differ from authoritative Goal state", async () => {
    const state = new InMemoryAgentGoalState();
    const activeGoal = newGoal(uuid(5), "Authoritative activation Goal");

    await expectInvalidCommit(
      commitActivation(state, {
        goal: activeGoal,
        runtimeSessionId: SESSION_A,
        instructionId: uuid(108),
        idempotencyKey: "mismatched-activation-payload",
        fingerprintCharacter: "3",
        payloadGoal: { ...activeGoal, priority: 99 },
      }),
    );
    await expect(state.getGoal(OWNER_ID, activeGoal.id)).resolves.toBeNull();
    await expect(state.listInstructions(OWNER_ID, SESSION_A)).resolves.toEqual(
      [],
    );

    await commitActivation(state, {
      goal: activeGoal,
      runtimeSessionId: SESSION_A,
      instructionId: uuid(109),
      idempotencyKey: "valid-authoritative-activation",
      fingerprintCharacter: "4",
    });
    const revision = revisedGoal(activeGoal, { priority: 80 }, 2);
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: revision,
        instruction: updateDraft({
          goal: revision,
          payloadGoal: {
            ...revision,
            objective: "Instruction payload diverges from authoritative Goal",
          },
          runtimeSessionId: SESSION_A,
          instructionId: uuid(110),
          idempotencyKey: "mismatched-update-payload",
        }),
        command: command("mismatched-update-payload", "5"),
      }),
    );
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: revision,
        instruction: updateDraft({
          goal: revision,
          previousRevision: 2,
          runtimeSessionId: SESSION_A,
          instructionId: uuid(111),
          idempotencyKey: "wrong-previous-revision",
        }),
        command: command("wrong-previous-revision", "6"),
      }),
    );
    await expect(state.getGoal(OWNER_ID, activeGoal.id)).resolves.toMatchObject(
      { goal: { revision: 1 } },
    );
  });

  it("accepts only exact context upsert and remove transitions", async () => {
    const state = new InMemoryAgentGoalState();
    const activeGoal = newGoal(uuid(6), "Context transition Goal");
    await commitActivation(state, {
      goal: activeGoal,
      runtimeSessionId: SESSION_A,
      instructionId: uuid(112),
      idempotencyKey: "activate-context-transition",
      fingerprintCharacter: "7",
    });
    const contextRef: GoalContextReference = {
      id: "jira-176",
      kind: "connector_record",
      refId: "JIRA-176",
      summary: "Authoritative connector context",
      origin: "connector",
      sourceRef: "jira:JIRA-176",
    };

    const unrelatedUpsert = revisedGoal(
      activeGoal,
      { contextRefs: [contextRef], priority: 90 },
      3,
    );
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: unrelatedUpsert,
        instruction: contextUpsertDraft({
          goal: unrelatedUpsert,
          contextRef,
          instructionId: uuid(113),
          idempotencyKey: "context-upsert-with-unrelated-change",
        }),
        command: command("context-upsert-with-unrelated-change", "8"),
      }),
    );

    const validUpsert = revisedGoal(
      activeGoal,
      { contextRefs: [contextRef] },
      3,
    );
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: validUpsert,
        instruction: updateDraft({
          goal: validUpsert,
          runtimeSessionId: SESSION_A,
          instructionId: uuid(114),
          idempotencyKey: "context-through-general-update",
        }),
        command: command("context-through-general-update", "9"),
      }),
    );
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 1,
        goal: validUpsert,
        instruction: contextUpsertDraft({
          goal: validUpsert,
          contextRef: {
            ...contextRef,
            summary: "Payload context differs from authoritative Goal",
          },
          instructionId: uuid(119),
          idempotencyKey: "context-upsert-payload-mismatch",
        }),
        command: command("context-upsert-payload-mismatch", "f"),
      }),
    );
    await state.commitRevision({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_A,
      expectedRevision: 1,
      goal: validUpsert,
      instruction: contextUpsertDraft({
        goal: validUpsert,
        contextRef,
        instructionId: uuid(115),
        idempotencyKey: "valid-context-upsert",
      }),
      command: command("valid-context-upsert", "a"),
    });

    const unrelatedRemove = revisedGoal(
      validUpsert,
      { contextRefs: [], priority: 95 },
      4,
    );
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 2,
        goal: unrelatedRemove,
        instruction: contextRemoveDraft({
          goal: unrelatedRemove,
          contextRefId: contextRef.id,
          instructionId: uuid(116),
          idempotencyKey: "context-remove-with-unrelated-change",
        }),
        command: command("context-remove-with-unrelated-change", "b"),
      }),
    );

    const validRemove = revisedGoal(validUpsert, { contextRefs: [] }, 4);
    await expectInvalidCommit(
      state.commitRevision({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_A,
        expectedRevision: 2,
        goal: validRemove,
        instruction: contextRemoveDraft({
          goal: validRemove,
          contextRefId: "missing-context",
          instructionId: uuid(117),
          idempotencyKey: "remove-missing-context",
        }),
        command: command("remove-missing-context", "c"),
      }),
    );
    await state.commitRevision({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_A,
      expectedRevision: 2,
      goal: validRemove,
      instruction: contextRemoveDraft({
        goal: validRemove,
        contextRefId: contextRef.id,
        instructionId: uuid(118),
        idempotencyKey: "valid-context-remove",
      }),
      command: command("valid-context-remove", "d"),
    });

    await expect(state.getGoal(OWNER_ID, activeGoal.id)).resolves.toMatchObject(
      {
        goal: { revision: 3, contextRefs: [], priority: 70 },
      },
    );
    await expect(
      state.listInstructions(OWNER_ID, SESSION_A),
    ).resolves.toMatchObject([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "context.upsert" },
      { sequence: 3, kind: "context.remove" },
    ]);
  });
});
