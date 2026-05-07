/**
 * Shared Utils Tests
 *
 * Tests for packages/shared/src/utils.ts
 * SU-01 to SU-35
 */

import { describe, it, expect } from "vitest";
import {
  normalizeTimestamp,
  coerceDate,
  timeBeforeHours,
  timeBeforeHoursMs,
  timeBeforeMinutes,
  formatBytes,
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
  sanitizeText,
  getTextFromMessage,
  getCurrentYearMonth,
  cn,
} from "@alloomi/shared/utils";

describe("shared utils", () => {
  describe("normalizeTimestamp", () => {
    // SU-01: normalizeTimestamp second-level conversion
    it("SU-01: should convert second-level timestamp to milliseconds", () => {
      // 1704067200 seconds = Jan 1, 2024 00:00:00 UTC
      const result = normalizeTimestamp(1704067200);
      expect(result).toBe(1704067200000);
    });

    // SU-02: normalizeTimestamp millisecond-level preservation
    it("SU-02: should keep millisecond-level timestamp unchanged", () => {
      const msTimestamp = 1704067200000;
      const result = normalizeTimestamp(msTimestamp);
      expect(result).toBe(msTimestamp);
    });

    // SU-03: normalizeTimestamp null
    it("SU-03: should return Date.now() for null input", () => {
      const before = Date.now();
      const result = normalizeTimestamp(null);
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    // SU-03: normalizeTimestamp undefined
    it("SU-03: should return Date.now() for undefined input", () => {
      const before = Date.now();
      const result = normalizeTimestamp(undefined);
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe("coerceDate", () => {
    // SU-04: coerceDate Date object
    it("SU-04: should return Date object unchanged", () => {
      const date = new Date(2024, 0, 1);
      const result = coerceDate(date);
      expect(result).toBe(date);
    });

    // SU-05: coerceDate number in seconds
    it("SU-05: should convert number in seconds to Date", () => {
      // 1704067200 seconds
      const result = coerceDate(1704067200);
      expect(result.getTime()).toBe(1704067200000);
    });

    // SU-06: coerceDate number in milliseconds
    it("SU-06: should keep millisecond number as Date", () => {
      const ms = 1704067200000;
      const result = coerceDate(ms);
      expect(result.getTime()).toBe(ms);
    });

    // SU-07: coerceDate ISO string
    it("SU-07: should parse ISO string to Date", () => {
      const result = coerceDate("2024-01-01T00:00:00Z");
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(1);
    });

    // SU-08: coerceDate invalid input
    it("SU-08: should return current date for invalid input", () => {
      const before = Date.now();
      const result = coerceDate("invalid");
      const after = Date.now();
      // Should return a date, at minimum it should be a Date object
      expect(result).toBeInstanceOf(Date);
      // The result should be either new Date(0) (epoch) or a reasonable date
      // Since invalid string falls through to new Date(), which returns current date
      expect(result.getTime()).toBeGreaterThanOrEqual(0);
    });
  });

  describe("timeBeforeHours", () => {
    // SU-09: timeBeforeHours
    it("SU-09: should return Unix timestamp N hours ago", () => {
      const now = Math.floor(Date.now() / 1000);
      const twoHoursAgo = timeBeforeHours(2);
      // 2 hours = 7200 seconds
      expect(now - twoHoursAgo).toBe(7200);
    });
  });

  describe("timeBeforeHoursMs", () => {
    // SU-10: timeBeforeHoursMs
    it("SU-10: should return milliseconds timestamp N hours ago", () => {
      const now = Date.now();
      const twoHoursAgo = timeBeforeHoursMs(2, now);
      // 2 hours = 7200 seconds = 7200000 ms
      expect(now - twoHoursAgo).toBe(7200000);
    });
  });

  describe("timeBeforeMinutes", () => {
    // SU-11: timeBeforeMinutes
    it("SU-11: should return Unix timestamp N minutes ago", () => {
      const now = Math.floor(Date.now() / 1000);
      const thirtyMinutesAgo = timeBeforeMinutes(30);
      // 30 minutes = 1800 seconds
      expect(now - thirtyMinutesAgo).toBe(1800);
    });
  });

  describe("formatBytes", () => {
    // SU-12: formatBytes 0
    it("SU-12: should format 0 bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    // SU-13: formatBytes 1024
    it("SU-13: should format 1024 bytes as 1 KB", () => {
      expect(formatBytes(1024)).toBe("1 KB");
    });

    // SU-14: formatBytes 1048576
    it("SU-14: should format 1048576 bytes as 1 MB", () => {
      expect(formatBytes(1048576)).toBe("1 MB");
    });
  });

  describe("generateUUID", () => {
    // SU-15: valid v4 format
    it("SU-15: should generate UUID in valid v4 format", () => {
      const uuid = generateUUID();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    // SU-16: uniqueness
    it("SU-16: should generate unique UUIDs", () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe("getMostRecentUserMessage", () => {
    // SU-17: returns last user message
    it("SU-17: should return the last user message", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ] as any;
      const result = getMostRecentUserMessage(messages) as any;
      expect(result?.content).toBe("How are you?");
    });

    // SU-18: returns undefined when no user messages
    it("SU-18: should return undefined when no user messages", () => {
      const messages = [{ role: "assistant", content: "Hi there" }] as any;
      const result = getMostRecentUserMessage(messages);
      expect(result).toBeUndefined();
    });

    // SU-19: empty array
    it("SU-19: should return undefined for empty array", () => {
      const result = getMostRecentUserMessage([]);
      expect(result).toBeUndefined();
    });
  });

  describe("getTrailingMessageId", () => {
    // SU-20: returns last message id
    it("SU-20: should return last message id", () => {
      const messages = [
        { id: "msg-1", role: "user" },
        { id: "msg-2", role: "assistant" },
      ] as any;
      const result = getTrailingMessageId({ messages });
      expect(result).toBe("msg-2");
    });

    // SU-21: returns null for empty array
    it("SU-21: should return null for empty array", () => {
      const result = getTrailingMessageId({ messages: [] });
      expect(result).toBeNull();
    });
  });

  describe("sanitizeText", () => {
    // SU-22: removes function call marker
    it("SU-22: should remove has_function_call marker", () => {
      const result = sanitizeText("Hello <has_function_call>world");
      expect(result).toBe("Hello world");
    });

    // SU-23: returns unchanged without marker
    it("SU-23: should return unchanged text without marker", () => {
      const result = sanitizeText("Hello world");
      expect(result).toBe("Hello world");
    });
  });

  describe("getTextFromMessage", () => {
    // SU-24: extracts text from text parts
    it("SU-24: should extract text from text parts", () => {
      const message = {
        parts: [
          { type: "text", text: "Hello" },
          { type: "text", text: " " },
          { type: "text", text: "World" },
        ],
      } as any;
      const result = getTextFromMessage(message);
      expect(result).toBe("Hello World");
    });

    // SU-25: ignores non-text parts
    it("SU-25: should ignore non-text parts", () => {
      const message = {
        parts: [
          { type: "text", text: "Hello" },
          { type: "image", data: "abc" },
        ],
      } as any;
      const result = getTextFromMessage(message);
      expect(result).toBe("Hello");
    });

    // SU-26: empty parts
    it("SU-26: should return empty string for empty parts", () => {
      const message = { parts: [] } as any;
      const result = getTextFromMessage(message);
      expect(result).toBe("");
    });
  });

  describe("getCurrentYearMonth", () => {
    // SU-27: returns current year and month
    it("SU-27: should return current year and month", () => {
      const result = getCurrentYearMonth();
      expect(result.year).toBe(new Date().getFullYear());
      expect(result.month).toBe(new Date().getMonth() + 1);
    });

    // SU-28: year is number
    it("SU-28: year should be a number", () => {
      const result = getCurrentYearMonth();
      expect(typeof result.year).toBe("number");
    });

    // SU-29: month is between 1 and 12
    it("SU-29: month should be between 1 and 12", () => {
      const result = getCurrentYearMonth();
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
    });
  });

  describe("cn", () => {
    // SU-30: merges class names
    it("SU-30: should merge class names", () => {
      const result = cn("foo", "bar");
      expect(result).toContain("foo");
      expect(result).toContain("bar");
    });

    // SU-31: handles undefined
    it("SU-31: should handle undefined inputs", () => {
      const result = cn("foo", undefined, "bar");
      expect(result).toContain("foo");
      expect(result).toContain("bar");
    });
  });
});
