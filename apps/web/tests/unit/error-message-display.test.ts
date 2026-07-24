import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { returnObjects?: boolean }) => {
      if (options?.returnObjects) {
        if (key === "common.errors.codexCompatibilityError.suggestions") {
          return ["Upgrade Codex", "Choose a compatible model"];
        }
        if (key === "common.errors.genericError.suggestions") {
          return ["Please try again later"];
        }
        return [];
      }

      const messages: Record<string, string> = {
        "common.errors.codexCompatibilityError.title":
          "Codex setup needs attention",
        "common.errors.codexCompatibilityError.docsAction":
          "Open Codex installation guide",
        "common.errors.genericError.title": "An Error Occurred",
        "common.errors.genericError.description":
          "There was a problem processing your request.",
      };
      return messages[key] ?? key;
    },
  }),
}));

vi.mock("@/components/remix-icon", () => ({
  RemixIcon: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: unknown }) => children,
}));

import { ErrorMessageDisplay } from "@/components/message/error-message-display";

describe("ErrorMessageDisplay", () => {
  it("renders the original backend detail for an otherwise generic error", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorMessageDisplay, {
        errorContent:
          "Error: The provider rejected this exact request for account policy ABC-123.",
      }),
    );

    expect(html).toContain(
      "The provider rejected this exact request for account policy ABC-123.",
    );
    expect(html).toContain("An Error Occurred");
  });

  it("renders actionable Codex compatibility detail and the upgrade guide", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorMessageDisplay, {
        errorContent:
          'The selected model "gpt-new" is not available in Codex CLI 0.100.0. Upgrade Codex or choose a compatible model.',
      }),
    );

    expect(html).toContain("Codex setup needs attention");
    expect(html).toContain("gpt-new");
    expect(html).toContain("Codex CLI 0.100.0");
    expect(html).toContain("Upgrade Codex");
    expect(html).toContain("Choose a compatible model");
    expect(html).toContain(
      'href="https://github.com/openai/codex#installation"',
    );
  });
});
