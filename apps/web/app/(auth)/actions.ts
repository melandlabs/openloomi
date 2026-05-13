"use server";

import { z } from "zod";
import { createUser, getUser, db } from "@/lib/db/queries";
import { authFormSchema } from "@/lib/auth/validation";
import { signIn } from "./auth";
import {
  shouldUseCloudAuth,
  getCloudApiBaseUrl,
} from "@/lib/auth/remote-client";
import { getOrCreateShadowUser } from "@/lib/db/remote-user-queries";

/**
 * Map error codes to i18n keys
 */
function getErrorI18nKey(errorCode: string): string {
  const errorMap: Record<string, string> = {
    INVALID_CREDENTIALS: "auth.errorInvalidCredentials",
    USER_EXISTS: "auth.errorUserExists",
    USER_NOT_FOUND: "auth.errorUserNotFound",
    MISSING_EMAIL: "auth.errorMissingEmail",
    MISSING_PASSWORD: "auth.errorMissingPassword",
    INVALID_EMAIL: "auth.errorInvalidEmail",
    INVALID_PASSWORD: "auth.errorInvalidPassword",
  };

  return errorMap[errorCode] || errorCode;
}

export interface GoogleOAuthCompleteState {
  status: "idle" | "success" | "failed";
  token?: string;
  error?: string;
}

/**
 * Complete Google OAuth login: create shadow user with dummy password, sign in, redirect.
 */
export const completeGoogleOAuth = async (
  _: GoogleOAuthCompleteState,
  formData: FormData,
): Promise<GoogleOAuthCompleteState> => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const token = formData.get("token") as string | undefined;
  const userId = formData.get("userId") as string | undefined;
  const userName = formData.get("userName") as string | null | undefined;
  const userAvatar = formData.get("userAvatar") as string | null | undefined;

  if (!email || !password) {
    return { status: "failed", error: "Missing credentials" };
  }

  try {
    // Create local shadow user with cloud's dummy password
    await getOrCreateShadowUser(
      {
        id: userId || email,
        email,
        name: userName || null,
        avatarUrl: userAvatar || null,
      },
      db,
      { password },
    );

    // Sign in with NextAuth (same as normal remote login)
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { status: "success", token };
  } catch (error) {
    console.error("[CompleteGoogleOAuth] Error:", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Login failed",
    };
  }
};

export interface GitHubOAuthCompleteState {
  status: "idle" | "success" | "failed";
  token?: string;
  error?: string;
}

/**
 * Complete GitHub OAuth login: create shadow user with dummy password, sign in, redirect.
 */
export const completeGitHubOAuth = async (
  _: GitHubOAuthCompleteState,
  formData: FormData,
): Promise<GitHubOAuthCompleteState> => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const token = formData.get("token") as string | undefined;
  const userId = formData.get("userId") as string | undefined;
  const userName = formData.get("userName") as string | null | undefined;
  const userAvatar = formData.get("userAvatar") as string | null | undefined;

  if (!email || !password) {
    return { status: "failed", error: "Missing credentials" };
  }

  try {
    // Create local shadow user with cloud's dummy password
    await getOrCreateShadowUser(
      {
        id: userId || email,
        email,
        name: userName || null,
        avatarUrl: userAvatar || null,
      },
      db,
      { password },
    );

    // Sign in with NextAuth (same as normal remote login)
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { status: "success", token };
  } catch (error) {
    console.error("[CompleteGitHubOAuth] Error:", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Login failed",
    };
  }
};

