export const DEV_PORT = "3515";
export const PROD_PORT = "3414";

export const maxChunkSummaryCount = 10;
export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
  process.env.PLAYWRIGHT ||
  process.env.CI_PLAYWRIGHT,
);

export const guestRegex = /^guest-\d+$/;

// Bump this value to force all users to re-authenticate and receive a fresh session token.
export const authSessionVersion = "2025-01-17";

export const nextAuthSessionCookies = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "__Host-next-auth.session-token",
] as const;
