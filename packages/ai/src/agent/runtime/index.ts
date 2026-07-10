import { randomUUID } from "node:crypto";

import { type AgentRegistry, getAgentRegistry } from "../registry";
import type { AgentConfig, AgentMessage, AgentOptions, IAgent } from "../types";

export interface AgentRuntimeRequest {
  prompt: string;
  phase?: "plan" | "execute";
  planId?: string;
  config: AgentConfig;
  options?: AgentOptions;
}

type AgentPermissionRequest = Parameters<
  NonNullable<AgentOptions["onPermissionRequest"]>
>[0];

export type AgentRuntimePermissionRequest = AgentPermissionRequest & {
  /** Opaque OpenLoomi request id exposed to clients instead of provider ids. */
  requestId: string;
};

export type AgentRuntimePermissionDecision = Awaited<
  ReturnType<NonNullable<AgentOptions["onPermissionRequest"]>>
>;

export type AgentRuntimePermissionHandler = (
  request: AgentRuntimePermissionRequest,
) => Promise<AgentRuntimePermissionDecision>;

export interface AgentRuntimeContext {
  registry?: AgentRegistry;
  permissionHandler?: AgentRuntimePermissionHandler;
  emitPermissionRequestEvents?: boolean;
  detectPasswordPrompt?: (output: string) => boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface AgentRuntimeRun {
  generator: AsyncGenerator<AgentMessage>;
  shouldAbortOnClose: () => boolean;
}

export class AgentRuntimeRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AgentRuntimeRequestError";
  }
}

interface ResolvedAgentRuntimeContext {
  registry: AgentRegistry;
  permissionHandler?: AgentRuntimePermissionHandler;
  emitPermissionRequestEvents: boolean;
  detectPasswordPrompt?: (output: string) => boolean;
  logger: Pick<Console, "log" | "warn" | "error">;
}

/**
 * Shared native agent execution loop.
 *
 * Hosts own app-specific preparation such as auth, DB reads, RAG hydration,
 * provider registration, and prompt assembly. This package runtime owns the
 * provider-neutral execution flow: run/plan/execute dispatch, permission event
 * materialization, sudo password prompts, and lifecycle state.
 */
export async function runAgentRuntimeRequest(
  request: AgentRuntimeRequest,
  context: AgentRuntimeContext = {},
): Promise<AgentRuntimeRun> {
  validateAgentRuntimeRequest(request);

  const runtimeContext = resolveRuntimeContext(context);
  const agent = runtimeContext.registry.create(request.config);
  const agentOptions = request.options ?? {};
  const runtimeEventQueue = new RuntimeEventQueue();
  const pendingSudoCommands = new Map<
    string,
    { command: string; cwd?: string }
  >();

  let selectedGenerator: AsyncGenerator<AgentMessage>;

  if (request.phase === "plan") {
    selectedGenerator = agent.plan(request.prompt, {
      ...agentOptions,
      onPermissionRequest: async (permissionRequest) => {
        runtimeContext.logger.log(
          "[AgentRuntime] Permission request (plan mode):",
          permissionRequest,
        );
        // Planning should describe actions, not perform protected tool calls.
        return { behavior: "allow" };
      },
    });
  } else if (request.phase === "execute") {
    if (!request.planId) {
      throw new AgentRuntimeRequestError(
        "planId is required for execute phase",
        400,
      );
    }

    const plan = agent.getPlan(request.planId);
    if (!plan) {
      throw new AgentRuntimeRequestError("Plan not found or expired", 404);
    }

    selectedGenerator = createExecuteGenerator({
      agent,
      planId: request.planId,
      finalPrompt: request.prompt,
      agentOptions,
      runtimeEventQueue,
      runtimeContext,
    });
  } else {
    selectedGenerator = createRunGenerator({
      agent,
      finalPrompt: request.prompt,
      agentOptions,
      runtimeEventQueue,
      pendingSudoCommands,
      runtimeContext,
    });
  }

  let completedNormally = false;
  const generator = (async function* () {
    yield* selectedGenerator;
    completedNormally = true;
  })();

  return {
    generator,
    shouldAbortOnClose: () => !completedNormally,
  };
}

