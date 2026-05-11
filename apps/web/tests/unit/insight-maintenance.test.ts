import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

const { deleteExpiredPendingDeletionInsightsMock, runInsightCompactionMock } =
  vi.hoisted(() => ({
    deleteExpiredPendingDeletionInsightsMock: vi.fn(),
    runInsightCompactionMock: vi.fn(),
  }));

const { refreshInsightAccessSummaryMock } = vi.hoisted(() => ({
  refreshInsightAccessSummaryMock: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/lib/insights/compaction", () => ({
  deleteExpiredPendingDeletionInsights:
    deleteExpiredPendingDeletionInsightsMock,
  runInsightCompaction: runInsightCompactionMock,
}));

vi.mock("@/lib/insights/weight-adjustment", () => ({
  refreshInsightAccessSummary: refreshInsightAccessSummaryMock,
}));

import {
  runDailyInsightAnalyticsMaintenance,
  runWeeklyInsightMaintenance,
} from "@/lib/insights/maintenance";

function makeBotSelectBuilder(response: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      groupBy: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(response),
        where: vi.fn().mockResolvedValue(response),
      }),
    }),
  };
}

function makeWeightSelectBuilder(response: unknown) {
  const resolved = Promise.resolve(response);
  const builder = {
    innerJoin: vi.fn(),
    where: vi.fn().mockReturnValue(resolved),
  };
  // biome-ignore lint/suspicious/noThenProperty: thenable mock for query builder
  (builder as any).then = resolved.then.bind(resolved);

  builder.innerJoin.mockReturnValue(builder);

  return {
    from: vi.fn().mockReturnValue(builder),
  };
}

describe("weekly insight maintenance", () => {
  beforeEach(() => {
    selectMock.mockReset();
    runInsightCompactionMock.mockReset();
    deleteExpiredPendingDeletionInsightsMock.mockReset();
    refreshInsightAccessSummaryMock.mockReset();
  });

  it("runs compaction and cleanup per user for the selected platform", async () => {
    selectMock.mockImplementationOnce(() =>
      makeBotSelectBuilder([{ userId: "user-1" }, { userId: "user-2" }]),
    );

    runInsightCompactionMock
      .mockResolvedValueOnce({
        candidateCount: 3,
        groupCount: 1,
        condensedInsightIds: ["condensed-1"],
        pendingDeletionInsightIds: ["old-1", "old-2"],
        dryRun: false,
      })
      .mockResolvedValueOnce({
        candidateCount: 0,
        groupCount: 0,
        condensedInsightIds: [],
        pendingDeletionInsightIds: [],
        dryRun: false,
      });

    deleteExpiredPendingDeletionInsightsMock
      .mockResolvedValueOnce(["expired-1"])
      .mockResolvedValueOnce([]);

    const result = await runWeeklyInsightMaintenance({
      platform: "web",
    });

    expect(runInsightCompactionMock).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      botId: undefined,
      olderThanDays: undefined,
      triggerType: "scheduled",
      platform: "web",
    });
    expect(runInsightCompactionMock).toHaveBeenNthCalledWith(2, {
      userId: "user-2",
      botId: undefined,
      olderThanDays: undefined,
      triggerType: "scheduled",
      platform: "web",
    });

    expect(deleteExpiredPendingDeletionInsightsMock).toHaveBeenNthCalledWith(
      1,
      {
        userId: "user-1",
        botId: undefined,
        platform: "web",
      },
    );
    expect(deleteExpiredPendingDeletionInsightsMock).toHaveBeenNthCalledWith(
      2,
      {
        userId: "user-2",
        botId: undefined,
        platform: "web",
      },
    );

    expect(result).toEqual({
      platform: "web",
      processedUserCount: 2,
      users: [
        {
          userId: "user-1",
          compaction: {
            candidateCount: 3,
            groupCount: 1,
            condensedInsightIds: ["condensed-1"],
            pendingDeletionInsightIds: ["old-1", "old-2"],
            dryRun: false,
          },
          deletedInsightIds: ["expired-1"],
        },
        {
          userId: "user-2",
          compaction: {
            candidateCount: 0,
            groupCount: 0,
            condensedInsightIds: [],
            pendingDeletionInsightIds: [],
            dryRun: false,
          },
          deletedInsightIds: [],
        },
      ],
    });
  });

  it("refreshes rolling access counts for every tracked insight weight", async () => {
    const now = new Date("2026-05-09T00:00:00.000Z");
    selectMock.mockImplementationOnce(() =>
      makeWeightSelectBuilder([
        { insightId: "insight-1", userId: "user-1" },
        { insightId: "insight-2", userId: "user-1" },
        { insightId: "insight-3", userId: "user-2" },
      ]),
    );

    const result = await runDailyInsightAnalyticsMaintenance({ now });

    expect(refreshInsightAccessSummaryMock).toHaveBeenNthCalledWith(
      1,
      "insight-1",
      "user-1",
      now,
      expect.any(Object),
    );
    expect(refreshInsightAccessSummaryMock).toHaveBeenNthCalledWith(
      2,
      "insight-2",
      "user-1",
      now,
      expect.any(Object),
    );
    expect(refreshInsightAccessSummaryMock).toHaveBeenNthCalledWith(
      3,
      "insight-3",
      "user-2",
      now,
      expect.any(Object),
    );

    expect(result).toEqual({
      processedWeightCount: 3,
      processedUserCount: 2,
      users: ["user-1", "user-2"],
    });
  });
});
