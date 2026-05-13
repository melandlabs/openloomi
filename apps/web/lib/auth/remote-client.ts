/**
 * Cloud API client
 * Used by Tauri local version to call cloud authentication and user-related APIs
 *
 * Design principles:
 * - Only user authentication-related data goes through cloud API (User, Session, Subscription)
 * - Application data (Chat, Message, Bot etc.) stored in local SQLite
 * - Web version does not need this client, directly calls local API routes
 */

import { isTauri } from "@/lib/tauri";
import { getAuthToken } from "@/lib/auth/token-manager";

/**
 * Check if running in Tauri client environment
 */
function isTauriClient(): boolean {
  // Client environment: check window.__TAURI__
  if (typeof window !== "undefined") {
    return isTauri();
  }
  // Server environment: check environment variables
  if (typeof process !== "undefined" && process.env?.IS_TAURI === "true") {
    return true;
  }
  return false;
}

/**
 * Cloud API base URL
 * - Tauri mode: use cloud server address
 * - Web mode: return null (no need for remote client)
 */
export function getCloudApiBaseUrl(): string | null {
  if (!isTauriClient()) {
    return null; // Web version directly calls local API routes
  }

  // Get cloud API address from environment variables
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.openloomi.ai";

  return cloudUrl;
}

/**
 * Cloud API client class
 */
export class CloudApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private cookie: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Set auth token
   */
  setAuthToken(token: string) {
    this.token = token;
  }

  /**
   * Set Cookie (for server to forward session)
   */
  setCookie(cookie: string) {
    this.cookie = cookie;
  }

  /**
   * Clear auth token
   */
  clearAuthToken() {
    this.token = null;
  }

  /**
   * Generic request method
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers = new Headers({
      "Content-Type": "application/json",
      ...options.headers,
    });

    // Add auth token
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    // Add Cookie (for server to forward session)
    if (this.cookie) {
      headers.set("Cookie", this.cookie);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      console.error("[CloudApiClient] Network error:", error);
      throw new Error(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[CloudApiClient] API error:", response.status, errorText);
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET request
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  /**
   * POST request
   */
  async post<T>(path: string, data: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * PUT request
   */
  async put<T>(path: string, data: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  // ========================================
  // Authentication-related APIs
  // ========================================

  /**
   * User login
   */
  async login(
    email: string,
    password: string,
  ): Promise<{
    user: { id: string; email: string; name: string | null };
    token: string;
  }> {
    return this.post("/api/remote-auth/login", { email, password });
  }

  /**
   * User registration
   */
  async register(
    email: string,
    password: string,
  ): Promise<{
    user: { id: string; email: string; name: string | null };
    token: string;
  }> {
    return this.post("/api/remote-auth/register", { email, password });
  }

  /**
   * OAuth login (Google, Slack, Discord)
   */
  async oauthLogin(
    provider: "google" | "slack" | "discord",
    code: string,
    state: string,
  ): Promise<{
    user: { id: string; email: string; name: string | null };
    token: string;
  }> {
    return this.post(`/api/remote-auth/oauth/${provider}`, { code, state });
  }

  /**
   * Get Google OAuth URL (for Tauri mode)
   */
  async getGoogleOAuthUrl(redirectUri: string, state: string): Promise<string> {
    const response = await this.request<{
      url: string;
      state: string;
    }>(
      `/api/remote-auth/oauth/google?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      { method: "GET" },
    );
    return response.url;
  }

  /**
   * Exchange Google OAuth code
   */
  async exchangeGoogleOAuthCode(code: string): Promise<{
    token: string;
    user: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    };
  }> {
    return this.post("/api/remote-auth/oauth/google/exchange", { code });
  }

  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<{
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    subscription: string | null;
  }> {
    return this.get("/api/remote-auth/user");
  }

  /**
   * Update user info
   */
  async updateUser(
    data: Partial<{ name: string; avatarUrl: string }>,
  ): Promise<{ id: string; email: string; name: string | null }> {
    return this.put("/api/remote-auth/user", data);
  }

  /**
   * Update user password
   */
  async updatePassword(data: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean }> {
    return this.post("/api/remote-auth/password", data);
  }

  // ========================================
  // Subscription-related APIs
  // ========================================

  /**
   * Get user subscription info
   */
  async getSubscription(): Promise<{
    planName: string;
    status: string;
    endDate: string | null;
  } | null> {
    return this.get("/api/remote-auth/subscription");
  }

  /**
   * Create subscription payment session (Stripe checkout)
   */
  async createSubscriptionCheckout(data: {
    planId: string;
    billingCycle?: "monthly" | "yearly";
    affiliateCode?: string;
    couponCode?: string;
  }): Promise<{ id: string; url: string }> {
    return this.post("/api/stripe/checkout", data);
  }

  /**
   * Create credits top-up payment session (Stripe checkout)
   */
  async createCreditsCheckout(data: {
    amount: number;
    isCustom?: boolean;
  }): Promise<{ id: string; url: string }> {
    return this.post("/api/stripe/credits-checkout", data);
  }

  /**
   * Get subscription details
   */
  async getStripeSubscription(): Promise<{
    subscription: {
      isActive: boolean;
      cancelAtPeriodEnd: boolean;
      planId: string | null;
    } | null;
  }> {
    return this.get("/api/stripe/subscription");
  }

  /**
   * Upgrade subscription
   */
  async upgradeSubscription(data: {
    planId: string;
  }): Promise<{ url: string }> {
    return this.post("/api/stripe/subscription/upgrade", data);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(data: { immediately: boolean }): Promise<{
    subscription: {
      isActive: boolean;
      cancelAtPeriodEnd: boolean;
      planId: string | null;
    };
  }> {
    return this.post("/api/stripe/subscription/cancel", data);
  }

  /**
   * Resume subscription
   */
  async resumeSubscription(): Promise<{
    subscription: {
      isActive: boolean;
      cancelAtPeriodEnd: boolean;
      planId: string | null;
    };
  }> {
    return this.post("/api/stripe/subscription/resume", {});
  }

  // ========================================
  // LLM API (unified credit billing)
  // ========================================

  /**
   * Call cloud LLM (with credit billing)
   * - Automatically uses cloud's unified credit system
   * - Supports streaming and non-streaming responses
   * - Auto refund on failure
   *
   * @param request - Chat request parameters
   * @returns Streaming response (ReadableStream) or JSON response
   */
  async chatWithAI(request: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    system?: string;
    stream?: boolean;
  }): Promise<Response> {
    const url = `${this.baseUrl}/api/ai/chat`;

    const headers = new Headers({
      "Content-Type": "application/json",
    });

    // Add auth token
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloud AI API request failed: ${response.status} - ${errorText}`,
      );
    }

    return response;
  }

  /**
   * Check cloud AI service status
   */
  async checkCloudAIStatus(): Promise<{
    status: string;
    message: string;
    tauriMode: boolean;
  }> {
    return this.get("/api/ai/chat");
  }

  // ========================================
  // Feedback-related APIs
  // ========================================

  /**
   * Submit user feedback
   * Supports anonymous feedback and logged-in user feedback
   */
  async submitFeedback(data: {
    content: string;
    email?: string;
    systemInfo?: {
      platform?: string;
      appVersion?: string;
      osVersion?: string;
    };
  }): Promise<{
    success: boolean;
    message: string;
    feedbackId: string;
  }> {
    return this.post("/api/remote-feedback", data);
  }

  // ========================================
  // Credit-related APIs
  // ========================================

  /**
   * Get user credit usage
   */
  async getQuotaUsage(): Promise<{
    totalQuota: number;
    usedQuota: number;
    remainingQuota: number;
  }> {
    return this.get("/api/quota/usage");
  }
}