function validateAgentRuntimeRequest(request: AgentRuntimeRequest) {
  if (!request.prompt) {
    throw new AgentRuntimeRequestError("prompt is required", 400);
  }

  if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
    throw new AgentRuntimeRequestError(
      "prompt must be a non-empty string",
      400,
    );
  }
}

function resolveRuntimeContext(
  context: AgentRuntimeContext,
): ResolvedAgentRuntimeContext {
  return {
    registry: context.registry ?? getAgentRegistry(),
    permissionHandler: context.permissionHandler,
    emitPermissionRequestEvents: context.emitPermissionRequestEvents ?? false,
    detectPasswordPrompt: context.detectPasswordPrompt,
    logger: context.logger ?? console,
  };
}

function createExecuteGenerator({
  agent,
  planId,
  finalPrompt,
  agentOptions,
  runtimeEventQueue,
  runtimeContext,
}: {
  agent: IAgent;
  planId: string;
  finalPrompt: string;
  agentOptions: AgentOptions;
  runtimeEventQueue: RuntimeEventQueue;
  runtimeContext: ResolvedAgentRuntimeContext;
}): AsyncGenerator<AgentMessage> {
  return (async function* () {
    const innerGenerator = agent.execute({
      planId,
      originalPrompt: finalPrompt,
      ...agentOptions,
      onInsightChange: (data) => {
        runtimeEventQueue.push({
          type: "insightsRefresh",
          ...data,
        });
      },
      onPermissionRequest: async (permissionRequest) => {
        runtimeContext.logger.log(
          "[AgentRuntime] Permission request (execute mode):",
          permissionRequest,
        );
        return resolvePermissionRequest({
          permissionRequest,
          agentOptions,
          runtimeEventQueue,
          runtimeContext,
        });
      },
    });

    yield* multiplexAgentMessages(innerGenerator, runtimeEventQueue);
  })();
}

function createRunGenerator({
  agent,
  finalPrompt,
  agentOptions,
  runtimeEventQueue,
  pendingSudoCommands,
  runtimeContext,
}: {
  agent: IAgent;
  finalPrompt: string;
  agentOptions: AgentOptions;
  runtimeEventQueue: RuntimeEventQueue;
  pendingSudoCommands: Map<string, { command: string; cwd?: string }>;
  runtimeContext: ResolvedAgentRuntimeContext;
}): AsyncGenerator<AgentMessage> {
  return (async function* () {
    const innerGenerator = agent.run(finalPrompt, {
      ...agentOptions,
      onInsightChange: (data) => {
        runtimeEventQueue.push({
          type: "insightsRefresh",
          ...data,
        });
      },
      onPermissionRequest: async (permissionRequest) => {
        runtimeContext.logger.log(
          "[AgentRuntime] Permission request (run mode):",
          permissionRequest,
        );

        rememberSudoCommand(permissionRequest, pendingSudoCommands);

        return resolvePermissionRequest({
          permissionRequest,
          agentOptions,
          runtimeEventQueue,
          runtimeContext,
        });
      },
    });

    yield* multiplexAgentMessages(
      innerGenerator,
      runtimeEventQueue,
      (message) => {
        if (
          message.type === "tool_result" &&
          message.output &&
          message.toolUseId &&
          runtimeContext.detectPasswordPrompt?.(message.output)
        ) {
          const pendingCommand = pendingSudoCommands.get(message.toolUseId);
          if (pendingCommand) {
            runtimeContext.logger.log(
              "[AgentRuntime] Detected sudo password prompt for toolUseID:",
              message.toolUseId,
            );
            return [
              {
                type: "password_input",
                toolUseId: message.toolUseId,
                passwordInput: {
                  toolUseID: message.toolUseId,
                  originalCommand: pendingCommand.command,
                },
              },
              message,
            ];
          }
        }

        return [message];
      },
    );
  })();
}

