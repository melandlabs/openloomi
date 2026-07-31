import { describe, expect, test } from "vitest";
import {
  buildLifestyleReferenceImages,
  isSupportedLifestyleReferenceImageMimeType,
  MAX_LIFESTYLE_REFERENCE_IMAGES,
  normalizeLifestyleReferenceImage,
} from "@/lib/ai/image-generation/lifestyle-reference-images";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

describe("normalizeLifestyleReferenceImage", () => {
  test("normalizes bare base64 image data", () => {
    expect(
      normalizeLifestyleReferenceImage({
        data: PNG_BASE64,
        mimeType: "image/png",
      }),
    ).toEqual({
      b64Json: PNG_BASE64,
      mimeType: "image/png",
      role: "style",
    });
  });

  test("normalizes data URLs and lowercases MIME type", () => {
    expect(
      normalizeLifestyleReferenceImage({
        dataUrl: `data:IMAGE/JPEG;base64,${PNG_BASE64}`,
        role: "subject",
      }),
    ).toEqual({
      b64Json: PNG_BASE64,
      mimeType: "image/jpeg",
      role: "subject",
    });
  });

  test("strips a data URL prefix from b64Json when MIME type is supplied", () => {
    expect(
      normalizeLifestyleReferenceImage({
        b64Json: `data:image/webp;base64,${PNG_BASE64}`,
        mimeType: "image/webp",
      }),
    ).toEqual({
      b64Json: PNG_BASE64,
      mimeType: "image/webp",
      role: "style",
    });
  });

  test("uses the configured default role and trims notes", () => {
    expect(
      normalizeLifestyleReferenceImage(
        {
          data: PNG_BASE64,
          mimeType: "image/png",
          note: "  use the jacket color  ",
        },
        { defaultRole: "subject" },
      ),
    ).toEqual({
      b64Json: PNG_BASE64,
      mimeType: "image/png",
      role: "subject",
      note: "use the jacket color",
    });
  });

  test("rejects unsupported MIME types", () => {
    expect(
      normalizeLifestyleReferenceImage({
        data: PNG_BASE64,
        mimeType: "application/pdf",
      }),
    ).toBeNull();
  });

  test("rejects empty image payloads", () => {
    expect(
      normalizeLifestyleReferenceImage({
        data: "   ",
        mimeType: "image/png",
      }),
    ).toBeNull();
  });
});

describe("buildLifestyleReferenceImages", () => {
  test("filters invalid images and caps the result at four references by default", () => {
    const sources = Array.from({ length: 6 }, (_, index) => ({
      data: `${PNG_BASE64}-${index}`,
      mimeType: index === 2 ? "text/plain" : "image/png",
    }));

    const images = buildLifestyleReferenceImages(sources);

    expect(images).toHaveLength(MAX_LIFESTYLE_REFERENCE_IMAGES);
    expect(images.map((image) => image.b64Json)).toEqual([
      `${PNG_BASE64}-0`,
      `${PNG_BASE64}-1`,
      `${PNG_BASE64}-3`,
      `${PNG_BASE64}-4`,
    ]);
  });

  test("supports a custom max image count", () => {
    expect(
      buildLifestyleReferenceImages(
        [
          { data: "one", mimeType: "image/png" },
          { data: "two", mimeType: "image/png" },
        ],
        { maxImages: 1 },
      ),
    ).toEqual([
      {
        b64Json: "one",
        mimeType: "image/png",
        role: "style",
      },
    ]);
  });
});

describe("isSupportedLifestyleReferenceImageMimeType", () => {
  test("accepts supported image MIME types", () => {
    expect(isSupportedLifestyleReferenceImageMimeType("image/png")).toBe(true);
    expect(isSupportedLifestyleReferenceImageMimeType("IMAGE/WEBP")).toBe(true);
  });

  test("rejects unsupported or non-image MIME types", () => {
    expect(isSupportedLifestyleReferenceImageMimeType("image/svg+xml")).toBe(
      false,
    );
    expect(isSupportedLifestyleReferenceImageMimeType("text/plain")).toBe(
      false,
    );
  });
});
