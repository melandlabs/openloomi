/**
 * Cloud registration API
 * Used for remote registration in Tauri desktop version
 *
 * - Web: direct handling
 * - Tauri desktop: forward to cloud
 */

import type { NextRequest } from "next/server";
import { getUser, createUser } from "@/lib/db/queries";
import {
  generateToken,
  getTokenLifetime,
  withErrorHandler,
  createSuccessResponse,
  createErrorResponse,
} from "@/lib/auth/remote-auth-utils";
import {
  withRateLimit,
  createRateLimitResponse,
  RateLimitPresets,
} from "@/lib/rate-limit/middleware";
import { setAuthCookies } from "@/lib/auth/cookie-auth";
import { createCloudClientForRequest } from "@/lib/auth/remote-client";
import { isTauriMode } from "@/lib/env/constants";
import { authFormSchema } from "@/lib/auth/validation";

export async function POST(request: NextRequest) {
  // Tauri desktop: forward to cloud (rate limiting handled by cloud)
  if (isTauriMode()) {
    const cloudClient = createCloudClientForRequest(request);

    if (!cloudClient) {
      return createErrorResponse("Cloud API not available", 503);
    }

    try {
      const body = await request.json();
      const result = await cloudClient.register(body.email, body.password);
      return createSuccessResponse(result);
    } catch (error) {
      console.error(
        "[Remote Auth] Failed to forward register to cloud:",
        error,
      );
      return createErrorResponse(
        error instanceof Error ? error.message : "Registration failed",
        500,
      );
    }
  }

  // Web: direct handling (includes rate limiting)
  // Rate limit check: 3 requests/hour (registration is stricter than login)
  const rateLimitResult = await withRateLimit(
    request,
    RateLimitPresets.register,
  );
  if (!rateLimitResult.success) {
    return createRateLimitResponse(rateLimitResult);
  }

  return withErrorHandler(async () => {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return createErrorResponse("Email and password are required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return createErrorResponse("Invalid email format");
    }

    // Validate password strength (use same schema as frontend to prevent bypass)
    const { error: passwordError } =
      authFormSchema.shape.password.safeParse(password);
    if (passwordError) {
      return createErrorResponse("Password does not meet requirements");
    }

    // Check if user already exists
    const existingUsers = await getUser(email);

    if (existingUsers.length > 0) {
      return createErrorResponse("User already exists", 409);
    }

    // Create new user
    const [newUser] = await createUser(email, password);

    // Generate auth token
    const token = generateToken(newUser.id, newUser.email);

    // Parse token to get payload (for setting payload cookie)
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: newUser.id,
      email: newUser.email,
      exp: now + getTokenLifetime(),
      iat: now,
    };

    // Set auth cookies and return user info (token in cookie)
    // Also return token in response body for Tauri compatibility
    const response = createSuccessResponse({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        avatarUrl: newUser.avatarUrl,
        type: "regular",
      },
      token,
    });
    return setAuthCookies(response, token, payload);
  });
}
