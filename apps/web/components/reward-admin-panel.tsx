"use client";

import useSWR from "swr";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openloomi/ui";

type RewardAdminSummary = {
  featureEnabled: boolean;
  dailyCap: number;
  todaysCredits: number;
  lifetimeCredits: number;
  dayTotals: Array<{ day: string; credits: number; count: number }>;
};

const ADMIN_REWARD_ENDPOINT = "/api/admin/rewards/summary" as const;

async function fetchRewardSummary(url: string): Promise<RewardAdminSummary> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to load reward metrics (${response.status})`);
  }
  return (await response.json()) as RewardAdminSummary;
}

export function RewardAdminPanel() {
  const { t } = useTranslation();
  const { data, error } = useSWR<RewardAdminSummary>(
    ADMIN_REWARD_ENDPOINT,
    fetchRewardSummary,
    { revalidateOnFocus: false },
  );

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-rose-900 text-base">
            {t("rewards.adminTitle", { defaultValue: "Reward program" })}
          </CardTitle>
          <CardDescription className="text-rose-700 text-sm">
            {t("rewards.adminError", {
              defaultValue: "Unable to load reward metrics right now.",
            })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data?.featureEnabled) {
    return null;
  }

  const remainingToday = Math.max(data.dailyCap - data.todaysCredits, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("rewards.adminTitle", { defaultValue: "Reward program" })}
        </CardTitle>
        <CardDescription>
          {t("rewards.adminDescription", {
            defaultValue: "Monitor granted credits and daily caps.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              {t("rewards.adminToday", { defaultValue: "Issued today" })}
            </p>
            <p className="text-xl font-semibold text-blue-600">
              {data.todaysCredits.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("rewards.adminRemaining", {
                defaultValue: "{{credits}} credits remaining in cap",
                credits: remainingToday,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              {t("rewards.adminLifetime", { defaultValue: "Lifetime issued" })}
            </p>
            <p className="text-xl font-semibold">
              {data.lifetimeCredits.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              {t("rewards.adminCap", { defaultValue: "Daily cap" })}
            </p>
            <p className="text-xl font-semibold">
              {data.dailyCap.toLocaleString()}
            </p>
          </div>
        </div>
        {data.dayTotals.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {data.dayTotals.slice(0, 5).map((entry) => (
              <li
                key={entry.day}
                className="flex items-center justify-between rounded border border-muted px-3 py-2"
              >
                <span>{entry.day}</span>
                <span className="text-muted-foreground">
                  {entry.credits.toLocaleString()} ({entry.count})
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
