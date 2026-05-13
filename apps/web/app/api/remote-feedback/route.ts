/**
 * Feedback API
 *
 * - Web (cloud or local dev): save directly to database
 * - Tauri desktop: forward to cloud
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateCloudRequest } from "@/lib/auth/cloud-auth";
import { AppError } from "@openloomi/shared/errors";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { saveFeedback } from "@/lib/db/queries";
import { generateUUID } from "@/lib/utils";
import { forwardToCloud } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";

const feedbackRequestBodySchema = z.object({
  content: z
    .string()
    .min(1, "Feedback content cannot be empty")
    .max(500, "Feedback cannot exceed 500 characters"),
  email: z
    .string()
    .min(1, "Email is required")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format")
    .optional(),
  systemInfo: z
    .object({
      platform: z.string().optional(),
      appVersion: z.string().optional(),
      osVersion: z.string().optional(),
    })
    .optional(),
});

type FeedbackRequestBody = z.infer<typeof feedbackRequestBodySchema>;

export async function POST(request: NextRequest) {
  let requestBody: FeedbackRequestBody;
  let rawBody: string;

  try {
    rawBody = await request.text();
    const json = JSON.parse(rawBody);
    requestBody = feedbackRequestBodySchema.parse(json);
  } catch (error) {
    console.error("[Remote Feedback] Invalid request body", error);
    return new AppError(
      "bad_request:feedback",
      "Invalid feedback content",
    ).toResponse();
  }

  // Tauri desktop: forward to cloud
  if (isTauriMode()) {
    return forwardToCloud(request, "/api/remote-feedback", rawBody);
  }

  // Web: direct handling (includes rate limiting)
  // Rate limit check: 10 requests/hour
  const rateLimitResult = await withRateLimit(
    request,
    RateLimitPresets.default,
  );
  if (!rateLimitResult.success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Please try again later",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const user = await authenticateCloudRequest(request);

    if (!user) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "You must be logged in to submit feedback",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const feedbackData = {
      content: requestBody.content,
      userId: user?.id || null,
      contactEmail: user?.email || requestBody.email || null,
      type: "general" as const,
      title: requestBody.content.slice(0, 50),
      description: requestBody.content,
      status: "open" as const,
      priority: "medium" as const,
      source:
        requestBody.systemInfo?.platform === "desktop" ? "desktop" : "web",
      systemInfo: requestBody.systemInfo || null,
      id: generateUUID(),
      updatedAt: new Date(),
    };

    const savedFeedback = await saveFeedback(feedbackData);

    console.log("[Remote Feedback] Saved:", {
      id: savedFeedback.id,
      userId: savedFeedback.userId,
      contactEmail: savedFeedback.contactEmail
        ? `${savedFeedback.contactEmail.slice(0, 3)}***`
        : null,
    });

    return Response.json(
      {
        success: true,
        message: "Thank you for your feedback!",
        feedbackId: savedFeedback.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Remote Feedback] Failed to submit feedback", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:feedback",
      "Failed to process your feedback",
    ).toResponse();
  }
}
