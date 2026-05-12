export type PlanId = "basic" | "pro";
export type BillingCycle = "monthly" | "yearly";

/**
 * Stripe Price ID mapping
 *
 * Note: Yearly prices need to be created in Stripe Dashboard
 * - Basic yearly: $153/year (equivalent to $12.75/month, 15% discount)
 * - Pro yearly: $398/year (equivalent to $33.17/month, 15% discount)
 *
 * Creation steps:
 * 1. Log in to Stripe Dashboard
 * 2. Go to Products page
 * 3. Add new yearly prices for Basic and Pro products
 * 4. Fill in the generated Price IDs in the configuration below
 */
const STRIPE_PRICE_BY_PLAN: Record<
  PlanId,
  Partial<Record<BillingCycle, string>>
> = {
  basic: {
    monthly: "price_1SFcn0FGmRIfSL0DZJfklyWh",
    // TODO: After creating yearly price in Stripe Dashboard, fill in Price ID here
    // yearly: "price_xxxxxxxxxxxxxxxxxxxxx", // $153/year
  },
  pro: {
    monthly: "price_1SFcnlFGmRIfSL0DgPfYc5HC",
    // TODO: After creating yearly price in Stripe Dashboard, fill in Price ID here
    // yearly: "price_xxxxxxxxxxxxxxxxxxxxx", // $398/year
  },
};

const PRICE_TO_PLAN = new Map<
  string,
  { planId: PlanId; billingCycle: BillingCycle }
>();

for (const [planId, cycles] of Object.entries(STRIPE_PRICE_BY_PLAN) as Array<
  [PlanId, Partial<Record<BillingCycle, string>>]
>) {
  for (const [cycle, priceId] of Object.entries(cycles) as Array<
    [BillingCycle, string]
  >) {
    if (!priceId) continue;
    PRICE_TO_PLAN.set(priceId, { planId, billingCycle: cycle });
  }
}

export const SUPPORTED_PLAN_IDS = Object.keys(STRIPE_PRICE_BY_PLAN) as PlanId[];

export function isSupportedPlan(planId: string): planId is PlanId {
  return SUPPORTED_PLAN_IDS.includes(planId as PlanId);
}

export function getStripePriceId(
  planId: PlanId,
  billingCycle: BillingCycle = "monthly",
): string | undefined {
  return STRIPE_PRICE_BY_PLAN[planId]?.[billingCycle];
}

export function resolvePlanFromPrice(priceId: string) {
  return PRICE_TO_PLAN.get(priceId);
}
