import { getAgentRegistry, type AgentRegistry } from "../registry";
import type { AgentConfig, AgentMessage, AgentOptions, IAgent } from "../types";

export interface AgentRuntimeRequest {
  prompt: string;
  phase?: "plan" | "execute";
  planId?: string;
  config: AgentConfig;
  options?: AgentOptions;
}

export type AgentRuntimePermissionRequest = Parameters<
  NonNullable<AgentOptions["onPermissionRequest"]>
>[0];

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

type InsightChange = Parameters<
  NonNullable<AgentOptions["onInsightChange"]>
>[0];

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
  const permissionRequestEventQueue: AgentRuntimePermissionRequest[] = [];
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
      permissionRequestEventQueue,
      runtimeContext,
    });
  } else {
    selectedGenerator = createRunGenerator({
      agent,
      finalPrompt: request.prompt,
      agentOptions,
      permissionRequestEventQueue,
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
  permissionRequestEventQueue,
  runtimeContext,
}: {
  agent: IAgent;
  planId: string;
  finalPrompt: string;
  agentOptions: AgentOptions;
  permissionRequestEventQueue: AgentRuntimePermissionRequest[];
  runtimeContext: ResolvedAgentRuntimeContext;
}): AsyncGenerator<AgentMessage> {
  const insightChangeEventQueue: InsightChange[] = [];

  return (async function* () {
    const innerGenerator = agent.execute({
      planId,
      originalPrompt: finalPrompt,
      ...agentOptions,
      onInsightChange: (data) => {
        insightChangeEventQueue.push(data);
      },
      onPermissionRequest: async (permissionRequest) => {
        runtimeContext.logger.log(
          "[AgentRuntime] Permission request (execute mode):",
          permissionRequest,
        );
        return resolvePermissionRequest({
          permissionRequest,
          agentOptions,
          permissionRequestEventQueue,
          runtimeContext,
        });
      },
    });

    for await (const message of innerGenerator) {
      yield message;
      yield* drainQueuedAgentEvents(
        insightChangeEventQueue,
        permissionRequestEventQueue,
      );
    }
  })();
}

function createRunGenerator({
  agent,
  finalPrompt,
  agentOptions,
  permissionRequestEventQueue,
  pendingSudoCommands,
  runtimeContext,
}: {
  agent: IAgent;
  finalPrompt: string;
  agentOptions: AgentOptions;
  permissionRequestEventQueue: AgentRuntimePermissionRequest[];
  pendingSudoCommands: Map<string, { command: string; cwd?: string }>;
  runtimeContext: ResolvedAgentRuntimeContext;
}): AsyncGenerator<AgentMessage> {
  const insightChangeEventQueue: InsightChange[] = [];

  return (async function* () {
    const innerGenerator = agent.run(finalPrompt, {
      ...agentOptions,
      onInsightChange: (data) => {
        insightChangeEventQueue.push(data);
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
          permissionRequestEventQueue,
          runtimeContext,
        });
      },
    });

    for await (const message of innerGenerator) {
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
          yield {
            type: "password_input",
            toolUseId: message.toolUseId,
            passwordInput: {
              toolUseID: message.toolUseId,
              originalCommand: pendingCommand.command,
            },
          };
        }
      }

      yield message;
      yield* drainQueuedAgentEvents(
        insightChangeEventQueue,
        permissionRequestEventQueue,
      );
    }
  })();
}

function rememberSudoCommand(
  permissionRequest: AgentRuntimePermissionRequest,
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
  permissionRequestEventQueue,
  runtimeContext,
}: {
  permissionRequest: AgentRuntimePermissionRequest;
  agentOptions: AgentOptions;
  permissionRequestEventQueue: AgentRuntimePermissionRequest[];
  runtimeContext: ResolvedAgentRuntimeContext;
}): Promise<AgentRuntimePermissionDecision> {
  if (runtimeContext.emitPermissionRequestEvents) {
    permissionRequestEventQueue.push(permissionRequest);
  }

  if (runtimeContext.permissionHandler) {
    return runtimeContext.permissionHandler(permissionRequest);
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

function* drainQueuedAgentEvents(
  insightChangeEventQueue: InsightChange[],
  permissionRequestEventQueue: AgentRuntimePermissionRequest[],
): Generator<AgentMessage> {
  while (insightChangeEventQueue.length > 0) {
    const event = insightChangeEventQueue.shift();
    if (event) {
      yield {
        type: "insightsRefresh",
        ...event,
      };
    }
  }

  while (permissionRequestEventQueue.length > 0) {
    const permissionRequest = permissionRequestEventQueue.shift();
    if (permissionRequest) {
      yield {
        type: "permission_request",
        permissionRequest,
      };
    }
  }
}
