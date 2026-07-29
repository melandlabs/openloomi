import type {
  HookCallback,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CreateAgentGoalInput } from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it, vi } from "vitest";

import {
  ClaudeRuntimeSession,
  createClaudeSupplementalInputHooks,
  startClaudeGoalRuntimeSession,
} from "@/lib/ai/extensions/agent/claude/runtime";
import { createInMemoryAgentGoalRuntime } from "@/lib/ai/runtime-instructions/runtime";
import {
  createControlledClaudeQuery,
  createFakeClaudeSdkTransport,
} from "../../helpers/claude-runtime";
import {
  DeterministicRuntimeIds,
  FixedRuntimeClock,
} from "../../helpers/goal-runtime";

const OWNER_ID = "owner-lifecycle-vertical";
const SESSION_ID = "claude-lifecycle-session_V1StGXR8";
const NOW = new Date("2026-07-29T09:00:00.000Z");

function goalInput(objective: string): CreateAgentGoalInput {
  return {
    objective,
    successCriteria: [
      {
        id: "lifecycle-observed",
        description: "The lifecycle transition is applied at a turn boundary",
        verification: { type: "model_evidence" },
        required: true,
      },
    ],
    constraints: [],
    contextRefs: [],
    priority: 80,
    maxTurns: 5,
    completionPolicy: "model_evaluator",
    source: { type: "user" },
  };
}

function resultMessage(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 10,
    total_cost_usd: 0.01,
    usage: { input_tokens: 4, output_tokens: 2 },
  } as SDKMessage;
}

async function createHarness(idPrefix: string) {
  const handle = createControlledClaudeQuery();
  const sdk = createFakeClaudeSdkTransport(handle);
  const claude = new ClaudeRuntimeSession({
    runtimeSessionId: SESSION_ID,
    runEpoch: 0,
    sdkTransport: sdk.transport,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    createMessageId: () => `${idPrefix}-agent-message`,
  });
  const runtime = createInMemoryAgentGoalRuntime({
    clock: new FixedRuntimeClock(NOW),
    idGenerator: new DeterministicRuntimeIds(idPrefix),
  });
  const registration = await startClaudeGoalRuntimeSession({
    session: { user: { id: OWNER_ID } },
    runtime: claude,
    start: { initialPrompt: "Start the lifecycle test Goal" },
    goalRuntime: runtime,
  });
  const sdkInput = (sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>)[
    Symbol.asyncIterator
  ]();
  await sdkInput.next();

  return { claude, handle, registration, runtime, sdkInput };
}

async function addPendingContext(
  harness: Awaited<ReturnType<typeof createHarness>>,
  goalId: string,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return harness.runtime.goals.upsertContext({
    ownerId: OWNER_ID,
    runtimeSessionId: SESSION_ID,
    goalId,
    expectedRevision,
    idempotencyKey,
    source: {
      type: "connector",
      authority: "untrusted_data",
      sourceRef: "jira:JIRA-176",
    },
    contextRef: {
      id: `${idempotencyKey}-context`,
      kind: "connector_record",
      refId: "JIRA-176",
      origin: "connector",
      sourceRef: "jira:JIRA-176",
      summary: "Pending context fenced by the lifecycle transition",
    },
  });
}

