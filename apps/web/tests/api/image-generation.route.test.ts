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

const fetchMock = vi.fn();

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/v1/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/v1/images/generations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    __resetImageGenerationServiceForTests();
    authState.user = { id: "user-image-generation", type: "regular" };
    envState.tauriMode = false;
    delete process.env.IMAGE_GENERATION_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.OPENAI_IMAGE_BASE_URL;
    delete process.env.NANO_BANANA_API_KEY;
    delete process.env.NANO_BANANA_BASE_URL;
    delete process.env.NANO_BANANA_IMAGE_GENERATION_URL;
    delete process.env.NANO_BANANA_MODEL;
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
