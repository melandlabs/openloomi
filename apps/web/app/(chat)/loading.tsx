import { Skeleton } from "@openloomi/ui";

export default function ChatLoading() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      {/* Messages skeleton */}
      <div className="flex-1 space-y-4 overflow-hidden">
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-16 w-1/2 ml-auto" />
        <Skeleton className="h-20 w-5/6" />
        <Skeleton className="h-16 w-2/3" />
      </div>

      {/* Input skeleton */}
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
