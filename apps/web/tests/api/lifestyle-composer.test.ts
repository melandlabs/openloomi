import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-lifestyle",
    type: "regular" as const,
  } as AuthUser | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
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

import { POST } from "@/app/api/ai/v1/images/lifestyle/compose/route";
import { composeLifestyleImagePrompt } from "@/lib/ai/image-generation/lifestyle-composer";

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/v1/images/lifestyle/compose", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function insight(overrides: Record<string, unknown>) {
  return {
    id: "insight-default",
    botId: "bot-1",
    taskLabel: "insight",
    title: "Default insight",
    description: "Default description",
    topKeywords: [],
    topEntities: [],
    groups: [],
    people: [],
    categories: [],
    learning: null,
    ...overrides,
  };
}

function markdownFile(name: string) {
  return {
    name,
    isFile: () => true,
  };
}

function mockDefaultSources() {
  dbMocks.getUserProfile.mockResolvedValue({
    id: "user-lifestyle",
    email: "user@example.com",
    name: "Avery",
    avatarUrl: null,
    hasPassword: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    lastLoginAt: null,
  });
  dbMocks.getUserInsightSettings.mockResolvedValue({
    focusPeople: ["founder channel"],
    focusTopics: ["AI agents", "product storytelling"],
    identityIndustries: ["AI products"],
    identityWorkDescription:
      "Building an attention broker for focused builders.",
  });
  dbMocks.getChatById.mockResolvedValue({
    id: "chat-1",
    userId: "user-lifestyle",
  });
  dbMocks.getMessagesByChatId.mockResolvedValue([
    {
      id: "message-1",
      role: "user",
      parts: JSON.stringify([
        {
          type: "text",
          text: "I keep thinking about calm launches and product storytelling.",
        },
      ]),
    },
  ]);
  dbMocks.getChatInsights.mockResolvedValue([
    insight({
      id: "insight-chat",
      title: "Launch narrative",
      description: "User discussed product storytelling and launch energy.",
      topKeywords: ["storytelling", "launch"],
    }),
  ]);
  dbMocks.getBotsByUserId.mockResolvedValue({
    bots: [{ id: "bot-1" }],
    hasMore: false,
  });
  dbMocks.getStoredInsightsByBotIds.mockResolvedValue({
    insights: [
      insight({
        id: "insight-memory",
        taskLabel: "chronicle_screen",
        title: "Screen: product planning",
        description: "A planning session around the image generation launch.",
        topKeywords: ["planning", "image generation"],
        learning: JSON.stringify({ screenshotPath: "screen.png" }),
      }),
    ],
    hasMore: false,
  });
  fsMocks.readdir.mockImplementation(async (dir: string) => {
    if (dir.includes("notes")) {
      return [
        markdownFile("memory-1.md"),
        markdownFile("memory-2.md"),
        markdownFile("memory-3.md"),
        markdownFile("memory-4.md"),
        markdownFile("memory-5.md"),
      ];
    }
    const error = new Error("missing") as Error & { code: string };
    error.code = "ENOENT";
    throw error;
  });
  fsMocks.readFile.mockImplementation(async (filePath: string) => {
    const match = filePath.match(/memory-(\d+)\.md$/);
    const index = match?.[1] ?? "1";
    return [
      `# Memory ${index}`,
      "",
      `Durable user context item ${index}.`,
      `Additional detail ${index} that should not be copied into the prompt.`,
    ].join("\n");
  });
}

