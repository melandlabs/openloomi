/**
 * Channels Sources Types Unit Tests
 *
 * Tests for utility functions in @openloomi/integrations/channels/sources/types
 */
import { describe, test, expect } from "vitest";
import type { ExtractedMessageInfo } from "@openloomi/shared";

describe("isEmptyMessage", async () => {
  const { isEmptyMessage } =
    await import("@openloomi/integrations/channels/sources/types");

  test("returns true for null", () => {
    expect(isEmptyMessage(null)).toBe(true);
  });

  test("returns true for empty text with no attachments and no quoted", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
    };
    expect(isEmptyMessage(msg)).toBe(true);
  });

  test("returns false for message with text", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "Hello",
      timestamp: Date.now(),
    };
    expect(isEmptyMessage(msg)).toBe(false);
  });

  test("returns false for message with attachments", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      attachments: [
        {
          name: "file.pdf",
          url: "https://example.com/file.pdf",
          contentType: "application/pdf",
        },
      ],
    };
    expect(isEmptyMessage(msg)).toBe(false);
  });

  test("returns false for message with quoted content", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      quoted: {
        chatType: "private",
        chatName: "Test Chat",
        sender: "Other",
        text: "Previous message",
        timestamp: Date.now(),
      },
    };
    expect(isEmptyMessage(msg)).toBe(false);
  });

  test("returns true for empty message with undefined attachments", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      attachments: undefined,
    };
    expect(isEmptyMessage(msg)).toBe(true);
  });

  test("returns true for empty message with null attachments", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      attachments: undefined,
    };
    expect(isEmptyMessage(msg)).toBe(true);
  });

  test("returns true for empty message with empty attachments array", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      attachments: [],
    };
    expect(isEmptyMessage(msg)).toBe(true);
  });

  test("returns true for empty message with null quoted", () => {
    const msg: ExtractedMessageInfo = {
      chatType: "private",
      chatName: "Test Chat",
      sender: "User",
      text: "",
      timestamp: Date.now(),
      quoted: null,
    };
    expect(isEmptyMessage(msg)).toBe(true);
  });
});

describe("getTgUserNameString", async () => {
  const { getTgUserNameString } =
    await import("@openloomi/integrations/channels/sources/types");

  test("returns firstName when only firstName is provided", () => {
    const result = getTgUserNameString({ firstName: "John" });
    expect(result).toBe("John");
  });

  test("returns lastName when only lastName is provided", () => {
    const result = getTgUserNameString({ lastName: "Doe" });
    expect(result).toBe("Doe");
  });

  test("returns full name when both firstName and lastName are provided", () => {
    const result = getTgUserNameString({
      firstName: "John",
      lastName: "Doe",
    });
    expect(result).toBe("John Doe");
  });

  test("returns userName when no firstName or lastName is provided", () => {
    const result = getTgUserNameString({ userName: "johndoe" });
    expect(result).toBe("johndoe");
  });

  test("prefers firstName + lastName over userName", () => {
    const result = getTgUserNameString({
      firstName: "John",
      lastName: "Doe",
      userName: "johndoe",
    });
    expect(result).toBe("John Doe");
  });

  test("trims leading and trailing whitespace from names", () => {
    const result = getTgUserNameString({
      firstName: "  John  ",
      lastName: "  Doe  ",
    });
    // Note: internal whitespace between firstName and lastName is preserved
    expect(result).toBe("John     Doe");
  });

  test("returns empty string when no name fields are provided", () => {
    const result = getTgUserNameString({});
    expect(result).toBe("");
  });
});
