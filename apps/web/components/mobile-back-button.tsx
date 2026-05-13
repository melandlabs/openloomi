"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import { cn, getHomePath } from "@/lib/utils";

/**
 * Mobile back button component
 * Displays on non-chat pages, click to return to chat page
 */
export function MobileBackButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();

  // Get query parameter
  const page = searchParams?.get("page");

  // Determine if currently on a chat-related page (excluding cases with page query param)
  // When page query param exists, it's other feature pages (e.g., subscription, integrations), not chat pages
  const isChatPage =
    (pathname === "/" || pathname.startsWith("/chat/")) && !page;

  // Exclude auth pages like login, register
  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password");

  /**
   * Handle back button click
   */
  const handleBack = () => {
    const fromUserMenu = searchParams?.get("fromUserMenu");

    // If entered from user menu, back should go to menu (remove page param but keep fromUserMenu)
    // This keeps the menu open
    if (fromUserMenu === "true") {
      router.push(`${getHomePath()}?fromUserMenu=true`);
    } else {
      router.push(getHomePath());
    }
  };

  // Only show on mobile, non-chat pages, non-auth pages
  if (!isMobile || isChatPage || isAuthPage) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleBack}
      className={cn(
        "fixed left-4 top-[calc(env(safe-area-inset-top,0px)+16px)] z-[60]",
        "flex size-10 items-center justify-center rounded-full",
        "border border-border/60 bg-background/95 backdrop-blur",
        "text-foreground shadow-sm",
        "hover:bg-muted/50 transition-colors",
        "supports-[backdrop-filter]:bg-background/80",
      )}
      aria-label="Back"
    >
      <RemixIcon name="arrow_left" size="size-5" />
    </Button>
  );
}
