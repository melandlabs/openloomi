import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SQLiteVecStore } from "../../../../packages/ai/rag/src/sqlite-vec-store";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLiteVecStore", () => {
  it("searches with metadata filters and optionally returns embeddings", async () => {
    const store = createStore("search");
    try {
      await store.addChunks([
        chunk("near", [1, 0, 0], {
          userId: "user-1",
          platform: "feishu",
          channel: "project",
          timestamp: 200,
        }),
        chunk("far", [0, 1, 0], {
          userId: "user-1",
          platform: "feishu",
          channel: "project",
          timestamp: 200,
        }),
        chunk("other-user", [1, 0, 0], {
          userId: "user-2",
          platform: "feishu",
          channel: "project",
          timestamp: 200,
        }),
      ]);

      const results = await store.similaritySearchWithOptions([1, 0, 0], {
        limit: 5,
        includeEmbeddings: true,
        filter: {
          userId: "user-1",
          platform: "feishu",
          channel: "project",
          startTime: 100,
        },
      });

      expect(results.map((result) => result.id)).toEqual(["near", "far"]);
      expect(results[0]?.embedding).toEqual([1, 0, 0]);
      expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    } finally {
      store.close();
    }
  });

  it("moves records between dimension tables and removes expired vectors", async () => {
    const store = createStore("migration");
    try {
      await store.addChunks([
        chunk("moving", [1, 0, 0], { timestamp: 200 }),
        chunk("old", [0, 1, 0], { timestamp: 50 }),
      ]);
      await store.addChunk(chunk("moving", [1, 0, 0, 0], { timestamp: 200 }));

      await expect(store.similaritySearch([1, 0, 0], 5)).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "moving" })]),
      );
      await expect(store.similaritySearch([1, 0, 0, 0], 5)).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "moving" })]),
      );
      await expect(store.deleteOlderThan(100)).resolves.toBe(1);
      await expect(store.getStats()).resolves.toEqual({
        count: 1,
        dimensions: 4,
      });
    } finally {
      store.close();
    }
  });
});

function createStore(testName: string): SQLiteVecStore {
  const directory = mkdtempSync(join(tmpdir(), "openloomi-sqlite-vec-"));
  tempDirectories.push(directory);
  return new SQLiteVecStore(join(directory, "vectors.db"), undefined, {
    collectionName: `test_${testName}`,
  });
}

function chunk(
  id: string,
  embedding: number[],
  metadata: Record<string, unknown>,
) {
  return {
    id,
    documentId: `document-${id}`,
    content: `content-${id}`,
    embedding,
    metadata,
  };
}
