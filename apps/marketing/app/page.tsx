import { Suspense } from "react";
import MarketingHomeClient from "./home-client";

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <MarketingHomeClient />
    </Suspense>
  );
}
