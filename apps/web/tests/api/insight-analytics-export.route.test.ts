import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-export",
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
      totalInsights: 1,
      activeInsights: 1,
      dormantInsights: 0,
      totalAccesses30d: 3,
      averageValueScore: 81,
      risingInsights: 1,
      fallingInsights: 0,
      stableInsights: 0,
    },
    topInsights: [],
    bottomInsights: [],
    insights: [
      {
        id: "insight-1",
        title: 'Launch, "Alpha"',
        description: "Important\nmulti-line note",
        platform: "slack",
        account: "team",
        taskLabel: "launch",
        importance: "high",
        urgency: "urgent",
        accessCountTotal: 5,
        accessCount7d: 2,
        accessCount30d: 3,
        lastAccessedAt: new Date("2026-05-08T10:00:00.000Z"),
        trend: "rising",
        recent7dAccessCount: 2,
        previous7dAccessCount: 0,
        valueScore: 81,
        recommendation: {
          action: "keep",
          reason:
            "Usage, freshness, or relevance still supports keeping it active.",
        },
        isFavorited: true,
        isArchived: false,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T12:00:00.000Z"),
        time: new Date("2026-04-01T00:00:00.000Z"),
      },
    ],
  },
}));

vi.mock("@/lib/insights/analytics", () => ({
  getInsightUsageAnalytics: vi.fn(async () => analyticsState.result),
}));

const authModulePromise = import("@/app/(auth)/auth");
const analyticsModulePromise = import("@/lib/insights/analytics");

async function invokeExport(
  path = "http://localhost/api/insights/analytics/export",
) {
  const request = new Request(path, { method: "GET" }) as any;
  request.nextUrl = new URL(path);
  const { GET } =
    await import("@/app/(chat)/api/insights/analytics/export/route");
  return GET(request);
}

describe("Insight analytics CSV export API", () => {
  let authModule: any;
  let analyticsModule: any;

  beforeEach(async () => {
    authModule = await authModulePromise;
    analyticsModule = await analyticsModulePromise;

    authModule.__setUser({ id: "user-export", type: "regular" });
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockClear();
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockImplementation(
      async () => analyticsState.result,
    );
  });

  test("rejects anonymous requests", async () => {
    authModule.__setUser(null);

    const response = await invokeExport();

    expect(response.status).toBe(401);
    expect(analyticsModule.getInsightUsageAnalytics).not.toHaveBeenCalled();
  });

  test("exports analytics as CSV", async () => {
    const response = await invokeExport(
      "http://localhost/api/insights/analytics/export?includeArchived=1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=",
    );
    expect(analyticsModule.getInsightUsageAnalytics).toHaveBeenCalledWith({
      userId: "user-export",
      includeArchived: true,
    });

    const csv = await response.text();
    expect(csv).toContain(
      "id,title,description,platform,account,task_label,importance,urgency",
    );
    expect(csv).toContain('"Launch, ""Alpha"""');
    expect(csv).toContain('"Important\nmulti-line note"');
    expect(csv).toContain("2026-05-08T10:00:00.000Z");
    expect(csv).toContain(",rising,2,0,81,keep,");
  });

  test("returns database error when analytics export fails", async () => {
    vi.mocked(analyticsModule.getInsightUsageAnalytics).mockRejectedValueOnce(
      new Error("boom"),
    );

    const response = await invokeExport();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toHaveProperty("message");
  });
});
