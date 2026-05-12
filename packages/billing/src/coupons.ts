import type Stripe from "stripe";

import type { PlanId } from "./prices";

export type CouponDiscountInput =
  | {
      kind: "percent";
      percentOff: number;
      duration: Stripe.CouponCreateParams.Duration;
      durationInMonths?: number | null;
    }
  | {
      kind: "amount";
      amountOff: number;
      currency: string;
      duration: Stripe.CouponCreateParams.Duration;
      durationInMonths?: number | null;
    };

export type CreateCouponWithPromotionCodeInput = {
  code: string;
  label?: string | null;
  planId?: PlanId;
  discount: CouponDiscountInput;
  activationExpiresAt?: Date | null;
  maxRedemptions?: number | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type CreateCouponWithPromotionCodeResult = {
  coupon: Stripe.Coupon;
  promotionCode: Stripe.PromotionCode;
};

function normalizeCouponCode(code: string) {
  return code.trim().replace(/\s+/g, "-").toUpperCase();
}

function toStripeTimestamp(value: Date | number | null | undefined) {
  if (!value) return undefined;
  const timestamp = value instanceof Date ? value.getTime() : value;
  const seconds = Math.floor(timestamp / 1000);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function sanitizeCouponMetadata(
  metadata: Record<string, string | number | boolean | null | undefined> | null,
) {
  if (!metadata) return undefined;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(metadata)) {
    if (rawValue === null || rawValue === undefined) continue;
    output[key] = String(rawValue);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/**
 * Create a Stripe coupon and promotion code.
 * The stripe client must be provided via setStripeClientFactory().
 */
let _getStripeClient: (() => Promise<Stripe>) | null = null;

export function setStripeClientFactory(factory: () => Promise<Stripe>) {
  _getStripeClient = factory;
}

async function getStripeClient(): Promise<Stripe> {
  if (!_getStripeClient) {
    throw new Error(
      "Stripe client factory not set. Call setStripeClientFactory() before using coupon functions.",
    );
  }
  return _getStripeClient();
}

export async function createStripeCouponWithPromotionCode({
  code,
  label,
  planId,
  discount,
  activationExpiresAt,
  maxRedemptions,
  metadata,
}: CreateCouponWithPromotionCodeInput): Promise<CreateCouponWithPromotionCodeResult> {
  const stripe = await getStripeClient();

  const couponInput: Stripe.CouponCreateParams = {
    name: label ?? code,
    duration: discount.duration,
    metadata: sanitizeCouponMetadata({
      ...metadata,
      alloomi_coupon_label: label ?? undefined,
      alloomi_plan_id: planId ?? undefined,
    }),
  };

  if (
    discount.duration === "repeating" &&
    discount.durationInMonths &&
    discount.durationInMonths > 0
  ) {
    couponInput.duration_in_months = discount.durationInMonths;
  }

  if (discount.kind === "percent") {
    couponInput.percent_off = Number(discount.percentOff);
  } else if (discount.kind === "amount") {
    if (!discount.currency) {
      throw new Error("Currency is required when applying amount discounts.");
    }
    couponInput.currency = discount.currency.toLowerCase();
    couponInput.amount_off = Math.round(discount.amountOff * 100);
  } else {
    throw new Error(
      `Unsupported discount kind: ${(discount as { kind?: string })?.kind}`,
    );
  }

  const coupon = await stripe.coupons.create(couponInput);

  const promotionCodeInput: Stripe.PromotionCodeCreateParams = {
    code: normalizeCouponCode(code),
    promotion: {
      type: "coupon",
      coupon: coupon.id,
    },
    max_redemptions: maxRedemptions ?? 1,
    metadata: sanitizeCouponMetadata({
      ...metadata,
      alloomi_coupon_label: label ?? undefined,
      alloomi_plan_id: planId ?? undefined,
      alloomi_coupon_code: code,
    }),
  };

  if (activationExpiresAt) {
    const expiresAt = toStripeTimestamp(activationExpiresAt);
    if (expiresAt) {
      promotionCodeInput.expires_at = expiresAt;
    }
  }

  const promotionCode = await stripe.promotionCodes.create(promotionCodeInput);

  return { coupon, promotionCode };
}
