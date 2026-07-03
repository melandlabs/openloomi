import { describe, expect, it, vi } from "vitest";
import {
  chunkAtomicFacts,
  chunkDocument,
  type AtomicFactProvider,
} from "../../../../packages/ai/rag/src";

class StubProvider implements AtomicFactProvider {
  facts: Array<{ fact: string; confidence: number; sourceText?: string }>;
  shouldThrow = false;

  constructor(
    facts: Array<{ fact: string; confidence: number; sourceText?: string }>,
  ) {
    this.facts = facts;
  }

  async decompose(): Promise<
    Array<{ fact: string; confidence: number; sourceText?: string }>
  > {
    if (this.shouldThrow) throw new Error("provider down");
    return this.facts;
  }
}

describe("chunkAtomicFacts", () => {
  it("returns empty for empty input without calling the provider", async () => {
    const provider: AtomicFactProvider = {
      decompose: vi.fn().mockResolvedValue([]),
    };
    const out = await chunkAtomicFacts("", { provider });
    expect(out).toEqual([]);
    expect(provider.decompose).not.toHaveBeenCalled();
  });

  it("returns empty for whitespace-only input", async () => {
    const provider: AtomicFactProvider = {
      decompose: vi.fn().mockResolvedValue([]),
    };
    const out = await chunkAtomicFacts("   \n\n  ", { provider });
    expect(out).toEqual([]);
    expect(provider.decompose).not.toHaveBeenCalled();
  });

  it("decomposes a compound sentence into multiple atomic facts", async () => {
    const provider = new StubProvider([
      {
        fact: "Paris is the capital of France.",
        confidence: 0.95,
        sourceText: "Paris is the capital of France and it has 2.1M people.",
      },
      {
        fact: "Paris has 2.1M people.",
        confidence: 0.9,
        sourceText: "Paris is the capital of France and it has 2.1M people.",
      },
    ]);
    const out = await chunkAtomicFacts(
      "Paris is the capital of France and it has 2.1M people.",
      { provider },
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toMatch(/Paris/);
    expect(out[0]?.confidence).toBeGreaterThan(0.9);
  });

  it("returns one chunk for a simple single-fact sentence", async () => {
    const provider = new StubProvider([
      {
        fact: "The sky is blue.",
        confidence: 0.99,
        sourceText: "The sky is blue.",
      },
    ]);
    const out = await chunkAtomicFacts("The sky is blue.", { provider });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("The sky is blue.");
  });

  it("falls back to the fixed chunker when the provider throws", async () => {
    const provider = new StubProvider([]);
    provider.shouldThrow = true;
    const text = "First sentence. Second sentence. Third sentence.";
    const out = await chunkAtomicFacts(text, {
      provider,
      fallbackOptions: {
        maxChunkSize: 30,
        chunkOverlap: 0,
        separator: " ",
      },
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.confidence).toBe(0);
    expect(out[0]?.metadata?.atomic_fact_fallback).toBe(true);
  });

  it("throws when fallbackStrategy is throw and provider fails", async () => {
    const provider = new StubProvider([]);
    provider.shouldThrow = true;
    await expect(
      chunkAtomicFacts("hello world", {
        provider,
        fallbackStrategy: "throw",
      }),
    ).rejects.toThrow("provider down");
  });

  it("drops facts whose confidence is below minConfidence", async () => {
    const provider = new StubProvider([
      { fact: "Weak claim.", confidence: 0.1, sourceText: "Weak claim." },
      {
        fact: "Strong claim.",
        confidence: 0.9,
        sourceText: "Strong claim.",
      },
    ]);
    const out = await chunkAtomicFacts("Two claims.", {
      provider,
      minConfidence: 0.5,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("Strong claim.");
  });

  it("caps the number of returned facts at maxFactsPerChunk", async () => {
    const provider = new StubProvider([
      { fact: "a", confidence: 0.9, sourceText: "a" },
      { fact: "b", confidence: 0.9, sourceText: "b" },
      { fact: "c", confidence: 0.9, sourceText: "c" },
      { fact: "d", confidence: 0.9, sourceText: "d" },
      { fact: "e", confidence: 0.9, sourceText: "e" },
    ]);
    const out = await chunkAtomicFacts("a b c d e", {
      provider,
      maxFactsPerChunk: 3,
    });
    expect(out).toHaveLength(3);
  });

  it("ignores invalid items (non-string fact, missing confidence)", async () => {
    const provider: AtomicFactProvider = {
      decompose: async () =>
        // @ts-expect-error testing runtime validation
        [
          { fact: "", confidence: 0.9 },
          { fact: "valid", confidence: 0.9 },
          { fact: "no-confidence" },
          { not: "shape" },
        ],
    };
    const out = await chunkAtomicFacts("input", { provider });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("valid");
  });

  it("falls back to fixed chunker when LLM returns empty array", async () => {
    const provider = new StubProvider([]);
    const out = await chunkAtomicFacts("Some text content here.", {
      provider,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.metadata?.atomic_fact_fallback).toBe(true);
  });

  it("falls back to fixed chunker when LLM returns non-array", async () => {
    const provider: AtomicFactProvider = {
      decompose: async () => "not-an-array" as unknown as never,
    };
    const out = await chunkAtomicFacts("Some text content here.", {
      provider,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.metadata?.atomic_fact_fallback).toBe(true);
  });

  it("clamps out-of-range confidence values into [0, 1]", async () => {
    const provider = new StubProvider([
      { fact: "way over", confidence: 1.4, sourceText: "way over" },
      { fact: "way under", confidence: -0.5, sourceText: "way under" },
      { fact: "in range", confidence: 0.7, sourceText: "in range" },
    ]);
    const out = await chunkAtomicFacts("input", {
      provider,
      minConfidence: 0.5,
    });
    // "way under" is clamped to 0 and dropped; the other two survive.
    expect(out.map((c) => c.text).sort()).toEqual(["in range", "way over"]);
    const over = out.find((c) => c.text === "way over");
    expect(over?.confidence).toBe(1);
  });
});

describe("chunkDocument dispatcher", () => {
  it("dispatches strategy='fixed' synchronously", async () => {
    const out = await chunkDocument("hello world", { strategy: "fixed" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.text).toContain("hello");
  });

  it("dispatches strategy='atomic' through the provider", async () => {
    const provider = new StubProvider([
      { fact: "x is 1.", confidence: 0.9, sourceText: "x is 1." },
    ]);
    const out = await chunkDocument("x is 1.", {
      strategy: "atomic",
      atomicFactProvider: provider,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.metadata?.strategy).toBe("atomic");
    expect(out[0]?.metadata?.confidence).toBe(0.9);
  });

  it("throws when strategy='atomic' is requested without a provider", async () => {
    await expect(
      chunkDocument("hello", { strategy: "atomic" }),
    ).rejects.toThrow(/atomicFactProvider/);
  });

  it("treats 'semantic' as an alias for fixed chunking today", async () => {
    const out = await chunkDocument("hello world", { strategy: "semantic" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.metadata?.strategy).toBe("semantic");
  });
});
