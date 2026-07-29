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

const OWNER_ID = "owner-vertical-slice";
const SESSION_ID = "claude-nanoid-session_V1StGXR8";
const NOW = new Date("2026-07-26T09:00:00.000Z");

function goalInput(): CreateAgentGoalInput {
  return {
    objective: "Deliver a Goal through the live Claude SDK input stream",
    successCriteria: [
      {
        id: "instruction-observed",
        description: "The formatted activation reaches the SDK input",
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

describe("Claude Goal runtime vertical slice", () => {
  it("delivers activate, update, and context commands into a nanoid-style Claude session", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const claude = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      createMessageId: () => "agent-message-id",
    });
    const runtime = createInMemoryAgentGoalRuntime({
      clock: new FixedRuntimeClock(NOW),
      idGenerator: new DeterministicRuntimeIds("10000000"),
    });
    const activationCommand = {
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "vertical-activate",
      source: { type: "user", authority: "user" } as const,
      goal: goalInput(),
    };
    const activated = await runtime.goals.activate(activationCommand);
    expect(activated.dispatch.status).toBe("unavailable");

    const registration = await startClaudeGoalRuntimeSession({
      session: { user: { id: OWNER_ID } },
      runtime: claude,
      start: { initialPrompt: "Initial user request" },
      goalRuntime: runtime,
    });

    const sdkInput = (sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>)[
      Symbol.asyncIterator
    ]();
    await expect(sdkInput.next()).resolves.toMatchObject({
      value: {
        session_id: SESSION_ID,
        message: { content: "Initial user request" },
      },
    });

    await expect(sdkInput.next()).resolves.toMatchObject({
      value: {
        session_id: SESSION_ID,
        priority: "now",
        shouldQuery: true,
        message: {
          content: expect.stringContaining('kind="goal.activate"'),
        },
      },
    });

    const updated = await runtime.goals.update({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 1,
      idempotencyKey: "vertical-update",
      source: { type: "user", authority: "user" },
      update: { objective: "Deliver the updated Goal to Claude as well" },
    });
    expect(updated.instruction).toMatchObject({
      sequence: 2,
      goalRevision: 2,
      kind: "goal.update",
    });
    await expect(sdkInput.next()).resolves.toMatchObject({
      value: {
        priority: "now",
        message: {
          content: expect.stringContaining(
            "Deliver the updated Goal to Claude as well",
          ),
        },
      },
    });

    const context = await runtime.goals.upsertContext({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 2,
      idempotencyKey: "vertical-context",
      source: {
        type: "connector",
        authority: "untrusted_data",
        sourceRef: "jira:JIRA-176",
      },
      contextRef: {
        id: "jira-176",
        kind: "connector_record",
        refId: "JIRA-176",
        origin: "connector",
        sourceRef: "jira:JIRA-176",
        summary: "External issue data",
      },
    });
    expect(context.instruction).toMatchObject({
      sequence: 3,
      goalRevision: 3,
      kind: "context.upsert",
      deliveryMode: "next_boundary",
    });
    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: claude.liveInputSource,
      sessionId: SESSION_ID,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const postToolBatch = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;
    await expect(
      postToolBatch({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: expect.stringContaining(
          '<openloomi_untrusted_context context_id="jira-176"',
        ),
      },
    });

    const retry = await runtime.goals.activate(activationCommand);
    expect(retry.deduplicated).toBe(true);
    expect(retry.instruction).toEqual(activated.instruction);
    expect(claude.liveInputSource.hasPending?.()).toBe(false);
    await expect(
      runtime.state.listInstructions(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "goal.update" },
      { sequence: 3, kind: "context.upsert" },
    ]);
    expect(handle.interrupt).toHaveBeenCalledTimes(2);

    registration?.release();
    await claude.close();
  });

  it("replaces a live Claude Goal only after the old turn terminates and fences pending old-epoch input", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const claude = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      createMessageId: () => "replacement-agent-message-id",
    });
    const runtime = createInMemoryAgentGoalRuntime({
      clock: new FixedRuntimeClock(NOW),
      idGenerator: new DeterministicRuntimeIds("20000000"),
    });
    const registration = await startClaudeGoalRuntimeSession({
      session: { user: { id: OWNER_ID } },
      runtime: claude,
      start: { initialPrompt: "Start the original Goal" },
      goalRuntime: runtime,
    });
    const sdkInput = (sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>)[
      Symbol.asyncIterator
    ]();
    await sdkInput.next();

    const activated = await runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "replacement-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput(),
    });
    await expect(sdkInput.next()).resolves.toMatchObject({
      value: {
        priority: "now",
        message: { content: expect.stringContaining('kind="goal.activate"') },
      },
    });

    const context = await runtime.goals.upsertContext({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 1,
      idempotencyKey: "replacement-old-context",
      source: {
        type: "connector",
        authority: "untrusted_data",
        sourceRef: "jira:JIRA-176",
      },
      contextRef: {
        id: "jira-replacement-context",
        kind: "connector_record",
        refId: "JIRA-176",
        origin: "connector",
        sourceRef: "jira:JIRA-176",
        summary: "Context that must not cross the replacement boundary",
      },
    });
    expect(claude.liveInputSource.hasPending?.()).toBe(true);
    const nextRuntimeInput = sdkInput.next();

    const replacing = runtime.replacements.replace({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 2,
      idempotencyKey: "replacement-command",
      source: { type: "user", authority: "user" },
      reason: "Switch to the new primary Goal",
      replacement: {
        ...goalInput(),
        objective: "Execute only the replacement Goal",
      },
    });
    await vi.waitFor(() => {
      expect(handle.interrupt).toHaveBeenCalledTimes(2);
    });
    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: claude.liveInputSource,
      sessionId: SESSION_ID,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const postToolBatch = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;
    await expect(
      postToolBatch({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});

    await expect(
      runtime.goals.getActivePrimaryGoal(OWNER_ID, SESSION_ID),
    ).resolves.toBeNull();
    await expect(
      runtime.state.listInstructions(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "context.upsert" },
      { sequence: 3, kind: "control.interrupt" },
    ]);

    handle.push(resultMessage());
    const replaced = await replacing;

    expect(replaced).toMatchObject({
      replacement: {
        phase: "activated",
        expectedRunEpoch: 0,
        runEpoch: 1,
      },
      discardedInputIds: [context.instruction.id],
      controlDispatch: { status: "accepted" },
      activationDispatch: { status: "accepted" },
    });
    expect(claude.runEpoch).toBe(1);
    // The replacement activation has already been handed to the pending SDK
    // iterator below, so it is no longer resident in the queue.
    expect(claude.liveInputSource.hasPending?.()).toBe(false);
    expect(handle.interrupt).toHaveBeenCalledTimes(2);
    await expect(nextRuntimeInput).resolves.toMatchObject({
      value: {
        priority: "now",
        message: {
          content: expect.stringContaining("Execute only the replacement Goal"),
        },
      },
    });
    expect(claude.liveInputSource.hasPending?.()).toBe(false);
    await expect(
      runtime.goals.getGoal(OWNER_ID, activated.goal.goal.id),
    ).resolves.toMatchObject({ goal: { status: "cancelled", revision: 3 } });
    await expect(
      runtime.goals.getActivePrimaryGoal(OWNER_ID, SESSION_ID),
    ).resolves.toEqual(replaced.replacement.replacementGoal);
    await expect(
      runtime.state.listInstructions(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([
      { sequence: 1, kind: "goal.activate" },
      { sequence: 2, kind: "context.upsert" },
      { sequence: 3, kind: "control.interrupt" },
      { sequence: 4, kind: "goal.activate" },
    ]);

    registration?.release();
    await claude.close();
  });
});
