import { describe, it, expect } from "vitest";
import {
  filterInsights,
  insightMatchesFilterDefinition,
  toInsightFilterResponse,
} from "@/lib/insights/filter-utils";
import type { DBInsightFilter, Insight } from "@/lib/db/schema";
import {
  normalizeImportanceOption,
  normalizeUrgencyOption,
  normalizePlatformOption,
} from "@openloomi/insights";

describe("Filter Utils", () => {
  describe("toInsightFilterResponse", () => {
    it("should convert DBInsightFilter to InsightFilterResponse", () => {
      const dbFilter: DBInsightFilter = {
        id: "filter-1",
        userId: "user-1",
        label: "High Priority",
        slug: "high-priority",
        description: "Show high priority items",
        color: "#FF0000",
        icon: "star",
        sortOrder: 1,
        isPinned: true,
        isArchived: false,
        source: "user",
        definition: {
          match: "all",
          conditions: [
            {
              kind: "importance",
              values: ["high"],
            },
          ],
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      };

      const result = toInsightFilterResponse(dbFilter);

      expect(result).toEqual({
        id: "filter-1",
        userId: "user-1",
        label: "High Priority",
        slug: "high-priority",
        description: "Show high priority items",
        color: "#FF0000",
        icon: "star",
        sortOrder: 1,
        isPinned: true,
        isArchived: false,
        source: "user",
        definition: {
          match: "all",
          conditions: [
            {
              kind: "importance",
              values: ["high"],
            },
          ],
        },
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      });
    });

    it("should handle null values", () => {
      const createdAt = new Date("2024-02-01T00:00:00.000Z");
      const updatedAt = new Date("2024-02-02T12:30:00.000Z");
      const dbFilter: DBInsightFilter = {
        id: "filter-2",
        userId: "user-1",
        label: "Test Filter",
        slug: "test-filter",
        description: null,
        color: null,
        icon: null,
        sortOrder: 0,
        isPinned: false,
        isArchived: false,
        source: "system",
        definition: {
          match: "all",
          conditions: [],
        },
        createdAt,
        updatedAt,
      };

      const result = toInsightFilterResponse(dbFilter);

      expect(result.description).toBeNull();
      expect(result.color).toBeNull();
      expect(result.icon).toBeNull();
      expect(result.createdAt).toBe(createdAt.toISOString());
      expect(result.updatedAt).toBe(updatedAt.toISOString());
    });
  });

  describe("insightMatchesFilter", () => {
    const baseInsight = {
      id: "insight-1",
      title: "Fix login",
      description: "Fix login bug for alpha users",
      importance: "high",
      urgency: "immediate",
      taskLabel: "bug",
      myTasks: [],
      waitingForMe: [],
      waitingForOthers: [],
      nextActions: [],
      details: [],
      sources: [],
      platform: "slack",
      time: new Date("2024-01-02T12:00:00Z"),
      createdAt: new Date("2024-01-02T12:00:00Z"),
    } as unknown as Insight;

    it("matches importance and urgency conditions", () => {
      const definition = {
        match: "all",
        conditions: [
          { kind: "importance", values: ["high"] },
          { kind: "urgency", values: ["immediate", "soon"] },
        ],
      } as any;

      expect(insightMatchesFilterDefinition(baseInsight, definition)).toBe(
        true,
      );
    });

    it("matches keyword conditions across default fields", () => {
      const insight = {
        ...baseInsight,
        description: "Alpha project launch plan",
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "keyword", values: ["alpha"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("matches Chinese keyword from title when topKeywords is empty", () => {
      // Bug repro: email insight with title "Resume email" but empty topKeywords
      // Searching for "resume" should match via title/description
      const insight = {
        ...baseInsight,
        title: "Resume email",
        description: "Resume email",
        topKeywords: [] as string[],
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "keyword", values: ["resume"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("matches Chinese keyword with explicit fields parameter (basic searchMode)", () => {
      // Simulates how chatInsight sets fields in basic/comprehensive mode
      const insight = {
        ...baseInsight,
        title: "Resume email",
        description: "Resume email",
        topKeywords: [] as string[],
      };
      const definition = {
        match: "any",
        conditions: [
          {
            kind: "keyword",
            values: ["resume"],
            match: "any",
            fields: [
              "title",
              "description",
              "groups",
              "people",
              "details",
              "sources",
              "insight_keywords",
            ],
          },
        ],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("matches importance across mixed languages and casing", () => {
      const zhInsight = {
        ...baseInsight,
        importance: "Important",
      };
      const generalInsight = { ...baseInsight, importance: "General" };

      const highDefinition = {
        match: "all",
        conditions: [{ kind: "importance", values: ["High"] }],
      } as any;
      const generalDefinition = {
        match: "all",
        conditions: [{ kind: "importance", values: ["General"] }],
      } as any;

      expect(insightMatchesFilterDefinition(zhInsight, highDefinition)).toBe(
        true,
      );
      expect(
        insightMatchesFilterDefinition(generalInsight, generalDefinition),
      ).toBe(true);
    });

    it("matches platform condition from details", () => {
      const insight = {
        ...baseInsight,
        platform: null,
        details: [{ platform: "discord" }],
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "platform", values: ["discord"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("matches platform condition with friendly labels", () => {
      const insight = {
        ...baseInsight,
        platform: "google_drive",
        details: [],
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "platform", values: ["Google Drive"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("applies time window using provided context", () => {
      const definition = {
        match: "all",
        conditions: [{ kind: "time_window", withinHours: 36 }],
      } as any;

      expect(
        insightMatchesFilterDefinition(baseInsight, definition, {
          now: new Date("2024-01-03T00:00:00Z"),
        }),
      ).toBe(true);
      expect(
        insightMatchesFilterDefinition(baseInsight, definition, {
          now: new Date("2024-01-04T01:00:00Z"),
        }),
      ).toBe(false);
    });

    it("matches mentions_me condition using nickname context", () => {
      const insight = {
        ...baseInsight,
        people: ["Alice"],
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "mentions_me" }],
      } as any;

      expect(
        insightMatchesFilterDefinition(insight, definition, {
          myNicknames: ["alice@example.com", "alice"],
        }),
      ).toBe(true);
    });

    it("matches has_tasks buckets", () => {
      const insight = { ...baseInsight, myTasks: [{ id: "task-1" }] };
      const definition = {
        match: "all",
        conditions: [{ kind: "has_tasks", values: ["myTasks"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("matches people condition using focusPeople when values are empty", () => {
      const insight = {
        ...baseInsight,
        people: ["Alice"],
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "people", values: [], match: "any" }],
      } as any;

      expect(
        insightMatchesFilterDefinition(insight, definition, {
          focusPeople: ["Alice"],
        }),
      ).toBe(true);
      expect(
        insightMatchesFilterDefinition(insight, definition, {
          focusPeople: [],
        }),
      ).toBe(false);
    });

    it("matches urgency when value names differ", () => {
      const insight = {
        ...baseInsight,
        urgency: "Within 24 hours",
      };
      const definition = {
        match: "all",
        conditions: [{ kind: "urgency", values: ["Within 24 hours"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    it("filters insights with definition helpers", () => {
      const insights = [
        baseInsight,
        { ...baseInsight, id: "insight-2", importance: "low" },
      ];
      const definition = {
        match: "all",
        conditions: [{ kind: "importance", values: ["high"] }],
      } as any;

      const filtered = filterInsights(insights, definition);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("insight-1");
    });
  });

  describe("normalizeImportanceOption (direct)", () => {
    // FU-01: normalizes high importance
    it("FU-01: should normalize high importance", () => {
      const result = normalizeImportanceOption("high");
      expect(result?.key).toBe("high");
    });

    // FU-02: normalizes medium importance
    it("FU-02: should normalize medium importance", () => {
      const result = normalizeImportanceOption("medium");
      expect(result?.key).toBe("medium");
    });

    // FU-03: normalizes low importance
    it("FU-03: should normalize low importance", () => {
      const result = normalizeImportanceOption("low");
      expect(result?.key).toBe("low");
    });

    // FU-04: handles null
    it("FU-04: should return null for null input", () => {
      const result = normalizeImportanceOption(null);
      expect(result).toBeNull();
    });
  });

  describe("normalizeUrgencyOption (direct)", () => {
    // FU-05: normalizes immediate urgency
    it("FU-05: should normalize immediate urgency", () => {
      const result = normalizeUrgencyOption("immediate");
      expect(result?.key).toBe("immediate");
    });

    // FU-06: normalizes not_urgent urgency
    it("FU-06: should normalize not_urgent urgency", () => {
      const result = normalizeUrgencyOption("not urgent");
      expect(result?.key).toBe("not_urgent");
    });

    // FU-07: handles null
    it("FU-07: should return null for null input", () => {
      const result = normalizeUrgencyOption(null);
      expect(result).toBeNull();
    });
  });

  describe("normalizePlatformOption (direct)", () => {
    // FU-08: normalizes slack
    it("FU-08: should normalize slack platform", () => {
      const result = normalizePlatformOption("slack");
      expect(result?.key).toBe("slack");
      expect(result?.label).toBe("Slack");
    });

    // FU-09: normalizes discord
    it("FU-09: should normalize discord platform", () => {
      const result = normalizePlatformOption("discord");
      expect(result?.key).toBe("discord");
      expect(result?.label).toBe("Discord");
    });

    // FU-10: handles unknown platforms
    it("FU-10: should handle unknown platforms", () => {
      const result = normalizePlatformOption("custom_app");
      expect(result?.key).toBe("customapp");
    });

    // FU-11: handles null
    it("FU-11: should return null for null input", () => {
      const result = normalizePlatformOption(null);
      expect(result).toBeNull();
    });
  });

  describe("filterInsights with binary expressions", () => {
    const baseInsight = {
      id: "insight-1",
      title: "Test",
      description: "Test description",
      importance: "high",
      urgency: "immediate",
      taskLabel: null,
      myTasks: [],
      waitingForMe: [],
      waitingForOthers: [],
      nextActions: [],
      details: [],
      sources: [],
      groups: [],
      people: [],
      platform: "slack",
      time: new Date("2024-01-02T12:00:00Z"),
      createdAt: new Date("2024-01-02T12:00:00Z"),
    } as unknown as Insight;

    // FU-12: AND expression
    it("FU-12: should filter with AND expression", () => {
      const insights = [
        baseInsight,
        { ...baseInsight, id: "insight-2", importance: "low" },
        { ...baseInsight, id: "insight-3", urgency: "not_urgent" },
      ];

      const filter = {
        op: "and",
        left: {
          match: "all",
          conditions: [{ kind: "importance", values: ["high"] }],
        },
        right: {
          match: "all",
          conditions: [{ kind: "urgency", values: ["immediate"] }],
        },
      } as any;

      const filtered = filterInsights(insights, filter);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("insight-1");
    });

    // FU-13: OR expression
    it("FU-13: should filter with OR expression", () => {
      const insights = [
        baseInsight,
        {
          ...baseInsight,
          id: "insight-2",
          importance: "high",
          urgency: "not_urgent",
        },
        {
          ...baseInsight,
          id: "insight-3",
          importance: "low",
          urgency: "immediate",
        },
      ];

      const filter = {
        op: "or",
        left: {
          match: "all",
          conditions: [{ kind: "importance", values: ["high"] }],
        },
        right: {
          match: "all",
          conditions: [{ kind: "urgency", values: ["immediate"] }],
        },
      } as any;

      // All 3 match: insight-1 (high AND immediate), insight-2 (high), insight-3 (immediate)
      const filtered = filterInsights(insights, filter);
      expect(filtered).toHaveLength(3);
    });

    // FU-14: NOT expression
    it("FU-14: should filter with NOT expression", () => {
      const insights = [
        baseInsight,
        { ...baseInsight, id: "insight-2", importance: "low" },
        { ...baseInsight, id: "insight-3", importance: "medium" },
      ];

      const filter = {
        op: "not",
        operand: {
          match: "all",
          conditions: [{ kind: "importance", values: ["high"] }],
        },
      } as any;

      const filtered = filterInsights(insights, filter);
      expect(filtered).toHaveLength(2);
    });

    // FU-15: nested expressions
    it("FU-15: should filter with nested expressions", () => {
      const insights = [
        baseInsight,
        { ...baseInsight, id: "insight-2", importance: "low" },
        {
          ...baseInsight,
          id: "insight-3",
          importance: "high",
          urgency: "not_urgent",
        },
      ];

      const filter = {
        op: "and",
        left: {
          match: "all",
          conditions: [{ kind: "importance", values: ["high"] }],
        },
        right: {
          op: "or",
          left: {
            match: "all",
            conditions: [{ kind: "urgency", values: ["immediate"] }],
          },
          right: {
            match: "all",
            conditions: [{ kind: "urgency", values: ["not_urgent"] }],
          },
        },
      } as any;

      const filtered = filterInsights(insights, filter);
      expect(filtered).toHaveLength(2);
    });
  });

  describe("insightMatchesFilterDefinition - category condition", () => {
    // FU-16: category matching
    it("FU-16: should match category condition", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        categories: ["News", "R&D"],
        importance: "medium",
        urgency: "not_urgent",
        taskLabel: null,
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        groups: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "category", values: ["News"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    // FU-17: category not matching
    it("FU-17: should not match category when missing", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        categories: ["R&D"],
        importance: "medium",
        urgency: "not_urgent",
        taskLabel: null,
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        groups: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "category", values: ["News"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(false);
    });
  });

  describe("insightMatchesFilterDefinition - account condition", () => {
    // FU-18: account matching
    it("FU-18: should match account when filter value is substring", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        account: "acme",
        importance: "medium",
        urgency: "not_urgent",
        taskLabel: null,
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        groups: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "account", values: ["acme"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });
  });

  describe("insightMatchesFilterDefinition - groups condition", () => {
    // FU-19: groups matching
    it("FU-19: should match groups condition", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        groups: ["engineering", "backend"],
        importance: "medium",
        urgency: "not_urgent",
        taskLabel: null,
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "groups", values: ["engineering"], match: "any" }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    // FU-20: groups match all
    it("FU-20: should require all groups when match all", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        groups: ["engineering", "backend"],
        importance: "medium",
        urgency: "not_urgent",
        taskLabel: null,
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [
          { kind: "groups", values: ["engineering", "frontend"], match: "all" },
        ],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(false);
    });
  });

  describe("insightMatchesFilterDefinition - task_label condition", () => {
    // FU-21: task_label matching
    it("FU-21: should match task_label condition", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        taskLabel: "bug",
        importance: "medium",
        urgency: "not_urgent",
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        groups: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "task_label", values: ["bug"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(true);
    });

    // FU-22: task_label not matching
    it("FU-22: should not match task_label when missing", () => {
      const insight = {
        id: "insight-1",
        title: "Test",
        taskLabel: null,
        importance: "medium",
        urgency: "not_urgent",
        myTasks: [],
        waitingForMe: [],
        waitingForOthers: [],
        nextActions: [],
        details: [],
        sources: [],
        groups: [],
        people: [],
        platform: null,
        time: new Date(),
        createdAt: new Date(),
      } as unknown as Insight;

      const definition = {
        match: "all",
        conditions: [{ kind: "task_label", values: ["bug"] }],
      } as any;

      expect(insightMatchesFilterDefinition(insight, definition)).toBe(false);
    });
  });
});
