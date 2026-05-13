/**
 * AuthProvider implementation for apps/web
 *
 * Implements the AuthProvider interface from @openloomi/integrations/core
 * using the auth system from apps/web.
 */

import type { AuthProvider, UserType } from "@openloomi/integrations/core";
import { auth } from "@/app/(auth)/auth";
import { headers } from "next/headers";

/**
 * Implementation of AuthProvider that uses apps/web's auth system
 */
export class WebAuthProvider implements AuthProvider {
  private _userId: string | null = null;
  private _token: string | null = null;
  private _userType: UserType | null = null;
  private _initialized = false;

  /**
   * Get the current user's ID from the session
   */
  getUserId(): string | null {
    this.ensureInitialized();
    return this._userId;
  }

  /**
   * Get the current user's auth token (Bearer token)
   */
  getToken(): string | null {
    this.ensureInitialized();
    return this._token;
  }

  /**
   * Get the current user's type
   */
  getUserType(): UserType | null {
    this.ensureInitialized();
    return this._userType;
  }

  /**
   * Initialize from the current request context (call in async context)
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      const session = await auth();
      if (!session?.user?.id) {
        this._initialized = true;
        return;
      }

      this._userId = session.user.id;
      // Map apps/web UserType to core UserType
      const userType = session.user.isGuest ? "guest" : "user";
      this._userType = userType as UserType;

      // Get token from Authorization header if available
      const headersList = await headers();
      const authHeader = headersList.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        this._token = authHeader.slice(7);
      }
    } catch (error) {
      console.error("[WebAuthProvider] Failed to initialize:", error);
    } finally {
      this._initialized = true;
    }
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      // Sync initialization is not reliable for auth - initialize lazily
      this._initialized = true;
    }
  }

  /**
   * Reset the provider state (useful for testing)
   */
  reset(): void {
    this._userId = null;
    this._token = null;
    this._userType = null;
    this._initialized = false;
  }
}

/**
 * Singleton instance of WebAuthProvider
 */
export const authProvider = new WebAuthProvider();
