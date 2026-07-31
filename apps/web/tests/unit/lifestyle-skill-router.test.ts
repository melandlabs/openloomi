import { describe, expect, test } from "vitest";
import {
  parseLifestyleImageSkillDecision,
  resolveLifestyleImageSkillRoute,
  shouldGenerateLifestyleImageFromClassifierFallback,
} from "@/lib/ai/image-generation/lifestyle-skill-router";

describe("parseLifestyleImageSkillDecision", () => {
  test("accepts a valid structured decision", () => {
    expect(
      parseLifestyleImageSkillDecision({
        matched: true,
        confidence: "high",
        hasReferenceImage: true,
        reason: " explicit_lifestyle_image_generation_request ",
        refinedPrompt: " create a lifestyle portrait ",
      }),
    ).toEqual({
      matched: true,
      confidence: "high",
      hasReferenceImage: true,
      reason: "explicit_lifestyle_image_generation_request",
      refinedPrompt: "create a lifestyle portrait",
    });
  });

  test("accepts a JSON string decision", () => {
    expect(
      parseLifestyleImageSkillDecision(
        '{"matched":false,"confidence":"low","hasReferenceImage":false}',
      ),
    ).toEqual({
      matched: false,
      confidence: "low",
      hasReferenceImage: false,
    });
  });

  test("accepts a fenced JSON decision", () => {
    expect(
      parseLifestyleImageSkillDecision(
        '```json\n{"matched":true,"confidence":"high","hasReferenceImage":false}\n```',
      ),
    ).toEqual({
      matched: true,
      confidence: "high",
      hasReferenceImage: false,
    });
  });

  test("rejects natural language output", () => {
    expect(
      parseLifestyleImageSkillDecision(
        "The user probably wants a lifestyle image.",
      ),
    ).toBeNull();
  });

  test("rejects missing required fields", () => {
    expect(
      parseLifestyleImageSkillDecision({
        matched: true,
        confidence: "high",
      }),
    ).toBeNull();
  });

  test("rejects invalid confidence values", () => {
    expect(
      parseLifestyleImageSkillDecision({
        matched: true,
        confidence: "certain",
        hasReferenceImage: false,
      }),
    ).toBeNull();
  });

  test("rejects invalid optional field types", () => {
    expect(
      parseLifestyleImageSkillDecision({
        matched: true,
        confidence: "high",
        hasReferenceImage: false,
        refinedPrompt: ["portrait"],
      }),
    ).toBeNull();
  });
});

describe("resolveLifestyleImageSkillRoute", () => {
  test("routes high-confidence matched decisions to generation", () => {
    expect(
      resolveLifestyleImageSkillRoute({
        matched: true,
        confidence: "high",
        hasReferenceImage: false,
      }),
    ).toEqual({
      shouldGenerate: true,
      decision: {
        matched: true,
        confidence: "high",
        hasReferenceImage: false,
      },
    });
  });

  test("falls back when intent is not matched", () => {
    expect(
      resolveLifestyleImageSkillRoute({
        matched: false,
        confidence: "low",
        hasReferenceImage: false,
      }),
    ).toMatchObject({
      shouldGenerate: false,
      fallbackReason: "intent_not_matched",
    });
  });

  test("falls back when confidence is below high", () => {
    expect(
      resolveLifestyleImageSkillRoute({
        matched: true,
        confidence: "medium",
        hasReferenceImage: false,
      }),
    ).toMatchObject({
      shouldGenerate: false,
      fallbackReason: "confidence_not_high",
    });
  });

  test("falls back on malformed JSON", () => {
    expect(resolveLifestyleImageSkillRoute("{not-json")).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "invalid_json",
    });
  });

  test("falls back on invalid schema", () => {
    expect(
      resolveLifestyleImageSkillRoute({
        matched: true,
        confidence: "high",
      }),
    ).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "invalid_schema",
    });
  });

  test("falls back on empty output", () => {
    expect(resolveLifestyleImageSkillRoute("  ")).toEqual({
      shouldGenerate: false,
      decision: null,
      fallbackReason: "empty_output",
    });
  });
});

describe("shouldGenerateLifestyleImageFromClassifierFallback", () => {
  test("allows explicit lifestyle generation requests when the classifier is unavailable", () => {
    expect(
      shouldGenerateLifestyleImageFromClassifierFallback({
        route: {
          shouldGenerate: false,
          decision: null,
          fallbackReason: "classifier_unavailable",
        },
        message:
          "Use this uploaded image as a style reference and generate a lifestyle image.",
        hasReferenceImage: true,
      }),
    ).toBe(true);
  });

  test("does not route ordinary image understanding when the classifier is unavailable", () => {
    expect(
      shouldGenerateLifestyleImageFromClassifierFallback({
        route: {
          shouldGenerate: false,
          decision: null,
          fallbackReason: "classifier_unavailable",
        },
        message: "What is in this uploaded image?",
        hasReferenceImage: true,
      }),
    ).toBe(false);
  });

  test("does not route non-classifier fallbacks", () => {
    expect(
      shouldGenerateLifestyleImageFromClassifierFallback({
        route: {
          shouldGenerate: false,
          decision: null,
          fallbackReason: "invalid_json",
        },
        message: "Generate a lifestyle image.",
        hasReferenceImage: false,
      }),
    ).toBe(false);
  });
});