/**
 * Global cloud API client instance
 */
let cloudApiClient: CloudApiClient | null = null;

/**
 * Get cloud API client instance
 * Returns instance only in Tauri mode, Web mode returns null
 *
 * Automatically reads and sets token from localStorage
 */
export function getCloudApiClient(): CloudApiClient | null {
  const baseUrl = getCloudApiBaseUrl();

  if (!baseUrl) {
    return null; // Web mode does not need remote client
  }

  if (!cloudApiClient) {
    cloudApiClient = new CloudApiClient(baseUrl);

    // Automatically read token from cookie (cookie-first, localStorage fallback)
    if (typeof window !== "undefined") {
      const token = getAuthToken();
      if (token) {
        cloudApiClient.setAuthToken(token);
      }
    }
  }

  return cloudApiClient;
}

/**
 * Check if should use cloud authentication
 */
export function shouldUseCloudAuth(): boolean {
  return isTauriClient() && getCloudApiBaseUrl() !== null;
}

/**
 * Create temporary CloudApiClient for server routes
 * Extract auth info from request
 *
 * Auth priority:
 * 1. Bearer token (cloud account auth, e.g. Tauri desktop)
 * 2. Session cookie (local Web)
 */
export function createCloudClientForRequest(
  request: Request,
): CloudApiClient | null {
  // Server directly uses cloud URL, no need to check isTauriClient
  const baseUrl = getCloudApiBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const client = new CloudApiClient(baseUrl);

  // Prefer Bearer token (cloud account auth)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    client.setAuthToken(token);
    return client;
  }

  // If no Bearer token, try to forward session cookie (local Web)
  // Note: This requires cloud API to support cookie auth
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    client.setCookie(cookieHeader);
    return client;
  }

  return client;
}

// Export functions from token-manager, keep backward compatible
export {
  getAuthToken as getStoredAuthToken,
  storeAuthToken,
  clearAuthToken,
} from "@/lib/auth/token-manager";
