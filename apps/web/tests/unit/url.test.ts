import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockIsTauriMode = vi.fn(() => false);
vi.mock("@/lib/env", () => ({
  isTauriMode: () => mockIsTauriMode(),
  getApplicationBaseUrl: vi.fn(() => {
    const envUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.APPLICATION_URL ||
      process.env.NEXTAUTH_URL;
    if (envUrl) {
      return envUrl.replace(/\/$/, "");
    }
    return process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
      : "http://localhost:3414";
  }),
  getAppUrl: vi.fn(() => {
    const envUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.APPLICATION_URL ||
      process.env.NEXTAUTH_URL;
    if (envUrl) {
      return envUrl.replace(/\/$/, "");
    }
    return process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
      : "http://localhost:3414";
  }),
}));

import { getApplicationBaseUrl } from "@/lib/env";

const originalEnv = { ...process.env };

describe("getApplicationBaseUrl", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    mockIsTauriMode.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers public app url and trims trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com/";
    expect(getApplicationBaseUrl()).toBe("https://example.com");
  });

  it("falls back to vercel url when provided", () => {
    process.env.NEXT_PUBLIC_APP_URL = undefined;
    process.env.VERCEL_URL = "my-app.vercel.app/";
    expect(getApplicationBaseUrl()).toBe("https://my-app.vercel.app");
  });
});