function rememberSudoCommand(
  permissionRequest: AgentPermissionRequest,
  pendingSudoCommands: Map<string, { command: string; cwd?: string }>,
) {
  if (permissionRequest.toolName !== "Bash") {
    return;
  }

  const command = permissionRequest.toolInput?.command;
  if (typeof command === "string" && /\bsudo\b/.test(command)) {
    pendingSudoCommands.set(permissionRequest.toolUseID, {
      command,
      cwd:
        typeof permissionRequest.toolInput?.cwd === "string"
          ? permissionRequest.toolInput.cwd
          : undefined,
    });
  }
}

function resolvePermissionRequest({
  permissionRequest,
  agentOptions,
  runtimeEventQueue,
  runtimeContext,
}: {
  permissionRequest: AgentPermissionRequest;
  agentOptions: AgentOptions;
  runtimeEventQueue: RuntimeEventQueue;
  runtimeContext: ResolvedAgentRuntimeContext;
}): Promise<AgentRuntimePermissionDecision> {
  const runtimePermissionRequest: AgentRuntimePermissionRequest = {
    ...permissionRequest,
    requestId: randomUUID(),
  };

  if (runtimeContext.emitPermissionRequestEvents) {
    runtimeEventQueue.push({
      type: "permission_request",
      permissionRequest: runtimePermissionRequest,
    });
  }

  if (runtimeContext.permissionHandler) {
    return runtimeContext.permissionHandler(runtimePermissionRequest);
  }

  if (agentOptions.permissionMode === "dontAsk") {
    runtimeContext.logger.log(
      "[AgentRuntime] Permission request auto-denied because permissionMode is dontAsk:",
      permissionRequest,
    );
  } else {
    runtimeContext.logger.warn(
      "[AgentRuntime] No permission handler configured; denying request:",
      permissionRequest,
    );
  }
  return Promise.resolve({ behavior: "deny" });
}

async function* multiplexAgentMessages(
  innerGenerator: AsyncGenerator<AgentMessage>,
  runtimeEventQueue: RuntimeEventQueue,
  transformMessage: (message: AgentMessage) => AgentMessage[] = (message) => [
    message,
  ],
): AsyncGenerator<AgentMessage> {
  let finished = false;
  let pendingNext = innerGenerator.next();

  try {
    while (!finished) {
      const queuedEvent = runtimeEventQueue.shift();
      if (queuedEvent) {
        yield queuedEvent;
        continue;
      }

      const outcome = await Promise.race([
        pendingNext.then((result) => ({ type: "agent" as const, result })),
        runtimeEventQueue.waitForEvent().then(() => ({
          type: "runtime" as const,
        })),
      ]);

      if (outcome.type === "runtime") {
        continue;
      }

      // A provider can resolve its next message in the same microtask that it
      // asks for permission. Always expose queued control events first.
      for (const event of runtimeEventQueue.drain()) {
        yield event;
      }

      if (outcome.result.done) {
        finished = true;
        break;
      }

      for (const message of transformMessage(outcome.result.value)) {
        yield message;
      }
      pendingNext = innerGenerator.next();
    }
  } finally {
    if (!finished) {
      await innerGenerator.return(undefined);
    }
  }
}

class RuntimeEventQueue {
  private readonly events: AgentMessage[] = [];
  private eventSignal = createSignal();

  push(event: AgentMessage): void {
    this.events.push(event);
    this.eventSignal.resolve();
    this.eventSignal = createSignal();
  }

  shift(): AgentMessage | undefined {
    return this.events.shift();
  }

  drain(): AgentMessage[] {
    return this.events.splice(0);
  }

  waitForEvent(): Promise<void> {
    return this.eventSignal.promise;
  }
}

function createSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
