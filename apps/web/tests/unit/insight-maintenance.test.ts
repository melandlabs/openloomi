import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

const { runInsightCompactionMock } = vi.hoisted(() => ({
  runInsightCompactionMock: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/lib/insights/compaction", () => ({
  runInsightCompaction: runInsightCompactionMock,
}));

import { runWeeklyInsightMaintenance } from "@/lib/insights/maintenance";

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

describe("weekly insight maintenance", () => {
  beforeEach(() => {
    selectMock.mockReset();
    runInsightCompactionMock.mockReset();
  });

  it("runs compaction per user for the selected platform", async () => {
    selectMock.mockImplementationOnce(() =>
      makeBotSelectBuilder([{ userId: "user-1" }, { userId: "user-2" }]),
    );

    runInsightCompactionMock
      .mockResolvedValueOnce({
        candidateCount: 3,
        groupCount: 1,
        condensedInsightIds: ["condensed-1"],
        archivedInsightIds: ["old-1", "old-2"],
        dryRun: false,
      })
      .mockResolvedValueOnce({
        candidateCount: 0,
        groupCount: 0,
        condensedInsightIds: [],
        archivedInsightIds: [],
        dryRun: false,
      });

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
            archivedInsightIds: ["old-1", "old-2"],
            dryRun: false,
          },
        },
        {
          userId: "user-2",
          compaction: {
            candidateCount: 0,
            groupCount: 0,
            condensedInsightIds: [],
            archivedInsightIds: [],
            dryRun: false,
          },
        },
      ],
    });
  });
});