export interface LoginActionState {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
  error?: string;
  token?: string; // Cloud auth token, needs to be stored in localStorage on client
}

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // Check if using remote authentication
    if (shouldUseCloudAuth()) {
      // Remote authentication: call cloud API (consistent with remote-client, includes default URL)
      const cloudUrl =
        process.env.CLOUD_API_URL ||
        process.env.NEXT_PUBLIC_CLOUD_API_URL ||
        getCloudApiBaseUrl() ||
        "https://app.openloomi.ai";

      if (!cloudUrl) {
        console.error("[RemoteAuth] Cloud API URL not configured");
        return { status: "failed", error: "Cloud API URL not configured" };
      }

      const response = await fetch(`${cloudUrl}/api/remote-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Important: don't follow redirects automatically, avoid 307 loops
        redirect: "manual",
        body: JSON.stringify({
          email: validatedData.email,
          password: validatedData.password,
        }),
      });

      // Handle redirect responses (307, 308, etc.)
      if (response.status === 307 || response.status === 308) {
        const redirectUrl = response.headers.get("Location");
        console.error("[RemoteAuth] Got redirect (307/308) to:", redirectUrl);
        console.error(
          "[RemoteAuth] This usually means the URL is wrong. Cloud URL:",
          cloudUrl,
        );
        return {
          status: "failed",
          error: "API configuration error. Please check the cloud URL.",
        };
      }

      if (!response.ok) {
        console.error("[RemoteAuth] Login failed:", response.status);

        let errorMessage = "auth.errorLoginFailed";
        try {
          const errorData = await response.json();
          const errorCode = errorData.error || errorData.message;
          errorMessage = getErrorI18nKey(errorCode || errorMessage);
        } catch {
          // JSON parsing failed, use default message
        }

        return {
          status: "failed",
          error: errorMessage,
        };
      }

      const data = await response.json();

      // Create local shadow user (only when user data exists)
      if (data.user) {
        try {
          // Set password for shadow user so NextAuth can verify
          await getOrCreateShadowUser(data.user, db, {
            password: validatedData.password,
          });
        } catch (error) {
          console.error("[RemoteAuth] Failed to create shadow user:", error);
          // Don't block login flow, shadow user creation failure doesn't affect login
        }
      }

      // Create local session using NextAuth (using shadow user and its id)
      const signInResult = await signIn("credentials", {
        cloudUserId: data.user?.id,
        email: validatedData.email,
        password: validatedData.password,
        redirect: false,
      });

      // Return token to client, client needs to store it in localStorage
      return { status: "success", token: data.token };
    }
    // Local authentication: only used in Web mode
    // If in Tauri mode but shouldUseCloudAuth() returns false, this is a configuration error
    const isTauriEnv =
      process.env.IS_TAURI === "true" ||
      process.env.DEPLOYMENT_MODE === "tauri";

    if (isTauriEnv) {
      return {
        status: "failed",
        error:
          "Tauri mode requires cloud authentication. Please check CLOUD_API_URL configuration.",
      };
    }

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export interface RegisterActionState {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
  error?: string;
  token?: string; // Cloud auth token, needs to be stored in localStorage on client
}

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // Check if using remote authentication
    if (shouldUseCloudAuth()) {
      // Remote authentication: call cloud API (consistent with remote-client, includes default URL)
      const cloudUrl =
        process.env.CLOUD_API_URL ||
        process.env.NEXT_PUBLIC_CLOUD_API_URL ||
        getCloudApiBaseUrl() ||
        "https://app.openloomi.ai";

      if (!cloudUrl) {
        return { status: "failed", error: "Cloud API URL not configured" };
      }

      const response = await fetch(`${cloudUrl}/api/remote-auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: validatedData.email,
          password: validatedData.password,
        }),
      });

      if (!response.ok) {
        console.error("[RemoteAuth] Register failed:", response.status);

        let errorMessage = "auth.errorRegisterFailed";
        try {
          const errorData = await response.json();
          const errorCode = errorData.error || errorData.message;
          errorMessage = getErrorI18nKey(errorCode || errorMessage);
        } catch {
          // JSON parsing failed, use default message
        }

        if (response.status === 409) {
          return { status: "user_exists", error: errorMessage };
        }

        return { status: "failed", error: errorMessage };
      }

      const data = await response.json();

      // Create local shadow user (only when user data exists)
      if (data.user) {
        try {
          // Set password for shadow user so NextAuth can verify
          await getOrCreateShadowUser(data.user, db, {
            password: validatedData.password,
          });
        } catch (error) {
          console.error("[RemoteAuth] Failed to create shadow user:", error);
          // Don't block registration flow, shadow user creation failure doesn't affect registration
        }
      }

      // Create local session using NextAuth (using shadow user and its id)
      await signIn("credentials", {
        cloudUserId: data.user?.id,
        email: validatedData.email,
        password: validatedData.password,
        redirect: false,
      });

      // Return token to client, client needs to store it in localStorage
      return { status: "success", token: data.token };
    }

    // Local authentication: check if user exists
    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }

    await createUser(validatedData.email, validatedData.password);

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
