import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_AI_MODEL } from "@/lib/env";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import { resolveLlmProvider } from "@/lib/ai/provider-resolver";
import type { LlmProvider } from "@/lib/ai/provider";
import { getUserVisionLlmSettings } from "@/lib/db/queries";

const analyzeSchema = z.object({
  screenshotPath: z.string(),
});

// Chronicle resolves its LLM provider via the shared `resolveLlmProvider`
// helper. This honours the user's saved `anthropic_compatible` HTTP config
// (or env fallback) when present, and otherwise falls back to the
// configured agent runtime (Codex / OpenCode / Hermes / Openclaw) so a
// user who has set `OPENLOOMI_AGENT_PROVIDER` but no HTTP API key still
// gets a working vision analysis.
const ANTHROPIC_MESSAGES_PATH = "/api/ai/v1/messages";

const ANALYSIS_SYSTEM_PROMPT = `You are a screen content analyzer used to build a personal "screen memory" that the user will later query in natural language.

Your job is to (a) transcribe ALL visible text on the screen verbatim, and (b) produce a short structured summary.

Output rules:
- Respond with EXACTLY one JSON object. No markdown fences, no commentary, no leading or trailing text.
- All string values MUST be valid JSON (escape newlines as \\n and quotes as \\").
- Detect the dominant language of the screen and answer "description" and "keyContent" in that same language. Keep "extractedText" in its original languages exactly as shown.

Schema:
{
  "description": "string. 2-4 sentences summarizing what the user is doing right now and what app/window is in focus. Mention the application name, window title, or page title if visible.",
  "keyContent": ["string"],
  "extractedText": "string"
}

Field-specific requirements:

1. "extractedText" — FULL transcription, this is the most important field:
   - Capture EVERY readable string on the screen, including window titles, tab titles, menus, toolbar labels, sidebar items, body text, code, chat messages, comments, captions, button labels, status bars, notification badges, URLs, file paths, timestamps, numbers, table cells, and form values.
   - Preserve original wording, punctuation, casing, language, and code indentation. Do NOT translate, summarize, paraphrase, or correct typos.
   - Use "\\n" to separate logical regions (panels, paragraphs, list items, table rows, code lines).
   - For code blocks, keep them as-is and prefix the block with the language if you can infer it, e.g. "[code:typescript]\\n...".
   - For chat/conversation interfaces, format each message as "<speaker>: <message>" on its own line.
   - If a region is too small or blurry to read, write "[unreadable]" instead of guessing.
   - Do not invent text that is not visible.

2. "keyContent" — up to 15 short strings (each ≤ 80 chars) that are the most queryable atoms of this screen:
   - Identifiers a user is likely to search for: app/window names, page/file/branch names, people, project names, error messages, key sentences, command names, URLs.
   - Each item must be a self-contained phrase, not a generic label like "code" or "menu".

3. "description" — written so it is useful as future search context, e.g. "Editing chronicle.md in VS Code, comparing two prompt designs in the right pane."`;

// Transient upstream statuses worth retrying. 408/409/425/429 = request-side
// throttling, 5xx + 529 = server-side overload. All others (400/401/403/404/413)
// are fatal — they will not recover on their own.
const RETRYABLE_UPSTREAM_STATUSES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 529,
]);

class RetryableUpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "RetryableUpstreamError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class FatalUpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FatalUpstreamError";
    this.status = status;
  }
}

// Parses the standard `Retry-After` header — either a delta-seconds integer
// or an HTTP-date — into a millisecond delay. Capped at 30s so a misbehaving
// upstream cannot stall the request indefinitely.
function parseRetryAfterHeader(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - Date.now()), 30_000);
  }
  return undefined;
}

function classifyUpstreamError(
  status: number,
  message: string,
  retryAfterMs: number | undefined,
): Error {
  if (RETRYABLE_UPSTREAM_STATUSES.has(status)) {
    return new RetryableUpstreamError(message, status, retryAfterMs);
  }
  return new FatalUpstreamError(message, status);
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("EAI_AGAIN") ||
    msg.includes("socket hang up")
  );
}

