import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({
  getUserTypeForService: vi.fn(),
  getUserInsightSettings: vi.fn(),
}));

vi.mock("@/lib/ai/runtime/register-plugins", () => ({
  registerPlugins: vi.fn(),
}));

vi.mock("@openloomi/ai/store", () => ({
  saveCompactionSummary: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  prepareConversationWindows: vi.fn(),
  triggerCompactionAsync: vi.fn(),
}));

vi.mock("@openloomi/ai/agent", () => ({
  sanitizeCompactionMessages: vi.fn(),
}));

vi.mock("@openloomi/ai/agent/registry", () => ({
  getAgentRegistry: vi.fn(),
}));

import {
  getUserTypeForService,
  getUserInsightSettings,
} from "@/lib/db/queries";
import { prepareConversationWindows, triggerCompactionAsync } from "@/lib/ai";
import { sanitizeCompactionMessages } from "@openloomi/ai/agent";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { handleAgentRuntime } from "@/lib/ai/runtime/shared";

function createDoneOnlyGenerator() {
  return (async function* () {
    yield { type: "done" } as any;
  })();
}

function buildPreparedWindow(
  candidates: Array<{ role: string; content: string }>,
) {
  return {
    totalTokens: 120_000,
    immediate: [{ role: "assistant", content: "recent context" }],
    immediateTokens: 4_000,
    candidatesForCompaction: candidates.map((message, index) => ({
      ...message,
      timestamp: Date.UTC(2026, 0, index + 1),
    })),
    compactionCandidateTokens: 80_000,
    usageRatio: 1.2,
    level: "hard",
    bucketStats: {
      recent: { messages: 1 },
      warm: { messages: 0 },
      cold: { messages: 0 },
      archive: { messages: 0 },
    },
  } as any;
}

describe("runtime shared compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserTypeForService).mockResolvedValue("pro" as any);
    vi.mocked(getUserInsightSettings).mockResolvedValue({
      aiSoulPrompt: null,
    } as any);

    vi.mocked(getAgentRegistry).mockReturnValue({
      create: vi.fn(() => ({
        run: vi.fn(() => createDoneOnlyGenerator()),
      })),
    } as any);
  });

  it("sanitizes compaction candidates before triggering async compaction", async () => {
    const candidates: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }> = Array.from({ length: 11 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index === 0 ? " data:image/png;base64,AAAA " : `old-${index}`,
    }));
    vi.mocked(prepareConversationWindows).mockReturnValue(
      buildPreparedWindow(candidates),
    );
    vi.mocked(sanitizeCompactionMessages).mockReturnValue([
      { role: "assistant", type: "message", content: "sanitized A" },
      { role: "user", type: "message", content: "sanitized B" },
    ] as any);
    vi.mocked(triggerCompactionAsync).mockResolvedValue(undefined);

    await handleAgentRuntime(
      "run scheduled task",
      {
        userId: "u1",
        accountId: "a1",
        modelConfig: { apiKey: "token" },
        conversation: candidates,
      },
      vi.fn().mockResolvedValue(undefined),
      "telegram",
    );

    expect(sanitizeCompactionMessages).toHaveBeenCalledTimes(1);
    const sanitizeInput = vi.mocked(sanitizeCompactionMessages).mock
      .calls[0][0];
    expect(sanitizeInput).toHaveLength(11);
    expect(sanitizeInput[0]).toMatchObject({
      role: "user",
      type: "message",
      content: " data:image/png;base64,AAAA ",
    });

    expect(triggerCompactionAsync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(triggerCompactionAsync).mock.calls[0][0]).toMatchObject({
      messages: [
        { role: "assistant", content: "sanitized A" },
        { role: "user", content: "sanitized B" },
      ],
      level: "hard",
      platform: "telegram",
      authToken: "token",
    });
  });

  it("does not trigger async compaction when sanitize result is empty", async () => {
    const candidates: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }> = Array.from({ length: 12 }, (_, index) => ({
      role: "assistant",
      content: `old-${index}`,
    }));
    vi.mocked(prepareConversationWindows).mockReturnValue(
      buildPreparedWindow(candidates),
    );
    vi.mocked(sanitizeCompactionMessages).mockReturnValue([]);

    await handleAgentRuntime(
      "run scheduled task",
      {
        userId: "u1",
        accountId: "a1",
        modelConfig: { apiKey: "token" },
        conversation: candidates,
      },
      vi.fn().mockResolvedValue(undefined),
      "telegram",
    );

    expect(sanitizeCompactionMessages).toHaveBeenCalledTimes(1);
    expect(triggerCompactionAsync).not.toHaveBeenCalled();
  });
});
