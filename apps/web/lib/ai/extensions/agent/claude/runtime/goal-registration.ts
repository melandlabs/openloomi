import {
  getAgentGoalRuntime,
  type AgentGoalRuntime,
  type RuntimeInstructionDispatch,
  type RuntimeSessionRegistration,
} from "@/lib/ai/runtime-instructions";
import type { ClaudeRuntimeSession } from "./session";
import { ClaudeRuntimeEventObserver } from "./event-observer";

export interface StartClaudeGoalRuntimeSessionInput {
  session?: unknown;
  runtime: ClaudeRuntimeSession;
  start: Parameters<ClaudeRuntimeSession["start"]>[0];
  goalRuntime?: AgentGoalRuntime;
}

export class ClaudeGoalRuntimeRegistrationError extends Error {
  constructor(public readonly dispatch: RuntimeInstructionDispatch) {
    super(
      `Failed to replay pending Goal instructions: ${dispatch.status}`,
      dispatch.status === "transport_failed"
        ? { cause: dispatch.error }
        : undefined,
    );
    this.name = "ClaudeGoalRuntimeRegistrationError";
  }
}

export class ClaudeGoalRuntimeEpochMismatchError extends Error {
  readonly code = "run_epoch_mismatch";

  constructor(
    public readonly runtimeSessionId: string,
    public readonly expectedRunEpoch: number,
    public readonly actualRunEpoch: number,
  ) {
    super(
      `Cannot register Claude Runtime Session ${runtimeSessionId} at runEpoch ${actualRunEpoch}; OpenLoomi expects ${expectedRunEpoch}`,
    );
    this.name = "ClaudeGoalRuntimeEpochMismatchError";
  }
}

export class ClaudeGoalRuntimeRecoveryRequiredError extends Error {
  readonly code = "run_epoch_recovery_required";

  constructor(
    public readonly runtimeSessionId: string,
    public readonly runEpoch: number,
  ) {
    super(
      `Claude Runtime Session ${runtimeSessionId} requires runEpoch ${runEpoch} recovery, which is not available before durable restart recovery is implemented`,
    );
    this.name = "ClaudeGoalRuntimeRecoveryRequiredError";
  }
}

/**
 * Reserves the owner-scoped runtime identity, starts the Claude SDK Query, then
 * replays its pending instruction outbox. Registration is synchronous, so no
 * command can observe the transport between reservation and Query startup.
 * Startup, registration, and replay form one lifecycle boundary: any failure
 * releases the registry handle and closes the runtime. An unauthenticated
 * session is deliberately not registered in a shared anonymous namespace.
 */
export async function startClaudeGoalRuntimeSession(
  input: StartClaudeGoalRuntimeSessionInput,
): Promise<RuntimeSessionRegistration | undefined> {
  const ownerId = resolveAuthenticatedGoalRuntimeOwnerId(input.session);
  if (!ownerId) {
    input.runtime.start(input.start);
    return undefined;
  }

  const goalRuntime = input.goalRuntime ?? getAgentGoalRuntime();
  let registration: RuntimeSessionRegistration | undefined;
  try {
    const expectedRunEpoch = await goalRuntime.goals.getRuntimeSessionRunEpoch(
      ownerId,
      input.runtime.runtimeSessionId,
    );
    if (input.runtime.runEpoch !== expectedRunEpoch) {
      throw new ClaudeGoalRuntimeEpochMismatchError(
        input.runtime.runtimeSessionId,
        expectedRunEpoch,
        input.runtime.runEpoch,
      );
    }
    if (expectedRunEpoch > 0) {
      throw new ClaudeGoalRuntimeRecoveryRequiredError(
        input.runtime.runtimeSessionId,
        expectedRunEpoch,
      );
    }
    input.runtime.attachEventObserver(
      new ClaudeRuntimeEventObserver(
        ownerId,
        input.runtime.runtimeSessionId,
        goalRuntime.observations,
      ),
    );
    registration = goalRuntime.sessions.register({
      ownerId,
      transport: input.runtime,
    });
    input.runtime.start(input.start);
    const replay = await goalRuntime.goals.replayPendingInstructions(
      ownerId,
      input.runtime.runtimeSessionId,
    );
    if (replay !== null && replay.status !== "accepted") {
      throw new ClaudeGoalRuntimeRegistrationError(replay);
    }
    return registration;
  } catch (error) {
    try {
      await input.runtime.close();
    } finally {
      registration?.release();
    }
    throw error;
  }
}

export function resolveAuthenticatedGoalRuntimeOwnerId(
  session: unknown,
): string | undefined {
  if (!session || typeof session !== "object") return undefined;

  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return undefined;

  const id = (user as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;

  if (id.length === 0 || id.length > 256 || id !== id.trim()) {
    return undefined;
  }
  return id;
}
