import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { generateText } from "ai";
import { getModel } from "@/lib/ai";
import { setAIUserContextFromRequest } from "@/lib/ai/request-context";
import { isTauriMode } from "@/lib/env";

/**
 * POST /api/ai/polish
 *
 * Polish user's reply draft
 * Directly receive context information, not dependent on insight ID
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:auth").toResponse();
  }

  try {
    // Parse request body
    const body = await request.json();

    // Set AI user context with cloud auth token for proper billing in proxy mode
    setAIUserContextFromRequest({
      userId: session.user.id,
      email: session.user.email || "",
      name: session.user.name || null,
      userType: session.user.type,
      request,
      body,
    });
    const { draft, tone, language, insightContext } = body as {
      draft?: string;
      tone?: string;
      language?: string;
      insightContext?: {
        title?: string;
        description?: string;
        details?: Array<{ content: string }>;
        people?: string[];
      };
    };

    if (!draft || draft.trim().length === 0) {
      return new AppError(
        "bad_request:api",
        "Draft content is required",
      ).toResponse();
    }

    // Build context (if provided)
    let context = "";
    if (insightContext) {
      const description = insightContext.description?.slice(0, 500) || "";
      const title = insightContext.title || "";
      context = `
Original Message: "${description}"
Context: ${title}
    `.trim();
    }

    // Build polish prompt
    const toneInstruction = tone
      ? `Use a ${tone} tone.`
      : "Use a professional yet friendly tone.";

    const languageInstruction = language
      ? `Respond in ${language}.`
      : "Maintain the original language.";

    let prompt = `You are a professional writing assistant. Polish the following email draft to make it more clear, concise, and effective.

${toneInstruction}
${languageInstruction}`;

    if (context) {
      prompt += `

Context for reference:
${context}`;
    }

    prompt += `

Original Draft:
"""${draft}"""

Provide only the polished version without any explanations or preamble. Keep the meaning the same but improve the clarity, flow, and professionalism.`;

    console.log("[Polish API] Polishing draft", {
      draftLength: draft.length,
      tone,
      language,
      hasContext: !!insightContext,
    });

    // Call AI to polish
    const { text } = await generateText({
      model: getModel(isTauriMode()),
      prompt,
      temperature: 0.3,
    });

    console.log("[Polish API] Polished text length:", text.length);

    // Return polished text
    return Response.json({
      success: true,
      data: {
        polished: text.trim(),
      },
    });
  } catch (error) {
    console.error("[Polish API] Error:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError(
      "bad_request:api",
      `Failed to polish draft: ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
