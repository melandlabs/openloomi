import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_AI_MODEL } from "@/lib/env";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import {
  MeetingTranscriptionError,
  transcribeMeetingAudio,
} from "@/lib/audio/meeting-transcription";

export const maxDuration = 800;

const analyzeMeetingSchema = z.object({
  audioPath: z.string(),
  title: z.string().optional().default(""),
});

const ANTHROPIC_MESSAGES_PATH = "/api/ai/v1/messages";

const MEETING_SUMMARY_SYSTEM_PROMPT = `You are a meeting assistant that analyzes audio transcriptions and generates structured summaries.

Your job is to:
1. Review the full transcript of a meeting
2. Generate an accurate summary
3. Extract key points discussed
4. Identify action items (tasks assigned or commitments made)
5. Note any participants if mentioned

Output rules:
- Respond with EXACTLY one JSON object. No markdown fences, no commentary.
- All string values MUST be valid JSON (escape newlines as \\n and quotes as \\").
- Detect the dominant language of the transcript and respond in that same language.

Schema:
{
  "summary": "string. 2-4 sentences summarizing what was discussed and decided.",
  "keyPoints": ["string"],
  "actionItems": ["string"],
  "participants": ["string"]
}

Field-specific requirements:

1. "summary" — A concise overview of the meeting topic, main discussions, and outcomes.

2. "keyPoints" — Up to 10 short strings (each ≤ 100 chars) summarizing the most important topics or decisions. Each should be a self-contained phrase.

3. "actionItems" — Tasks or commitments mentioned in the meeting, formatted as actionable items. Each should be complete and understandable on its own.

4. "participants" — Names or identifiers of meeting participants mentioned in the transcript. Only include if explicitly stated.`;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();
    const { audioPath, title } = analyzeMeetingSchema.parse(body);

    const sessionCloudToken = (
      session as typeof session & { cloudAuthToken?: string }
    ).cloudAuthToken;
    const requestCloudToken = extractCloudAuthToken(request, body);
    const cloudToken = sessionCloudToken || requestCloudToken;

    // Step 1: Transcribe audio (chunked automatically for long recordings)
    let transcription: string;
    try {
      transcription = await transcribeMeetingAudio({
        audioPath,
        requestUrl: request.url,
        cloudToken,
        cookie: cloudToken
          ? undefined
          : (request.headers.get("cookie") ?? undefined),
      });
    } catch (error) {
      if (error instanceof MeetingTranscriptionError) {
        console.error(
          "[Chronicle Meeting] Transcription failed:",
          error.message,
        );
        return new AppError("bad_request:api", error.message).toResponse();
      }
      const errno =
        error && typeof error === "object" && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (errno === "ENOENT") {
        return new AppError(
          "not_found:api",
          "Audio file not found",
        ).toResponse();
      }
      console.error(
        "[Chronicle Meeting] Failed to transcribe audio file:",
        error,
      );
      return new AppError(
        "bad_request:api",
        "Failed to transcribe meeting audio",
      ).toResponse();
    }

    if (!transcription.trim()) {
      return NextResponse.json({
        success: true,
        title: title || "Meeting Recording",
        transcript: "",
        summary: "No speech detected in the recording.",
        keyPoints: [],
        actionItems: [],
        participants: [],
      });
    }

    // Step 2: Generate summary using LLM
    const analysis = await generateMeetingSummary(
      transcription,
      title,
      cloudToken,
      request.url,
    );

    return NextResponse.json({
      success: true,
      title: title || analysis.summary.slice(0, 60),
      transcript: transcription,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      actionItems: analysis.actionItems,
      participants: analysis.participants,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new AppError(
        "bad_request:api",
        "Invalid request body",
      ).toResponse();
    }

    console.error("[Chronicle Meeting] Analysis failed:", error);
    return new AppError(
      "bad_request:api",
      "Failed to analyze meeting",
    ).toResponse();
  }
}

interface MeetingAnalysisResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
}

async function generateMeetingSummary(
  transcript: string,
  title: string,
  cloudToken: string | undefined,
  requestUrl: string,
): Promise<MeetingAnalysisResult> {
  const targetUrl = new URL(ANTHROPIC_MESSAGES_PATH, requestUrl).toString();
  const model =
    process.env.LLM_VISION_LANGUAGE_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    DEFAULT_AI_MODEL;

  const userTitleNote = title ? `\nMeeting title: ${title}` : "";

  const requestBody = {
    model,
    max_tokens: 4000,
    stream: false,
    // Disable extended thinking. Some OpenRouter Anthropic adapters default
    // to `thinking: enabled` for newer Claude models and spend the entire
    // token budget producing `thinking` / `redacted_thinking` blocks. We
    // explicitly turn it off so the model emits a `text` block we can parse.
    thinking: { type: "disabled" },
    system: MEETING_SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Please analyze this meeting transcript and provide a structured summary.${userTitleNote}\n\nTranscript:\n${transcript.slice(0, 50000)}`,
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

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(
        "[Chronicle Meeting] Summary generation failed:",
        response.status,
        errText,
      );
      return {
        summary: transcript.slice(0, 500),
        keyPoints: [],
        actionItems: [],
        participants: [],
      };
    }

    const responseContentType = response.headers.get("content-type") || "";
    let data: {
      content?: Array<{ type: string; text?: string }>;
      error?: { message?: string };
    };

    if (responseContentType.includes("text/event-stream")) {
      data = await collapseAnthropicStream(response);
    } else {
      data = (await response.json()) as typeof data;
    }

    if (data.error) {
      console.error("[Chronicle Meeting] LLM error:", data.error.message);
      return {
        summary: transcript.slice(0, 500),
        keyPoints: [],
        actionItems: [],
        participants: [],
      };
    }

    const textContent = (data.content ?? [])
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!textContent) {
      return {
        summary: transcript.slice(0, 500),
        keyPoints: [],
        actionItems: [],
        participants: [],
      };
    }

    return parseMeetingAnalysisJson(textContent);
  } catch (error) {
    console.error("[Chronicle Meeting] Summary generation error:", error);
    return {
      summary: transcript.slice(0, 500),
      keyPoints: [],
      actionItems: [],
      participants: [],
    };
  }
}

async function collapseAnthropicStream(response: Response): Promise<{
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}> {
  if (!response.body) return { content: [] };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

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
            delta?: { type?: string; text?: string };
          };
          if (evt.type !== "content_block_delta" || !evt.delta) continue;
          if (typeof evt.delta.text === "string") text += evt.delta.text;
        } catch {
          // ignore
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return { content: text ? [{ type: "text", text }] : [] };
}

function parseMeetingAnalysisJson(text: string): MeetingAnalysisResult {
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
    const parsed = JSON.parse(jsonStr) as Partial<MeetingAnalysisResult>;
    return {
      summary: parsed.summary || text.slice(0, 500),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      participants: Array.isArray(parsed.participants)
        ? parsed.participants
        : [],
    };
  } catch {
    return {
      summary: text.slice(0, 500),
      keyPoints: [],
      actionItems: [],
      participants: [],
    };
  }
}
