import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  BaseAgent,
  defineAgentPlugin,
  formatPlanForExecution,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
} from "@openloomi/ai/agent";
import type { AgentPlugin } from "@openloomi/ai/agent/plugin";
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from "@openloomi/ai/agent/types";

import {
  buildOpenCodeRunCommand,
  normalizeOpenCodeProviderConfig,
  OpenCodeCommandNotFoundError,
  runOpenCodeCli,
  type OpenCodeCliEvent,
} from "./command";
import { OPENCODE_METADATA } from "./metadata";
import { parseOpenCodeJsonLine } from "./parser";

export class OpenCodeAgent extends BaseAgent {
  readonly provider: AgentProvider = "opencode";

  private messageCounter = 0;

  private generateMessageId(): string {
    return `opencode_msg_${Date.now()}_${++this.messageCounter}`;
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
      yield* this.runOpenCodePrompt(
        prompt,
        cwd,
        options,
        session.abortController.signal,
      );
    } catch (error) {
      yield this.toErrorMessage(error);
    } finally {
      this.sessions.delete(session.id);
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
      // TODO: Bridge OpenCode permission events once the CLI exposes a stable
      // approval protocol. Until then, planning must never opt into --auto.
      const planningOptions: AgentOptions = {
        ...options,
        permissionMode: "plan",
      };

      for await (const message of this.runOpenCodePrompt(
        planningPrompt,
        cwd,
        planningOptions,
        session.abortController.signal,
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

      yield {
        type: "direct_answer",
        content: fullResponse.trim(),
        messageId: this.generateMessageId(),
      };
    } catch (error) {
      yield this.toErrorMessage(error);
    } finally {
      this.sessions.delete(session.id);
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

  private async *runOpenCodePrompt(
    prompt: string,
    cwd: string,
    options?: AgentOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentMessage> {
    const providerConfig = normalizeOpenCodeProviderConfig(
      this.config.providerConfig,
    );
    const command = buildOpenCodeRunCommand({
      prompt,
      cwd,
      model: this.config.model,
      permissionMode: options?.permissionMode,
      providerConfig: this.config.providerConfig,
    });

    let closeEvent: Extract<OpenCodeCliEvent, { type: "close" }> | undefined;

    for await (const event of runOpenCodeCli(command.command, command.args, {
      cwd,
      env: providerConfig.env,
      signal: signal ?? options?.abortController?.signal,
      timeoutMs: providerConfig.timeoutMs,
    })) {
      if (event.type === "line") {
        for (const message of parseOpenCodeJsonLine(event.line)) {
          yield this.withMessageId(message);
        }
        continue;
      }

      closeEvent = event;
    }

    if (!closeEvent) {
      return;
    }

    if (closeEvent.exitCode !== 0) {
      yield {
        type: "error",
        message: formatOpenCodeExitError(closeEvent),
        messageId: this.generateMessageId(),
      };
      return;
    }

    yield {
      type: "result",
      content: "success",
      duration: closeEvent.duration,
      messageId: this.generateMessageId(),
    };
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
        error instanceof OpenCodeCommandNotFoundError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      messageId: this.generateMessageId(),
    };
  }

  private async resolveAndPrepareWorkDir(options?: AgentOptions) {
    const rawWorkDir = options?.cwd || this.config.workDir || process.cwd();
    const resolved = resolveHome(rawWorkDir);
    await mkdir(resolved, { recursive: true });
    return resolved;
  }
}

function formatOpenCodeExitError(
  closeEvent: Extract<OpenCodeCliEvent, { type: "close" }>,
) {
  const output = closeEvent.stderr.trim() || closeEvent.stdout.trim();
  if (closeEvent.timedOut) {
    return output
      ? `OpenCode CLI timed out after ${closeEvent.timeoutMs}ms: ${output}`
      : `OpenCode CLI timed out after ${closeEvent.timeoutMs}ms`;
  }

  return output
    ? `OpenCode CLI exited with code ${closeEvent.exitCode}: ${output}`
    : `OpenCode CLI exited with code ${closeEvent.exitCode}`;
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

export function createOpenCodeAgent(config: AgentConfig): OpenCodeAgent {
  return new OpenCodeAgent(config);
}

export const opencodePlugin: AgentPlugin = defineAgentPlugin({
  metadata: OPENCODE_METADATA,
  factory: (config) => createOpenCodeAgent(config),
});
