import * as crypto from "node:crypto";

import { and, count, eq, gte, sql } from "drizzle-orm";

import { AppError } from "@openloomi/shared/errors";
import { db } from "./queries";
import { user } from "./schema";
import { landingPromoRegistrations } from "./schema";
import type { LandingPromoRegistration } from "./schema";
import { upsertUserSubscriptionRecord } from "./subscriptions";

const PROMO_CONFIG = {
  MAX_PARTICIPANTS: 200,
  DAYS_PERIOD: 30,
  MONTHS_GRANTED: 6,
  PLAN_NAME: "pro",
  PROMO_CODE: "6M_FREE_PRO",
  REFERRAL_BONUS_MONTHS: 6,
  REFERRAL_REQUIRED: 3,
} as const;

/**
 * Get current landing promo statistics
 */
export async function getLandingPromoStats() {
  try {
    const now = new Date();

    // Count active registrations (not expired)
    const [activeResult] = await db
      .select({ count: count() })
      .from(landingPromoRegistrations)
      .where(
        and(
          eq(landingPromoRegistrations.status, "active"),
          gte(landingPromoRegistrations.expiresAt, now),
        ),
      );

    const registeredCount = Number(activeResult?.count ?? 0);
    const remainingSpots = Math.max(
      0,
      PROMO_CONFIG.MAX_PARTICIPANTS - registeredCount,
    );
    const isFull = remainingSpots === 0;

    // Calculate days remaining (from first registration + 30 days)
    const [firstRegistration] = await db
      .select({ createdAt: landingPromoRegistrations.createdAt })
      .from(landingPromoRegistrations)
      .orderBy(landingPromoRegistrations.createdAt)
      .limit(1);

    let daysRemaining: number = PROMO_CONFIG.DAYS_PERIOD;
    if (firstRegistration) {
      const endDate = new Date(firstRegistration.createdAt);
      endDate.setDate(endDate.getDate() + PROMO_CONFIG.DAYS_PERIOD);
      const diffTime = endDate.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    return {
      registeredCount,
      maxParticipants: PROMO_CONFIG.MAX_PARTICIPANTS,
      remainingSpots,
      isFull,
      daysRemaining,
      periodDays: PROMO_CONFIG.DAYS_PERIOD,
      monthsGranted: PROMO_CONFIG.MONTHS_GRANTED,
      planName: PROMO_CONFIG.PLAN_NAME,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get landing promo stats: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Generate a unique referral code
 */
async function generateReferralCode(): Promise<string> {
  const code = crypto.randomBytes(6).toString("hex").toUpperCase();

  // With 12 hex chars (~2.8 trillion possibilities), collision is astronomically unlikely.
  // Still verify uniqueness to be safe.
  const [existing] = await db
    .select({ id: landingPromoRegistrations.id })
    .from(landingPromoRegistrations)
    .where(eq(landingPromoRegistrations.referralCode, code))
    .limit(1);

  if (existing) {
    throw new AppError("rate_limit:api", "Referral code collision");
  }

  return code;
}

/**
 * Check if user is eligible for landing promo
 */
async function checkUserEligibility(email: string): Promise<{
  eligible: boolean;
  reason?: string;
  existingRegistration?: LandingPromoRegistration;
}> {
  // Check if email already registered for promo
  const [existing] = await db
    .select()
    .from(landingPromoRegistrations)
    .where(eq(landingPromoRegistrations.email, email))
    .limit(1);

  if (existing) {
    // Check if still active
    const now = new Date();
    if (existing.expiresAt < now) {
      return {
        eligible: false,
        reason: "Promo has expired for this email",
        existingRegistration: existing,
      };
    }
    return {
      eligible: false,
      reason: "Email already registered for this promo",
      existingRegistration: existing,
    };
  }

  // Check if promo is full
  const stats = await getLandingPromoStats();
  if (stats.isFull) {
    return {
      eligible: false,
      reason: "Promo is fully subscribed",
    };
  }

  // Check if promo period has ended
  if (stats.daysRemaining <= 0) {
    return {
      eligible: false,
      reason: "Promo period has ended",
    };
  }

  return { eligible: true };
}

/**
 * Claim landing promo - creates user account and grants 6 months Pro
 */
export async function claimLandingPromo(args: {
  email: string;
  name?: string;
  password?: string;
  referralCode?: string;
  userId?: string; // If user already exists
  trackingParams?: Record<string, string>;
}): Promise<{
  success: boolean;
  message: string;
  registration?: LandingPromoRegistration;
  user?: typeof user.$inferSelect;
}> {
  const {
    email,
    name,
    password,
    referralCode,
    userId: existingUserId,
    trackingParams,
  } = args;

  try {
    // Check eligibility
    const eligibility = await checkUserEligibility(email);
    if (!eligibility.eligible) {
      return {
        success: false,
        message: eligibility.reason ?? "Not eligible for promo",
      };
    }

    // Verify referral code if provided
    let referredBy: string | null = null;
    if (referralCode) {
      const [referrer] = await db
        .select()
        .from(landingPromoRegistrations)
        .where(eq(landingPromoRegistrations.referralCode, referralCode))
        .limit(1);

      if (!referrer) {
        return {
          success: false,
          message: "Invalid referral code",
        };
      }
      referredBy = referrer.id;
    }

    // Get or create user
    let userId = existingUserId;
    let newUser = false;

    if (!userId) {
      // Check if user exists
      const [existingUser] = await db
        .select()
        .from(user)
        .where(eq(user.email, email))
        .limit(1);

      if (existingUser) {
        userId = existingUser.id;
      } else if (password) {
        // Create new user with password
        const bcrypt = await import("bcrypt-ts");
        const hashedPassword = await bcrypt.hash(password, 10);

        const [newUserRecord] = await db
          .insert(user)
          .values({
            email,
            name: name ?? email.split("@")[0],
            password: hashedPassword,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        userId = newUserRecord.id;
        newUser = true;
      } else {
        return {
          success: false,
          message: "Password required for new users",
        };
      }
    }

    // Assert that userId is defined (TypeScript can't infer this from the above logic)
    if (!userId) {
      return {
        success: false,
        message: "Failed to get or create user",
      };
    }

    // Calculate expiration date (6 months from now)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + PROMO_CONFIG.MONTHS_GRANTED);

    // Create promo registration
    const referralCodeOwn = await generateReferralCode();
    const [registration] = await db
      .insert(landingPromoRegistrations)
      .values({
        userId,
        email,
        promoCode: PROMO_CONFIG.PROMO_CODE,
        monthsGranted: PROMO_CONFIG.MONTHS_GRANTED,
        planName: PROMO_CONFIG.PLAN_NAME,
        status: "active",
        claimedAt: now,
        expiresAt,
        referralCode: referralCodeOwn,
        referredBy,
        referralCount: 0,
        metadata: {
          newUser,
          landingPage: true,
          ...(trackingParams && { trackingParams }),
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Grant Pro subscription
    await upsertUserSubscriptionRecord({
      userId,
      planName: PROMO_CONFIG.PLAN_NAME,
      status: "active",
      isActive: true,
      autoRenew: false, // Don't auto-renew after promo
      currentPeriodStart: now,
      currentPeriodEnd: expiresAt,
      lastPaymentDate: now,
      stripeSubscriptionId: `promo_${registration.id}`,
      billingCycle: "custom",
    });

    // Update referrer's count if applicable
    if (referredBy) {
      await db
        .update(landingPromoRegistrations)
        .set({
          referralCount: sql`${landingPromoRegistrations.referralCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(landingPromoRegistrations.id, referredBy));
    }

    // Get user details
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    return {
      success: true,
      message: newUser
        ? `Successfully registered! Enjoy ${PROMO_CONFIG.MONTHS_GRANTED} months of Pro membership.`
        : `Successfully claimed ${PROMO_CONFIG.MONTHS_GRANTED} months of Pro membership!`,
      registration,
      user: userRecord,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to claim landing promo: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Process referral - check if referrer has earned bonus
 */
export async function processReferralBonus(referralCode: string) {
  const [referrer] = await db
    .select()
    .from(landingPromoRegistrations)
    .where(eq(landingPromoRegistrations.referralCode, referralCode))
    .limit(1);

  if (!referrer) {
    return { eligible: false, message: "Invalid referral code" };
  }

  // Check if already has enough referrals
  if (referrer.referralCount >= PROMO_CONFIG.REFERRAL_REQUIRED) {
    return {
      eligible: true,
      message: "Referrer already has bonus",
      alreadyEarned: true,
    };
  }

  // Get current referral count
  const currentCount = referrer.referralCount ?? 0;
  const newCount = currentCount + 1;

  // Check if earned bonus
  if (newCount >= PROMO_CONFIG.REFERRAL_REQUIRED) {
    // Grant additional 6 months
    const now = new Date();
    const currentExpiry = referrer.expiresAt;
    const newExpiry =
      currentExpiry > now ? new Date(currentExpiry) : new Date();

    newExpiry.setMonth(
      newExpiry.getMonth() + PROMO_CONFIG.REFERRAL_BONUS_MONTHS,
    );

    // Update subscription
    await upsertUserSubscriptionRecord({
      userId: referrer.userId,
      planName: PROMO_CONFIG.PLAN_NAME,
      status: "active",
      isActive: true,
      autoRenew: false,
      currentPeriodEnd: newExpiry,
      stripeSubscriptionId: `promo_${referrer.id}_bonus`,
      billingCycle: "custom",
    });

    // Update registration
    await db
      .update(landingPromoRegistrations)
      .set({
        expiresAt: newExpiry,
        referralCount: newCount,
        updatedAt: now,
        metadata: {
          ...((referrer.metadata as Record<string, unknown>) ?? {}),
          bonusEarned: true,
          bonusMonths: PROMO_CONFIG.REFERRAL_BONUS_MONTHS,
        },
      })
      .where(eq(landingPromoRegistrations.id, referrer.id));

    return {
      eligible: true,
      message: `Congratulations! You've earned ${PROMO_CONFIG.REFERRAL_BONUS_MONTHS} additional months of Pro!`,
      bonusEarned: true,
      newExpiry,
    };
  }

  return {
    eligible: true,
    message: `${PROMO_CONFIG.REFERRAL_REQUIRED - newCount} more referrals needed for bonus`,
    bonusEarned: false,
  };
}

/**
 * Get user's landing promo registration
 */
export async function getUserLandingPromo(userId: string) {
  try {
    const [registration] = await db
      .select()
      .from(landingPromoRegistrations)
      .where(eq(landingPromoRegistrations.userId, userId))
      .limit(1);

    return registration ?? null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get user landing promo: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get referral stats for a user
 */
export async function getReferralStats(registrationId: string) {
  try {
    const [registration] = await db
      .select()
      .from(landingPromoRegistrations)
      .where(eq(landingPromoRegistrations.id, registrationId))
      .limit(1);

    if (!registration) {
      return null;
    }

    const referralCount = registration.referralCount ?? 0;
    const remainingNeeded = Math.max(
      0,
      PROMO_CONFIG.REFERRAL_REQUIRED - referralCount,
    );

    return {
      referralCode: registration.referralCode,
      referralCount,
      remainingNeeded,
      bonusMonths: PROMO_CONFIG.REFERRAL_BONUS_MONTHS,
      totalBonusMonthsEarned:
        Math.floor(referralCount / PROMO_CONFIG.REFERRAL_REQUIRED) *
        PROMO_CONFIG.REFERRAL_BONUS_MONTHS,
      expiresAt: registration.expiresAt,
      status: registration.status,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get referral stats: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
