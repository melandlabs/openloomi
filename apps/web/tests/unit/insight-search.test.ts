import { describe, expect, it } from "vitest";
import { cosineSimilarity, parseStoredEmbedding } from "@/lib/insights/search";

describe("insight semantic search helpers", () => {
  it("parses stored embedding vectors", () => {
    expect(parseStoredEmbedding("[1,2,3.5]")).toEqual([1, 2, 3.5]);
    expect(parseStoredEmbedding("not-json")).toBeNull();
    expect(parseStoredEmbedding('{"x":1}')).toBeNull();
    expect(parseStoredEmbedding("[1,null]")).toBeNull();
  });

  it("calculates cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns NaN for invalid vector pairs", () => {
    expect(Number.isNaN(cosineSimilarity([], []))).toBe(true);
    expect(Number.isNaN(cosineSimilarity([1], [1, 2]))).toBe(true);
    expect(Number.isNaN(cosineSimilarity([0, 0], [1, 2]))).toBe(true);
  });
});
