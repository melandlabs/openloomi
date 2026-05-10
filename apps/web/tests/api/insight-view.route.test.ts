import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-view",
    type: "regular" as const,
  } as AuthUser | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
  __setUser: (user: AuthUser | null) => {
    authState.user = user;
  },
}));

const dbState = vi.hoisted(() => ({
  ownedRows: [{ id: "insight-1" }],
  query: {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock("@/lib/db/queries", () => ({
  db: {
    select: vi.fn(() => dbState.query),
  },
  __setOwnedRows: (rows: Array<{ id: string }>) => {
    dbState.ownedRows = rows;
  },
  __resetDbMock: () => {
    dbState.ownedRows = [{ id: "insight-1" }];
    dbState.query.from.mockClear();
    dbState.query.innerJoin.mockClear();
    dbState.query.where.mockClear();
    dbState.query.limit.mockClear();
    dbState.query.from.mockReturnValue(dbState.query);
    dbState.query.innerJoin.mockReturnValue(dbState.query);
    dbState.query.where.mockReturnValue(dbState.query);
    dbState.query.limit.mockImplementation(async () => dbState.ownedRows);
  },
}));

vi.mock("@/lib/db/schema", () => ({
  bot: {
    id: "bot.id",
    userId: "bot.userId",
  },
  insight: {
    id: "insight.id",
    botId: "insight.botId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

vi.mock("@/lib/insights/weight-adjustment", () => ({
  recordInsightView: vi.fn(async () => undefined),
}));

const authModulePromise = import("@/app/(auth)/auth");
const queriesModulePromise = import("@/lib/db/queries");
const weightModulePromise = import("@/lib/insights/weight-adjustment");

async function invokeRecordView(body?: unknown) {
  const request = new Request("http://localhost/api/insights/insight-1/view", {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as any;
  const { POST } = await import("@/app/(chat)/api/insights/[id]/view/route");
  return POST(request, { params: Promise.resolve({ id: "insight-1" }) });
}

describe("Insight view tracking API", () => {
  let authModule: any;
  let queriesModule: any;
  let weightModule: any;

  beforeEach(async () => {
    authModule = await authModulePromise;
    queriesModule = await queriesModulePromise;
    weightModule = await weightModulePromise;

    authModule.__setUser({ id: "user-view", type: "regular" });
    queriesModule.__resetDbMock();
    vi.mocked(weightModule.recordInsightView).mockClear();
  });

  test("rejects anonymous requests", async () => {
    authModule.__setUser(null);

    const response = await invokeRecordView();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(weightModule.recordInsightView).not.toHaveBeenCalled();
  });

  test("returns 404 when the insight does not belong to the user", async () => {
    queriesModule.__setOwnedRows([]);

    const response = await invokeRecordView();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Insight not found" });
    expect(weightModule.recordInsightView).not.toHaveBeenCalled();
  });

  test("records a detail view with sanitized context", async () => {
    const response = await invokeRecordView({
      viewSource: "detail",
      viewContext: {
        surface: "drawer",
        initialTab: "sources",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(weightModule.recordInsightView).toHaveBeenCalledWith(
      "insight-1",
      "user-view",
      "detail",
      {
        surface: "drawer",
        initialTab: "sources",
      },
      expect.any(Object),
    );
  });

  test("falls back to detail source for invalid payloads", async () => {
    const response = await invokeRecordView({
      viewSource: "unknown",
      viewContext: ["not", "an", "object"],
    });

    expect(response.status).toBe(200);
    expect(weightModule.recordInsightView).toHaveBeenCalledWith(
      "insight-1",
      "user-view",
      "detail",
      null,
      expect.any(Object),
    );
  });
});
