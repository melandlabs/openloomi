import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authState = vi.hoisted(() => ({
  user: { id: "user-lifestyle", email: "user@example.com" } as {
    id: string;
    email?: string;
  } | null,
}));

vi.mock("@/lib/auth/dual-auth", () => ({
  getAuthUser: async () => authState.user,
}));

const dbMocks = vi.hoisted(() => ({
  getBotsByUserId: vi.fn(),
  getChatById: vi.fn(),
  getChatInsights: vi.fn(),
  getMessagesByChatId: vi.fn(),
  getStoredInsightsByBotIds: vi.fn(),
  getUserInsightSettings: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => dbMocks);

const storageMocks = vi.hoisted(() => ({
  getUserFileById: vi.fn(),
}));

vi.mock("@/lib/db/storageService", () => storageMocks);

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => fsMocks);

vi.mock("@/lib/utils/path", () => ({
  getUserMemoryPath: (userId: string) => `/mock-memory/${userId}`,
}));

import { POST } from "@/app/api/ai/v1/images/lifestyle/generate/route";
import { __resetImageGenerationServiceForTests } from "@/lib/ai/image-generation/service";
import {
  __resetImageGenerationUsageRecorderForTests,
  __setImageGenerationUsageRecorderForTests,
  type ImageGenerationUsageRecord,
} from "@/lib/ai/image-generation/usage";

const fetchMock = vi.fn();
const usageRecords: ImageGenerationUsageRecord[] = [];

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/v1/images/lifestyle/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function mockDefaultSources() {
  dbMocks.getUserProfile.mockResolvedValue({
    id: "user-lifestyle",
    email: "user@example.com",
    name: "Avery",
  });
  dbMocks.getUserInsightSettings.mockResolvedValue({
    focusPeople: ["founder channel"],
    focusTopics: ["AI agents", "product storytelling"],
    identityIndustries: ["AI products"],
    identityWorkDescription: "Building focused AI product workflows.",
  });
  dbMocks.getChatById.mockResolvedValue({
    id: "chat-1",
    userId: "user-lifestyle",
  });
  dbMocks.getMessagesByChatId.mockResolvedValue([]);
  dbMocks.getChatInsights.mockResolvedValue([]);
  dbMocks.getBotsByUserId.mockResolvedValue({
    bots: [{ id: "bot-1" }],
    hasMore: false,
  });
  dbMocks.getStoredInsightsByBotIds.mockResolvedValue({
    insights: [],
    hasMore: false,
  });
  fsMocks.readdir.mockRejectedValue(
    Object.assign(new Error("missing"), {
      code: "ENOENT",
    }),
  );
}

describe("POST /api/ai/v1/images/lifestyle/generate", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    usageRecords.length = 0;
    authState.user = { id: "user-lifestyle", email: "user@example.com" };
    __resetImageGenerationServiceForTests();
    __resetImageGenerationUsageRecorderForTests();
    __setImageGenerationUsageRecorderForTests((record) => {
      usageRecords.push(record);
    });
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    mockDefaultSources();
  });

  test("composes context, generates an image, and records usage", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }],
        }),
        { status: 200 },
      ),
    );

    const response = await POST(
      request({
        chatId: "chat-1",
        triggerPrompt: "Generate a lifestyle image for my launch work.",
        provider: "openai",
        outputFormat: "png",
        responseFormat: "data_url",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      dataUrl: "data:image/png;base64,aGVsbG8=",
      usage: {
        provider: "openai",
        model: "gpt-image-2",
        imageCount: 1,
        quotaMode: "record_only",
      },
    });
    expect(body.prompt).toContain("Generate a lifestyle image");
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]).toMatchObject({
      userId: "user-lifestyle",
      endpoint: "api/ai/v1/images/lifestyle/generate",
      provider: "openai",
      status: "success",
      quotaMode: "record_only",
    });
  });

  test("returns 401 when unauthenticated", async () => {
    authState.user = null;

    const response = await POST(request({ chatId: "chat-1" }));

    expect(response.status).toBe(401);
  });
});
