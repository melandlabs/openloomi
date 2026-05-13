// app/api/survey/route.ts
import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { getLatestSurveyByUserId, saveSurvey } from "@/lib/db/queries";
import { z } from "zod";

const surveyRequestBodySchema = z
  .object({
    industry: z.string().min(1, "Please select your industry"),
    role: z.string().optional(),
    roles: z.array(z.string()).min(1).optional(),
    otherRole: z.string().optional(),
    size: z.string().min(1, "Please select your company size"),
    communicationTools: z
      .array(z.string())
      .min(1, "Please select at least one communication tool"),
    dailyMessages: z.string(),
    challenges: z
      .array(z.string())
      .min(1, "Please select at least one challenge"),
    workDescription: z.string().max(2000).optional(),
  })
  .refine(
    (data) => {
      if (data.roles && data.roles.length > 0) return true;
      return typeof data.role === "string" && data.role.trim().length > 0;
    },
    {
      message: "Please select at least one role",
      path: ["roles"],
    },
  );

type SurveyRequestBody = z.infer<typeof surveyRequestBodySchema>;

export async function POST(request: Request) {
  let requestBody: SurveyRequestBody;

  try {
    const json = await request.json();
    requestBody = surveyRequestBodySchema.parse(json);
  } catch (error) {
    console.error("[Survey] Invalid request body", error);
    return new AppError(
      "bad_request:survey",
      "Invalid survey answers. Please check your responses (including industry/role/company size) and try again.",
    ).toResponse();
  }

  const session = await auth();
  if (!session?.user) {
    return new AppError(
      "unauthorized:survey",
      "You must be logged in to submit the survey",
    ).toResponse();
  }

  try {
    const userId = session.user.id;
    // Destructure including newly added fields
    const {
      industry,
      role,
      roles,
      otherRole,
      size,
      communicationTools,
      dailyMessages,
      challenges,
      workDescription,
    } = requestBody;

    const normalizedRoles =
      roles && roles.length > 0 ? roles : role ? [role] : [];

    if (normalizedRoles.length === 0) {
      return new AppError(
        "bad_request:survey",
        "Please select at least one role",
      ).toResponse();
    }

    const survey = await saveSurvey({
      userId,
      industry,
      role: normalizedRoles[0] ?? "",
      roles: normalizedRoles,
      otherRole: otherRole?.trim() ? otherRole.trim() : null,
      size,
      communicationTools,
      dailyMessages,
      challenges,
      workDescription: workDescription?.trim() ? workDescription.trim() : null,
    });

    console.log(`[Survey] Submitted by user ${userId}:`, {
      id: survey.id,
      industry,
      roles: normalizedRoles,
      primaryRole: normalizedRoles[0] ?? null,
      otherRole,
      size,
      communicationTools,
      dailyMessages,
      challengesCount: challenges.length,
      hasWorkDescription: Boolean(workDescription?.trim()),
    });

    return Response.json(
      {
        success: true,
        message: "Survey submitted successfully",
        surveyId: survey.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Survey] Failed to submit survey", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:survey",
      "Failed to process your survey responses",
    ).toResponse();
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new AppError(
        "unauthorized:survey",
        "You must be logged in to check your survey status",
      ).toResponse();
    }

    const userId = session.user.id;
    console.log(`[Survey] Checking survey status for user ${userId}`);

    const survey = await getLatestSurveyByUserId(userId);
    return Response.json(
      {
        hasSurvey: !!survey,
        survey: survey
          ? {
              id: survey.id,
              industry: survey.industry,
              size: survey.size,
            }
          : null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Survey] Failed to check survey status", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:survey",
      "Failed to check your survey submission status",
    ).toResponse();
  }
}
