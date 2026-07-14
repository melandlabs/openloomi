/**
 * LLM provider resolver + three concrete provider implementations.
 *
 * The resolver is the single entry point every "AI API" call site should go
 * through: chat, Chronicle analyze, embeddings, anything that currently
 * fetches `/api/ai/v1/messages` or `/api/ai/v1/chat/completions` directly.
 *
 * Resolution order (see {@link resolveLlmProvider}):
 *   1. User-configured `anthropic_compatible` / `openai_compatible` row
 *      that matches the call site's `prefer` — returns an HTTP provider.
 *   2. The configured agent runtime (`OPENLOOMI_AGENT_PROVIDER`) — returns
 *      an {@link AgentRuntimeProvider} that shells out to the matching CLI.
 *   3. `undefined` — caller surfaces a config error to the user.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import type { NativeAgentRequest } from "@openloomi/ai/agent/native-runner";
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
} from "@openloomi/ai/agent/types";

import { nativeAgentHost } from "./native-agent/host";
import { resolveNativeAgentProviderRequest } from "./native-agent/provider-env";
import type {
  LlmCompleteRequest,
  LlmCompleteResponse,
  LlmImage,
  LlmProvider,
  ProviderKind,
} from "./provider";
import {
  getUserLlmProviderConfig,
  type UserLlmProviderConfig,
} from "./user-llm-api-settings";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resolve the LLM provider for a call site.
 *
 * `prefer` controls which HTTP provider wins in step 1. Call sites that
 * primarily talk Anthropic Messages (`/api/ai/v1/messages`, Chronicle
 * analyze) pass `"anthropic_messages"`. Chat-style call sites that talk
 * OpenAI Chat Completions (`/api/ai/v1/chat/completions`) pass
 * `"chat_completions"`. Either way, step 2 falls back to the agent runtime
 * — so a user who only has `OPENLOOMI_AGENT_PROVIDER=codex` set still gets a
 * working provider for both call sites.
 */
export async function resolveLlmProvider({
  userId,
  prefer,
}: {
  userId?: string;
  prefer: ProviderKind;
}): Promise<LlmProvider | undefined> {
  // Step 1: user-configured HTTP provider.
  if (userId) {
    const providerType =
      prefer === "anthropic_messages"
        ? "anthropic_compatible"
        : "openai_compatible";

    const httpConfig = await getUserLlmProviderConfig({
      userId,
      providerType,
    });

    if (httpConfig) {
      return prefer === "anthropic_messages"
        ? new AnthropicMessagesHttpProvider(httpConfig)
        : new OpenAIChatHttpProvider(httpConfig);
    }
  }

  // Step 2: agent runtime. We use the same resolution function the Loop's
  // tick prompt uses (`resolveNativeAgentProviderRequest`) so the call site
  // stays in sync with whatever runtime the user picked for the Loop.
  const stub: NativeAgentRequest = { prompt: "", provider: undefined };
  const resolved = resolveNativeAgentProviderRequest(stub);
  const runtime = resolved?.provider;

  if (runtime && runtime !== "claude") {
    // Non-Claude runtimes are almost certainly the user's deliberate choice
    // (codex, opencode, hermes, openclaw). Honor it.
    return new AgentRuntimeProvider({ runtime });
  }

  // Claude runtime: the default. The user has not opted into anything
  // specific, so we don't reach for `claude` CLI here — that would shell
  // out on every chat call when the user might be expecting the API
  // defaults. Callers that want `claude` CLI explicitly can wire that up
  // later via a UI toggle.
  return undefined;
}

// =============================================================================
// HTTP providers — wrap the existing fetch() calls.
// =============================================================================

class AnthropicMessagesHttpProvider implements LlmProvider {
  readonly flavor = "anthropic_http" as const;
  readonly model: string;

