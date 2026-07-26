import {
  getAgentGoalRuntime,
  type AgentGoalRuntime,
  type RuntimeInstructionDispatch,
  type RuntimeSessionRegistration,
} from "@/lib/ai/runtime-instructions";
import type { ClaudeRuntimeSession } from "./session";

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
  const ownerId = authenticatedOwnerId(input.session);
  if (!ownerId) {
    input.runtime.start(input.start);
    return undefined;
  }

  const goalRuntime = input.goalRuntime ?? getAgentGoalRuntime();
  let registration: RuntimeSessionRegistration | undefined;
  try {
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
    registration?.release();
    await input.runtime.close();
    throw error;
  }
}

function authenticatedOwnerId(session: unknown): string | undefined {
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
