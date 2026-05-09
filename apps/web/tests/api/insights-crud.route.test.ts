import { randomUUID } from "node:crypto";
import { describe, beforeAll, beforeEach, test, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/insights", () => ({
  refreshActiveBotInsight: vi.fn(),
}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-insights-crud",
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
  insights: new Map<string, any>(),
  bots: new Map<string, any>(),
}));

vi.mock("@/lib/db/queries", () => ({
  insertInsightRecords: vi.fn(async (entries: any[]) => {
    const ids: string[] = [];
    for (const entry of entries) {
      const id = randomUUID();
      dbState.insights.set(id, {
        ...entry,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      ids.push(id);
    }
    return ids;
  }),
  getInsightByIdForUser: vi.fn(
    async ({ userId, insightId }: { userId: string; insightId: string }) => {
      const insight = dbState.insights.get(insightId);
      if (!insight) return null;

      const bot = dbState.bots.get(insight.botId);
      if (!bot || bot.userId !== userId) return null;

      return { insight, bot };
    },
  ),
  updateInsightById: vi.fn(
    async ({
      insightId,
      botId,
      payload,
    }: {
      insightId: string;
      botId: string;
      payload: any;
    }) => {
      const existing = dbState.insights.get(insightId);
      if (!existing) return null;

      const updated = {
        ...existing,
        ...payload,
        id: insightId,
        updatedAt: new Date(),
      };
      dbState.insights.set(insightId, updated);
      return updated;
    },
  ),
  deleteInsightsByIds: vi.fn(async ({ ids }: { ids: string[] }) => {
    for (const id of ids) {
      dbState.insights.delete(id);
    }
  }),
  getBotsByUserId: vi.fn(async ({ id: userId }: { id: string }) => {
    const userBots = Array.from(dbState.bots.values()).filter(
      (b) => b.userId === userId,
    );
    return { bots: userBots };
  }),
  createBot: vi.fn(async (input: any) => {
    const id = randomUUID();
    const bot = { ...input, id, createdAt: new Date(), updatedAt: new Date() };
    dbState.bots.set(id, bot);
    return id;
  }),
  __reset: () => {
    dbState.insights = new Map();
    dbState.bots = new Map();
  },
  __setInsight: (insight: any) => {
    dbState.insights.set(insight.id, insight);
  },
  __setBot: (bot: any) => {
    dbState.bots.set(bot.id, bot);
  },
  __getState: () => dbState,
}));

const authModulePromise = import("@/app/(auth)/auth");
const queriesModulePromise = import("@/lib/db/queries");

let authModule: any;
let queriesModule: any;

async function invokeCreateInsight(body: unknown) {
  const request = new Request("http://localhost/api/insights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
  const { POST } = await import("@/app/(chat)/api/insights/route");
  return POST(request);
}

async function invokeUpdateInsight(insightId: string, body: unknown) {
  const request = new Request(`http://localhost/api/insights/${insightId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
  const { PUT } = await import("@/app/(chat)/api/insights/[id]/route");
  return PUT(request, { params: Promise.resolve({ id: insightId }) });
}

async function invokeDeleteInsight(insightId: string) {
  const request = new Request(`http://localhost/api/insights/${insightId}`, {
    method: "DELETE",
  }) as any;
  const { DELETE } = await import("@/app/(chat)/api/insights/[id]/route");
  return DELETE(request, { params: Promise.resolve({ id: insightId }) });
}

describe("Insights CRUD API integration tests", () => {
  beforeAll(async () => {
    authModule = await authModulePromise;
    queriesModule = await queriesModulePromise;
  });

  beforeEach(() => {
    authModule.__setUser({ id: "user-insights-crud", type: "regular" });
    queriesModule.__reset();
  });

  describe("POST /api/insights - Create Insight", () => {
    test("[INSIGHTS-CREATE-01] creates a new insight with required fields", async () => {
      const response = await invokeCreateInsight({
        title: "Coffee Preference",
        description: "I prefer Americano coffee",
      });

      expect(response.status).toBe(201);

      const payload = await response.json();
      expect(payload.id).toBeTruthy();
      expect(payload.message).toBe("Insight created successfully");

      const dbSnapshot = queriesModule.__getState();
      expect(dbSnapshot.insights.size).toBe(1);
      const created = dbSnapshot.insights.get(payload.id);
      expect(created.title).toBe("Coffee Preference");
      expect(created.description).toBe("I prefer Americano coffee");
      expect(created.platform).toBe("manual");
    });

    test("[INSIGHTS-CREATE-02] creates insight with optional fields", async () => {
      const response = await invokeCreateInsight({
        title: "Important Task",
        description: "Complete project deadline",
        importance: "Important",
        urgency: "As soon as possible",
        groups: ["work"],
        categories: ["priority"],
        people: ["John"],
      });

      expect(response.status).toBe(201);

      const payload = await response.json();
      const dbSnapshot = queriesModule.__getState();
      const created = dbSnapshot.insights.get(payload.id);
      expect(created.importance).toBe("Important");
      expect(created.urgency).toBe("ASAP");
      expect(created.groups).toEqual(["work"]);
      expect(created.categories).toEqual(["priority"]);
      expect(created.people).toEqual(["John"]);
    });

    test("[INSIGHTS-CREATE-03] normalizes importance values", async () => {
      const response = await invokeCreateInsight({
        title: "Test",
        description: "Test description",
        importance: "Important",
        urgency: "As soon as possible",
      });

      expect(response.status).toBe(201);

      const payload = await response.json();
      const dbSnapshot = queriesModule.__getState();
      const created = dbSnapshot.insights.get(payload.id);
      expect(created.importance).toBe("Important");
      expect(created.urgency).toBe("ASAP");
    });

    test("[INSIGHTS-CREATE-04] rejects missing title", async () => {
      const response = await invokeCreateInsight({
        description: "Only description",
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe("title is required");
    });

    test("[INSIGHTS-CREATE-05] rejects missing description", async () => {
      const response = await invokeCreateInsight({
        title: "Only title",
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe("description is required");
    });

    test("[INSIGHTS-CREATE-06] rejects anonymous requests", async () => {
      authModule.__setUser(null);

      const response = await invokeCreateInsight({
        title: "Test",
        description: "Test",
      });

      expect(response.status).toBe(401);
    });

    test("[INSIGHTS-CREATE-07] creates or reuses manual bot", async () => {
      // First request should create a manual bot
      const response1 = await invokeCreateInsight({
        title: "First Insight",
        description: "First description",
      });
      expect(response1.status).toBe(201);

      let dbSnapshot = queriesModule.__getState();
      expect(dbSnapshot.bots.size).toBe(1);
      const manualBotId = (Array.from(dbSnapshot.bots.values())[0] as any).id;

      // Second request should reuse the same manual bot
      const response2 = await invokeCreateInsight({
        title: "Second Insight",
        description: "Second description",
      });
      expect(response2.status).toBe(201);

      dbSnapshot = queriesModule.__getState();
      expect(dbSnapshot.bots.size).toBe(1); // Still only one bot
      const secondInsight = Array.from(dbSnapshot.insights.values())[1] as any;
      expect(secondInsight.botId).toBe(manualBotId);
    });

    test("[INSIGHTS-CREATE-08] creates insight with tasks", async () => {
      const response = await invokeCreateInsight({
        title: "Task List",
        description: "Things to do",
        myTasks: [
          { text: "Task 1", completed: false },
          { text: "Task 2", completed: true, deadline: "2025-01-15" },
        ],
      });

      expect(response.status).toBe(201);

      const payload = await response.json();
      const dbSnapshot = queriesModule.__getState();
      const created = dbSnapshot.insights.get(payload.id);
      expect(created.myTasks).toBeTruthy();
      expect(created.myTasks.length).toBe(2);
    });
  });

  describe("PUT /api/insights/:id - Update Insight", () => {
    test("[INSIGHTS-UPDATE-01] updates description", async () => {
      // Create an insight first
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-1",
        botId,
        title: "Original Title",
        description: "Original Description",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-1", {
        updates: {
          description: "Updated Description",
        },
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.message).toBe("Insight updated successfully");

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-1");
      expect(updated.description).toBe("Updated Description");
      expect(updated.title).toBe("Original Title"); // Title unchanged
    });

    test("[INSIGHTS-UPDATE-02] updates title", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-2",
        botId,
        title: "Original Title",
        description: "Original Description",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-2", {
        updates: {
          title: "New Title",
        },
      });

      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-2");
      expect(updated.title).toBe("New Title");
      expect(updated.description).toBe("Original Description");
    });

    test("[INSIGHTS-UPDATE-03] appends to details array", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-3",
        botId,
        title: "Test",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: [
          { content: "Original detail", person: "User", time: Date.now() },
        ],
        timeline: null,
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-3", {
        updates: {
          details: [{ content: "New detail added", person: "User" }],
        },
      });

      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-3");
      expect(updated.details.length).toBe(2);
      expect(updated.details[0].content).toBe("Original detail");
      expect(updated.details[1].content).toBe("New detail added");
    });

    test("[INSIGHTS-UPDATE-04] appends to timeline array", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-4",
        botId,
        title: "Test",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: [{ summary: "Created", label: "Created", time: Date.now() }],
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-4", {
        updates: {
          timeline: [{ summary: "Progress update", label: "Update" }],
        },
      });

      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-4");
      expect(updated.timeline.length).toBe(2);
      expect(updated.timeline[0].summary).toBe("Created");
      expect(updated.timeline[1].summary).toBe("Progress update");
    });

    test("[INSIGHTS-UPDATE-05] updates importance and urgency", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-5",
        botId,
        title: "Test",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-5", {
        updates: {
          importance: "Important",
          urgency: "As soon as possible",
        },
      });

      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-5");
      expect(updated.importance).toBe("Important");
      expect(updated.urgency).toBe("ASAP");
    });

    test("[INSIGHTS-UPDATE-06] returns 404 for non-existent insight", async () => {
      const response = await invokeUpdateInsight("non-existent", {
        updates: { description: "New" },
      });

      expect(response.status).toBe(404);
    });

    test("[INSIGHTS-UPDATE-07] prevents updating other user's insight", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "other-user",
        name: "Other Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-6",
        botId,
        title: "Other User Insight",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeUpdateInsight("insight-6", {
        updates: { description: "Hacked" },
      });

      expect(response.status).toBe(404);
    });

    test("[INSIGHTS-UPDATE-08] rejects anonymous requests", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-7",
        botId,
        title: "Test",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      authModule.__setUser(null);

      const response = await invokeUpdateInsight("insight-7", {
        updates: { description: "New" },
      });

      expect(response.status).toBe(401);
    });

    test("[INSIGHTS-UPDATE-09] rejects missing updates object", async () => {
      const response = await invokeUpdateInsight("insight-1", {});

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe("updates object is required");
    });

    test("[INSIGHTS-UPDATE-10] updates tasks with completion status", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-8",
        botId,
        title: "Task Insight",
        description: "Test",
        taskLabel: "task",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
        myTasks: [
          { title: "Task 1", status: "pending", deadline: null, owner: null },
        ],
      });

      const response = await invokeUpdateInsight("insight-8", {
        updates: {
          myTasks: [
            { text: "Task 1", completed: true },
            { text: "Task 2", completed: false },
          ],
        },
      });

      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      const updated = dbSnapshot.insights.get("insight-8");
      expect(updated.myTasks.length).toBe(2);
      expect(updated.myTasks[0].status).toBe("completed");
      expect(updated.myTasks[1].status).toBe("pending");
    });
  });

  describe("DELETE /api/insights/:id - Delete Insight", () => {
    test("[INSIGHTS-DELETE-01] deletes owned insight", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "user-insights-crud",
        name: "Test Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-to-delete",
        botId,
        title: "To Delete",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeDeleteInsight("insight-to-delete");
      expect(response.status).toBe(200);

      const dbSnapshot = queriesModule.__getState();
      expect(dbSnapshot.insights.has("insight-to-delete")).toBe(false);
    });

    test("[INSIGHTS-DELETE-02] returns 404 for non-existent insight", async () => {
      const response = await invokeDeleteInsight("non-existent");
      expect(response.status).toBe(404);
    });

    test("[INSIGHTS-DELETE-03] prevents deleting other user's insight", async () => {
      const botId = randomUUID();
      queriesModule.__setBot({
        id: botId,
        userId: "other-user",
        name: "Other Bot",
        adapter: "manual",
      });
      queriesModule.__setInsight({
        id: "insight-other",
        botId,
        title: "Other User Insight",
        description: "Test",
        taskLabel: "insight",
        importance: "General",
        urgency: "General",
        time: new Date(),
        groups: [],
        people: [],
        details: null,
        timeline: null,
        insights: null,
      });

      const response = await invokeDeleteInsight("insight-other");
      expect(response.status).toBe(404);

      const dbSnapshot = queriesModule.__getState();
      expect(dbSnapshot.insights.has("insight-other")).toBe(true);
    });
  });
});
