// app/api/survey/route.ts
import { auth } from "@/app/(auth)/auth";
import { getUserById, updateUserOnboarding } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { z } from "zod";

const onboardingRequestBodySchema = z.object({
  finishOnboarding: z.boolean(),
});

type OnboardingRequestBody = z.infer<typeof onboardingRequestBodySchema>;

export async function POST(request: Request) {
  let requestBody: OnboardingRequestBody;

  try {
    const json = await request.json();
    requestBody = onboardingRequestBodySchema.parse(json);
  } catch (error) {
    console.error("[Onboarding] Invalid request body", error);
    return new AppError(
      "bad_request:database",
      "Invalid request body.",
    ).toResponse();
  }

  const session = await auth();
  if (!session?.user) {
    return new AppError(
      "unauthorized:database",
      "You must be logged in to submit the onboarding",
    ).toResponse();
  }

  try {
    const userId = session.user.id;
    const { finishOnboarding } = requestBody;

    await updateUserOnboarding(userId, finishOnboarding);

    console.log(`[Onboaring] Submitted by user ${userId}:`, {
      finishOnboarding,
    });

    return Response.json(
      {
        success: true,
        message: "Onboarding submitted successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Onboarding] Failed to submit", error);
    if (error instanceof AppError) return error.toResponse();
    return new AppError(
      "bad_request:database",
      "Failed to process onboarding responses",
    ).toResponse();
  }
}

export async function GET(_: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new AppError(
        "unauthorized:database",
        "You must be logged in to submit the onboarding",
      ).toResponse();
    }

    const user = await getUserById(session.user.id);
    const exists = !!user;
    const finishOnboarding = exists ? Boolean(user.finishOnboarding) : !exists;
    return Response.json({ exists, finishOnboarding }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:database",
      "Failed to check user existence",
    ).toResponse();
  }
}
