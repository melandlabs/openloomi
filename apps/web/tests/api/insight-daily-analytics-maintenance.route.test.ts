import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authState = vi.hoisted(() => ({
  authorized: true,
}));

vi.mock("@/lib/auth/remote-auth-utils", () => ({
  verifyCronAuth: vi.fn(() => authState.authorized),
}));

const maintenanceState = vi.hoisted(() => ({
  result: {
    processedWeightCount: 2,
    processedUserCount: 1,
    users: ["user-1"],
  },
}));

vi.mock("@/lib/insights/maintenance", () => ({
  runDailyInsightAnalyticsMaintenance: vi.fn(
    async () => maintenanceState.result,
  ),
}));

const authUtilsPromise = import("@/lib/auth/remote-auth-utils");
const maintenanceModulePromise = import("@/lib/insights/maintenance");

async function invokeDailyMaintenance(method: "GET" | "POST" = "GET") {
  const request = new Request(
    "http://localhost/api/insights/maintenance/daily-analytics",
    {
      method,
      headers: { authorization: "Bearer secret" },
    },
  );
  const route =
    await import("@/app/api/insights/maintenance/daily-analytics/route");

  return method === "POST" ? route.POST(request) : route.GET(request);
}

describe("daily insight analytics maintenance API", () => {
  let authUtils: any;
  let maintenanceModule: any;

  beforeEach(async () => {
    authUtils = await authUtilsPromise;
    maintenanceModule = await maintenanceModulePromise;

    vi.stubEnv("CRON_SECRET", "secret");
    authState.authorized = true;
    vi.mocked(authUtils.verifyCronAuth).mockClear();
    vi.mocked(
      maintenanceModule.runDailyInsightAnalyticsMaintenance,
    ).mockClear();
    vi.mocked(
      maintenanceModule.runDailyInsightAnalyticsMaintenance,
    ).mockImplementation(async () => maintenanceState.result);
  });

  test("returns 500 when CRON_SECRET is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await invokeDailyMaintenance();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "CRON_SECRET is not configured",
    });
    expect(
      maintenanceModule.runDailyInsightAnalyticsMaintenance,
    ).not.toHaveBeenCalled();
  });

  test("rejects unauthorized cron requests", async () => {
    authState.authorized = false;

    const response = await invokeDailyMaintenance();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(
      maintenanceModule.runDailyInsightAnalyticsMaintenance,
    ).not.toHaveBeenCalled();
  });

  test("runs daily analytics maintenance for GET and POST", async () => {
    const getResponse = await invokeDailyMaintenance("GET");
    const postResponse = await invokeDailyMaintenance("POST");

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      ok: true,
      ...maintenanceState.result,
    });
    expect(postResponse.status).toBe(200);
    expect(await postResponse.json()).toEqual({
      ok: true,
      ...maintenanceState.result,
    });
    expect(
      maintenanceModule.runDailyInsightAnalyticsMaintenance,
    ).toHaveBeenCalledTimes(2);
  });
});
