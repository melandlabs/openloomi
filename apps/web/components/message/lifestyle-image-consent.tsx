"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface LifestyleImageConsentProps {
  onConfirm: () => Promise<void>;
  onDecline: () => void;
}

export function LifestyleImageConsent({
  onConfirm,
  onDecline,
}: LifestyleImageConsentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="mt-2 w-full max-w-xl rounded-[8px] border border-border bg-card p-3 text-sm shadow-sm">
      <div className="space-y-1">
        <p className="font-medium text-foreground">Generate lifestyle image?</p>
        <p className="text-muted-foreground">
          OpenLoomi will use bounded profile, recent chat, insight, and memory
          summaries to create one image prompt.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);
            try {
              await onConfirm();
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          Generate
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={onDecline}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
