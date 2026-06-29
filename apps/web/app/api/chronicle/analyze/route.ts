import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_AI_MODEL } from "@/lib/env";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import { getUserVisionLlmSettings } from "@/lib/db/queries";

const analyzeSchema = z.object({
  screenshotPath: z.string(),
});

// Chronicle uses the local Anthropic Messages API proxy. The proxy at
// `/api/ai/v1/messages` reads the user's `anthropic_compatible` provider
// config from the DB (or env fallback) and forwards this body as-is to the
// upstream — no shape conversion. This is the path the original alloomi
// reference used, and it matches what the user's "Anthropic compatible"
// provider (configured in API Settings) is wired to handle.
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

    if (useCustom) {
      // Custom endpoint — single attempt (no retry loop for external APIs;
      // a second try with the same payload almost never helps).
      try {
        analysis = await analyzeScreenshotWithCustomVisionLlm({
          imageBuffer,
          apiUrl: visionLlm.apiUrl,
          apiKey: visionLlm.apiKey,
          model: visionLlm.model || "gpt-4o-mini",
        });
      } catch (err) {
        lastErr = err;
        console.error("[Chronicle] Custom vision LLM failed:", err);
      }
    } else {
      // One synchronous retry: the upstream model occasionally drops the
      // connection on its first try with vision payloads, but a re-issue with
      // the same body almost always succeeds. We cap at 2 total attempts —
      // adding more turns the user-visible latency on a real failure into a
      // multi-minute hang.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          analysis = await analyzeScreenshotWithMessagesAPI({
            imageBuffer,
            cloudToken,
            requestUrl: request.url,
          });
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[Chronicle] Analysis attempt ${attempt} threw:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
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

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessagesResponse {
  content?: Array<
    AnthropicTextBlock | { type: string; [key: string]: unknown }
  >;
  error?: { message?: string };
}

function extractTextFromMessagesResponse(
  data: AnthropicMessagesResponse,
): string {
  const blocks = data.content ?? [];

  const text = blocks
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (text) return text;

  // Last-resort: some OpenRouter adapters route reasoning-model output into
  // `thinking` / `redacted_thinking` blocks even when `thinking: disabled`
  // is requested. If JSON happened to land inside the thinking stream we
  // still want to recover it; parseAnalysisJson tolerates leading prose.
  return blocks
    .map((b) => {
      const block = b as { type?: string; thinking?: unknown };
      if (
        (block.type === "thinking" || block.type === "redacted_thinking") &&
        typeof block.thinking === "string"
      ) {
        return block.thinking;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function analyzeScreenshotWithMessagesAPI(params: {
  imageBuffer: Buffer;
  cloudToken: string | undefined;
  requestUrl: string;
}): Promise<AnalysisResult> {
  const { imageBuffer, cloudToken, requestUrl } = params;

  const base64 = imageBuffer.toString("base64");
  const targetUrl = new URL(ANTHROPIC_MESSAGES_PATH, requestUrl).toString();
  const model =
    process.env.LLM_VISION_LANGUAGE_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    DEFAULT_AI_MODEL;

  // Sniff media type from magic bytes so we can correctly label JPEGs that the
  // client now produces (PNG capture → 1080p JPEG re-encode to shrink the
  // upstream payload). Falling back to PNG is safe because that's what the
  // original Tauri capture always emits.
  const mediaType = detectImageMediaType(imageBuffer);

  const requestBody = {
    model,
    // OCR-style full transcription needs significant headroom; long screens
    // with code or chats easily exceed 1-2k tokens. With reasoning models
    // (kimi-k2.6 on OpenRouter) the chain-of-thought also eats from this
    // budget, so we leave room for both the thinking pass and the final JSON.
    max_tokens: 8000,
    stream: false,
    // Disable extended thinking. Some OpenRouter Anthropic adapters default
    // to `thinking: enabled` for newer Claude models and spend the entire
    // token budget producing `thinking` / `redacted_thinking` blocks. We
    // explicitly turn it off so the model emits a `text` block we can parse.
    thinking: { type: "disabled" },
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: "text",
            text: 'Transcribe every visible string on this screenshot into "extractedText" verbatim, and fill "description" and "keyContent" per the system instructions. Return strict JSON only.',
          },
        ],
      },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cloudToken) {
    headers.Authorization = `Bearer ${cloudToken}`;
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `Messages API ${response.status}: ${errText.slice(0, 300)}`,
    );
  }

  const responseContentType = response.headers.get("content-type") || "";

  let data: AnthropicMessagesResponse;
  if (responseContentType.includes("text/event-stream")) {
    data = await collapseAnthropicStream(response);
  } else {
    data = (await response.json()) as AnthropicMessagesResponse;
  }
  if (data.error) {
    throw new Error(`Messages API error: ${data.error.message}`);
  }

  const textContent = extractTextFromMessagesResponse(data);

  if (!textContent) {
    const blockTypes = (data.content || []).map(
      (b) => (b as { type?: string }).type || "unknown",
    );
    throw new Error(
      `Messages API returned no usable text. blockTypes=${JSON.stringify(
        blockTypes,
      )} preview=${JSON.stringify(data).slice(0, 300)}`,
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
    throw new Error(
      `Custom vision LLM ${response.status} from ${targetUrl}: ${errText.slice(0, 300)}`,
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

/**
 * Defensive SSE collapser for Anthropic Messages streams. We request
 * non-stream, but the proxy may still hand back text/event-stream. We
 * collect `text_delta` (the normal path) and fall back to
 * `thinking_delta` / `partial_json_delta` for adapter quirks. The caller
 * will throw if all three are empty.
 */
async function collapseAnthropicStream(
  response: Response,
): Promise<AnthropicMessagesResponse> {
  if (!response.body) return { content: [] };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let partialJson = "";
  let thinking = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              thinking?: string;
            };
          };
          if (evt.type !== "content_block_delta" || !evt.delta) continue;
          if (typeof evt.delta.text === "string") text += evt.delta.text;
          if (typeof evt.delta.partial_json === "string")
            partialJson += evt.delta.partial_json;
          if (typeof evt.delta.thinking === "string")
            thinking += evt.delta.thinking;
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  const chosen = text || partialJson || thinking;
  return { content: chosen ? [{ type: "text", text: chosen }] : [] };
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