// Exponential backoff with jitter, preferring the upstream's `Retry-After`
// when present. 4 attempts at base 1s gives worst-case ~7s of waiting on top
// of the request time, which is below the typical Chronicle capture cadence.
async function withUpstreamRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = 1000;
  const maxDelayMs = 15_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof RetryableUpstreamError || isTransientNetworkError(err);
      const fatal = err instanceof FatalUpstreamError;
      if (fatal || attempt >= maxAttempts || !retryable) {
        throw err;
      }
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jittered = exp * (0.8 + Math.random() * 0.4);
      const retryAfterMs =
        err instanceof RetryableUpstreamError ? err.retryAfterMs : undefined;
      const delay =
        retryAfterMs !== undefined
          ? Math.min(retryAfterMs, maxDelayMs)
          : jittered;
      console.warn(
        `[Chronicle] Retryable upstream error (attempt ${attempt}/${maxAttempts}, status=${
          err instanceof RetryableUpstreamError ? err.status : "network"
        }), backing off ${Math.round(delay)}ms:`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();
    const { screenshotPath } = analyzeSchema.parse(body);

    const sessionCloudToken = (
      session as typeof session & { cloudAuthToken?: string }
    ).cloudAuthToken;
    const requestCloudToken = extractCloudAuthToken(request, body);
    const cloudToken = sessionCloudToken || requestCloudToken;

    let imageBuffer: Buffer;
    try {
      imageBuffer = await readFile(screenshotPath);
    } catch (error) {
      console.error("[Chronicle] Failed to read screenshot:", error);
      return new AppError(
        "not_found:api",
        "Screenshot file not found",
      ).toResponse();
    }

    // Check whether the user has enabled a custom OpenAI-compatible vision
    // endpoint. If so, bypass the internal /api/ai/v1/messages pipeline and
    // POST directly to the user's endpoint in Chat Completions format.
    const visionLlm = await getUserVisionLlmSettings(session.user.id);
    const useCustom =
      visionLlm?.enabled && visionLlm.apiUrl && visionLlm.apiKey;

    let analysis: AnalysisResult | null = null;
    let lastErr: unknown = null;

    try {
      if (useCustom) {
        // External vision endpoint — also goes through withUpstreamRetry so
        // a 529 from the user's provider is treated the same as one from the
        // internal proxy.
        analysis = await withUpstreamRetry(() =>
          analyzeScreenshotWithCustomVisionLlm({
            imageBuffer,
            apiUrl: visionLlm.apiUrl,
            apiKey: visionLlm.apiKey,
            model: visionLlm.model || "gpt-4o-mini",
          }),
        );
      } else {
        analysis = await withUpstreamRetry(() =>
          analyzeScreenshotWithMessagesAPI({
            imageBuffer,
            cloudToken,
            requestUrl: request.url,
            userId: session.user.id,
          }),
        );
      }
    } catch (err) {
      lastErr = err;
    }

    if (!analysis) {
      console.error("[Chronicle] Analysis failed after retries:", lastErr);
      analysis = fallbackAnalysis();
    }

    return NextResponse.json({
      success: true,
      description: analysis.description,
      keyContent: analysis.keyContent,
      extractedText: analysis.extractedText,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new AppError(
        "bad_request:api",
        "Invalid request body",
      ).toResponse();
    }

    console.error("[Chronicle] Analysis failed:", error);
    return new AppError(
      "bad_request:api",
      "Failed to analyze screenshot",
    ).toResponse();
  }
}

interface AnalysisResult {
  description: string;
  keyContent: string[];
  extractedText: string;
}

async function analyzeScreenshotWithMessagesAPI(params: {
  imageBuffer: Buffer;
  cloudToken: string | undefined;
  requestUrl: string;
  userId: string;
}): Promise<AnalysisResult> {
  const { imageBuffer, userId } = params;

  const base64 = imageBuffer.toString("base64");

  // Sniff media type from magic bytes so we can correctly label JPEGs that the
  // client now produces (PNG capture → 1080p JPEG re-encode to shrink the
  // upstream payload). Falling back to PNG is safe because that's what the
  // original Tauri capture always emits.
  const mediaType = detectImageMediaType(imageBuffer);

  // Resolve the provider directly via the shared resolver. This:
  //  - Honours the user's saved `anthropic_compatible` HTTP config when present.
  //  - Falls back to the configured agent runtime (Codex / OpenCode / Hermes
  //    / Openclaw) when no HTTP provider is configured — so a user who has
  //    set `OPENLOOMI_AGENT_PROVIDER=codex` and no API key still gets a
  //    working vision analysis.
  const provider: LlmProvider | undefined = await resolveLlmProvider({
    userId,
    prefer: "anthropic_messages",
  });
  if (!provider) {
    throw classifyUpstreamError(
      400,
      "Anthropic-compatible provider is not configured and no agent runtime is available. Save one in Preferences → API Settings, or set OPENLOOMI_AGENT_PROVIDER.",
      undefined,
    );
  }

  // The Anthropic-style model name only makes sense for the HTTP path.
  // For the agent runtime, let the runtime pick its own model
  // (typically `OPENLOOMI_AGENT_<RUNTIME>_MODEL`, or the runtime's default).
  // Codex would reject `claude-sonnet-5` outright; OpenCode / Hermes /
  // Openclaw have their own model ecosystems.
  const model =
    provider.flavor === "agent_runtime"
      ? undefined
      : process.env.ANTHROPIC_MODEL || DEFAULT_AI_MODEL;

  // OCR-style full transcription needs significant headroom; long screens
  // with code or chats easily exceed 1-2k tokens. With reasoning models
  // (kimi-k2.6 on OpenRouter) the chain-of-thought also eats from this
  // budget, so we leave room for both the thinking pass and the final JSON.
  // 8000 is also enough for Codex / OpenCode / Hermes / Openclaw vision
  // outputs.
  const maxTokens = 8000;

  let textContent: string;
  try {
    const result = await provider.complete({
      system: ANALYSIS_SYSTEM_PROMPT,
      userContent:
        'Transcribe every visible string on this screenshot into "extractedText" verbatim, and fill "description" and "keyContent" per the system instructions. Return strict JSON only.',
      images: [{ base64, mediaType }],
      model,
      maxTokens,
      timeoutMs: 120_000,
    });
    textContent = result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw classifyUpstreamError(
      502,
      `LLM provider (${provider.flavor}) failed: ${message}`,
      undefined,
    );
  }

  if (!textContent) {
    throw new Error(
      `LLM provider (${provider.flavor}) returned no usable text`,
    );
  }

  console.log(
    "[Chronicle] LLM analysis text (first 200 chars):",
    textContent.slice(0, 200),
  );
  return parseAnalysisJson(textContent);
}

