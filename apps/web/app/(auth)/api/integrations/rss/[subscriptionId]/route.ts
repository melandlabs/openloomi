import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  deleteRssSubscription,
  getRssSubscriptionById,
  updateRssSubscription,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

const UpdateRssSubscriptionSchema = z
  .object({
    status: z.enum(["active", "paused", "disabled"]).optional(),
    title: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided.",
  );

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subscriptionId } = await params;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "Missing subscription identifier" },
      { status: 400 },
    );
  }

  try {
    const payload = UpdateRssSubscriptionSchema.parse(await request.json());
    const updated = await updateRssSubscription({
      userId: session.user.id,
      subscriptionId,
      ...payload,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ subscription: updated }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((item) => item.message).join(", ") },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error(
      `[RssSubscriptions] Failed to update subscription ${subscriptionId}`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to update RSS subscription" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subscriptionId } = await params;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "Missing subscription identifier" },
      { status: 400 },
    );
  }

  try {
    const existing = await getRssSubscriptionById({
      userId: session.user.id,
      subscriptionId,
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }

    const deleted = await deleteRssSubscription({
      userId: session.user.id,
      subscriptionId,
    });

    return NextResponse.json({ success: deleted }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error(
      `[RssSubscriptions] Failed to delete subscription ${subscriptionId}`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to delete RSS subscription" },
      { status: 500 },
    );
  }
}
