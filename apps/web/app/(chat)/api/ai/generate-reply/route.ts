import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import { jsonrepair } from "jsonrepair";

/**
 * Try multiple JSON parsing strategies, including repair
 */
function tryParseJson(
  jsonStr: string,
): { success: true; data: unknown } | { success: false; error: string } {
  if (!jsonStr || typeof jsonStr !== "string" || jsonStr.trim() === "") {
    return { success: false, error: "Empty response from AI" };
  }

  // Strategy 1: direct parse
  try {
    return { success: true, data: JSON.parse(jsonStr) };
  } catch {
    // continue
  }

  // Strategy 2: extract from code block and parse
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch?.[1]) {
    try {
      return { success: true, data: JSON.parse(codeBlockMatch[1]) };
    } catch {
      // continue
    }
  }

  // Strategy 3: jsonrepair on original
  try {
    const repaired = jsonrepair(jsonStr);
    return { success: true, data: JSON.parse(repaired) };
  } catch {
    // continue
  }

  // Strategy 4: jsonrepair on code block content
  if (codeBlockMatch?.[1]) {
    try {
      const repaired = jsonrepair(codeBlockMatch[1]);
      return { success: true, data: JSON.parse(repaired) };
    } catch {
      // continue
    }
  }

  return { success: false, error: "Could not parse JSON" };
}

