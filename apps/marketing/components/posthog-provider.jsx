"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PostHogProvider } from "posthog-js/react";

import {
  capturePosthogPageview,
  getPosthogClient,
  initPosthog,
  isPosthogEnabled,
} from "@/lib/analytics/posthog";

function PosthogRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    capturePosthogPageview();
  }, [pathname, searchParams]);

  return null;
}

export function PosthogProvider({ children }) {
  useEffect(() => {
    initPosthog();
  }, []);

  if (!isPosthogEnabled()) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={getPosthogClient()}>
      {children}
      <Suspense fallback={null}>
        <PosthogRouteTracker />
      </Suspense>
    </PostHogProvider>
  );
}
