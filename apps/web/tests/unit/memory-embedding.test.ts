import { describe, expect, it } from "vitest";
import {
  buildMemoryRecordEmbeddingDocument,
  buildMemoryRecordEmbeddingText,
} from "../../../../packages/ai/src/memory";

describe("memory record embedding text", () => {
  it("builds stable text from raw memory fields", () => {
    const text = buildMemoryRecordEmbeddingText({
      text: "  Project feedback   looked good. ",
      timestamp: 1774500000000,
      tier: "short",
      dimensions: {
        platform: "slack",
        channel: "product",
        botId: "bot-1",
      },
      metadata: {
        source: "insight",
        __rawMessage: {
          ignored: true,
        },
      },
    });

    expect(text).toContain("Text: Project feedback looked good.");
    expect(text).toContain("Dimensions:");
    expect(text).toContain("platform: slack");
    expect(text).toContain("Metadata: source: insight");
    expect(text).not.toContain("__rawMessage");
  });

  it("hashes content deterministically", () => {
    const first = buildMemoryRecordEmbeddingDocument({
      text: "same memory",
      timestamp: 1774500000000,
    });
    const second = buildMemoryRecordEmbeddingDocument({
      text: "same memory",
      timestamp: 1774500000000,
    });
    const changed = buildMemoryRecordEmbeddingDocument({
      text: "changed memory",
      timestamp: 1774500000000,
    });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).not.toBe(changed.contentHash);
  });
});
