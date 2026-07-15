import { describe, expect, test } from "vitest";
import { detectLifestyleImageTrigger } from "@/lib/ai/image-generation/lifestyle-trigger";

describe("detectLifestyleImageTrigger", () => {
  test("matches explicit English lifestyle image generation requests", () => {
    expect(
      detectLifestyleImageTrigger(
        "Please generate a lifestyle image for my current builder identity.",
      ),
    ).toMatchObject({
      matched: true,
      confidence: "high",
      kind: "explicit_lifestyle_image_request",
    });
  });

  test("matches explicit Chinese lifestyle image generation requests", () => {
    expect(
      detectLifestyleImageTrigger("帮我生成一张生活方式图片"),
    ).toMatchObject({
      matched: true,
      confidence: "high",
      kind: "explicit_lifestyle_image_request",
    });
  });

  test("does not match ordinary lifestyle discussion", () => {
    expect(
      detectLifestyleImageTrigger("Let's talk about my lifestyle and focus."),
    ).toMatchObject({
      matched: false,
    });
  });

  test("does not match prompt-only requests", () => {
    expect(
      detectLifestyleImageTrigger("Create a lifestyle image prompt for later."),
    ).toMatchObject({
      matched: false,
      reason: "prompt_only_request",
    });
  });

  test("does not match negated image generation requests", () => {
    expect(
      detectLifestyleImageTrigger("不要生成生活方式图片，只总结一下文字。"),
    ).toMatchObject({
      matched: false,
      reason: "negated_image_generation_request",
    });
  });
});
