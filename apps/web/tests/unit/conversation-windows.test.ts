import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONVERSATION_WINDOW_CONFIG,
  estimateConversationTokens,
  getConversationBucket,
  prepareConversationWindows,
} from "@openloomi/ai/agent/context";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function contentWithTokens(tokens: number): string {
  return "a".repeat(tokens * 5);
}

describe("conversation windows", () => {
  it("estimates tokens by summing message content", () => {
    const total = estimateConversationTokens([
      { content: contentWithTokens(3) },
      { content: contentWithTokens(7) },
      { content: "" },
    ]);

    expect(total).toBe(10);
  });

  it("classifies buckets by timestamp windows", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const config = DEFAULT_CONVERSATION_WINDOW_CONFIG;

    expect(getConversationBucket(undefined, now, config)).toBe("unknown");
    expect(getConversationBucket(now - 30 * 60 * 1000, now, config)).toBe(
      "recent",
    );
    expect(getConversationBucket(now - 6 * HOUR_MS, now, config)).toBe("warm");
    expect(getConversationBucket(now - 2 * DAY_MS, now, config)).toBe("cold");
    expect(getConversationBucket(now - 10 * DAY_MS, now, config)).toBe(
      "archive",
    );
  });

  it("reports bucket stats and keeps all messages when token budget is sufficient", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const result = prepareConversationWindows(
      [
        {
          role: "assistant",
          content: "recent message",
          timestamp: now - 20 * 60 * 1000,
        },
        {
          role: "assistant",
          content: "warm message",
          timestamp: now - 4 * HOUR_MS,
        },
        {
          role: "assistant",
          content: "cold message",
          timestamp: now - 2 * DAY_MS,
        },
        {
          role: "assistant",
          content: "archive message",
          timestamp: now - 12 * DAY_MS,
        },
        {
          role: "assistant",
          content: "unknown message",
        },
      ],
      { maxTokens: 1_000 },
      now,
    );

    expect(result.immediate).toHaveLength(5);
    expect(result.candidatesForCompaction).toHaveLength(0);
    expect(result.bucketStats.recent.messages).toBe(1);
    expect(result.bucketStats.warm.messages).toBe(1);
    expect(result.bucketStats.cold.messages).toBe(1);
    expect(result.bucketStats.archive.messages).toBe(1);
    expect(result.bucketStats.unknown.messages).toBe(1);
  });

  it("uses soft level when old history exists even at low usage", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const result = prepareConversationWindows(
      [
        {
          role: "assistant",
          content: "very old context",
          timestamp: now - 9 * DAY_MS,
        },
      ],
      { maxTokens: 1_000 },
      now,
    );

    expect(result.usageRatio).toBeLessThan(0.75);
    expect(result.level).toBe("soft");
  });

  it("escalates level to hard and emergency by usage ratio", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);

    const hardResult = prepareConversationWindows(
      [{ role: "assistant", content: contentWithTokens(90), timestamp: now }],
      { maxTokens: 100 },
      now,
    );
    const emergencyResult = prepareConversationWindows(
      [{ role: "assistant", content: contentWithTokens(96), timestamp: now }],
      { maxTokens: 100 },
      now,
    );

    expect(hardResult.level).toBe("hard");
    expect(emergencyResult.level).toBe("emergency");
  });

  it("keeps newest messages per bucket budget and compacts older overflow", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const result = prepareConversationWindows(
      [
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 50 * 60 * 1000,
        }, // recent old
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 30 * 60 * 1000,
        }, // recent mid
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 10 * 60 * 1000,
        }, // recent new
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 20 * HOUR_MS,
        }, // warm old
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 2 * HOUR_MS,
        }, // warm new
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 10 * DAY_MS,
        }, // archive old
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 8 * DAY_MS,
        }, // archive new
        {
          role: "assistant",
          content: contentWithTokens(4),
          timestamp: now - 2 * DAY_MS,
        }, // cold
      ],
      {
        maxTokens: 20,
        keepRecentTokensRatio: 0.5, // recent budget = 10
        keepWarmTokensRatio: 0.3, // warm budget = 6
      },
      now,
    );

    const candidateTimestamps = result.candidatesForCompaction.map(
      (msg) => msg.timestamp,
    );
    expect(result.candidatesForCompaction).toHaveLength(3);
    expect(candidateTimestamps).toEqual([
      now - 10 * DAY_MS, // oldest archive dropped by remaining budget
      now - 20 * HOUR_MS, // warm overflow dropped
      now - 50 * 60 * 1000, // recent overflow dropped
    ]);

    const immediateTimestamps = result.immediate.map((msg) => msg.timestamp);
    expect(immediateTimestamps).toContain(now - 2 * DAY_MS); // cold kept
    expect(immediateTimestamps).toContain(now - 8 * DAY_MS); // newest archive kept
    expect(immediateTimestamps).not.toContain(now - 10 * DAY_MS);
    expect(immediateTimestamps).not.toContain(now - 20 * HOUR_MS);
    expect(immediateTimestamps).not.toContain(now - 50 * 60 * 1000);
  });

  it("keeps at least the newest message when bucket budget is too small", () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const result = prepareConversationWindows(
      [
        {
          role: "assistant",
          content: contentWithTokens(5),
          timestamp: now - 20 * 60 * 1000,
        }, // older
        {
          role: "assistant",
          content: contentWithTokens(5),
          timestamp: now - 10 * 60 * 1000,
        }, // newest
      ],
      {
        maxTokens: 1,
        keepRecentTokensRatio: 0,
      },
      now,
    );

    expect(result.immediate).toHaveLength(1);
    expect(result.immediate[0].timestamp).toBe(now - 10 * 60 * 1000);
    expect(result.candidatesForCompaction).toHaveLength(1);
    expect(result.candidatesForCompaction[0].timestamp).toBe(
      now - 20 * 60 * 1000,
    );
  });
});
