"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useSWRConfig } from "swr";
import { getHomePath } from "@/lib/utils";
import { toast } from "sonner";

export default function SlackAuthorizedPage() {
  return (
    <Suspense fallback={<AuthorizingFallback />}>
      <SlackAuthorizedContent />
    </Suspense>
  );
}

function SlackAuthorizedContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const providerError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutate } = useSWRConfig();

  // Handle OAuth completion logic
  useEffect(() => {
    const handleOAuthCallback = async () => {
      if (!code || !stateParam) {
        if (providerError) {
          setError(
            providerError + (errorDescription ? `: ${errorDescription}` : ""),
          );
        } else {
          setError("Missing authorization code or state");
        }
        setIsAuthorizing(false);
        return;
      }

      setIsProcessing(true);
      setIsAuthorizing(true);
      setError(null);

      try {
        // Call backend API to complete OAuth (no authentication needed, because userId is extracted from state)
        const response = await fetch("/api/slack/oauth/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state: stateParam }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to complete authorization");
        }

        // Show success message and redirect
        toast.success(
          t("auth.slackConnected", "Slack connected successfully!"),
        );

        // Delay redirect to let user see success message
        setTimeout(() => {
          router.push(getHomePath());
          router.refresh();
        }, 1500);
      } catch (err) {
        console.error("OAuth finalize failed:", err);
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to complete authorization";

        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setIsProcessing(false);
        setIsAuthorizing(false);
      }
    };

    handleOAuthCallback();
  }, [code, stateParam, providerError, errorDescription]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 px-6">
      <div className="w-full max-w-md text-center">
        {isAuthorizing || isProcessing ? (
          <div className="space-y-6">
            <div className="mx-auto size-16 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
            <h1 className="text-2xl font-semibold text-gray-900">
              {t("auth.authorizing", "Authorizing...")}
            </h1>
            <p className="text-gray-600">
              {t(
                "auth.pleaseWait",
                "Please wait while we connect your Slack workspace",
              )}
            </p>
          </div>
        ) : error ? (
          <div className="space-y-6">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100">
              <span className="text-4xl">❌</span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t("auth.authorizationFailed", "Authorization Failed")}
            </h1>
            <p className="text-gray-600">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
              <span className="text-4xl">✅</span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t("auth.slackConnected", "Slack Connected!")}
            </h1>
            <p className="text-gray-600">
              {t("auth.redirecting", "Redirecting you back...")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AuthorizingFallback() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 px-6">
      <div className="w-full max-w-md text-center">
        <div className="space-y-6">
          <div className="mx-auto size-16 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">
            {t("auth.authorizing", "Authorizing...")}
          </h1>
          <p className="text-gray-600">
            {t(
              "auth.pleaseWait",
              "Please wait while we connect your Slack workspace",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
