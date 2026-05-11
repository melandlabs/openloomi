import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const schema = vi.hoisted(() => ({
  insightWeights: {
    _name: "insight_weights",
    id: "weights.id",
    insightId: "weights.insightId",
    userId: "weights.userId",
    lastViewedAt: "weights.lastViewedAt",
    createdAt: "weights.createdAt",
  },
  insightWeightHistory: {
    _name: "insight_weight_history",
  },
  insightViewHistory: {
    _name: "insight_view_history",
    insightId: "view.insightId",
    userId: "view.userId",
    viewedAt: "view.viewedAt",
  },
  insightWeightConfig: {
    _name: "insight_weight_config",
    configKey: "config.configKey",
    configValue: "config.configValue",
  },
}));

vi.mock("@/lib/db/schema", () => schema);

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  count: vi.fn(() => "count"),
  desc: vi.fn((column: unknown) => ({ type: "desc", column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({
    type: "gte",
    left,
    right,
  })),
  sql: vi.fn(() => "sql"),
}));

type TableName =
  | "insight_weights"
  | "insight_weight_config"
  | "insight_view_history";

function createMockDb() {
  const state = {
    weightRows: [] as any[],
    configRows: [] as any[],
    countRows: [[{ value: 4 }], [{ value: 2 }], [{ value: 3 }]],
    lastAccessRows: [{ viewedAt: new Date("2026-05-09T10:00:00.000Z") }],
    inserts: [] as Array<{ table: string; value: any }>,
    updates: [] as Array<{ table: string; value: any }>,
    countSelects: [] as Array<{ table?: TableName; where?: unknown }>,
  };

  class SelectBuilder {
    private table?: { _name: TableName };
    private whereClause?: unknown;

    constructor(private readonly selection?: unknown) {}

    from(table: { _name: TableName }) {
      this.table = table;
      return this;
    }

    where(whereClause: unknown) {
      this.whereClause = whereClause;
      return this;
    }

    orderBy() {
      return this;
    }

    limit() {
      if (this.table?._name === "insight_weights") {
        return Promise.resolve(state.weightRows);
      }
      if (this.table?._name === "insight_weight_config") {
        return Promise.resolve(state.configRows);
      }
      if (this.table?._name === "insight_view_history") {
        return Promise.resolve(state.lastAccessRows);
      }
      return Promise.resolve([]);
    }

    // biome-ignore lint/suspicious/noThenProperty: thenable mock for query builder
    then(
      resolve: (value: any[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      if ((this.selection as any)?.value === "count") {
        state.countSelects.push({
          table: this.table?._name,
          where: this.whereClause,
        });
        return Promise.resolve(state.countRows.shift() ?? [{ value: 0 }]).then(
          resolve,
          reject,
        );
      }

      return Promise.resolve([]).then(resolve, reject);
    }
  }

  class InsertBuilder {
    constructor(private readonly table: { _name: string }) {}

    values(value: any) {
      state.inserts.push({ table: this.table._name, value });
      return Promise.resolve([]);
    }
  }

  class UpdateBuilder {
    private value: any;

    constructor(private readonly table: { _name: string }) {}

    set(value: any) {
      this.value = value;
      return this;
    }

    where() {
      state.updates.push({ table: this.table._name, value: this.value });
      return Promise.resolve([]);
    }
  }

  return {
    state,
    db: {
      select: vi.fn((selection?: unknown) => new SelectBuilder(selection)),
      insert: vi.fn((table: { _name: string }) => new InsertBuilder(table)),
      update: vi.fn((table: { _name: string }) => new UpdateBuilder(table)),
    },
  };
}

describe("recordInsightView access counts", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test("creates a weight record and syncs rolling access counts", async () => {
    const { recordInsightView } =
      await import("@/lib/insights/weight-adjustment");
    const { db, state } = createMockDb();

    await recordInsightView(
      "insight-1",
      "user-1",
      "detail",
      { surface: "drawer" },
      db as any,
    );

    expect(state.inserts[0]).toMatchObject({
      table: "insight_weights",
      value: {
        insightId: "insight-1",
        userId: "user-1",
        accessCountTotal: 0,
        accessCount7d: 0,
        accessCount30d: 0,
      },
    });
    expect(state.inserts[1]).toMatchObject({
      table: "insight_view_history",
      value: {
        insightId: "insight-1",
        userId: "user-1",
        viewSource: "detail",
        viewContext: { surface: "drawer" },
      },
    });
    expect(state.updates.at(-1)).toMatchObject({
      table: "insight_weights",
      value: {
        accessCountTotal: 4,
        accessCount7d: 2,
        accessCount30d: 3,
      },
    });
    expect(state.updates.at(-1)?.value.lastAccessedAt).toBeInstanceOf(Date);
    expect(state.updates.at(-1)?.value.lastAccessedAt.toISOString()).toBe(
      "2026-05-09T10:00:00.000Z",
    );
  });

  test("serializes view context when running against the SQLite schema", async () => {
    vi.stubEnv("IS_TAURI", "true");

    const { recordInsightView } =
      await import("@/lib/insights/weight-adjustment");
    const { db, state } = createMockDb();

    await recordInsightView(
      "insight-1",
      "user-1",
      "detail",
      { surface: "drawer" },
      db as any,
    );

    expect(state.inserts[1]).toMatchObject({
      table: "insight_view_history",
      value: {
        viewContext: JSON.stringify({ surface: "drawer" }),
      },
    });
  });
});
