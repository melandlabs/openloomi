import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-analytics",
    type: "regular" as const,
  } as AuthUser | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
  __setUser: (user: AuthUser | null) => {
    authState.user = user;
  },
}));

const analyticsState = vi.hoisted(() => ({
  result: {
    generatedAt: "2026-05-09T00:00:00.000Z",
    summary: {
      totalInsights: 0,
      activeInsights: 0,
      dormantInsights: 0,
      totalAccesses30d: 0,
      averageValueScore: 0,
      risingInsights: 0,
      fallingInsights: 0,
      stableInsights: 0,
    },
    topInsights: [],
    bottomInsights: [],
    insights: [],
  },
}));

vi.mock("@/lib/insights/analytics", () => ({
  getInsightUsageAnalytics: vi.fn(async () => analyticsState.result),
  __setAnalyticsResult: (result: unknown) => {
    analyticsState.result = result as typeof analyticsState.result;
  },
}));

const authModulePromise = import("@/app/(auth)/auth");
const analyticsModulePromise = import("@/lib/insights/analytics");

async function invokeAnalytics(
  path = "http://localhost/api/insights/analytics",
) {
  const request = new Request(path, { method: "GET" }) as any;
  request.nextUrl = new URL(path);
  const { GET } = await import("@/app/(chat)/api/insights/analytics/route");
  return GET(request);
}

describe("Insight analytics API", () => {
  let authModule: any;
  let analyticsModule: any;

  beforeEach(async () => {
    authModule = await authModulePromise;
    analyticsModule = await analyticsModulePromise;

    authModule.__setUser({ id: "user-analytics", type: "regular" });
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockClear();
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockImplementation(
      async () => analyticsState.result,
    );
  });

  test("rejects anonymous requests", async () => {
    authModule.__setUser(null);

    const response = await invokeAnalytics();

    expect(response.status).toBe(401);
    expect(analyticsModule.getInsightUsageAnalytics).not.toHaveBeenCalled();
  });

  test("loads analytics with default options", async () => {
    const response = await invokeAnalytics();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analyticsState.result);
    expect(analyticsModule.getInsightUsageAnalytics).toHaveBeenCalledWith({
      userId: "user-analytics",
      limit: 10,
      includeArchived: false,
    });
  });

  test("parses limit and includeArchived query params", async () => {
    const response = await invokeAnalytics(
      "http://localhost/api/insights/analytics?limit=250&includeArchived=true",
    );

    expect(response.status).toBe(200);
    expect(analyticsModule.getInsightUsageAnalytics).toHaveBeenCalledWith({
      userId: "user-analytics",
      limit: 100,
      includeArchived: true,
    });
  });

  test("falls back to default limit for invalid values", async () => {
    const response = await invokeAnalytics(
      "http://localhost/api/insights/analytics?limit=-10&includeArchived=0",
    );

    expect(response.status).toBe(200);
    expect(analyticsModule.getInsightUsageAnalytics).toHaveBeenCalledWith({
      userId: "user-analytics",
      limit: 10,
      includeArchived: false,
    });
  });

  test("returns database error when analytics loading fails", async () => {
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockRejectedValueOnce(
      new Error("boom"),
    );

    const response = await invokeAnalytics();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toHaveProperty("message");
  });
});