/**
 * Analyze a screenshot using a user-provided OpenAI-compatible vision
 * endpoint. Constructs a Chat Completions–shaped request and sends it to
 * `${apiUrl}/chat/completions`.
 *
 * The system prompt (ANALYSIS_SYSTEM_PROMPT) instructs the model to output
 * strict JSON, so we reuse the same `parseAnalysisJson` parser. No streaming
 * is used — the caller expects a single synchronous response.
 */
async function analyzeScreenshotWithCustomVisionLlm(params: {
  imageBuffer: Buffer;
  apiUrl: string;
  apiKey: string;
  model: string;
}): Promise<AnalysisResult> {
  const { imageBuffer, apiUrl, apiKey, model } = params;

  const base64 = imageBuffer.toString("base64");
  const mediaType = detectImageMediaType(imageBuffer);
  const dataUrl = `data:${mediaType};base64,${base64}`;

  // Normalise the base URL: strip trailing slash if present, append
  // /chat/completions.
  const base = apiUrl.replace(/\/+$/, "");
  const targetUrl = `${base}/chat/completions`;

  const requestBody = {
    model,
    max_tokens: 8000,
    stream: false,
    messages: [
      {
        role: "system",
        content: ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
          {
            type: "text",
            text: 'Transcribe every visible string on this screenshot into "extractedText" verbatim, and fill "description" and "keyContent" per the system instructions. Return strict JSON only.',
          },
        ],
      },
    ],
  };

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    const retryAfterMs = parseRetryAfterHeader(
      response.headers.get("retry-after"),
    );
    throw classifyUpstreamError(
      response.status,
      `Custom vision LLM ${response.status} from ${targetUrl}: ${errText.slice(0, 300)}`,
      retryAfterMs,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null };
      finish_reason?: string;
    }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`Custom vision LLM error: ${data.error.message}`);
  }

  const textContent = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!textContent) {
    const finishReason = data.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(
      `Custom vision LLM returned empty content (finish_reason=${finishReason})`,
    );
  }

  console.log(
    "[Chronicle] Custom vision LLM analysis (first 200 chars):",
    textContent.slice(0, 200),
  );
  return parseAnalysisJson(textContent);
}

function parseAnalysisJson(text: string): AnalysisResult {
  let jsonStr = text;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    jsonStr = fenced[1];
  } else {
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as Partial<AnalysisResult>;
    return {
      description: parsed.description || text.slice(0, 500),
      keyContent: Array.isArray(parsed.keyContent) ? parsed.keyContent : [],
      extractedText:
        typeof parsed.extractedText === "string" ? parsed.extractedText : "",
    };
  } catch (parseError) {
    // Last resort: try parsing the original text directly
    try {
      const parsed = JSON.parse(text) as Partial<AnalysisResult>;
      return {
        description: parsed.description || text.slice(0, 500),
        keyContent: Array.isArray(parsed.keyContent) ? parsed.keyContent : [],
        extractedText:
          typeof parsed.extractedText === "string" ? parsed.extractedText : "",
      };
    } catch {
      console.warn(
        "[Chronicle] Failed to parse JSON response, using raw text:",
        parseError,
      );
      return {
        description: text.slice(0, 500),
        keyContent: [],
        extractedText: "",
      };
    }
  }
}

function detectImageMediaType(
  buffer: Buffer,
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  if (buffer.length >= 4) {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "image/png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return "image/gif";
    }
  }
  return "image/png";
}

function fallbackAnalysis(): AnalysisResult {
  return {
    description: "Screen content captured (LLM analysis not available)",
    keyContent: [`Screen capture at ${new Date().toLocaleString()}`],
    extractedText: "",
  };
}
