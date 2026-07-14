import {
  type RawMessage,
  type RawMessageGraphEvolutionStorage,
  type RawMessageQuery,
  createRawMessageMemoryGraphStore,
  memoryGraphLedgerMessageId,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import {
  type MemoryGraphSnapshot,
  type OwnerScope,
  buildMemoryGraphEvolutionPlan,
} from "@openloomi/memory-consolidation";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const OWNER = { userId: "user-1" } satisfies OwnerScope;

class InMemoryRawMessageStorage implements RawMessageGraphEvolutionStorage {
  readonly messages = new Map<string, RawMessage>();
  failLedgerWrites = 0;
  leakCrossScopeQueries = false;
  nextId = 1;

  async storeMessage(message: RawMessage): Promise<number> {
    if (
      message.messageId.startsWith("__openloomi_memory_graph__") &&
      this.failLedgerWrites > 0
    ) {
      this.failLedgerWrites -= 1;
      throw new Error("ledger write failed");
    }
    const existing = this.messages.get(message.messageId);
    const id = existing?.id ?? this.nextId++;
    this.messages.set(message.messageId, { ...message, id });
    return id;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    const ids: number[] = [];
    for (const message of messages) ids.push(await this.storeMessage(message));
    return ids;
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    return this.messages.get(messageId) ?? null;
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let items = [...this.messages.values()];
    if (query.userId && !this.leakCrossScopeQueries) {
      items = items.filter((message) => message.userId === query.userId);
    }
    if (!query.includeArchived) {
      items = items.filter((message) => message.archivedAt === undefined);
    }
    if (!query.includeDeprecated) {
      items = items.filter((message) => message.deprecatedAt === undefined);
    }
    items.sort((left, right) =>
      query.reverse === false
        ? left.timestamp - right.timestamp
        : right.timestamp - left.timestamp,
    );
    return items.slice(0, query.limit ?? query.pageSize ?? items.length);
  }
}

function rawMessage(
  messageId: string,
  input: {
    userId?: string;
    relationGroup?: string;
    relationValue?: string;
    sourceIdentity?: string;
    applicability?: Record<string, unknown>;
    topicKeys?: string[];
    channel?: string;
    timestamp?: number;
  } = {},
): RawMessage {
  return {
    messageId,
    platform: "slack",
    botId: "bot-1",
    userId: input.userId ?? OWNER.userId,
    channel: input.channel,
    timestamp: input.timestamp ?? Math.floor(NOW / 1000),
    content: `memory ${messageId}`,
    attachments: [],
    metadata: {
      relationGroup: input.relationGroup,
      relationValue: input.relationValue,
      sourceIdentity: input.sourceIdentity,
      memoryApplicability: input.applicability,
      memoryTopicKeys: input.topicKeys,
    },
    createdAt: Math.floor(NOW / 1000),
    memoryStage: "short",
  };
}

async function readSnapshot(
  storage: InMemoryRawMessageStorage,
  ownerScope: OwnerScope = OWNER,
): Promise<MemoryGraphSnapshot> {
  return createRawMessageMemoryGraphStore({
    storage,
    ownerScope,
    now: () => NOW,
  }).readSnapshot({ ownerScope, includeAuditOnly: true });
}

describe("raw-message memory graph evolution runtime", () => {
  it("preserves baseline storage when graph evolution is disabled or dry-run", async () => {
    const storage = new InMemoryRawMessageStorage();

    const disabled = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [rawMessage("disabled")],
      now: NOW,
    });
    expect(disabled.graphEvolution.status).toBe("disabled");
    expect(storage.messages.has(memoryGraphLedgerMessageId(OWNER))).toBe(false);

    const dryRun = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("dry-run", {
          relationGroup: "language",
          relationValue: "zh",
        }),
      ],
      graphEvolution: { enabled: true, dryRun: true },
      now: NOW,
    });
    expect(dryRun.graphEvolution.status).toBe("planned");
    expect(dryRun.graphEvolution.plan?.persistence).toEqual({
      mode: "dry-run",
      enabled: false,
    });
    expect(storage.messages.has(memoryGraphLedgerMessageId(OWNER))).toBe(false);
  });

  it("protects the internal graph ledger namespace from raw-message writes", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [rawMessage("valid")],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    const ledgerId = memoryGraphLedgerMessageId(OWNER);
    const ledgerBefore = storage.messages.get(ledgerId);

    await expect(
      storeRawMessagesWithGraphEvolution({
        storage,
        messages: [rawMessage(ledgerId)],
        now: NOW + 1000,
      }),
    ).rejects.toThrow("internal memory graph namespace");
    await expect(
      storeRawMessagesWithGraphEvolution({
        storage,
        messages: [
          {
            ...rawMessage("forged-ledger-metadata"),
            metadata: { memoryGraphLedger: { schemaVersion: 1 } },
          },
        ],
        now: NOW + 2000,
      }),
    ).rejects.toThrow("internal memory graph namespace");

    expect(storage.messages.get(ledgerId)).toEqual(ledgerBefore);
    expect(storage.messages.has("forged-ledger-metadata")).toBe(false);
  });

  it("rejects a ledger containing nested cross-scope graph objects", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [rawMessage("scoped-node")],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    const ledgerId = memoryGraphLedgerMessageId(OWNER);
    const ledger = storage.messages.get(ledgerId);
    if (!ledger) throw new Error("expected graph ledger");
    const payload = ledger.metadata?.memoryGraphLedger as {
      snapshot: MemoryGraphSnapshot;
    };
    payload.snapshot.nodes[0].ownerScope = { userId: "other-user" };

    await expect(readSnapshot(storage)).rejects.toThrow(
      "Invalid owner-scoped memory graph ledger payload",
    );
  });

  it("reinforces one cluster and ignores duplicate source identities", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-1", {
          relationGroup: "language",
          relationValue: "zh",
          sourceIdentity: "source:language-1",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    const reinforced = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-2", {
          relationGroup: "language",
          relationValue: "zh",
          sourceIdentity: "source:language-2",
          applicability: { scope: "global" },
          timestamp: Math.floor(NOW / 1000) + 1,
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });

    expect(reinforced.graphEvolution.status).toBe("applied");
    const reinforcedSnapshot = await readSnapshot(storage);
    expect(reinforcedSnapshot.edges).toEqual([
      expect.objectContaining({ kind: "support" }),
    ]);
    expect(reinforcedSnapshot.clusters).toHaveLength(1);
    expect(reinforcedSnapshot.clusters[0].nodeIds.sort()).toEqual([
      "language-1",
      "language-2",
    ]);
    expect(reinforcedSnapshot.clusters[0].supportScore).toBeGreaterThan(0);

    const duplicate = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-import-copy", {
          relationGroup: "language",
          relationValue: "zh",
          sourceIdentity: "source:language-2",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 2000,
    });
    expect(duplicate.graphEvolution.status).toBe("no-op");
    const duplicateSnapshot = await readSnapshot(storage);
    expect(duplicateSnapshot.nodes).toHaveLength(2);
    expect(duplicateSnapshot.edges[0].weight).toBe(
      reinforcedSnapshot.edges[0].weight,
    );
  });

  it("does not inflate support when graph evolution is enabled after a duplicate raw import", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-original", {
          relationGroup: "language",
          relationValue: "zh",
          sourceIdentity: "source:language-original",
          applicability: { scope: "global" },
        }),
      ],
      now: NOW,
    });

    const enabled = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-import-copy", {
          relationGroup: "language",
          relationValue: "zh",
          sourceIdentity: "source:language-original",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });

    expect(enabled.graphEvolution.status).toBe("applied");
    const snapshot = await readSnapshot(storage);
    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      "language-original",
    ]);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.clusters).toEqual([
      expect.objectContaining({ nodeIds: ["language-original"] }),
    ]);
  });

  it("creates competition without merging or superseding contextual evidence", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-global", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("language-task", {
          relationGroup: "language",
          relationValue: "en",
          applicability: { scope: "task", key: "task-42" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });

    const snapshot = await readSnapshot(storage);
    expect(snapshot.edges).toEqual([
      expect.objectContaining({ kind: "compete" }),
    ]);
    expect(snapshot.clusters).toHaveLength(2);
    expect(snapshot.clusters.every((cluster) => cluster.competitionKey)).toBe(
      true,
    );
    expect(snapshot.nodes.find((node) => node.id === "language-task")).toEqual(
      expect.objectContaining({
        applicability: { scope: "task", key: "task-42" },
        visibility: "default",
      }),
    );
    expect(
      snapshot.nodes.some((node) => node.visibility === "deprecated"),
    ).toBe(false);
  });

  it("keeps non-overlapping applicability and unrelated evidence separate", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("task-a", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "task", key: "task-a" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("task-b", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "task", key: "task-b" },
        }),
        rawMessage("project-fact", {
          relationGroup: "project-status",
          relationValue: "ready",
          applicability: { scope: "project", key: "project-1" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });

    const snapshot = await readSnapshot(storage);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.clusters).toHaveLength(3);
  });

  it("records topical relation without forcing cluster membership", async () => {
    const storage = new InMemoryRawMessageStorage();
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("deployment-fact", {
          topicKeys: ["deployment", "project-alpha"],
          applicability: { scope: "project", key: "project-alpha" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("deployment-note", {
          topicKeys: ["deployment", "project-alpha"],
          applicability: { scope: "project", key: "project-alpha" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });

    const snapshot = await readSnapshot(storage);
    expect(snapshot.edges).toEqual([
      expect.objectContaining({ kind: "related" }),
    ]);
    expect(snapshot.clusters).toHaveLength(2);
  });

  it("rejects leaked cross-scope candidates before planning relations", async () => {
    const storage = new InMemoryRawMessageStorage();
    storage.leakCrossScopeQueries = true;
    await storage.storeMessage(
      rawMessage("foreign", {
        userId: "other-user",
        relationGroup: "language",
        relationValue: "zh",
        applicability: { scope: "global" },
      }),
    );

    const result = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("local", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });

    expect(result.graphEvolution.status).toBe("applied");
    expect(result.graphEvolution.consideredCandidateIds).not.toContain(
      "foreign",
    );
    const snapshot = await readSnapshot(storage);
    expect(snapshot.nodes.map((node) => node.id)).toEqual(["local"]);
    expect(snapshot.edges).toEqual([]);
  });

  it("stores but refuses to evolve a mixed-owner batch", async () => {
    const storage = new InMemoryRawMessageStorage();
    const result = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("local"),
        rawMessage("foreign", { userId: "user-2" }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });

    expect(result.ids).toHaveLength(2);
    expect(result.graphEvolution.status).toBe("failed");
    expect(result.graphEvolution.reasonCodes).toContain(
      "memory_graph_scope_mismatch",
    );
    expect(storage.messages.get("foreign")?.metadata?.memoryOwnerScope).toEqual(
      {
        userId: "user-2",
        workspaceId: undefined,
        tenantId: undefined,
      },
    );
    expect(storage.messages.has(memoryGraphLedgerMessageId(OWNER))).toBe(false);
  });

  it("isolates graph candidates and ledgers by workspace within one user", async () => {
    const storage = new InMemoryRawMessageStorage();
    const workspaceA = { userId: OWNER.userId, workspaceId: "workspace-a" };
    const workspaceB = { userId: OWNER.userId, workspaceId: "workspace-b" };
    await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("workspace-a-memory", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true, workspaceId: "workspace-a" },
      now: NOW,
    });
    const result = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("workspace-b-memory", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true, workspaceId: "workspace-b" },
      now: NOW + 1000,
    });

    expect(result.graphEvolution.consideredCandidateIds).not.toContain(
      "workspace-a-memory",
    );
    expect(
      (await readSnapshot(storage, workspaceA)).nodes.map((node) => node.id),
    ).toEqual(["workspace-a-memory"]);
    expect(
      (await readSnapshot(storage, workspaceB)).nodes.map((node) => node.id),
    ).toEqual(["workspace-b-memory"]);
    expect(memoryGraphLedgerMessageId(workspaceA)).not.toBe(
      memoryGraphLedgerMessageId(workspaceB),
    );
  });

  it("recovers after a ledger write failure without duplicate reinforcement", async () => {
    const storage = new InMemoryRawMessageStorage();
    storage.failLedgerWrites = 1;
    const message = rawMessage("retry", {
      relationGroup: "language",
      relationValue: "zh",
      applicability: { scope: "global" },
    });

    const failed = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [message],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    expect(failed.graphEvolution.status).toBe("failed");
    expect(storage.messages.has("retry")).toBe(true);
    expect(storage.messages.has(memoryGraphLedgerMessageId(OWNER))).toBe(false);

    const retried = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [message],
      graphEvolution: { enabled: true },
      now: NOW + 1000,
    });
    expect(retried.graphEvolution.status).toBe("applied");
    const replayed = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [message],
      graphEvolution: { enabled: true },
      now: NOW + 2000,
    });
    expect(replayed.graphEvolution.status).toBe("no-op");
    expect((await readSnapshot(storage)).nodes).toHaveLength(1);
  });

  it("treats completed operation replay as no-op and rejects stale new plans", async () => {
    const storage = new InMemoryRawMessageStorage();
    const initial = await storeRawMessagesWithGraphEvolution({
      storage,
      messages: [
        rawMessage("versioned", {
          relationGroup: "language",
          relationValue: "zh",
          applicability: { scope: "global" },
        }),
      ],
      graphEvolution: { enabled: true },
      now: NOW,
    });
    const store = createRawMessageMemoryGraphStore({
      storage,
      ownerScope: OWNER,
      now: () => NOW + 1000,
    });
    const initialPlan = initial.graphEvolution.plan;
    expect(initialPlan).toBeDefined();
    if (!initialPlan) throw new Error("expected persisted graph plan");
    const replay = await store.persistPlan(initialPlan);
    expect(replay.replayed).toBe(true);
    expect(replay.mutatesGraph).toBe(false);

    const stalePlan = buildMemoryGraphEvolutionPlan({
      ownerScope: OWNER,
      newEvidence: [
        {
          id: "stale-new",
          ownerScope: OWNER,
          timestamp: NOW + 1000,
          relationGroup: "language",
          relationValue: "en",
          applicability: { scope: "global" },
        },
      ],
      candidateEvidence: [],
      snapshot: {
        ownerScope: OWNER,
        nodes: [],
        edges: [],
        clusters: [],
        version: "0",
        capturedAt: NOW,
      },
      now: NOW + 1000,
      persistence: { mode: "write", enabled: true },
    });
    const conflict = await store.persistPlan(stalePlan);
    expect(conflict.conflict).toBe(true);
    expect(conflict.diagnostics).toContain("memory_graph_version_conflict");
    expect((await readSnapshot(storage)).nodes.map((node) => node.id)).toEqual([
      "versioned",
    ]);
  });

  it("serializes same-owner writes so concurrent stale plans cannot both apply", async () => {
    const storage = new InMemoryRawMessageStorage();
    const store = createRawMessageMemoryGraphStore({
      storage,
      ownerScope: OWNER,
      now: () => NOW,
    });
    const empty = await store.readSnapshot({
      ownerScope: OWNER,
      includeAuditOnly: true,
    });
    const buildPlan = (id: string) =>
      buildMemoryGraphEvolutionPlan({
        ownerScope: OWNER,
        newEvidence: [
          {
            id,
            ownerScope: OWNER,
            timestamp: NOW,
            relationGroup: "language",
            relationValue: id,
            applicability: { scope: "global" },
          },
        ],
        candidateEvidence: [],
        snapshot: empty,
        now: NOW,
        persistence: { mode: "write", enabled: true },
      });

    const results = await Promise.all([
      store.persistPlan(buildPlan("concurrent-a")),
      store.persistPlan(buildPlan("concurrent-b")),
    ]);
    expect(results.filter((result) => result.mutatesGraph)).toHaveLength(1);
    expect(results.filter((result) => result.conflict)).toHaveLength(1);
    expect((await readSnapshot(storage)).nodes).toHaveLength(1);
  });
});
