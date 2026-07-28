import { describe, expect, it } from "vitest";
import { decodeSearchParamText } from "@/lib/chat/query-text";

describe("decodeSearchParamText", () => {
  it("returns undefined for missing query params", () => {
    expect(decodeSearchParamText(null)).toBeUndefined();
  });

  it("keeps already-decoded text with literal percent signs", () => {
    expect(decodeSearchParamText("Clean disk until 80% free")).toBe(
      "Clean disk until 80% free",
    );
  });

  it("supports legacy double-encoded query text", () => {
    expect(decodeSearchParamText("Record%20the%20meeting")).toBe(
      "Record the meeting",
    );
  });

  it("preserves malformed escape sequences instead of throwing", () => {
    expect(decodeSearchParamText("Summarize 100% of notes")).toBe(
      "Summarize 100% of notes",
    );
  });
});
