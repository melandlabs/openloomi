"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openloomi/ui";
import { Button } from "@openloomi/ui";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { getStoredAuthToken } from "@/lib/auth/remote-client";
import { toast } from "@/components/toast";
import { openUrl, isTauri } from "@/lib/tauri";
import {
  useSubscription,
  invalidateSubscriptionCache,
} from "@/hooks/use-subscription";

/**
 * Authenticated fetch: automatically attaches Bearer token (if present)
 */
function authenticatedFetch(url: string, options?: RequestInit) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (options?.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    for (const [key, value] of Object.entries(existingHeaders)) {
      headers.set(key, value);
    }
  }
  const cloudToken = getStoredAuthToken();
  if (cloudToken) {
    headers.set("Authorization", `Bearer ${cloudToken}`);
  }
  return fetch(url, { ...options, headers });
}

export interface PlansDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Pricing plans dialog
 * Style reference: personalization dialog (no left menu), only header + scrollable content area, contains three plan cards, supports account upgrade
 */
export function PlansDialog({ open, onOpenChange }: PlansDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session } = useSession();
  const { subscription } = useSubscription();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWaitingForPayment, setIsWaitingForPayment] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Use ref to avoid closure trap
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isWaitingRef = useRef(false);

  // Use subscription.planId instead of session.user.type to ensure accuracy
  const plan = subscription?.planId ?? "free";

  // Cleanup polling side effect
  useEffect(() => {
    isWaitingRef.current = isWaitingForPayment;
  }, [isWaitingForPayment]);

  // Clear all timers on component unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Plan level sorting: used to prevent downgrading
  const planLevels: Record<string, number> = {
    free: 0,
    basic: 1,
    pro: 2,
  };
  const currentPlanLevel = planLevels[plan] ?? 0;

  const startPaymentStatusPolling = useCallback(() => {
    const initialPlan = plan;
    const interval = setInterval(async () => {
      try {
        // Add timestamp parameter to avoid any possible caching
        const timestamp = Date.now();
        const response = await authenticatedFetch(
          `/api/stripe/subscription?_t=${timestamp}`,
        );
        if (response.ok) {
          const data = await response.json();
          const subscriptionData = data.subscription;
          if (subscriptionData) {
            // Check if subscription is active
            if (subscriptionData.isActive) {
              clearInterval(interval);
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }
              pollingIntervalRef.current = null;
              timeoutRef.current = null;
              setIsWaitingForPayment(false);
              // Clear SWR cache to ensure all components get the latest data
              invalidateSubscriptionCache();
              toast({ type: "success", description: t("payment.success") });
              window.location.reload();
              return;
            }

            // Even if not active, check if planId has changed (may be processing)
            if (
              subscriptionData.planId &&
              subscriptionData.planId !== initialPlan &&
              subscriptionData.planId !== "free"
            ) {
              console.log(
                `[Payment Polling] Plan changed from ${initialPlan} to ${subscriptionData.planId}`,
              );
              // Plan has changed, continue waiting for subscription status to become active
            }
          }
        } else {
          console.error(
            `[Payment Polling] Failed to fetch subscription, status: ${response.status}`,
          );
        }
      } catch (error) {
        console.error(
          "[Payment Polling] Error checking payment status:",
          error,
        );
      }
    }, 3000); // Check every 3 seconds

    pollingIntervalRef.current = interval;

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      clearInterval(interval);
      pollingIntervalRef.current = null;
      timeoutRef.current = null;
      if (isWaitingRef.current) {
        setIsWaitingForPayment(false);
        toast({ type: "info", description: t("payment.timeout") });
        console.log("[Payment Polling] Polling timed out");
      }
    }, 300000);

    timeoutRef.current = timeout;
  }, [plan, t]);

  const handleUpgrade = async (planId: string) => {
    if (!session) {
      toast({ type: "success", description: t("plans.needLogin") });
      router.push("/login?redirect=/subscription");
      return;
    }
    if (plan === planId) {
      toast({ type: "success", description: t("plans.alreadyOnPlan") });
      return;
    }
    // Prevent downgrade: check if target plan level is lower than current plan
    const targetPlanLevel = planLevels[planId] ?? 0;
    if (targetPlanLevel < currentPlanLevel) {
      toast({
        type: "error",
        description: t("plans.cannotDowngrade", {
          defaultValue: "Cannot downgrade to a lower plan",
        }),
      });
      return;
    }
    setIsProcessing(true);
    try {
      const response = await authenticatedFetch("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ planId, billingCycle: "monthly" }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          toast({ type: "error", description: t("plans.needLogin") });
          router.push("/login?redirect=/subscription");
          return;
        }
        const errData = await response.json().catch(() => null);
        const description =
          (errData?.message as string | undefined) ||
          t("payment.checkoutError");
        toast({ type: "error", description });
        return;
      }
      const data = await response.json();
      if (data?.url) {
        if (isTauri()) {
          // Clear any existing polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }

          await openUrl(data.url);
          setIsWaitingForPayment(true);
          startPaymentStatusPolling();
        } else {
          window.location.assign(data.url);
        }
        return;
      }
      toast({ type: "error", description: t("payment.checkoutError") });
    } catch (error) {
      console.error("[Stripe] Failed to start checkout", error);
      toast({ type: "error", description: t("payment.checkoutError") });
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle subscription cancellation
   */
  const handleCancelSubscription = () => {
    if (!subscription?.isActive || subscription.cancelAtPeriodEnd) {
      return;
    }
    setShowCancelDialog(true);
  };

  /**
   * Confirm subscription cancellation
   */
  const handleConfirmCancel = async () => {
    setShowCancelDialog(false);
    setIsCancelling(true);
    try {
      const response = await authenticatedFetch(
        "/api/stripe/subscription/cancel",
        {
          method: "POST",
          body: JSON.stringify({ immediately: false }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        if (data?.subscription) {
          toast({
            type: "success",
            description: t("settings.subscriptionCancelled", {
              defaultValue:
                "Subscription has been cancelled and will take effect at the end of the current billing cycle.",
            }),
          });
        }
      } else {
        const error = await response.json();
        toast({
          type: "error",
          description:
            error.message ||
            t("settings.cancelSubscriptionFailed", {
              defaultValue:
                "Failed to cancel subscription, please try again later.",
            }),
        });
      }
    } catch (error) {
      console.error("Failed to cancel subscription:", error);
      toast({
        type: "error",
        description: t("settings.cancelSubscriptionFailed", {
          defaultValue:
            "Failed to cancel subscription, please try again later.",
        }),
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="!fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-[95vw] sm:!w-[90vw] md:!max-w-[1000px] lg:!max-w-[1200px] !h-[90vh] !max-h-[800px] overflow-hidden flex flex-col p-0 gap-0 !z-[1000] !opacity-100 !visibility-visible"
          overlayClassName="!z-[999]"
        >
          <DialogHeader className="px-3 pt-3 md:px-8 md:pt-6 md:pb-6 gap-0 shrink-0">
            <DialogTitle className="text-base font-semibold text-foreground md:text-2xl mb-2">
              {t("plans.choosePlan", { defaultValue: "Select a plan" })}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 md:px-8 md:pt-0 md:pb-6">
            {isWaitingForPayment && (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-primary/5 mb-4">
                <RemixIcon
                  name="loader_2"
                  size="size-5"
                  className="text-primary animate-spin"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {t("payment.waitingForPayment")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("payment.browserOpened")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="shrink-0"
                >
                  {t("common.refresh", { defaultValue: "Refresh" })}
                </Button>
              </div>
            )}

            {/* Cancel subscription button: only shown when there is an active subscription and not already in cancellation flow */}
            {subscription?.isActive && !subscription.cancelAtPeriodEnd && (
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelSubscription}
                  disabled={isCancelling}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed underline-offset-4 hover:underline"
                >
                  {isCancelling
                    ? t("settings.cancelling", {
                        defaultValue: "Cancelling...",
                      })
                    : t("settings.cancelSubscription", {
                        defaultValue: "Cancel subscription",
                      })}
                </button>
              </div>
            )}

            {/* Notice when already in cancellation flow */}
            {subscription?.isActive && subscription.cancelAtPeriodEnd && (
              <div className="mb-4 flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
                <RemixIcon
                  name="information"
                  size="size-4"
                  className="text-amber-600 dark:text-amber-400 shrink-0"
                />
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {t("settings.subscriptionWillCancel", {
                    defaultValue: "Will be cancelled at end of cycle",
                  })}
                </span>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              {/* Free */}
              <Card
                className={cn(
                  "relative overflow-hidden transition-shadow duration-300 h-full flex flex-col border-border shadow-sm",
                )}
              >
                {plan === "free" && (
                  <div className="absolute top-0 right-0">
                    <div className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 uppercase tracking-wider">
                      {t("plans.current", { defaultValue: "Current" })}
                    </div>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-foreground">
                    {t("plans.freePlanTitle")}
                  </CardTitle>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-foreground">
                      {t("plans.freePlanPrice")}
                    </span>
                    <span className="text-muted-foreground">
                      {t("plans.freePlanPeriod")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="grow">
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("plans.freePlanDescription")}
                  </p>
                  <p className="text-base font-medium text-foreground mb-2">
                    {t("plans.freePlanIncludes")}
                  </p>
                  <ul className="space-y-2">
                    {[
                      "freePlanCredits",
                      "freePlanHistory",
                      "freePlanUnderstanding",
                      "freePlanConversations",
                      "freePlanIntegrations",
                      "freePlanSupport",
                    ].map((key) => (
                      <li key={key} className="flex items-start gap-2">
                        <RemixIcon
                          name="check"
                          size="size-4"
                          className="mt-1 flex-shrink-0 text-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          {t(`plans.${key}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className={cn(
                      "w-full py-6 text-base font-medium rounded-lg transition-all",
                      plan === "free"
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : (planLevels[plan] ?? 0) > planLevels.free
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "border-border bg-surface hover:bg-surface-hover",
                    )}
                    onClick={() => handleUpgrade("free")}
                    disabled={
                      plan === "free" ||
                      (planLevels[plan] ?? 0) > planLevels.free ||
                      isProcessing
                    }
                  >
                    {isProcessing && plan !== "free" ? (
                      <>
                        <RemixIcon
                          name="loader_2"
                          size="size-5"
                          className="mr-2 animate-spin"
                        />
                        {t("plans.processing", {
                          defaultValue: "Processing...",
                        })}
                      </>
                    ) : plan === "free" ? (
                      <>
                        <RemixIcon
                          name="check"
                          size="size-5"
                          className="mr-2"
                        />
                        {t("plans.currentPlan", {
                          defaultValue: "Current plan",
                        })}
                      </>
                    ) : (planLevels[plan] ?? 0) > planLevels.free ? (
                      <>
                        <RemixIcon name="lock" size="size-5" className="mr-2" />
                        {t("plans.cannotDowngrade", {
                          defaultValue: "Cannot downgrade",
                        })}
                      </>
                    ) : (
                      <>
                        {t("plans.upgrade", { defaultValue: "Upgrade" })}
                        <RemixIcon
                          name="arrow_right"
                          size="size-5"
                          className="ml-2"
                        />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>

              {/* Basic */}
              <Card
                className={cn(
                  "relative overflow-hidden transition-shadow duration-300 h-full flex flex-col",
                  plan === "basic"
                    ? "border-primary shadow-md"
                    : "border-border shadow-sm",
                )}
              >
                {plan === "basic" && (
                  <div className="absolute top-0 right-0">
                    <div className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 uppercase tracking-wider">
                      {t("plans.current", { defaultValue: "Current" })}
                    </div>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-foreground">
                    {t("plans.basicPlanTitle")}
                  </CardTitle>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-lg font-medium text-muted-foreground line-through">
                      $16.8
                    </span>
                    <span className="text-3xl font-bold text-foreground">
                      {t("plans.basicPlanPrice")}
                    </span>
                    <span className="bg-green-500/10 text-green-500 px-2 py-1 text-xs font-medium rounded-full border border-green-500/20">
                      10% OFF
                    </span>
                    <span className="text-muted-foreground">
                      {t("plans.basicPlanPeriod")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="grow">
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("plans.basicPlanDescription")}
                  </p>
                  <p className="text-base font-medium text-foreground mb-2">
                    {t("plans.basicPlanIncludes")}
                  </p>
                  <ul className="space-y-2">
                    {[
                      "basicPlanCredits",
                      "basicPlanHistory",
                      "basicPlanUnderstanding",
                      "basicPlanLearning",
                      "basicPlanTopUps",
                      "basicPlanSupport",
                    ].map((key) => (
                      <li key={key} className="flex items-start gap-2">
                        <RemixIcon
                          name="check"
                          size="size-4"
                          className="mt-1 flex-shrink-0 text-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          {t(`plans.${key}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className={cn(
                      "w-full py-6 text-base font-medium rounded-lg transition-all",
                      plan === "basic"
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : (planLevels[plan] ?? 0) > planLevels.basic
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-primary text-primary-foreground hover:opacity-90",
                    )}
                    onClick={() => handleUpgrade("basic")}
                    disabled={
                      plan === "basic" ||
                      (planLevels[plan] ?? 0) > planLevels.basic ||
                      isProcessing
                    }
                  >
                    {isProcessing && plan !== "basic" ? (
                      <>
                        <RemixIcon
                          name="loader_2"
                          size="size-5"
                          className="mr-2 animate-spin"
                        />
                        {t("plans.processing", {
                          defaultValue: "Processing...",
                        })}
                      </>
                    ) : plan === "basic" ? (
                      <>
                        <RemixIcon
                          name="check"
                          size="size-5"
                          className="mr-2"
                        />
                        {t("plans.currentPlan", {
                          defaultValue: "Current plan",
                        })}
                      </>
                    ) : plan === "pro" ? (
                      <>
                        <RemixIcon name="lock" size="size-5" className="mr-2" />
                        {t("plans.cannotDowngrade", {
                          defaultValue: "Cannot downgrade",
                        })}
                      </>
                    ) : (
                      <>
                        {t("plans.upgrade", { defaultValue: "Upgrade" })}
                        <RemixIcon
                          name="arrow_right"
                          size="size-5"
                          className="ml-2"
                        />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>

              {/* Pro */}
              <Card
                className={cn(
                  "relative overflow-hidden transition-shadow duration-300 h-full flex flex-col",
                  plan === "pro"
                    ? "border-primary shadow-md"
                    : "border-border shadow-sm",
                )}
              >
                {plan === "pro" && (
                  <div className="absolute top-0 right-0">
                    <div className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 uppercase tracking-wider">
                      {t("plans.current", { defaultValue: "Current" })}
                    </div>
                  </div>
                )}
                {plan !== "pro" && (
                  <div className="absolute top-0 right-0">
                    <div className="bg-accent-brand text-primary-foreground text-xs font-semibold px-3 py-1 uppercase tracking-wider flex items-center gap-1">
                      <RemixIcon name="star" size="size-4" filled />
                      {t("plans.popular", { defaultValue: "Most popular" })}
                    </div>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-foreground">
                    {t("plans.proPlanTitle")}
                  </CardTitle>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-lg font-medium text-muted-foreground line-through">
                      $43.8
                    </span>
                    <span className="text-3xl font-bold text-foreground">
                      {t("plans.proPlanPrice")}
                    </span>
                    <span className="bg-green-500/10 text-green-500 px-2 py-1 text-xs font-medium rounded-full border border-green-500/20">
                      10% OFF
                    </span>
                    <span className="text-muted-foreground">
                      {t("plans.proPlanPeriod")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="grow">
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("plans.proPlanDescription")}
                  </p>
                  <p className="text-base font-medium text-foreground mb-2">
                    {t("plans.proPlanIncludes")}
                  </p>
                  <ul className="space-y-2">
                    {[
                      "proPlanCredits",
                      "proPlanHistory",
                      "proPlanConversations",
                      "proPlanLearning",
                      "proPlanIntegrations",
                      "proPlanSupport",
                    ].map((key) => (
                      <li key={key} className="flex items-start gap-2">
                        <RemixIcon
                          name="check"
                          size="size-4"
                          className="mt-1 flex-shrink-0 text-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          {t(`plans.${key}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className={cn(
                      "w-full py-6 text-base font-medium rounded-lg transition-all",
                      plan === "pro"
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "bg-primary text-primary-foreground hover:opacity-90",
                    )}
                    onClick={() => handleUpgrade("pro")}
                    disabled={plan === "pro" || isProcessing}
                  >
                    {isProcessing && plan !== "pro" ? (
                      <>
                        <RemixIcon
                          name="loader_2"
                          size="size-5"
                          className="mr-2 animate-spin"
                        />
                        {t("plans.processing", {
                          defaultValue: "Processing...",
                        })}
                      </>
                    ) : plan === "pro" ? (
                      <>
                        <RemixIcon
                          name="check"
                          size="size-5"
                          className="mr-2"
                        />
                        {t("plans.currentPlan", {
                          defaultValue: "Current plan",
                        })}
                      </>
                    ) : (
                      <>
                        {t("plans.upgrade", { defaultValue: "Upgrade" })}
                        <RemixIcon
                          name="arrow_right"
                          size="size-5"
                          className="ml-2"
                        />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel subscription confirmation dialog - placed outside to avoid being obscured */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="!z-[1001]">
          <DialogHeader>
            <DialogTitle>
              {t("settings.cancelSubscriptionTitle", {
                defaultValue: "Cancel subscription",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.confirmCancelSubscription", {
                defaultValue:
                  "Are you sure you want to cancel your subscription? It will be cancelled at the end of the current billing cycle and you will not be charged next month.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button variant="destructive" onClick={handleConfirmCancel}>
              {t("settings.confirmCancel", {
                defaultValue: "Confirm cancellation",
              })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
