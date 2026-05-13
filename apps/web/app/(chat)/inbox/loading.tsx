import { Skeleton } from "@openloomi/ui";

const skeletonItems = Array.from({ length: 8 });

export default function InboxLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Insights list skeleton */}
      <div className="flex-1 space-y-3 overflow-hidden">
        {skeletonItems.map((_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton loading UI
            key={index}
            className="flex gap-3 rounded-lg border p-3"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
