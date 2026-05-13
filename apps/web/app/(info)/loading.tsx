import { Skeleton } from "@openloomi/ui";

export default function InfoLoading() {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      {/* Header skeleton */}
      <Skeleton className="h-8 w-48" />

      {/* Content skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
