// ── Stripe types (copied from @/lib/stripe/prices — pure type definitions) ──

export type PlanId = "basic" | "pro";
export type BillingCycle = "monthly" | "yearly";

// ── User types ──────────────────────────────────────────────────────────────

export type UserType = "guest" | "regular" | "basic" | "pro" | "team";

// ── Entitlements data ─────────────────────────────────────────────────────

interface Features {
  portraitLearning: boolean;
  realmeNotifications: boolean;
}

interface Entitlements {
  totalQuota: number;
  purchaseQuota: boolean;
  insightHistoryDays: number;
  features: Features;
  storageQuotaBytes: number;
}

export const paidUserTypes = ["basic", "pro", "team"] as const;

export function isFreeUser(userType: string) {
  return ["guest", "regular"].includes(userType);
}

export function isPaidUser(userType: string) {
  return paidUserTypes.includes(userType as (typeof paidUserTypes)[number]);
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  guest: {
    totalQuota: 30000,
    purchaseQuota: false,
    insightHistoryDays: 30,
    features: {
      portraitLearning: false,
      realmeNotifications: false,
    },
    storageQuotaBytes: 0,
  },
  regular: {
    totalQuota: 30000,
    purchaseQuota: false,
    insightHistoryDays: 30,
    features: {
      portraitLearning: false,
      realmeNotifications: false,
    },
    storageQuotaBytes: 0,
  },
  basic: {
    totalQuota: 500000,
    purchaseQuota: true,
    insightHistoryDays: 60,
    features: {
      portraitLearning: true,
      realmeNotifications: true,
    },
    storageQuotaBytes: 2 * 1024 * 1024 * 1024 * 1024, // 2 TB
  },
  pro: {
    totalQuota: 1500000,
    purchaseQuota: true,
    insightHistoryDays: 120,
    features: {
      portraitLearning: true,
      realmeNotifications: true,
    },
    storageQuotaBytes: 5 * 1024 * 1024 * 1024 * 1024, // 5 TB
  },
  team: {
    totalQuota: 1500000,
    purchaseQuota: true,
    insightHistoryDays: 120,
    features: {
      portraitLearning: true,
      realmeNotifications: true,
    },
    storageQuotaBytes: 5 * 1024 * 1024 * 1024 * 1024, // 5 TB (align with Pro)
  },
};

export function getInsightHistoryDays(userType: UserType): number {
  const entitlements =
    entitlementsByUserType[userType] ?? entitlementsByUserType.regular;
  return entitlements.insightHistoryDays;
}

// ── Subscription plan config ───────────────────────────────────────────────

export type PlanPricing = {
  amount: number;
  currency: string;
};

export type PlanFeatureDetails = {
  history: string;
  aiConversations: string;
  messageUnderstanding: string;
  messageReplies: string;
  customization: string;
  integrations: string;
  storage: string;
  autoLearning: string;
  topUps: string;
  support: string;
};

export type SubscriptionPlanConfig = {
  id: PlanId;
  nameKey: string;
  pricing: Record<BillingCycle, PlanPricing | undefined>;
  details: PlanFeatureDetails;
};

/**
 * Yearly discount rate: 15%
 * - Basic yearly: $15 * 12 * 0.85 = $153/year
 * - Pro yearly: $39 * 12 * 0.85 = $398/year
 */
export const YEARLY_DISCOUNT_RATE = 0.15;

export const SUBSCRIPTION_PLAN_CONFIGS: Record<PlanId, SubscriptionPlanConfig> =
  {
    basic: {
      id: "basic",
      nameKey: "plans.basic",
      pricing: {
        monthly: { amount: 15, currency: "USD" },
        yearly: { amount: 153, currency: "USD" }, // $15 * 12 * 0.85 = $153/year
      },
      details: {
        history: "History retention: 60 days",
        aiConversations: "Basic AI conversations",
        messageUnderstanding: "AI-powered message understanding",
        messageReplies: "Message replies included",
        customization: "Custom settings included",
        integrations: "Integration authorization included",
        storage: "2 TB encrypted storage for saved files",
        autoLearning: "Auto-learning with weekly updates",
        topUps: "Top-ups available: $1 = 30,000 credits",
        support: "Community + email support (24h response)",
      },
    },
    pro: {
      id: "pro",
      nameKey: "plans.pro",
      pricing: {
        monthly: { amount: 39, currency: "USD" },
        yearly: { amount: 398, currency: "USD" }, // $39 * 12 * 0.85 ≈ $398/year
      },
      details: {
        history: "History retention: 120 days",
        aiConversations: "Advanced AI conversations",
        messageUnderstanding: "Enhanced AI message understanding",
        messageReplies: "Message replies included",
        customization: "Custom settings included",
        integrations:
          "Priority access to new integrations (WhatsApp, Email, more)",
        storage: "5 TB encrypted storage for saved files",
        autoLearning: "Auto-learning with daily updates",
        topUps: "Top-ups available: $1 = 30,000 credits",
        support: "Priority email support (12h response) + Alpha access",
      },
    },
  };

export const DEFAULT_PLAN_ID: PlanId = "basic";

export function getPlanConfig(planId: PlanId) {
  return SUBSCRIPTION_PLAN_CONFIGS[planId];
}

export function getPlanPricing(
  planId: PlanId,
  billingCycle: BillingCycle,
): PlanPricing | undefined {
  return SUBSCRIPTION_PLAN_CONFIGS[planId]?.pricing[billingCycle];
}

export function getPlanMonthlyCredits(planId: PlanId): number {
  const entitlements = entitlementsByUserType[planId];
  return entitlements?.totalQuota ?? 0;
}

export function getPlanCreditsLabel(
  planId: PlanId,
  billingCycle: BillingCycle = "monthly",
): string {
  const monthlyCredits = getPlanMonthlyCredits(planId);
  if (monthlyCredits <= 0) {
    return "";
  }

  const totalCredits =
    billingCycle === "yearly" ? monthlyCredits * 12 : monthlyCredits;
  const cycleLabel = billingCycle === "yearly" ? "year" : "month";
  return `${totalCredits.toLocaleString()} credits per ${cycleLabel}`;
}

export function getPlanFeatureList(planId: PlanId): string[] {
  const config = SUBSCRIPTION_PLAN_CONFIGS[planId];
  if (!config) return [];
  return Object.values(config.details);
}
