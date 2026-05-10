import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserInsightSettingsMock,
  updateUserInsightSettingsMock,
  runDailyInsightAnalyticsMaintenanceMock,
  runWeeklyInsightMaintenanceMock,
} = vi.hoisted(() => ({
  getUserInsightSettingsMock: vi.fn(),
  updateUserInsightSettingsMock: vi.fn(),
  runDailyInsightAnalyticsMaintenanceMock: vi.fn(),
  runWeeklyInsightMaintenanceMock: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getUserInsightSettings: getUserInsightSettingsMock,
  updateUserInsightSettings: updateUserInsightSettingsMock,
}));

vi.mock("@/lib/insights/maintenance", () => ({
  runDailyInsightAnalyticsMaintenance: runDailyInsightAnalyticsMaintenanceMock,
  runWeeklyInsightMaintenance: runWeeklyInsightMaintenanceMock,
}));

import {
  runDailyInsightAnalyticsMaintenanceIfDue,
  runInsightMaintenanceIfDue,
  setLastInsightAnalyticsMaintenanceRunAt,
  setLastInsightMaintenanceRunAt,
} from "@/lib/cron/insight-maintenance";

describe("cron insight maintenance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T02:17:00.000Z"));
    setLastInsightAnalyticsMaintenanceRunAt(null);
    setLastInsightMaintenanceRunAt(null);
    getUserInsightSettingsMock.mockReset();
    updateUserInsightSettingsMock.mockReset();
    runDailyInsightAnalyticsMaintenanceMock.mockReset();
    runWeeklyInsightMaintenanceMock.mockReset();
    runDailyInsightAnalyticsMaintenanceMock.mockResolvedValue({
      processedWeightCount: 0,
      processedUserCount: 0,
      users: [],
    });
    runWeeklyInsightMaintenanceMock.mockResolvedValue({
      platform: "desktop",
      processedUserCount: 0,
      users: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs daily analytics once per local scheduler interval window", async () => {
    await runDailyInsightAnalyticsMaintenanceIfDue("user-1");
    await runDailyInsightAnalyticsMaintenanceIfDue("user-1");

    expect(runDailyInsightAnalyticsMaintenanceMock).toHaveBeenCalledTimes(1);
    expect(runDailyInsightAnalyticsMaintenanceMock).toHaveBeenCalledWith({
      userId: "user-1",
      now: new Date("2026-05-09T02:17:00.000Z"),
    });

    vi.setSystemTime(new Date("2026-05-10T02:17:01.000Z"));
    await runDailyInsightAnalyticsMaintenanceIfDue("user-1");

    expect(runDailyInsightAnalyticsMaintenanceMock).toHaveBeenCalledTimes(2);
  });

  it("runs weekly maintenance when persisted checkpoint is due", async () => {
    getUserInsightSettingsMock.mockResolvedValue({
      lastInsightMaintenanceRunAt: new Date("2026-05-01T02:17:00.000Z"),
    });

    await runInsightMaintenanceIfDue("user-1");

    expect(runWeeklyInsightMaintenanceMock).toHaveBeenCalledWith({
      platform: "desktop",
      userId: "user-1",
    });
    expect(updateUserInsightSettingsMock).toHaveBeenCalledWith("user-1", {
      lastInsightMaintenanceRunAt: new Date("2026-05-09T02:17:00.000Z"),
    });
  });

  it("skips maintenance without a scheduler user", async () => {
    await runDailyInsightAnalyticsMaintenanceIfDue(undefined);
    await runInsightMaintenanceIfDue(undefined);

    expect(runDailyInsightAnalyticsMaintenanceMock).not.toHaveBeenCalled();
    expect(runWeeklyInsightMaintenanceMock).not.toHaveBeenCalled();
  });
});
