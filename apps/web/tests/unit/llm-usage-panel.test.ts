import { describe, expect, it } from "vitest";

import {
  formatTokenCount,
  providerTypeDisplayName,
  resolveUsagePanelStatus,
} from "../../components/llm-usage-panel";

import type { LlmUsageSummary } from "../../lib/llm-usage/types";

function summary(
  overrides: Partial<LlmUsageSummary> = {},
): LlmUsageSummary {
  return {
    configured: true,
    providerSince: "2026-07-01T00:00:00.000Z",
    currentProvider: {
      providerType: "openai_compatible",
      model: "gpt-4o-mini",
      enabledSince: "2026-07-01T00:00:00.000Z",
    },
    totals: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    runCount: 3,
    firstRunAt: "2026-07-01T00:00:00.000Z",
    lastRunAt: "2026-07-02T00:00:00.000Z",
    trackedEndpoints: ["chat-completions"],
    trackedProviders: ["openai_compatible"],
    asOf: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveUsagePanelStatus", () => {
  it("renders loading until the first summary arrives", () => {
    expect(resolveUsagePanelStatus(true, null)).toBe("loading");
  });

  it("renders an error when the summary never arrives", () => {
    expect(resolveUsagePanelStatus(false, null)).toBe("error");
  });

  it("renders an error when the summary reports unavailability", () => {
    expect(
      resolveUsagePanelStatus(
        false,
        summary({ error: "usage_unavailable" }),
      ),
    ).toBe("error");
  });

  it("renders unconfigured when the user has no enabled provider", () => {
    expect(resolveUsagePanelStatus(false, summary({ configured: false }))).toBe(
      "unconfigured",
    );
  });

  it("renders ready once usage is available", () => {
    expect(resolveUsagePanelStatus(false, summary())).toBe("ready");
  });

  it("keeps rendering ready while a refetch is in flight", () => {
    expect(resolveUsagePanelStatus(true, summary())).toBe("ready");
  });
});

describe("formatTokenCount", () => {
  it("renders small counts exactly without separators", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(9_999)).toBe("9999");
  });

  it("abbreviates thousands with one decimal", () => {
    expect(formatTokenCount(10_000)).toBe("10k");
    expect(formatTokenCount(12_345)).toBe("12.3k");
  });

  it("abbreviates millions with one decimal", () => {
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_234_567)).toBe("1.2M");
  });

  it("falls back to a dash for non-finite or negative input", () => {
    expect(formatTokenCount(-1)).toBe("—");
    expect(formatTokenCount(Number.NaN)).toBe("—");
  });
});

describe("providerTypeDisplayName", () => {
  it("resolves known provider ids to their display name", () => {
    expect(providerTypeDisplayName("openai_compatible")).toBe(
      "OpenAI compatible",
    );
  });

  it("falls back to the raw value for ids outside the catalog", () => {
    expect(providerTypeDisplayName("unknown")).toBe("unknown");
  });
});
