/**
 * @alloomi/billing - Stripe billing, credits, and subscriptions
 */

// Stripe utilities
export type { PlanId, BillingCycle } from "./prices";
export {
  SUPPORTED_PLAN_IDS,
  isSupportedPlan,
  getStripePriceId,
  resolvePlanFromPrice,
} from "./prices";

// Entitlements (merged from @alloomi/entitlements)
export type { UserType } from "./entitlements";
export {
  paidUserTypes,
  isFreeUser,
  isPaidUser,
  entitlementsByUserType,
  getInsightHistoryDays,
  YEARLY_DISCOUNT_RATE,
  SUBSCRIPTION_PLAN_CONFIGS,
  DEFAULT_PLAN_ID,
  getPlanConfig,
  getPlanPricing,
  getPlanMonthlyCredits,
  getPlanCreditsLabel,
  getPlanFeatureList,
} from "./entitlements";
export type {
  PlanPricing,
  PlanFeatureDetails,
  SubscriptionPlanConfig,
} from "./entitlements";

export {
  setBaseUrlFactory,
  isSubscriptionStatusActive,
  stripeTimestampToDate,
} from "./utils";

// Coupon utilities
export type {
  CouponDiscountInput,
  CreateCouponWithPromotionCodeInput,
  CreateCouponWithPromotionCodeResult,
} from "./coupons";
export {
  createStripeCouponWithPromotionCode,
  setStripeClientFactory,
} from "./coupons";

// Credit constants
export {
  WEEKLY_REPORT_GENERATION_CREDIT_COST,
  WEEKLY_REPORT_REGENERATE_CREDIT_COST,
  PRESENTATION_JOB_CREDIT_COST,
  PRESENTATION_RETRY_CREDIT_COST,
} from "./credits-constants";
