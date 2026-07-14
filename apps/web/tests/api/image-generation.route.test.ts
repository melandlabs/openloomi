import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: {
    id: "user-image-generation",
    type: "regular" as const,
  } as AuthUser | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
}));

const envState = vi.hoisted(() => ({
  tauriMode: false,
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: () => envState.tauriMode,
}));

import { POST } from "@/app/api/ai/v1/images/generations/route";
import { __resetImageGenerationServiceForTests } from "@/lib/ai/image-generation/service";
import {
  __resetImageGenerationUsageRecorderForTests,
  __setImageGenerationUsageRecorderForTests,
  type ImageGenerationUsageRecord,
} from "@/lib/ai/image-generation/usage";

const fetchMock = vi.fn();
const usageRecords: ImageGenerationUsageRecord[] = [];
const IMAGE_GENERATION_ENV_KEYS = [
  "IMAGE_GENERATION_PROVIDER",
  "NEXT_PUBLIC_APP_URL",
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_BASE_URL",
  "OPENAI_IMAGE_GENERATION_URL",
  "OPENAI_IMAGE_TIMEOUT_MS",
  "IMAGE_GENERATION_TIMEOUT_MS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_IMAGE_BASE_URL",
  "OPENROUTER_IMAGE_GENERATION_URL",
  "OPENROUTER_IMAGE_MODEL",
  "OPENROUTER_IMAGE_TIMEOUT_MS",
  "NANO_BANANA_API_KEY",
  "NANO_BANANA_BASE_URL",
  "NANO_BANANA_IMAGE_GENERATION_URL",
  "NANO_BANANA_MODEL",
  "NANO_BANANA_TIMEOUT_MS",
];

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/v1/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function clearImageGenerationEnv(): void {
  for (const key of IMAGE_GENERATION_ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
}

describe("POST /api/ai/v1/images/generations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    usageRecords.length = 0;
    __resetImageGenerationServiceForTests();
    __resetImageGenerationUsageRecorderForTests();
    __setImageGenerationUsageRecorderForTests((record) => {
      usageRecords.push(record);
    });
    authState.user = { id: "user-image-generation", type: "regular" };
    envState.tauriMode = false;
    clearImageGenerationEnv();
  });

  test("returns 401 when unauthenticated outside Tauri", async () => {
    authState.user = null;

    const response = await POST(request({ prompt: "test" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Unauthorized",
      code: "unauthorized:auth",
    });
  });

  test("returns validation error when prompt is missing", async () => {
    const response = await POST(request({ provider: "openai" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      errorType: "validation_error",
    });
  });

  test("returns configuration error when selected provider is missing env", async () => {
    const response = await POST(
      request({ provider: "openai", prompt: "a lifestyle image" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      provider: "openai",
      errorType: "configuration_error",
    });
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]).toMatchObject({
      userId: "user-image-generation",
      endpoint: "api/ai/v1/images/generations",
      provider: "openai",
      model: "gpt-image-2",
      imageCount: 1,
      creditsUsed: 750,
      status: "failed",
      errorType: "configuration_error",
      costMode: "estimated",
      quotaMode: "record_only",
    });
  });

  test("normalizes OpenAI b64_json into a dataUrl", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: "aGVsbG8=",
              revised_prompt: "a revised lifestyle image",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await POST(
      request({
        provider: "openai",
        prompt: "a lifestyle image",
        size: "1024x1024",
        outputFormat: "png",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openai-key",
        }),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      provider: "openai",
      model: "gpt-image-2",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      b64Json: "aGVsbG8=",
      mimeType: "image/png",
    });
    expect(body.creditsUsed).toBeGreaterThan(0);
  });

  test("uses OpenAI full image generation endpoint without appending a path", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_IMAGE_GENERATION_URL = "https://images.example/draw";
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
        provider: "openai",
        model: "gpt-image-2",
        prompt: "a lifestyle image",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://images.example/draw",
      expect.any(Object),
    );
  });

  test("uses OpenRouter image API shape with aspect_ratio output", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_IMAGE_MODEL = "bytedance-seed/seedream-4.5";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
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
        provider: "openrouter",
        prompt: "a lifestyle image",
        size: "1024x1024",
        outputFormat: "png",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-openrouter-key",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "OpenLoomi",
        }),
      }),
    );
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as RequestInit).body as string);
    expect(payload).toMatchObject({
      model: "bytedance-seed/seedream-4.5",
      prompt: "a lifestyle image",
      aspect_ratio: "1:1",
      output_format: "png",
    });
    expect(payload.size).toBeUndefined();

    expect(await response.json()).toMatchObject({
      success: true,
      provider: "openrouter",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]).toMatchObject({
      userId: "user-image-generation",
      endpoint: "api/ai/v1/images/generations",
      provider: "openrouter",
      model: "bytedance-seed/seedream-4.5",
      imageCount: 1,
      creditsUsed: 750,
      status: "success",
      costMode: "estimated",
      quotaMode: "record_only",
    });
  });

  test("uses request provider over env default and accepts Nano Banana url output", async () => {
    process.env.IMAGE_GENERATION_PROVIDER = "openai";
    process.env.NANO_BANANA_API_KEY = "test-nano-key";
    process.env.NANO_BANANA_IMAGE_GENERATION_URL =
      "https://nano.example/images";
    process.env.NANO_BANANA_MODEL = "nano-banana";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              url: "https://cdn.example/generated.png",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await POST(
      request({
        provider: "nano-banana",
        prompt: "a lifestyle image",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://nano.example/images",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-nano-key",
          "x-api-key": "test-nano-key",
        }),
      }),
    );
    expect(await response.json()).toMatchObject({
      success: true,
      provider: "nano-banana",
      imageUrl: "https://cdn.example/generated.png",
    });
  });
});