/**
 * POST /api/ai/generate-reply
 *
 * Generate reply suggestions for specified insight
 * Directly receive complete insight context, not dependent on insight ID
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:auth").toResponse();
  }

  try {
    // Parse request body
    const body = await request.json();

    const { insightContext, language, userLanguage } = body as {
      insightContext?: {
        title?: string;
        description?: string;
        details?: Array<{ content: string }>;
        people?: string[];
      };
      language?: string;
      userLanguage?: string;
    };

    // Extract cloud auth token for forwarding
    const cloudAuthToken = extractCloudAuthToken(request, body);

    if (!insightContext) {
      return new AppError(
        "bad_request:api",
        "Insight context is required",
      ).toResponse();
    }

    // Build context
    const title = insightContext.title?.trim() || "this understanding";
    const details = Array.isArray(insightContext.details)
      ? insightContext.details
      : null;
    const messageContent =
      (details
        ? details
            .map((detail: { content: string }) => detail.content)
            .filter((c): c is string => Boolean(c))
            .join("\n\n")
        : null) ||
      insightContext.description ||
      "";

    const projectState = insightContext.description || "";
    const relatedPeople = Array.isArray(insightContext.people)
      ? insightContext.people.join(", ")
      : "";

    // Language instruction
    const languageInstruction =
      userLanguage && userLanguage !== language
        ? `CRITICAL LANGUAGE REQUIREMENTS:
- User's preferred language: ${userLanguage}
- Recipient's language: ${language}

For EACH reply option, you MUST generate THREE fields:
1. "label": Short action label in ${userLanguage} only (e.g., "Confirm Schedule", "Ask Details")
2. "draft": Actual reply text in ${language} (recipient's language) - THIS IS WHAT GETS SENT
3. "userLanguageDraft": Translation in ${userLanguage} (for user reference only)

Both draft fields must have the SAME meaning, just in different languages.`
        : `CRITICAL LANGUAGE REQUIREMENTS:
- Language: ${language || "same as message"}
- The "label" field MUST be in this language using "Verb+Noun" format (e.g., "Confirm Schedule", "Ask Details")`;

    const basePrompt = `You are a professional reply drafting assistant. Generate 3 reply options using the 3-A Framework:

FRAMEWORK TYPES:
- ACT: Direct answer, approval, acknowledgment, or solution
- ASK: Request missing details, clarification, or data
- ALTER: Delay response, delegate to someone else, or correct assumptions

${languageInstruction}

PRIMARY SELECTION RULE (CRITICAL - READ CAREFULLY):

ANALYSIS DECISION TREE:
Step 1: Is the message a clear, complete request with sufficient context?
  YES → Consider ACT or ASK
  NO → Go to Step 2

Step 2: Is critical information missing (time, location, specifics)?
  YES → ASK should be PRIMARY
  NO → Go to Step 3

Step 3: Does the request require checking with others, or need time?
  YES → ALTER should be PRIMARY
  NO → ACT should be PRIMARY

SCENARIO EXAMPLES:
- "Can you join the meeting?" → ASK (missing time/location) - PRIMARY
- "Please approve by Friday" → ACT (enough info, can approve/decline) - PRIMARY
- "I'll send the details tomorrow" → ACT (acknowledge) - PRIMARY
- "Can we schedule a call?" → ASK (need to know when/why) - PRIMARY
- "Let me check with the team first" → ALTER (need to delegate) - PRIMARY
- "Urgent: System is down" → ACT (immediate acknowledgment) - PRIMARY
- "What do you think about this proposal?" → ACT (can give feedback) - PRIMARY
- "Are you available next week?" → ASK (need more specifics) - PRIMARY

IMPORTANT:
- Do NOT default to ACT - use the decision tree above
- The PRIMARY option should be the one that BEST fits the situation
- Set confidence_score higher for the PRIMARY option (0.7-0.95)
- Set lower scores for non-primary options (0.1-0.4)

MESSAGE CONTEXT:
Title: PLACEHOLDER_TITLE
Message Content:
"""
PLACEHOLDER_MESSAGE"""
Context: PLACEHOLDER_CONTEXT

OUTPUT REQUIREMENTS:
- Output ONLY valid JSON - no markdown, no code blocks, no explanations
- Do NOT include phrases like "Here are", "Based on", "Mentions", etc.
- Do NOT add meta-commentary or explanatory text
- Output ONLY the JSON object below (NOTE: The PRIMARY option varies based on context - in this example ASK is primary because critical info is missing):

{
  "intent_detected": "Meeting invitation without details",
  "options": [
    {
      "framework_type": "ACT",
      "label": "Confirm Attendance",
      "draft": "I'll be there",
      "userLanguageDraft": "I will attend",
      "confidence_score": 0.25,
      "is_primary": false
    },
    {
      "framework_type": "ASK",
      "label": "Ask Details",
      "draft": "Thanks for the invite! Could you share the time and location?",
      "userLanguageDraft": "Thanks for the invite! Can you tell me the time and location?",
      "confidence_score": 0.85,
      "is_primary": true
    },
    {
      "framework_type": "ALTER",
      "label": "Request Reschedule",
      "draft": "I might need to check my schedule",
      "userLanguageDraft": "I may need to check my schedule",
      "confidence_score": 0.15,
      "is_primary": false
    }
  ]
}

CRITICAL RULES:
1. Exactly ONE option must have "is_primary": true - choose based on the decision tree above
2. The PRIMARY option should have the highest confidence_score (0.7-0.95)
3. Non-primary options should have lower confidence_score (0.1-0.4)
4. All framework_type values must be "ACT", "ASK", or "ALTER"
5. Follow the decision tree - do NOT default to ACT
6. Output RAW JSON only - no formatting, no explanations`;

    // Truncate message content to fit model limits
    const maxMessageLength = 1000;
    const maxContextLength = 300;
    const maxTitleLength = 100;

    const truncatedMessage = messageContent.slice(0, maxMessageLength);
    const truncatedContext = `${projectState.slice(0, maxContextLength)}${relatedPeople ? `, People: ${relatedPeople.slice(0, 50)}` : ""}`;
    const truncatedTitle = title.slice(0, maxTitleLength);

    // Build final prompt
    const finalPrompt = basePrompt
      .replace("Title: PLACEHOLDER_TITLE", `Title: ${truncatedTitle}`)
      .replace('PLACEHOLDER_MESSAGE"""', `${truncatedMessage}"""`)
      .replace("Context: PLACEHOLDER_CONTEXT", `Context: ${truncatedContext}`);

    // Call internal /api/ai/v1/chat/completions (handles auth, billing, rate limiting)
    const internalHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cloudAuthToken) {
      internalHeaders.Authorization = `Bearer ${cloudAuthToken}`;
    }
    const cookie = request.headers.get("cookie");
    if (cookie) {
      internalHeaders.cookie = cookie;
    }

    const internalResponse = await fetch(
      new URL("/api/ai/v1/chat/completions", request.url),
      {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({
          model: "default",
          messages: [
            {
              role: "system",
              content: "You are a professional reply drafting assistant.",
            },
            { role: "user", content: finalPrompt },
          ],
          temperature: 0.7,
        }),
      },
    );

    if (!internalResponse.ok) {
      const errorData = await internalResponse.json().catch(() => ({}));
      throw new Error(
        (errorData as { error?: { message?: string } }).error?.message ||
          `AI API error: ${internalResponse.status}`,
      );
    }

    const responseData = (await internalResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; type?: string };
    };

    // Check for error response from internal API
    if (responseData.error) {
      throw new Error(
        responseData.error.message ||
          `AI API error: ${responseData.error.type || "unknown"}`,
      );
    }

    const text = responseData.choices?.[0]?.message?.content ?? "";
    console.log("[GenerateReply API] Raw AI response:", responseData);

    // Parse JSON response with multiple repair strategies
    const parseResult = tryParseJson(text);
    if (!parseResult.success) {
      console.error(
        "[GenerateReply API] Failed to parse AI response as JSON:",
        {
          text: text.slice(0, 1000),
          textLength: text.length,
          textFirstChars: text.slice(0, 200),
          parseError: parseResult.error,
        },
      );
      throw new Error("Failed to parse AI response as JSON");
    }
    const parsed = parseResult.data;

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid response format");
    }

    const record = parsed as Record<string, unknown>;
    const options = record.options;

    if (!Array.isArray(options)) {
      console.error("[GenerateReply API] Invalid options format:", {
        options,
        optionsType: typeof options,
        parsed,
        fullResponse: text.slice(0, 500),
      });
      throw new Error("Invalid options format in response");
    }

    // Return successful response
    return Response.json({
      success: true,
      data: {
        intent: record.intent_detected as string | undefined,
        options: options
          .map((opt: unknown) => {
            if (!opt || typeof opt !== "object") return null;
            const option = opt as Record<string, unknown>;
            return {
              framework_type: option.framework_type as string,
              label: option.label as string,
              draft: option.draft as string,
              userLanguageDraft: option.userLanguageDraft as string | null,
              confidence_score: option.confidence_score as number | null,
              is_primary: Boolean(option.is_primary),
            };
          })
          .filter(Boolean),
      },
    });
  } catch (error) {
    console.error("[GenerateReply API] Error:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError(
      "bad_request:api",
      `Failed to generate reply: ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