describe("composeLifestyleImagePrompt", () => {
  beforeEach(() => {
    authState.user = { id: "user-lifestyle", type: "regular" };
    vi.clearAllMocks();
    mockDefaultSources();
  });

  test("composes a lifestyle prompt from profile, focus, chat, insights, and reference image metadata", async () => {
    storageMocks.getUserFileById.mockResolvedValue({
      id: "file-1",
      userId: "user-lifestyle",
      blobUrl: "https://cdn.example/ref.png",
      blobPathname: "user-lifestyle/ref.png",
      name: "reference.png",
      contentType: "image/png",
      sizeBytes: 1200,
    });

    const result = await composeLifestyleImagePrompt({
      userId: "user-lifestyle",
      chatId: "chat-1",
      referenceImages: [
        {
          fileId: "file-1",
          role: "style",
          note: "soft editorial lighting",
        },
      ],
      generation: {
        provider: "openrouter",
        model: "bytedance-seed/seedream-4.5",
        outputFormat: "png",
      },
    });

    expect(result.prompt).toContain("AI agents");
    expect(result.prompt).toContain("product storytelling");
    expect(result.prompt).toContain("Recent memory signals");
    expect(result.sourceSummary.profile).toMatchObject({
      name: "Avery",
      industries: ["AI products"],
    });
    expect(result.sourceSummary.recentInterests).toEqual(
      expect.arrayContaining([
        "I keep thinking about calm launches and product storytelling.",
      ]),
    );
    expect(result.sourceSummary.lifeKeywords).toEqual(
      expect.arrayContaining(["storytelling", "image generation"]),
    );
    expect(result.sourceSummary.memories).toHaveLength(4);
    expect(result.sourceSummary.memories[0]).toBe(
      "notes: Memory 1 - Durable user context item 1.",
    );
    expect(result.sourceSummary.memories.join(" ")).not.toContain(
      "Additional detail",
    );
    expect(result.sourceSummary.memories.join(" ")).not.toContain("Memory 5");
    expect(result.sourceSummary.referenceImages[0]).toMatchObject({
      fileId: "file-1",
      role: "style",
      mimeType: "image/png",
    });
    expect(result.imageGenerationRequest).toMatchObject({
      provider: "openrouter",
      model: "bytedance-seed/seedream-4.5",
      outputFormat: "png",
      prompt: result.prompt,
    });
    expect(result.imageGenerationRequest.referenceImages).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "reference_images_collected_not_forwarded",
    );
  });

  test("does not use chat context when the chat belongs to a different user", async () => {
    dbMocks.getChatById.mockResolvedValue({
      id: "chat-1",
      userId: "someone-else",
    });

    const result = await composeLifestyleImagePrompt({
      userId: "user-lifestyle",
      chatId: "chat-1",
    });

    expect(dbMocks.getMessagesByChatId).not.toHaveBeenCalled();
    expect(dbMocks.getChatInsights).not.toHaveBeenCalled();
    expect(result.sourceSummary.recentInterests).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "chat_not_found_or_forbidden",
    );
  });
});

describe("POST /api/ai/v1/images/lifestyle/compose", () => {
  beforeEach(() => {
    authState.user = { id: "user-lifestyle", type: "regular" };
    vi.clearAllMocks();
    mockDefaultSources();
  });

  test("returns 401 when unauthenticated", async () => {
    authState.user = null;

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Unauthorized",
      code: "unauthorized:auth",
    });
  });

  test("returns a composed image generation request", async () => {
    const response = await POST(
      request({
        chatId: "chat-1",
        provider: "openai",
        outputFormat: "png",
        imageCount: 2,
        passReferenceImagesToProvider: true,
        referenceImages: [
          {
            dataUrl: "data:image/png;base64,aGVsbG8=",
            role: "subject",
            note: "desk setup",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      imageGenerationRequest: {
        provider: "openai",
        outputFormat: "png",
        imageCount: 2,
        n: 2,
      },
    });
    expect(body.imageGenerationRequest.prompt).toContain(
      "personalized lifestyle image",
    );
    expect(body.imageGenerationRequest.referenceImages[0]).toMatchObject({
      dataUrl: "data:image/png;base64,aGVsbG8=",
      b64Json: "aGVsbG8=",
      mimeType: "image/png",
    });
    expect(body.sourceSummary.referenceImages[0]).toMatchObject({
      role: "subject",
      mimeType: "image/png",
    });
  });
});
