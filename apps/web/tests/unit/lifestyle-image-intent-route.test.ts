import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isTauriMode: vi.fn(),
  resolveLlmProvider: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: mocks.isTauriMode,
}));

vi.mock("@/lib/ai/provider-resolver", () => ({
  resolveLlmProvider: mocks.resolveLlmProvider,
}));

describe("lifestyle image intent route", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.isTauriMode.mockReset();
    mocks.resolveLlmProvider.mockReset();
    mocks.complete.mockReset();

    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.isTauriMode.mockReturnValue(false);
    mocks.resolveLlmProvider.mockResolvedValue({
      flavor: "openai_http",
      model: "classifier-model",
      complete: mocks.complete,
    });
  });

  test("returns a generation route for valid high-confidence intent JSON", async () => {
    mocks.complete.mockResolvedValue({
      text: JSON.stringify({
        matched: true,
        confidence: "high",
        hasReferenceImage: false,
        reason: "explicit_lifestyle_image_generation_request",
      }),
      model: "classifier-model",
    });

    const response = await postIntent({
      message: "Generate a lifestyle image for my profile.",
      hasReferenceImage: true,
      model: "openai/gpt-5.4",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.route).toMatchObject({
      shouldGenerate: true,
      decision: {
        matched: true,
        confidence: "high",
        hasReferenceImage: true,
      },
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4",
        maxTokens: 300,
      }),
    );
    const request = mocks.complete.mock.calls[0][0];
    expect(request.system).toContain("OpenLoomi Lifestyle Image");
    expect(request.userContent).toContain("Reference image uploaded: true");
  });

  test("falls back when the model returns natural language", async () => {
    mocks.complete.mockResolvedValue({
      text: "The user probably wants a lifestyle image.",
      model: "classifier-model",
    });

    const response = await postIntent({
      message: "Generate a lifestyle image for my profile.",
      hasReferenceImage: false,
    });
    const body = await response.json();

    expect(body.route).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "invalid_json",
    });
  });

  test("falls back when the provider is unavailable", async () => {
    mocks.resolveLlmProvider.mockResolvedValue(null);

    const response = await postIntent({
      message: "Generate a lifestyle image.",
      hasReferenceImage: false,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.route).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "classifier_unavailable",
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  test("falls back when the provider resolves to an agent runtime", async () => {
    mocks.resolveLlmProvider.mockResolvedValue({
      flavor: "agent_runtime",
      model: "agent-runtime",
      complete: mocks.complete,
    });

    const response = await postIntent({
      message: "Let's talk about lifestyle design.",
      hasReferenceImage: false,
      model: "deepseek/deepseek-v4-pro",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.route).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "classifier_unavailable",
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

async function postIntent(body: Record<string, unknown>): Promise<Response> {
  const { POST } =
    await import("@/app/api/ai/v1/images/lifestyle/intent/route");
  return POST(
    new Request("http://localhost/api/ai/v1/images/lifestyle/intent", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
