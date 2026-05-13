import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  triggerCompaction,
  triggerCompactionAsync,
} from "@openloomi/ai/agent/compaction";

describe("compaction client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null and skips fetch when input messages are empty", async () => {
    global.fetch = vi.fn();

    const result = await triggerCompaction({
      messages: [],
      level: "soft",
      platform: "scheduler",
      authToken: "token",
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes content and normalizes roles before sending request", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: "summary",
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          totalCredits: 2,
        },
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    const result = await triggerCompaction({
      messages: [
        { role: "tool", content: "  hello from tool  " },
        { role: "user", content: "data:image/png;base64,AAAA" },
      ],
      level: "hard",
      platform: "scheduler",
      authToken: "token",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as any).mock.calls[0] as [string, any];
    const body = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages).toEqual([
      { role: "assistant", content: "hello from tool" },
      { role: "user", content: "[image omitted for compaction]" },
    ]);
    expect(result).toMatchObject({
      summary: "summary",
      messageCount: 2,
      level: "hard",
      originalTokens: 120,
      summaryTokens: 30,
      creditsUsed: 2,
    });
  });

  it("returns null and skips fetch when sanitization drops all messages", async () => {
    global.fetch = vi.fn();

    const result = await triggerCompaction({
      messages: [{ role: "assistant", content: "    " }],
      level: "soft",
      platform: "scheduler",
      authToken: "token",
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("awaits async persistSummary in triggerCompactionAsync", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        text: "saved summary",
        usage: {
          inputTokens: 90,
          outputTokens: 20,
          totalCredits: 1,
        },
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    let persisted = false;
    const sourceMessages = [{ role: "assistant", content: "keep this" }];
    const persistSummary = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      persisted = true;
    });

    await triggerCompactionAsync({
      messages: sourceMessages,
      level: "soft",
      platform: "scheduler",
      authToken: "token",
      persistSummary,
    });

    expect(persisted).toBe(true);
    expect(persistSummary).toHaveBeenCalledTimes(1);
    expect(persistSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "saved summary",
        level: "soft",
      }),
      sourceMessages,
    );
  });
});
