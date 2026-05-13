"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button, Input, Label } from "@openloomi/ui";
import { toast } from "@/components/toast";
import { openUrl, isTauri } from "@/lib/tauri";
import { getStoredAuthToken } from "@/lib/auth/remote-client";

/**
 * Unified API call function
 * Automatically adds Bearer token (if present)
 */
function authenticatedFetch(url: string, options?: RequestInit) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  // Add user-passed headers
  if (options?.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    Object.entries(existingHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  const cloudToken = getStoredAuthToken();
  if (cloudToken) {
    headers.set("Authorization", `Bearer ${cloudToken}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * 1 USD = 15,000 credits
 * Calculated based on average model cost ($15/million tokens), 1 credit ≈ 13.33 tokens
 */
const CREDITS_PER_DOLLAR = 15000;

/**
 * Preset top-up tiers
 */
const PRESET_OPTIONS = [
  { amount: 5, credits: 5 * CREDITS_PER_DOLLAR, label: "starter" },
  { amount: 10, credits: 10 * CREDITS_PER_DOLLAR, label: "popular" },
  { amount: 20, credits: 20 * CREDITS_PER_DOLLAR, label: "bestValue" },
];

interface CreditsTopUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Credits top-up dialog component
 * User can select preset tiers or enter custom amount to top up credits
 */
export function CreditsTopUpDialog({
  open,
  onOpenChange,
}: CreditsTopUpDialogProps) {
  const { t } = useTranslation();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWaitingForPayment, setIsWaitingForPayment] = useState(false);

  /**
   * Handle preset amount selection
   */
  const handlePresetSelect = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount("");
  };

  /**
   * Handle custom amount input
   */
  const handleCustomAmountChange = (value: string) => {
    // Only allow numbers and decimal point
    const sanitized = value.replace(/[^0-9.]/g, "");
    setCustomAmount(sanitized);

    const numValue = Number.parseFloat(sanitized);
    if (!Number.isNaN(numValue) && numValue > 0) {
      setSelectedAmount(numValue);
    } else {
      setSelectedAmount(null);
    }
  };

  /**
   * Calculate the number of credits to be received
   */
  const getCreditsAmount = () => {
    if (!selectedAmount) return 0;
    return selectedAmount * CREDITS_PER_DOLLAR;
  };

  /**
   * Handle top-up
   */
  const handleTopUp = async () => {
    if (!selectedAmount || selectedAmount <= 0) {
      toast({
        type: "error",
        description: t("common.creditsTopUp.invalidAmount"),
      });
      return;
    }

    // Custom amount restriction
    if (customAmount && (selectedAmount < 1 || selectedAmount > 1000)) {
      toast({
        type: "error",
        description: t("common.creditsTopUp.amountRangeError"),
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Unified use of local API
      const response = await authenticatedFetch(
        "/api/stripe/credits-checkout",
        {
          method: "POST",
          body: JSON.stringify({
            amount: selectedAmount,
            isCustom: !!customAmount,
          }),
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const description =
          (errData?.message as string | undefined) ||
          t("common.creditsTopUp.checkoutError");
        toast({ type: "error", description });
        return;
      }

      const data = await response.json();

      if (data?.url) {
        // Tauri environment: use system browser to open payment page
        if (isTauri()) {
          await openUrl(data.url);
          setIsWaitingForPayment(true);
          // Credit top-up payment completion detection is handled on the payment success page
          setTimeout(() => {
            setIsWaitingForPayment(false);
            onOpenChange(false);
            window.location.reload();
          }, 60000); // Refresh after 1 minute
        } else {
          // Web environment: direct redirect
          window.location.assign(data.url);
        }
        return;
      }

      toast({
        type: "error",
        description: t("common.creditsTopUp.checkoutError"),
      });
    } catch (error) {
      console.error("[Credits] Failed to start checkout", error);
      toast({
        type: "error",
        description: t("common.creditsTopUp.checkoutError"),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Reset dialog state
   */
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedAmount(null);
      setCustomAmount("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="p-8 sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {t("common.creditsTopUp.topUpTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("common.creditsTopUp.topUpDescription")}
          </DialogDescription>
        </DialogHeader>

        {/* Payment wait notice (Tauri environment only) */}
        {isWaitingForPayment && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
            <RemixIcon
              name="credit_card"
              size="size-5"
              className="text-blue-600 dark:text-blue-400 animate-pulse"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {t("payment.waitingForPayment")}
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                {t("payment.browserOpened")}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-6 py-4">
          {/* Preset top-up tiers */}
          <div className="space-y-3">
            <Label>{t("common.creditsTopUp.selectAmount")}</Label>
            <div className="grid grid-cols-3 gap-3">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.amount}
                  type="button"
                  onClick={() => handlePresetSelect(option.amount)}
                  disabled={isProcessing}
                  className={`
                    relative flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all
                    ${
                      selectedAmount === option.amount && !customAmount
                        ? "border-primary bg-primary/5"
                        : "border-gray-200 hover:border-gray-300"
                    }
                    ${isProcessing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                  `}
                >
                  {/* Popular recommendation tag */}
                  {option.label === "popular" && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-accent-brand text-white">
                      {t("common.creditsBadge.popular")}
                    </div>
                  )}
                  {/* Great value tag */}
                  {option.label === "bestValue" && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-green-600 text-white">
                      {t("common.creditsBadge.bestValue")}
                    </div>
                  )}
                  <div className="text-2xl font-bold text-foreground mt-1">
                    ${option.amount}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {option.credits.toLocaleString()}{" "}
                    {t("common.creditsTopUp.creditsLabel")}
                  </div>
                  {selectedAmount === option.amount && !customAmount && (
                    <div className="absolute top-2 right-2 size-2 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div className="space-y-3">
            <Label htmlFor="custom-amount">
              {t("common.creditsTopUp.customAmount")}
            </Label>
            <div className="space-y-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="custom-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="1-1000"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  disabled={isProcessing}
                  className="pl-6"
                />
              </div>
              {customAmount && (
                <p className="text-sm text-muted-foreground">
                  {t("common.creditsTopUp.willReceive")}:{" "}
                  {getCreditsAmount().toLocaleString()}{" "}
                  {t("common.creditsTopUp.creditsLabel")}
                </p>
              )}
            </div>
          </div>

          {/* Exchange rate note */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-sm text-muted-foreground">
              💡 {t("common.creditsTopUp.exchangeRate")}: $1 ={" "}
              {CREDITS_PER_DOLLAR.toLocaleString()}{" "}
              {t("common.creditsTopUp.creditsLabel")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleTopUp}
            disabled={!selectedAmount || isProcessing}
          >
            {isProcessing ? (
              <>{t("common.processing")}</>
            ) : (
              <>
                <RemixIcon name="add" size="size-4" className="mr-2" />
                {t("common.creditsTopUp.topUpButton")}
                {selectedAmount ? ` $${selectedAmount}` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
