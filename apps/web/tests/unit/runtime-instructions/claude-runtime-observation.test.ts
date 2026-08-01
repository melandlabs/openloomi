import type {
  HookCallback,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CreateAgentGoalInput } from "@openloomi/ai/agent/runtime-instructions";
import { describe, expect, it, vi } from "vitest";

import { collectClaudeToolEvidence } from "@/lib/ai/extensions/agent/claude/runtime/evidence-collector";
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

const OWNER_ID = "owner-runtime-observation";
const SESSION_ID = "claude-runtime-observation-session";
const PROVIDER_SESSION_ID = "claude-provider-session";
const NOW = new Date("2026-08-01T09:00:00.000Z");

const INIT_EVENT_ID = "10000000-0000-4000-8000-000000000001";
const ASSISTANT_EVENT_ID = "10000000-0000-4000-8000-000000000002";
const RESULT_EVENT_ID = "10000000-0000-4000-8000-000000000003";

function goalInput(objective: string): CreateAgentGoalInput {
  return {
    objective,
    successCriteria: [
      {
        id: "runtime-observed",
        description: "Claude observes and applies the runtime instruction",
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

function initMessage(): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    uuid: INIT_EVENT_ID,
    session_id: PROVIDER_SESSION_ID,
  } as unknown as SDKMessage;
}

function assistantMessage(): SDKMessage {
  return {
    type: "assistant",
    uuid: ASSISTANT_EVENT_ID,
    session_id: PROVIDER_SESSION_ID,
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I am applying the active Goal." }],
    },
  } as unknown as SDKMessage;
}

function resultMessage(uuid = RESULT_EVENT_ID): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    uuid,
    session_id: PROVIDER_SESSION_ID,
    duration_ms: 10,
    duration_api_ms: 8,
    is_error: false,
    num_turns: 2,
    result: "Goal turn complete",
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 5,
    },
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
    observationIdGenerator: new DeterministicRuntimeIds("90000000"),
  });
  const registration = await startClaudeGoalRuntimeSession({
    session: { user: { id: OWNER_ID } },
    runtime: claude,
    start: { initialPrompt: "Start the observed Goal runtime" },
    goalRuntime: runtime,
  });
  const sdkInput = (sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>)[
    Symbol.asyncIterator
  ]();

  return { claude, handle, registration, runtime, sdkInput };
}

async function deliveryState(
  runtime: ReturnType<typeof createInMemoryAgentGoalRuntime>,
  instructionId: string,
) {
  const deliveries = await runtime.observations.listDeliveries(
    OWNER_ID,
    SESSION_ID,
  );
  return deliveries.find(
    (delivery) => delivery.instructionId === instructionId,
  );
}

