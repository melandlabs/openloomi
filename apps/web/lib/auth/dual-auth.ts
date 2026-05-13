/**
 * Dual auth utility functions
 * Supports both Session Cookie (Web) and Bearer Token (Tauri)
 */

import { auth } from "@/app/(auth)/auth";
import { getUserIdFromToken, isTokenValid } from "./token-manager";

export interface AuthUser {
  id: string;
  email?: string | null;
  name?: string | null;
  type?: string | null;
}

/**
 * Check if is shadow user (cloud user in Tauri mode)
 */
function isShadowUser(userId: string): boolean {
  return userId.startsWith("cloud_");
}

/**
 * Get authenticated user from request
 * Priority:
 * 1. Bearer Token (Tauri local) - prefer getting from local database
 * 2. Session Cookie (Web)
 */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  // 1. Try to get Bearer token from Authorization header first (Tauri local)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    if (isTokenValid(token)) {
      const userId = getUserIdFromToken(token);
      if (userId) {
        // For shadow users (Tauri mode), get user info from local database
        // Avoid calling cloud API every time
        if (isShadowUser(userId)) {
          try {
            const { getUserById } = await import("@/lib/db/queries");
            const localUser = await getUserById(userId);
            if (localUser) {
              return {
                id: localUser.id,
                email: localUser.email,
                name: localUser.name,
              };
            }
          } catch (error) {
            console.error(
              "[DualAuth] Failed to get shadow user from DB:",
              error,
            );
          }
        }

        // Non-shadow user or local fetch failed, try to get from cloud
        try {
          const response = await fetch(
            `${process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL || "https://app.openloomi.ai"}/api/remote-auth/user`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            return {
              id: data.id,
              email: data.email,
              name: data.name,
              type: data.subscription,
            };
          }

          // If failed to get user info, at least return ID
          return { id: userId };
        } catch (error) {
          console.error("[DualAuth] Failed to fetch user from cloud:", error);
          return { id: userId };
        }
      }
    }
  }

  // 2. If no Bearer token, try Session (Web)
  const session = await auth();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      type: session.user.type,
    };
  }

  return null;
}

/**
 * Verify if request is authenticated
 */
export async function isAuthenticated(request: Request): Promise<boolean> {
  const user = await getAuthUser(request);
  return user !== null;
}
