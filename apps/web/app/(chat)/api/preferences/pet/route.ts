import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  getPetSettings,
  isPetRunning,
  launchPet,
  savePetSettings,
  stopPet,
} from "@/lib/pet/launcher";
import { AppError } from "@openloomi/shared/errors";

const petSettingSchema = z.object({
  enabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  return NextResponse.json({
    ...getPetSettings(),
    running: isPetRunning(),
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const rawPayload = await request.json().catch(() => null);
  const parsed = petSettingSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return new AppError(
      "bad_request:api",
      "Invalid pet settings payload",
    ).toResponse();
  }

  const settings = savePetSettings({ enabled: parsed.data.enabled });

  // Apply immediately so the toggle behaves like a real switch.
  let launchError: string | undefined;
  if (settings.enabled) {
    const result = launchPet();
    if (!result.ok) launchError = result.reason;
  } else {
    stopPet();
  }

  return NextResponse.json({
    ...settings,
    running: isPetRunning(),
    ...(launchError ? { launchError } : {}),
  });
}
