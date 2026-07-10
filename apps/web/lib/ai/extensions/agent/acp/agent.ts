import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { PROTOCOL_VERSION, type ContentBlock } from "@agentclientprotocol/sdk";
import {
  BaseAgent,
  formatPlanForExecution,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
} from "@openloomi/ai/agent";
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from "@openloomi/ai/agent/types";

import {
  AcpCommandNotFoundError,
  AcpStdioClient,
  type AcpStdioClientEvent,
} from "./stdio-client";
import {
  convertAcpNotification,
  convertAcpPromptResponse,
  mapAcpPermissionRequest,
} from "./mapper";
import { addConversationContext } from "../prompt-context";

export interface AcpRuntimeDefinition {
  provider: AgentProvider;
  displayName: string;
  buildCommand: (providerConfig?: Record<string, unknown>) => {
    command: string;
    args: string[];
  };
  normalizeProviderConfig: (providerConfig?: Record<string, unknown>) => {
    timeoutMs?: number;
  };
  supportsSetModel?: boolean;
}

interface ActiveAcpRun {
  client: AcpStdioClient;
  acpSessionId?: string;
}

export class AcpAgent extends BaseAgent {
  readonly provider: AgentProvider;

  private messageCounter = 0;
  private activeRuns = new Map<string, ActiveAcpRun>();

