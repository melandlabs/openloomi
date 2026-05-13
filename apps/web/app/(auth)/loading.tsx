import { Skeleton } from "@openloomi/ui";

export default function AuthLoading() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo skeleton */}
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-16 w-16 rounded-xl" />
          <Skeleton className="h-6 w-32" />
        </div>

        {/* Form skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>

        {/* Footer skeleton */}
        <Skeleton className="h-4 w-48 mx-auto" />
      </div>
    </div>
  );
}
