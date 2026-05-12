import { describe, expect, it } from "vitest";
import {
  buildInsightEmbeddingDocument,
  buildInsightEmbeddingText,
  hashInsightEmbeddingContent,
  INSIGHT_EMBEDDING_TEXT_VERSION,
} from "@/lib/insights/embedding";

describe("insight embedding text", () => {
  it("builds stable semantic text from rich insight fields", () => {
    const text = buildInsightEmbeddingText({
      title: "Launch feedback",
      description: "Customer asked for clearer project milestones.",
      topKeywords: ["launch", "milestone", "launch"],
      groups: ["Product"],
      people: ["Ava"],
      timeline: [
        {
          title: "Feedback received",
          summary: "Ava requested a milestone summary before Friday.",
        } as any,
      ],
      nextActions: [{ label: "Send revised roadmap", owner: "me" } as any],
    });

    expect(text).toContain("Title: Launch feedback");
    expect(text).toContain(
      "Description: Customer asked for clearer project milestones.",
    );
    expect(text).toContain("Keywords: launch; milestone");
    expect(text).toContain("People: Ava");
    expect(text).toContain("Timeline:");
    expect(text).toContain("Next actions:");
  });

  it("returns deterministic content hashes", () => {
    const content = "Title: Launch feedback\nPeople: Ava";

    expect(hashInsightEmbeddingContent(content)).toBe(
      hashInsightEmbeddingContent(content),
    );
    expect(hashInsightEmbeddingContent(content)).toMatch(
      new RegExp(`^${INSIGHT_EMBEDDING_TEXT_VERSION}:[0-9a-f]{16}$`),
    );
  });

  it("packages content and hash for persistence", () => {
    const document = buildInsightEmbeddingDocument({
      title: "Payment risk",
      description: "Invoice may slip if contract approval waits another week.",
      riskFlags: [
        { severity: "high", reason: "contract approval delayed" } as any,
      ],
    });

    expect(document.textVersion).toBe(INSIGHT_EMBEDDING_TEXT_VERSION);
    expect(document.content).toContain("Title: Payment risk");
    expect(document.contentHash).toBe(
      hashInsightEmbeddingContent(document.content),
    );
  });

  it("truncates long content at a stable boundary", () => {
    const text = buildInsightEmbeddingText(
      {
        title: "Long insight",
        description: "alpha beta gamma. ".repeat(100),
      },
      { maxLength: 80 },
    );

    expect(text.length).toBeLessThanOrEqual(80);
    expect(text).toContain("Title: Long insight");
  });
});
