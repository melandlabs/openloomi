import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

const iconsByType: Record<"success" | "error" | "info", ReactNode> = {
  success: <RemixIcon name="checkbox_circle" size="size-4" filled />,
  error: <RemixIcon name="error_warning" size="size-4" />,
  info: <RemixIcon name="info" size="size-4" />,
};

type ToastTriggerProps = Omit<ToastProps, "id" | "onDismiss"> & {
  id?: string | number;
  duration?: number;
};

export function toast(props: ToastTriggerProps) {
  const { duration, id: requestedId, ...rest } = props;
  return sonnerToast.custom(
    (id) => (
      <Toast
        id={id}
        type={rest.type}
        description={rest.description}
        onDismiss={() => sonnerToast.dismiss(id)}
      />
    ),
    { duration, id: requestedId },
  );
}

export function dismissToast(id?: string | number) {
  sonnerToast.dismiss(id);
}

function Toast(props: ToastProps) {
  const { id, type, description, onDismiss } = props;

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;

    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };

    update(); // initial check
    const ro = new ResizeObserver(update); // re-check on width changes
    ro.observe(el);

    return () => ro.disconnect();
  }, [description]);

  return (
    <div className="flex w-full toast-mobile:w-[356px] justify-center">
      <div
        data-testid="toast"
        key={id}
        className={cn(
          "bg-zinc-100 p-3 rounded-lg w-full toast-mobile:w-fit flex flex-row gap-3",
          multiLine ? "items-start" : "items-center",
        )}
      >
        <div
          data-type={type}
          className={cn(
            "data-[type=error]:text-red-600 data-[type=success]:text-green-600 data-[type=info]:text-blue-600",
            {
              "pt-1": multiLine,
            },
          )}
        >
          {iconsByType[type]}
        </div>
        <div className="flex-1 min-w-0">
          <div ref={descriptionRef} className="text-zinc-950 text-sm">
            {description}
          </div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 shrink-0 rounded-full p-1 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800"
            aria-label="Dismiss notification"
          >
            <RemixIcon name="close" size="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface ToastProps {
  id: string | number;
  type: "success" | "error" | "info";
  description: ReactNode;
  onDismiss?: () => void;
}