  constructor(private readonly config: UserLlmProviderConfig) {
    this.model = config.model;
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const userContent: Array<Record<string, unknown>> = [];
    for (const img of request.images ?? []) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }
    const text = flattenUserText(request.userContent);
    if (text) {
      userContent.push({ type: "text", text });
    }

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? 4096,
      stream: false,
      system: request.system,
      messages: [{ role: "user", content: userContent }],
    };

    const targetUrl = joinBaseUrl(this.config.baseUrl, "/v1/messages");
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        Authorization: `Bearer ${this.config.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal:
        request.signal ??
        AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Anthropic Messages API ${response.status}: ${errText.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textOut = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      text: textOut,
      model: request.model ?? this.model,
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          }
        : undefined,
    };
  }
}

class OpenAIChatHttpProvider implements LlmProvider {
  readonly flavor = "openai_http" as const;
  readonly model: string;

  constructor(private readonly config: UserLlmProviderConfig) {
    this.model = config.model;
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const contentParts: Array<Record<string, unknown>> = [];
    for (const img of request.images ?? []) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    }
    const text = flattenUserText(request.userContent);
    if (text) {
      contentParts.push({ type: "text", text });
    }

    const messages: Array<{ role: string; content: unknown }> = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    messages.push({ role: "user", content: contentParts });

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? 4096,
      stream: false,
      messages,
    };

    const targetUrl = joinBaseUrl(this.config.baseUrl, "/v1/chat/completions");
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal:
        request.signal ??
        AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Chat Completions API ${response.status}: ${errText.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const textOut = data.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      text: textOut,
      model: request.model ?? this.model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

// =============================================================================
// Agent runtime provider — invoke the configured CLI
// =============================================================================

/**
 * Wraps a registered agent runtime (Codex / Claude / OpenCode / Hermes /
 * Openclaw) as a single-shot completion provider.
 *
 * The agent's `run(prompt, options)` returns an `AsyncGenerator<AgentMessage>`;
 * this provider collects the `text` events and assembles a single response.
 * Image inputs are written to a temp directory and the path is included in
 * the prompt, because not every CLI accepts image bytes directly — Codex
 * doesn't, for example. Claude's SDK path additionally receives the image
 * via `options.images` and can short-circuit the file-read step.
 */
class AgentRuntimeProvider implements LlmProvider {
  readonly flavor = "agent_runtime" as const;
  readonly model: string;

  constructor(private readonly options: { runtime: string }) {
    this.model = "agent-runtime";
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    // Ensure all runtimes are registered.
    await nativeAgentHost.registerProviders?.();

    // Resolve the runtime's providerConfig + model from env (same source the
    // Loop tick uses, via `resolveNativeAgentProviderRequest`).
    const stub: NativeAgentRequest = {
      prompt: "",
      provider: this.options.runtime as AgentProvider,
    };
    const resolved = resolveNativeAgentProviderRequest(stub);

    const config: AgentConfig = {
      provider: (resolved.provider ?? this.options.runtime) as AgentProvider,
      model: request.model ?? resolved.modelConfig?.model,
      providerConfig: resolved.providerConfig,
      workDir: tmpdir(),
    };

    const registry = getAgentRegistry();
    const agent = registry.create(config);

    // Image handling: materialize to disk and embed the path in the prompt.
    // The Claude path additionally receives the bytes via `options.images`,
    // so it can use the SDK's native vision path; other CLIs (Codex, etc.)
    // fall back to reading the file from disk.
    const imagePaths = await materializeImages(request.images ?? []);

    const userText = flattenUserText(request.userContent);
    const promptParts: string[] = [];
    if (request.system) {
      promptParts.push(request.system);
    }
    if (imagePaths.length > 0) {
      promptParts.push(
        `[System Note: ${imagePaths.length} image(s) have been saved to disk; read them and incorporate into your response:\n${imagePaths
          .map((p) => `- ${p}`)
          .join(
            "\n",
          )}]\n\nIf you cannot read images directly, describe what you would do with them and ask the user to provide the image text.`,
      );
    }
    if (userText) {
      promptParts.push(userText);
    }
    const finalPrompt = promptParts.join("\n\n");

    // Set up abort + timeout.
    const abortController = new AbortController();
    if (request.signal) {
      if (request.signal.aborted) {
        abortController.abort();
      } else {
        request.signal.addEventListener(
          "abort",
          () => abortController.abort(),
          {
            once: true,
          },
        );
      }
    }
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    const agentOptions: AgentOptions = {
      cwd: config.workDir,
      permissionMode: "acceptEdits",
      // Disable state-mutating tools; the agent should just read the image
      // and return text. Tools that are pure-read (Read, Glob, Grep) stay
      // available so the agent can resolve the file path.
      disallowedTools: [
        "Bash",
        "Write",
        "Edit",
        "MultiEdit",
        "NotebookEdit",
        "WebFetch",
        "WebSearch",
        "Skill",
        "Task",
        "TodoWrite",
        "LSP",
      ],
      abortController,
      stream: true,
      images: (request.images ?? []).map((img) => ({
        data: img.base64,
        mimeType: img.mediaType,
      })),
    };

    let text = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let sawError: string | undefined;

    try {
      for await (const message of agent.run(finalPrompt, agentOptions)) {
        accumulateAgentMessage(message, {
          onText: (chunk) => {
            text += chunk;
          },
          onUsage: (u) => {
            usage = u;
          },
          onError: (msg) => {
            sawError = msg;
          },
        });
        if (sawError) break;
      }
    } finally {
      clearTimeout(timer);
    }

    if (sawError) {
      throw new Error(
        `Agent runtime ${this.options.runtime} error: ${sawError}`,
      );
    }

    return {
      text: text.trim(),
      model: request.model ?? config.model ?? this.model,
      usage,
    };
  }
}

// =============================================================================
// Shared helpers
// =============================================================================

function flattenUserText(
  userContent: string | Array<{ type: "text"; text: string }>,
): string {
  if (typeof userContent === "string") return userContent;
  return userContent
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function joinBaseUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // If the user already provided a path that ends in /v1, just append the
  // remaining segment. Otherwise, append the full path.
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}${path.replace(/^\/v1/, "")}`;
  }
  return `${trimmed}${path}`;
}

async function materializeImages(images: LlmImage[]): Promise<string[]> {
  if (images.length === 0) return [];
  const dir = tmpdir();
  const paths: string[] = [];
  for (const img of images) {
    const ext = mediaTypeToExt(img.mediaType);
    const filename = `openloomi-img-${randomUUID()}.${ext}`;
    const path = join(dir, filename);
    await writeFile(path, Buffer.from(img.base64, "base64"));
    paths.push(path);
  }
  return paths;
}

function mediaTypeToExt(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function accumulateAgentMessage(
  message: AgentMessage,
  sinks: {
    onText: (chunk: string) => void;
    onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
    onError: (msg: string) => void;
  },
): void {
  if (message.type === "text" && message.content) {
    sinks.onText(message.content);
  } else if (message.type === "result" && message.usage) {
    sinks.onUsage(message.usage);
  } else if (message.type === "error" && message.message) {
    sinks.onError(message.message);
  }
}