describe("Claude Goal lifecycle vertical slice", () => {
  it("pauses at a terminal boundary and retains pending context until resume", async () => {
    const harness = await createHarness("30000000");
    const activated = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "pause-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput("Pause and resume the same Goal"),
    });
    await harness.sdkInput.next();
    const context = await addPendingContext(
      harness,
      activated.goal.goal.id,
      1,
      "pause-context",
    );
    const waitingSdkInput = harness.sdkInput.next();

    const pausing = harness.runtime.goals.pause({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 2,
      idempotencyKey: "pause-command",
      source: { type: "user", authority: "user" },
      reason: "Pause until the user resumes",
    });
    await vi.waitFor(() => {
      expect(harness.handle.interrupt).toHaveBeenCalledTimes(2);
    });

    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: harness.claude.liveInputSource,
      sessionId: SESSION_ID,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const postToolBatch = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;
    await expect(
      postToolBatch({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});

    let sdkInputSettled = false;
    void waitingSdkInput.then(() => {
      sdkInputSettled = true;
    });
    harness.handle.push(resultMessage());
    const paused = await pausing;
    await Promise.resolve();

    expect(paused).toMatchObject({
      goal: { goal: { status: "paused", revision: 3 } },
      instruction: {
        kind: "goal.pause",
        payload: { expectedRunEpoch: 0 },
      },
      dispatch: { status: "accepted" },
    });
    expect(harness.claude.runEpoch).toBe(0);
    expect(harness.claude.state).toBe("idle");
    expect(sdkInputSettled).toBe(false);
    expect(harness.claude.liveInputSource.hasPending?.()).toBe(true);

    const resumed = await harness.runtime.goals.resume({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 3,
      idempotencyKey: "resume-command",
      source: { type: "user", authority: "user" },
      reason: "Continue the paused Goal",
    });
    await expect(waitingSdkInput).resolves.toMatchObject({
      value: {
        message: {
          content: expect.stringContaining(
            `context_id="${context.goal.goal.contextRefs[0]?.id}"`,
          ),
        },
      },
    });
    await expect(harness.sdkInput.next()).resolves.toMatchObject({
      value: {
        message: { content: expect.stringContaining('kind="goal.resume"') },
      },
    });
    expect(resumed).toMatchObject({
      goal: { goal: { status: "active", revision: 4 } },
      instruction: { kind: "goal.resume" },
      dispatch: { status: "accepted" },
    });
    expect(harness.handle.interrupt).toHaveBeenCalledTimes(2);

    harness.registration?.release();
    await harness.claude.close();
  });

  it("cancels only after terminal, advances the epoch, and discards old input", async () => {
    const harness = await createHarness("40000000");
    const activated = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "cancel-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput("Cancel this Goal at a safe boundary"),
    });
    await harness.sdkInput.next();
    const context = await addPendingContext(
      harness,
      activated.goal.goal.id,
      1,
      "cancel-context",
    );
    const waitingSdkInput = harness.sdkInput.next();

    const cancelling = harness.runtime.goals.cancel({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 2,
      idempotencyKey: "cancel-command",
      source: { type: "user", authority: "user" },
      reason: "Cancel before activating another Goal",
    });
    await vi.waitFor(() => {
      expect(harness.handle.interrupt).toHaveBeenCalledTimes(2);
    });

    await expect(
      harness.runtime.goals.activate({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        idempotencyKey: "activate-too-early",
        source: { type: "user", authority: "user" },
        goal: goalInput("Must not activate before cancellation is terminal"),
      }),
    ).rejects.toMatchObject({ code: "lifecycle_transition_in_progress" });
    expect(harness.claude.runEpoch).toBe(0);

    harness.handle.push(resultMessage());
    const cancelled = await cancelling;
    expect(cancelled).toMatchObject({
      goal: { goal: { status: "cancelled", revision: 3 } },
      instruction: {
        kind: "goal.cancel",
        payload: { expectedRunEpoch: 0 },
      },
      dispatch: { status: "accepted" },
    });
    expect(harness.claude.runEpoch).toBe(1);
    expect(harness.claude.liveInputSource.hasPending?.()).toBe(false);

    const next = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "activate-after-cancel",
      source: { type: "user", authority: "user" },
      goal: goalInput("Run only after cancellation crossed the boundary"),
    });
    await expect(waitingSdkInput).resolves.toMatchObject({
      value: {
        message: {
          content: expect.stringContaining(
            "Run only after cancellation crossed the boundary",
          ),
        },
      },
    });
    expect(next).toMatchObject({
      goal: { goal: { status: "active", revision: 1 } },
      instruction: { kind: "goal.activate", sequence: 4 },
      dispatch: { status: "accepted" },
    });
    expect(
      (await harness.runtime.state.listInstructions(OWNER_ID, SESSION_ID)).map(
        ({ kind }) => kind,
      ),
    ).toEqual([
      "goal.activate",
      "context.upsert",
      "goal.cancel",
      "goal.activate",
    ]);
    expect(context.instruction.id).not.toBe(next.instruction.id);

    harness.registration?.release();
    await harness.claude.close();
  });
});
