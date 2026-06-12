import { describe, expect, it } from "vitest";

import { hasUsableConversationApiConfiguration } from "@/lib/ai/conversation-api-configuration";

function createResponse(
  overrides: {
    enabled?: boolean;
    hasApiKey?: boolean;
    baseUrl?: string | null;
    model?: string | null;
    systemHasApiKey?: boolean;
  } = {},
) {
  return {
    settings: [
      {
        providerType: "anthropic_compatible",
        enabled: overrides.enabled ?? false,
        hasApiKey: overrides.hasApiKey ?? false,
        baseUrl: overrides.baseUrl ?? null,
        model: overrides.model ?? null,
      },
    ],
    systemDefaults: {
      anthropic_compatible: {
        hasApiKey: overrides.systemHasApiKey ?? false,
      },
    },
  };
}

describe("conversation API configuration", () => {
  it("accepts a complete enabled user provider", () => {
    expect(
      hasUsableConversationApiConfiguration(
        createResponse({
          enabled: true,
          hasApiKey: true,
          baseUrl: "https://api.anthropic.com",
          model: "claude-sonnet-4-6",
        }),
      ),
    ).toBe(true);
  });

  it("rejects incomplete or disabled user providers", () => {
    expect(
      hasUsableConversationApiConfiguration(
        createResponse({
          enabled: false,
          hasApiKey: true,
          baseUrl: "https://api.anthropic.com",
          model: "claude-sonnet-4-6",
        }),
      ),
    ).toBe(false);
    expect(
      hasUsableConversationApiConfiguration(
        createResponse({
          enabled: true,
          hasApiKey: true,
          baseUrl: " ",
          model: "claude-sonnet-4-6",
        }),
      ),
    ).toBe(false);
  });

  it("does not treat an OpenAI-compatible provider as chat configuration", () => {
    const response = createResponse();
    response.settings = [
      {
        providerType: "openai_compatible",
        enabled: true,
        hasApiKey: true,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o-mini",
      },
    ];

    expect(hasUsableConversationApiConfiguration(response)).toBe(false);
  });

  it("accepts the system Anthropic API key fallback", () => {
    expect(
      hasUsableConversationApiConfiguration(
        createResponse({ systemHasApiKey: true }),
      ),
    ).toBe(true);
  });
});
