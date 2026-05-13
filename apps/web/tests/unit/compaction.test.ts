import { describe, expect, it } from "vitest";
import {
  buildCompactionPrompt,
  COMPACTION_EMERGENCY_RATIO,
  COMPACTION_HARD_RATIO,
  COMPACTION_SOFT_RATIO,
} from "@openloomi/ai/agent/compaction";

describe("compaction prompt", () => {
  it("includes the soft-level instruction and response marker", () => {
    const prompt = buildCompactionPrompt("soft");

    expect(prompt).toContain(
      "SOFT: The conversation is growing large. Provide a concise summary of the key context.",
    );
    expect(prompt).toContain("[COMPACTED: SOFT -- N messages summarized]");
  });

  it("includes the hard-level instruction and response marker", () => {
    const prompt = buildCompactionPrompt("hard");

    expect(prompt).toContain(
      "HARD: The conversation is near token limits. Preserve the most important context concisely.",
    );
    expect(prompt).toContain("[COMPACTED: HARD -- N messages summarized]");
  });

  it("includes the emergency-level instruction and response marker", () => {
    const prompt = buildCompactionPrompt("emergency");

    expect(prompt).toContain(
      "EMERGENCY: The conversation has reached critical token limits. Be extremely concise while preserving ALL critical information.",
    );
    expect(prompt).toContain("[COMPACTED: EMERGENCY -- N messages summarized]");
  });

  it("documents how preprocessed history should be handled", () => {
    const prompt = buildCompactionPrompt("soft");

    expect(prompt).toContain("The input may already be preprocessed:");
    expect(prompt).toContain(
      "Consecutive messages of the same kind may be merged into a single block",
    );
    expect(prompt).toContain(
      "Long code blocks or long message bodies may be shortened with omission markers",
    );
    expect(prompt).toContain(
      "Media payloads may be replaced with short placeholders",
    );
    expect(prompt).toContain(
      "Treat these as compression artifacts from the preprocessing stage.",
    );
  });

  it("exports ascending compaction thresholds", () => {
    expect(COMPACTION_SOFT_RATIO).toBeLessThan(COMPACTION_HARD_RATIO);
    expect(COMPACTION_HARD_RATIO).toBeLessThan(COMPACTION_EMERGENCY_RATIO);
  });
});
