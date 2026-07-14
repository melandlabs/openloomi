/**
 * Unified LLM provider abstraction.
 *
 * The web app historically routed every "AI" call through one of two HTTP
 * proxies (apps/web/app/api/ai/v1/messages and apps/web/app/api/ai/v1/chat/
 * completions), each resolving a single per-user provider row of type
 * `anthropic_compatible` or `openai_compatible`. There was no third option.
 *
 * This module adds a third option: the **agent runtime**. The same Codex /
 * Claude / OpenCode / Hermes / Openclaw CLI the Loop's tick prompt uses can
 * now serve any call site that was previously tied to a static HTTP provider.
 * Callers stop depending on "did the user save an `anthropic_compatible`
 * row?" — when no HTTP config is saved, the resolver falls back to whatever
 * the agent runtime is configured to (`OPENLOOMI_AGENT_PROVIDER`).
 *
 * Resolution lives in {@link resolveLlmProvider}. The three implementations
 * (HTTP Anthropic, HTTP OpenAI, agent runtime CLI) all satisfy
 * {@link LlmProvider}, so a call site that talks to one of them is
 * structurally the same as a call site that talks to any other.
 */

export type ProviderKind = "anthropic_messages" | "chat_completions";

export type ProviderFlavor = "anthropic_http" | "openai_http" | "agent_runtime";

/** A single image input. Mirrors the shape Anthropic / OpenAI take. */
export interface LlmImage {
  /** Base64-encoded bytes (no data-URL prefix). */
  base64: string;
  /** MIME type, e.g. `image/png`, `image/jpeg`. */
  mediaType: string;
}

export interface LlmCompleteRequest {
  /** Optional system prompt. Prepended to user content for the agent runtime path. */
  system?: string;
  /**
   * User content. Either a single string (most chat / proxy call sites) or an
   * array of text blocks (the Anthropic Messages shape). The resolver
   * implementations flatten both shapes consistently.
   */
  userContent: string | Array<{ type: "text"; text: string }>;
  /** Optional image inputs (vision). HTTP providers pass these as base64 parts; agent runtime materializes to disk. */
  images?: LlmImage[];
  /** Optional model override. Falls back to the provider's configured default. */
  model?: string;
  /** Optional max tokens. */
  maxTokens?: number;
  /** Optional abort signal — forwarded to the underlying fetch / CLI. */
  signal?: AbortSignal;
  /** Optional timeout in ms. Defaults to 120_000. */
  timeoutMs?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompleteResponse {
  /** Concatenated assistant text. */
  text: string;
  /** Model that produced the response (echo of the effective model). */
  model: string;
  /** Optional token usage, when the underlying provider surfaces it. */
  usage?: LlmUsage;
}

export interface LlmProvider {
  /** Which transport / protocol this provider speaks. */
  flavor: ProviderFlavor;
  /** Default model id (or `"agent-runtime"` if the runtime decides per call). */
  model: string;
  /**
   * Single-shot completion. Implementations buffer the underlying stream
   * (HTTP `stream:false` or agent CLI events) into a single text response.
   */
  complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse>;
}
