import { describe, expect, test } from "vitest";
import {
  buildInsightUsageAnalytics,
  calculateInsightTrend,
  calculateInsightValueScore,
  recommendInsightOrganization,
} from "@/lib/insights/analytics";

const NOW = new Date("2026-05-09T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeRow(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? "insight-1",
    title: overrides.title ?? "Insight",
    description: overrides.description ?? "Description",
    taskLabel: overrides.taskLabel ?? "general",
    platform: overrides.platform ?? "slack",
    account: overrides.account ?? null,
    importance: overrides.importance ?? "medium",
    urgency: overrides.urgency ?? "medium",
    isFavorited: overrides.isFavorited ?? false,
    isArchived: overrides.isArchived ?? false,
    createdAt: overrides.createdAt ?? daysAgo(10),
    updatedAt: overrides.updatedAt ?? daysAgo(2),
    time: overrides.time ?? daysAgo(10),
    accessCountTotal: overrides.accessCountTotal ?? 0,
    accessCount7d: overrides.accessCount7d ?? 0,
    accessCount30d: overrides.accessCount30d ?? 0,
    lastAccessedAt: overrides.lastAccessedAt ?? null,
  };
}

describe("insight analytics calculations", () => {
  test("calculates trend from recent and previous 7-day windows", () => {
    expect(calculateInsightTrend(5, 1)).toBe("rising");
    expect(calculateInsightTrend(1, 5)).toBe("falling");
    expect(calculateInsightTrend(4, 4)).toBe("stable");
    expect(calculateInsightTrend(0, 0)).toBe("stable");
  });

  test("scores frequently accessed, fresh, important insights higher", () => {
    const highScore = calculateInsightValueScore({
      accessCount30d: 10,
      maxAccessCount30d: 10,
      lastAccessedAt: daysAgo(1),
      createdAt: daysAgo(90),
      importance: "high",
      urgency: "urgent",
      isFavorited: true,
      now: NOW,
    });
    const lowScore = calculateInsightValueScore({
      accessCount30d: 0,
      maxAccessCount30d: 10,
      lastAccessedAt: daysAgo(120),
      createdAt: daysAgo(180),
      importance: "low",
      urgency: "low",
      isFavorited: false,
      now: NOW,
    });

    expect(highScore).toBeGreaterThan(90);
    expect(lowScore).toBeLessThan(25);
  });

  test("recommends archive/delete for dormant low-value insights", () => {
    expect(
      recommendInsightOrganization({
        accessCount30d: 0,
        lastAccessedAt: daysAgo(120),
        createdAt: daysAgo(150),
        importance: "low",
        isFavorited: false,
        trend: "stable",
        valueScore: 20,
        now: NOW,
      }).action,
    ).toBe("delete");

    expect(
      recommendInsightOrganization({
        accessCount30d: 0,
        lastAccessedAt: daysAgo(45),
        createdAt: daysAgo(70),
        importance: "medium",
        isFavorited: false,
        trend: "stable",
        valueScore: 40,
        now: NOW,
      }).action,
    ).toBe("archive");

    expect(
      recommendInsightOrganization({
        accessCount30d: 0,
        lastAccessedAt: daysAgo(200),
        createdAt: daysAgo(250),
        importance: "low",
        isFavorited: true,
        trend: "falling",
        valueScore: 10,
        now: NOW,
      }).action,
    ).toBe("keep");
  });

  test("builds top, bottom, trend, and summary analytics", () => {
    const analytics = buildInsightUsageAnalytics({
      now: NOW,
      limit: 2,
      rows: [
        makeRow({
          id: "top",
          title: "Top insight",
          importance: "high",
          urgency: "urgent",
          accessCountTotal: 20,
          accessCount7d: 5,
          accessCount30d: 12,
          lastAccessedAt: daysAgo(1),
        }),
        makeRow({
          id: "dormant",
          title: "Dormant insight",
          importance: "low",
          urgency: "low",
          createdAt: daysAgo(160),
          accessCountTotal: 1,
          accessCount7d: 0,
          accessCount30d: 0,
          lastAccessedAt: daysAgo(120),
        }),
        makeRow({
          id: "falling",
          title: "Falling insight",
          accessCountTotal: 10,
          accessCount7d: 1,
          accessCount30d: 4,
          lastAccessedAt: daysAgo(4),
        }),
      ],
      views: [
        { insightId: "top", viewedAt: daysAgo(1) },
        { insightId: "top", viewedAt: daysAgo(2) },
        { insightId: "top", viewedAt: daysAgo(8) },
        { insightId: "falling", viewedAt: daysAgo(1) },
        { insightId: "falling", viewedAt: daysAgo(8) },
        { insightId: "falling", viewedAt: daysAgo(9) },
        { insightId: "falling", viewedAt: daysAgo(10) },
      ],
      conversationLinks: [
        { chatId: "chat-1", insightId: "top" },
        { chatId: "chat-1", insightId: "falling" },
        { chatId: "chat-2", insightId: "top" },
        { chatId: "chat-2", insightId: "falling" },
        { chatId: "chat-3", insightId: "top" },
        { chatId: "chat-3", insightId: "dormant" },
      ],
    });

    expect(analytics.summary).toMatchObject({
      totalInsights: 3,
      activeInsights: 2,
      dormantInsights: 1,
      totalAccesses30d: 16,
      risingInsights: 1,
      fallingInsights: 1,
      stableInsights: 1,
    });
    expect(analytics.topInsights.map((item) => item.id)).toEqual([
      "top",
      "falling",
    ]);
    expect(analytics.bottomInsights[0].id).toBe("dormant");
    expect(
      analytics.insights.find((item) => item.id === "dormant")?.recommendation
        .action,
    ).toBe("delete");
    expect(analytics.insights.find((item) => item.id === "top")?.trend).toBe(
      "rising",
    );
    expect(
      analytics.insights.find((item) => item.id === "falling")?.trend,
    ).toBe("falling");
    expect(analytics.relationships[0]).toMatchObject({
      insightId: "falling",
      relatedInsightId: "top",
      sharedConversationCount: 2,
    });
  });
});
