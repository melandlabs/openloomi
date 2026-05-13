import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { saveFeedback } from "@/lib/db/queries";
import { z } from "zod";

const feedbackRequestBodySchema = z.object({
  content: z
    .string()
    .min(1, "Feedback content cannot be empty")
    .max(500, "Feedback cannot exceed 500 characters"),
});

type FeedbackRequestBody = z.infer<typeof feedbackRequestBodySchema>;

export async function POST(request: Request) {
  let requestBody: FeedbackRequestBody;

  try {
    const json = await request.json();
    requestBody = feedbackRequestBodySchema.parse(json);
  } catch (error) {
    console.error("[Feedback] Invalid request body", error);
    return new AppError(
      "bad_request:feedback",
      "Invalid feedback content",
    ).toResponse();
  }

  // Verify user identity
  const session = await auth();
  if (!session?.user) {
    return new AppError(
      "unauthorized:feedback",
      "You must be logged in to submit feedback",
    ).toResponse();
  }

  try {
    const userId = session.user.id;
    const { content } = requestBody;

    // Use session.user.email as contactEmail
    const contactEmail = session.user.email || null;

    const feedback = await saveFeedback({
      userId,
      contactEmail,
      content,
      type: "general",
      title: content.slice(0, 50),
      description: content,
      status: "open",
      priority: "medium",
      source: "web",
      systemInfo: null,
      updatedAt: new Date(),
      // id and createdAt will be auto-generated inside saveFeedback
    });

    console.log(`[Feedback] Submitted by user ${userId}:`, {
      id: feedback.id,
    });

    return Response.json(
      {
        success: true,
        message: "Feedback submitted successfully",
        feedbackId: feedback.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Feedback] Failed to submit feedback", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:feedback",
      "Failed to process your feedback",
    ).toResponse();
  }
}
