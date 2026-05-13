import { and, eq, type InferSelectModel, type SQL } from "drizzle-orm";

import { AppError } from "@openloomi/shared/errors";
import { db } from "./queries";
import { userSubscriptions } from "./schema";

export type UserSubscriptionRecord = InferSelectModel<typeof userSubscriptions>;

export type SubscriptionUpsertArgs = {
  userId: string;
  planName: string;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  stripePriceId?: string | null;
  billingCycle?: string | null;
  status: string;
  isActive: boolean;
  autoRenew: boolean;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  lastPaymentDate?: Date | null;
  affiliateId?: string | null;
  affiliateCode?: string | null;
  affiliateCommissionRate?: number | null;
};

export async function upsertUserSubscriptionRecord(
  args: SubscriptionUpsertArgs,
) {
  const now = new Date();

  try {
    const [existing] = await db
      .select({ id: userSubscriptions.id })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, args.userId))
      .limit(1);

    const sanitizedEndDate = args.currentPeriodEnd ?? null;
    const lastPaymentDate = args.lastPaymentDate ?? now;
    const baseUpdate = {
      planName: args.planName,
      stripeSubscriptionId: args.stripeSubscriptionId ?? null,
      stripeCustomerId: args.stripeCustomerId ?? null,
      stripePriceId: args.stripePriceId ?? null,
      billingCycle: args.billingCycle ?? null,
      status: args.status,
      isActive: args.isActive,
      autoRenew: args.autoRenew,
      endDate: sanitizedEndDate,
      lastPaymentDate,
      updatedAt: now,
      affiliateId: args.affiliateId ?? null,
      affiliateCode: args.affiliateCode ?? null,
      affiliateCommissionRate: args.affiliateCommissionRate ?? null,
    } satisfies Partial<UserSubscriptionRecord>;

    if (existing) {
      const updateData: Partial<UserSubscriptionRecord> = { ...baseUpdate };

      if (args.currentPeriodStart) {
        updateData.startDate = args.currentPeriodStart;
      }

      await db
        .update(userSubscriptions)
        .set(updateData)
        .where(eq(userSubscriptions.id, existing.id));
      return;
    }

    await db.insert(userSubscriptions).values({
      userId: args.userId,
      planName: args.planName,
      startDate: args.currentPeriodStart ?? now,
      endDate: sanitizedEndDate,
      isActive: args.isActive,
      autoRenew: args.autoRenew,
      lastPaymentDate,
      createdAt: now,
      updatedAt: now,
      stripeSubscriptionId: args.stripeSubscriptionId ?? null,
      stripeCustomerId: args.stripeCustomerId ?? null,
      stripePriceId: args.stripePriceId ?? null,
      billingCycle: args.billingCycle ?? null,
      status: args.status,
      affiliateId: args.affiliateId ?? null,
      affiliateCode: args.affiliateCode ?? null,
      affiliateCommissionRate: args.affiliateCommissionRate ?? null,
    });
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to upsert subscription record: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function markSubscriptionInactive({
  userId,
  stripeSubscriptionId,
  endedAt,
  status,
}: {
  userId?: string;
  stripeSubscriptionId?: string | null;
  endedAt?: Date | null;
  status?: string;
}) {
  if (!userId && !stripeSubscriptionId) {
    throw new AppError(
      "bad_request:api",
      "Missing subscription identifiers to deactivate record",
    );
  }

  const now = new Date();

  try {
    let whereClause: SQL | undefined;
    if (stripeSubscriptionId) {
      whereClause = eq(
        userSubscriptions.stripeSubscriptionId,
        stripeSubscriptionId,
      );
    }
    if (userId) {
      const userFilter = eq(userSubscriptions.userId, userId);
      whereClause = whereClause ? and(whereClause, userFilter) : userFilter;
    }

    if (!whereClause) {
      throw new AppError(
        "bad_request:api",
        "Unable to build subscription filter for cancellation",
      );
    }

    await db
      .update(userSubscriptions)
      .set({
        isActive: false,
        autoRenew: false,
        status: status ?? "canceled",
        endDate: endedAt ?? now,
        updatedAt: now,
      })
      .where(whereClause);
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to mark subscription inactive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateSubscriptionPaymentDate({
  stripeSubscriptionId,
  paidAt,
}: {
  stripeSubscriptionId: string | null | undefined;
  paidAt?: Date;
}) {
  if (!stripeSubscriptionId) return;
  const timestamp = paidAt ?? new Date();

  try {
    await db
      .update(userSubscriptions)
      .set({
        lastPaymentDate: timestamp,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to update subscription payment date: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function linkAffiliateToSubscription({
  userId,
  subscriptionId,
  affiliateId,
  affiliateCode,
  affiliateCommissionRate,
}: {
  userId?: string;
  subscriptionId?: string;
  affiliateId: string;
  affiliateCode?: string | null;
  affiliateCommissionRate?: number | null;
}) {
  if (!userId && !subscriptionId) {
    throw new AppError(
      "bad_request:api",
      "Missing identifiers to attach affiliate to subscription",
    );
  }

  let whereClause: SQL | undefined;
  if (subscriptionId) {
    whereClause = eq(userSubscriptions.id, subscriptionId);
  }

  if (userId) {
    const userFilter = eq(userSubscriptions.userId, userId);
    whereClause = whereClause ? and(whereClause, userFilter) : userFilter;
  }

  if (!whereClause) {
    throw new AppError(
      "bad_request:api",
      "Unable to determine subscription filter for affiliate link",
    );
  }

  try {
    await db
      .update(userSubscriptions)
      .set({
        affiliateId,
        affiliateCode: affiliateCode ?? null,
        affiliateCommissionRate: affiliateCommissionRate ?? null,
        updatedAt: new Date(),
      })
      .where(whereClause);
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to link affiliate to subscription: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getUserSubscriptionRecord(userId: string) {
  try {
    const [record] = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1);

    return record ?? null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to fetch subscription record: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  try {
    const [record] = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);

    return record ?? null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to fetch subscription by stripe id: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