  constructor(
    config: AgentConfig,
    private readonly runtime: AcpRuntimeDefinition,
  ) {
    super(config);
    this.provider = runtime.provider;
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession("executing", {
      abortController: options?.abortController,
    });

    yield {
      type: "session",
      sessionId: session.id,
      messageId: this.generateMessageId(),
    };

    try {
      const cwd = await this.resolveAndPrepareWorkDir(options);
      yield* this.runAcpPrompt(session.id, prompt, cwd, options, "run");
    } catch (error) {
      yield this.toErrorMessage(error);
    } finally {
      await this.cleanupRun(session.id);
      yield { type: "done", messageId: this.generateMessageId() };
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession("planning", {
      abortController: options?.abortController,
    });

    yield {
      type: "session",
      sessionId: session.id,
      messageId: this.generateMessageId(),
    };

    let fullResponse = "";

    try {
      const cwd = await this.resolveAndPrepareWorkDir(options);
      const planningPrompt = `${PLANNING_INSTRUCTION(options?.timezone ?? undefined)}\n\n${prompt}`;
      const planningOptions: AgentOptions = {
        ...options,
        permissionMode: "plan",
      };

      for await (const message of this.runAcpPrompt(
        session.id,
        planningPrompt,
        cwd,
        planningOptions,
        "plan",
      )) {
        if (message.type === "text" && message.content) {
          fullResponse += message.content;
          yield message;
        } else if (message.type === "error") {
          yield message;
          return;
        }
      }

      const planningResult = parsePlanningResponse(fullResponse);
      if (planningResult?.type === "direct_answer") {
        yield {
          type: "direct_answer",
          content: planningResult.answer,
          messageId: this.generateMessageId(),
        };
        return;
      }

      const plan =
        planningResult?.type === "plan"
          ? planningResult.plan
          : parsePlanFromResponse(fullResponse);
      if (plan && plan.steps.length > 0) {
        this.storePlan(plan);
        yield {
          type: "plan",
          plan,
          messageId: this.generateMessageId(),
        };
        return;
      }

      if (fullResponse.trim()) {
        yield {
          type: "direct_answer",
          content: fullResponse.trim(),
          messageId: this.generateMessageId(),
        };
      }
    } catch (error) {
      yield this.toErrorMessage(error);
    } finally {
      await this.cleanupRun(session.id);
      yield { type: "done", messageId: this.generateMessageId() };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);

    if (!plan) {
      yield {
        type: "session",
        sessionId: options.sessionId,
        messageId: this.generateMessageId(),
      };
      yield {
        type: "error",
        message: `Plan not found: ${options.planId}`,
        messageId: this.generateMessageId(),
      };
      yield { type: "done", messageId: this.generateMessageId() };
      return;
    }

    let completedSuccessfully = false;

    try {
      const cwd = await this.resolveAndPrepareWorkDir(options);
      const executionPrompt = `${formatPlanForExecution(
        plan,
        cwd,
        undefined,
        options.aiSoulPrompt ?? undefined,
        options.language ?? undefined,
        options.timezone ?? undefined,
      )}\n\nOriginal request: ${options.originalPrompt}`;

      let sawError = false;
      for await (const message of this.run(executionPrompt, {
        ...options,
        cwd,
      })) {
        if (message.type === "error") {
          sawError = true;
        }
        yield message;
      }

      completedSuccessfully =
        !sawError && !options.abortController?.signal.aborted;
    } finally {
      if (completedSuccessfully) {
        this.deletePlan(options.planId);
      }
    }
  }

  override async stop(sessionId: string): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId);
    if (activeRun) {
      await activeRun.client.cancel(activeRun.acpSessionId);
    }
    await super.stop(sessionId);
  }

  override async shutdown(): Promise<void> {
    for (const sessionId of Array.from(this.activeRuns.keys())) {
      await this.stop(sessionId);
    }
    await super.shutdown();
  }

  private async *runAcpPrompt(
    sessionId: string,
    prompt: string,
    cwd: string,
    options: AgentOptions | undefined,
    mode: "run" | "plan" | "execute",
  ): AsyncGenerator<AgentMessage> {
    const providerConfig = this.runtime.normalizeProviderConfig(
      this.config.providerConfig,
    );
    const command = this.runtime.buildCommand(this.config.providerConfig);
    const effectivePrompt = addConversationContext(prompt, options);
    const client = new AcpStdioClient(
      this.runtime.displayName,
      command.command,
      command.args,
      {
        cwd,
        signal: this.getSession(sessionId)?.abortController.signal,
        timeoutMs: providerConfig.timeoutMs,
        onRequest: async (request) => {
          if (request.method !== "session/request_permission") {
            return { outcome: { outcome: "cancelled" } };
          }
          return mapAcpPermissionRequest(
            request.params,
            options,
            mode,
            this.runtime.displayName,
          );
        },
      },
    );

    this.activeRuns.set(sessionId, { client });
    client.start();

    await client.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: "openloomi",
        version: "1.0.0",
      },
      clientCapabilities: {},
    });

    const sessionResponse = asRecord(
      await client.request("session/new", {
        cwd,
        mcpServers: [],
      }),
    );
    const acpSessionId =
      typeof sessionResponse?.sessionId === "string"
        ? sessionResponse.sessionId
        : undefined;
    if (!acpSessionId) {
      throw new Error(
        `${this.runtime.displayName} ACP session/new did not return a sessionId`,
      );
    }

    if (this.config.model && this.runtime.supportsSetModel) {
      await client.request("session/set_model", {
        sessionId: acpSessionId,
        modelId: this.config.model,
      });
    }

    const activeRun = this.activeRuns.get(sessionId);
    if (activeRun) {
      activeRun.acpSessionId = acpSessionId;
    }

    let promptSettled = false;
    let promptResult: unknown;
    let promptError: unknown;
    const promptPromise = client
      .request("session/prompt", {
        sessionId: acpSessionId,
        prompt: buildAcpPromptBlocks(effectivePrompt, options),
      })
      .then((result) => {
        promptSettled = true;
        promptResult = result;
      })
      .catch((error) => {
        promptSettled = true;
        promptError = error;
      });

    while (!promptSettled) {
      const event = await Promise.race([
        client.nextEvent(),
        promptPromise.then(() => undefined),
      ]);

      if (!event) {
        continue;
      }

      for (const message of this.convertClientEvent(event)) {
        yield this.withMessageId(message);
      }
    }

    await promptPromise;
    if (promptError) {
      throw promptError;
    }

    for (const event of client.drainEvents()) {
      for (const message of this.convertClientEvent(event)) {
        yield this.withMessageId(message);
      }
    }

    for (const message of convertAcpPromptResponse(
      promptResult,
      this.runtime.displayName,
    )) {
      yield this.withMessageId(message);
    }
  }

  private convertClientEvent(event: AcpStdioClientEvent): AgentMessage[] {
    if (event.type === "notification" && event.method === "session/update") {
      return convertAcpNotification(event.params, this.runtime.displayName);
    }

    if (event.type === "diagnostic") {
      return [{ type: "error", message: event.message }];
    }

    if (event.type === "close" && event.exitCode !== 0) {
      const output = event.stderr.trim() || event.stdout.trim();
      if (event.timedOut) {
        return [
          {
            type: "error",
            message: output
              ? `${this.runtime.displayName} ACP timed out after ${event.timeoutMs}ms: ${output}`
              : `${this.runtime.displayName} ACP timed out after ${event.timeoutMs}ms`,
          },
        ];
      }
      return [
        {
          type: "error",
          message: output
            ? `${this.runtime.displayName} ACP exited with code ${event.exitCode}: ${output}`
            : `${this.runtime.displayName} ACP exited with code ${event.exitCode}`,
        },
      ];
    }

    return [];
  }

  private async cleanupRun(sessionId: string) {
    const activeRun = this.activeRuns.get(sessionId);
    if (activeRun) {
      await activeRun.client.shutdown();
      this.activeRuns.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }

  private withMessageId(message: AgentMessage): AgentMessage {
    return message.messageId
      ? message
      : { ...message, messageId: this.generateMessageId() };
  }

  private toErrorMessage(error: unknown): AgentMessage {
    return {
      type: "error",
      message:
        error instanceof AcpCommandNotFoundError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      messageId: this.generateMessageId(),
    };
  }

  private generateMessageId(): string {
    return `${this.runtime.provider}_msg_${Date.now()}_${++this.messageCounter}`;
  }

  private async resolveAndPrepareWorkDir(options?: AgentOptions) {
    const rawWorkDir = options?.cwd || this.config.workDir || process.cwd();
    const resolved = resolveHome(rawWorkDir);
    await mkdir(resolved, { recursive: true });
    return resolved;
  }
}

function resolveHome(filePath: string) {
  if (filePath === "~") {
    return homedir();
  }
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return join(homedir(), filePath.slice(2));
  }
  return isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function buildAcpPromptBlocks(
  prompt: string,
  options?: AgentOptions,
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text: prompt }];
  for (const image of options?.images ?? []) {
    if (!image.data) continue;
    blocks.push({
      type: "image",
      data: image.data.replace(/^data:[^;]+;base64,/, ""),
      mimeType: image.mimeType,
    });
  }
  return blocks;
}