describe("Claude runtime Goal observations", () => {
  it("separates queued, written, observed, and applied delivery while deduplicating final usage", async () => {
    const harness = await createHarness("60000000");
    const activated = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "observe-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput("Track the Claude delivery lifecycle"),
    });

    expect(activated.dispatch.status).toBe("accepted");
    await expect(
      deliveryState(harness.runtime, activated.instruction.id),
    ).resolves.toMatchObject({ state: "queued" });

    await harness.sdkInput.next();
    await harness.sdkInput.next();
    await vi.waitFor(async () => {
      await expect(
        deliveryState(harness.runtime, activated.instruction.id),
      ).resolves.toMatchObject({ state: "written_to_sdk" });
    });

    harness.handle.push(initMessage());
    await vi.waitFor(() => expect(harness.claude.sdkMessageCount).toBe(1));
    await expect(
      deliveryState(harness.runtime, activated.instruction.id),
    ).resolves.toMatchObject({ state: "written_to_sdk" });

    harness.handle.push(assistantMessage());
    await vi.waitFor(async () => {
      await expect(
        deliveryState(harness.runtime, activated.instruction.id),
      ).resolves.toMatchObject({
        state: "observed",
        providerEventId: ASSISTANT_EVENT_ID,
      });
    });

    const result = resultMessage();
    harness.handle.push(result);
    await vi.waitFor(async () => {
      await expect(
        deliveryState(harness.runtime, activated.instruction.id),
      ).resolves.toMatchObject({
        state: "applied",
        providerEventId: RESULT_EVENT_ID,
      });
    });
    await expect(
      harness.runtime.observations.listGoalRuns(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([
      {
        goalId: activated.goal.goal.id,
        providerSessionId: PROVIDER_SESSION_ID,
        runEpoch: 0,
        status: "running",
        tokensUsed: 22,
        turnsUsed: 2,
      },
    ]);

    harness.handle.push({
      ...result,
      subtype: "error_max_turns",
    } as unknown as SDKMessage);
    await vi.waitFor(() => expect(harness.claude.sdkMessageCount).toBe(4));
    const runs = await harness.runtime.observations.listGoalRuns(
      OWNER_ID,
      SESSION_ID,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ tokensUsed: 22, turnsUsed: 2 });

    harness.registration?.release();
    await harness.claude.close();
  });

  it("reconciles provider handoff before its receipt and a rejected retry", async () => {
    const runtime = createInMemoryAgentGoalRuntime({
      clock: new FixedRuntimeClock(NOW),
      idGenerator: new DeterministicRuntimeIds("30000000"),
      observationIdGenerator: new DeterministicRuntimeIds("31000000"),
    });
    const activated = await runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "race-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput("Observe output that races ahead of its receipt"),
    });

    await runtime.observations.prepareDelivery({
      ownerId: OWNER_ID,
      instruction: activated.instruction,
    });
    await expect(
      runtime.observations.recordInstructionHandoff({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        instructionId: activated.instruction.id,
        runEpoch: 0,
        recordedAt: "2026-08-01T09:00:01.000Z",
      }),
    ).resolves.toBe(true);
    await runtime.observations.observeProviderEvent({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      eventKey: "terminal-before-receipt",
      providerEventId: "terminal-before-receipt",
      terminal: true,
      observedAt: "2026-08-01T09:00:02.000Z",
      usage: { tokensUsed: 3, turnsUsed: 1 },
    });
    await runtime.observations.recordDeliveryReceipt({
      ownerId: OWNER_ID,
      instruction: activated.instruction,
      receipt: {
        instructionId: activated.instruction.id,
        runtimeSessionId: SESSION_ID,
        state: "queued",
        recordedAt: "2026-08-01T09:00:03.000Z",
      },
    });
    await expect(
      deliveryState(runtime, activated.instruction.id),
    ).resolves.toMatchObject({ state: "applied", attempt: 1 });

    const updated = await runtime.goals.update({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 1,
      idempotencyKey: "race-retry-update",
      source: { type: "user", authority: "user" },
      update: { priority: 90 },
    });
    await runtime.observations.prepareDelivery({
      ownerId: OWNER_ID,
      instruction: updated.instruction,
    });
    await runtime.observations.recordDeliveryReceipt({
      ownerId: OWNER_ID,
      instruction: updated.instruction,
      receipt: {
        instructionId: updated.instruction.id,
        runtimeSessionId: SESSION_ID,
        state: "rejected",
        reason: "transient transport rejection",
        recordedAt: "2026-08-01T09:00:04.000Z",
      },
    });
    await runtime.observations.recordInstructionHandoff({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      instructionId: updated.instruction.id,
      runEpoch: 0,
      recordedAt: "2026-08-01T09:00:05.000Z",
    });
    await runtime.observations.recordDeliveryReceipt({
      ownerId: OWNER_ID,
      instruction: updated.instruction,
      receipt: {
        instructionId: updated.instruction.id,
        runtimeSessionId: SESSION_ID,
        state: "queued",
        recordedAt: "2026-08-01T09:00:06.000Z",
      },
    });
    const retry = (
      await runtime.observations.listDeliveries(OWNER_ID, SESSION_ID)
    ).find(({ instructionId }) => instructionId === updated.instruction.id);
    expect(retry).toMatchObject({ state: "written_to_sdk", attempt: 2 });
  });

  it("records next-boundary context as written when PostToolBatch consumes it", async () => {
    const harness = await createHarness("70000000");
    await harness.sdkInput.next();
    const activated = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "boundary-activate",
      source: { type: "user", authority: "user" },
      goal: goalInput("Consume context at the next tool boundary"),
    });
    await harness.sdkInput.next();

    const context = await harness.runtime.goals.upsertContext({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 1,
      idempotencyKey: "boundary-context",
      source: {
        type: "connector",
        authority: "untrusted_data",
        sourceRef: "jira:JIRA-176",
      },
      contextRef: {
        id: "jira-176-runtime-context",
        kind: "connector_record",
        refId: "JIRA-176",
        origin: "connector",
        sourceRef: "jira:JIRA-176",
        summary: "Context delivered at the next tool boundary",
      },
    });
    await expect(
      deliveryState(harness.runtime, context.instruction.id),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      harness.runtime.observations.listGoalRuns(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([{ goalRevision: 1 }]);

    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: harness.claude.liveInputSource,
      toolObserver: harness.claude,
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
          'context_id="jira-176-runtime-context"',
        ),
      },
    });
    await vi.waitFor(async () => {
      await expect(
        deliveryState(harness.runtime, context.instruction.id),
      ).resolves.toMatchObject({ state: "written_to_sdk" });
    });

    const preToolUse = hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const postToolUse = hooks?.PostToolUse?.[0]?.hooks[0] as HookCallback;
    const toolUseId = "tool-boundary-test";
    const hookBase = {
      session_id: PROVIDER_SESSION_ID,
      transcript_path: "transcript.jsonl",
      cwd: "D:/workspace",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_use_id: toolUseId,
    };
    await preToolUse(
      { ...hookBase, hook_event_name: "PreToolUse" } as never,
      toolUseId,
      { signal: new AbortController().signal },
    );
    await postToolUse(
      {
        ...hookBase,
        hook_event_name: "PostToolUse",
        tool_response: {
          stdout: "tests passed",
          stderr: "",
          interrupted: false,
          isImage: false,
        },
      } as never,
      toolUseId,
      { signal: new AbortController().signal },
    );
    const permissionDenied = hooks?.PermissionDenied?.[0]
      ?.hooks[0] as HookCallback;
    await permissionDenied(
      {
        ...hookBase,
        hook_event_name: "PermissionDenied",
        tool_name: "Write",
        tool_input: { file_path: "src/denied.ts", content: "private" },
        tool_use_id: "tool-denied-write",
        reason: "permission policy denied the write",
      } as never,
      "tool-denied-write",
      { signal: new AbortController().signal },
    );
    await expect(
      harness.runtime.observations.listGoalRuns(OWNER_ID, SESSION_ID),
    ).resolves.toMatchObject([{ goalRevision: 2 }]);
    await expect(
      harness.runtime.observations.listEvidence(OWNER_ID, SESSION_ID),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: activated.goal.goal.id,
          goalRevision: 2,
          instructionId: context.instruction.id,
          type: "test_result",
          sourceEventId: expect.stringContaining(toolUseId),
          success: true,
        }),
        expect.objectContaining({
          instructionId: context.instruction.id,
          type: "tool_result",
          sourceEventId: expect.stringContaining("tool-denied-write"),
          success: false,
        }),
      ]),
    );

    harness.registration?.release();
    await harness.claude.close();
  });

  it("classifies bounded command, test, file, generic, and failed tool evidence", () => {
    const privateWriteBody = "PRIVATE_WRITE_BODY_SHOULD_NOT_BE_RETAINED";
    const privateToken = "PRIVATE_TOKEN_SHOULD_NOT_BE_RETAINED";
    const observedAt = NOW.toISOString();
    const evidence = [
      collectClaudeToolEvidence({
        providerEventId: "provider-command",
        toolUseId: "tool-command",
        toolName: "Bash",
        outcome: "succeeded",
        toolInput: { command: `API_TOKEN=${privateToken} echo ready` },
        toolResponse: {
          stdout: "ready",
          stderr: "",
          interrupted: false,
          isImage: false,
        },
        observedAt,
      }),
      collectClaudeToolEvidence({
        providerEventId: "provider-test",
        toolUseId: "tool-test",
        toolName: "Bash",
        outcome: "failed",
        toolInput: { command: "pnpm test" },
        error: "Command failed with exit code 1",
        observedAt,
      }),
      collectClaudeToolEvidence({
        providerEventId: "provider-write",
        toolUseId: "tool-write",
        toolName: "Write",
        outcome: "succeeded",
        toolInput: {
          file_path: "src/runtime.ts",
          content: privateWriteBody.repeat(100),
        },
        toolResponse: { success: true },
        observedAt,
      }),
      collectClaudeToolEvidence({
        providerEventId: "provider-generic",
        toolUseId: "tool-generic",
        toolName: "Read",
        outcome: "succeeded",
        toolInput: { file_path: "README.md" },
        toolResponse: { success: false, lines: 20 },
        observedAt,
      }),
      collectClaudeToolEvidence({
        providerEventId: "provider-failure",
        toolUseId: "tool-failure",
        toolName: "WebFetch",
        outcome: "failed",
        toolInput: { url: "https://example.com" },
        error: "network denied",
        observedAt,
      }),
    ];

    expect(
      evidence.map(({ type, success, sourceEventId }) => ({
        type,
        success,
        sourceEventId,
      })),
    ).toEqual([
      {
        type: "command_result",
        success: true,
        sourceEventId: "provider-command:tool:tool-command",
      },
      {
        type: "test_result",
        success: false,
        sourceEventId: "provider-test:tool:tool-test",
      },
      {
        type: "file_change",
        success: true,
        sourceEventId: "provider-write:tool:tool-write",
      },
      {
        type: "tool_result",
        success: true,
        sourceEventId: "provider-generic:tool:tool-generic",
      },
      {
        type: "tool_result",
        success: false,
        sourceEventId: "provider-failure:tool:tool-failure",
      },
    ]);
    expect(evidence[2]?.payload).toMatchObject({
      paths: ["src/runtime.ts"],
      inputContentRetained: false,
    });
    expect(JSON.stringify(evidence[2])).not.toContain(privateWriteBody);
    expect(JSON.stringify(evidence)).not.toContain(privateToken);
  });

  it("rejects stale provider observations after cancellation advances the real runtime epoch", async () => {
    const harness = await createHarness("80000000");
    await harness.sdkInput.next();
    const activated = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "stale-activate-old",
      source: { type: "user", authority: "user" },
      goal: goalInput("Cancel this Goal before observing stale output"),
    });
    await harness.sdkInput.next();

    const cancelling = harness.runtime.goals.cancel({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      goalId: activated.goal.goal.id,
      expectedRevision: 1,
      idempotencyKey: "stale-cancel",
      source: { type: "user", authority: "user" },
      reason: "Advance the epoch before delayed output arrives",
    });
    await vi.waitFor(() => {
      expect(harness.handle.interrupt).toHaveBeenCalledTimes(2);
    });
    harness.handle.push(resultMessage("20000000-0000-4000-8000-000000000001"));
    const cancelled = await cancelling;
    expect(harness.claude.runEpoch).toBe(1);

    const replacement = await harness.runtime.goals.activate({
      ownerId: OWNER_ID,
      runtimeSessionId: SESSION_ID,
      idempotencyKey: "stale-activate-new",
      source: { type: "user", authority: "user" },
      goal: goalInput("Keep the new Goal isolated from stale output"),
    });
    await harness.sdkInput.next();
    await vi.waitFor(async () => {
      const runs = await harness.runtime.observations.listGoalRuns(
        OWNER_ID,
        SESSION_ID,
      );
      expect(
        runs.find(({ goalId }) => goalId === replacement.goal.goal.id),
      ).toMatchObject({
        runEpoch: 1,
        status: "running",
      });
    });

    const before = (
      await harness.runtime.observations.listGoalRuns(OWNER_ID, SESSION_ID)
    ).find(({ goalId }) => goalId === replacement.goal.goal.id);
    await expect(
      harness.runtime.observations.observeProviderEvent({
        ownerId: OWNER_ID,
        runtimeSessionId: SESSION_ID,
        runEpoch: 0,
        eventKey: "stale-provider-result",
        providerEventId: "stale-provider-result",
        observedAt: "2026-08-01T09:01:00.000Z",
        terminal: true,
        usage: {
          tokensUsed: 4_000,
          turnsUsed: 100,
        },
      }),
    ).resolves.toBe(false);
    const after = (
      await harness.runtime.observations.listGoalRuns(OWNER_ID, SESSION_ID)
    ).find(({ goalId }) => goalId === replacement.goal.goal.id);
    expect(after).toEqual(before);

    const runs = await harness.runtime.observations.listGoalRuns(
      OWNER_ID,
      SESSION_ID,
    );
    expect(
      runs.find(({ goalId }) => goalId === activated.goal.goal.id),
    ).toMatchObject({ status: "cancelled", runEpoch: 0 });
    await expect(
      deliveryState(harness.runtime, cancelled.instruction.id),
    ).resolves.toMatchObject({ state: "applied" });

    harness.registration?.release();
    await harness.claude.close();
  });
});
