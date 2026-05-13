/**
 * Insights Option Normalizers Tests
 *
 * Tests for packages/insights/src/option-normalizers.ts
 * Tests normalizeImportanceOption, normalizeUrgencyOption, normalizePlatformOption, normalizeBasicOption, dedupeOptions, normalizePlatformKey
 */

import { describe, it, expect } from "vitest";
import {
  normalizeImportanceOption,
  normalizeUrgencyOption,
  normalizePlatformOption,
  normalizeBasicOption,
  dedupeOptions,
  normalizePlatformKey,
} from "@openloomi/insights";

describe("insights-option-normalizers", () => {
  describe("normalizeImportanceOption", () => {
    // IN-01: high importance alias
    it("IN-01: should normalize high importance", () => {
      const result = normalizeImportanceOption("high");
      expect(result?.key).toBe("high");
      expect(result?.label).toBe("High");
    });

    // IN-02: important alias
    it("IN-02: should normalize important to high", () => {
      const result = normalizeImportanceOption("important");
      expect(result?.key).toBe("high");
    });

    // IN-03: medium importance
    it("IN-03: should normalize medium", () => {
      const result = normalizeImportanceOption("medium");
      expect(result?.key).toBe("medium");
      expect(result?.label).toBe("Medium");
    });

    // IN-04: general alias
    it("IN-04: should normalize general to medium", () => {
      const result = normalizeImportanceOption("general");
      expect(result?.key).toBe("medium");
    });

    // IN-05: low importance
    it("IN-05: should normalize low", () => {
      const result = normalizeImportanceOption("low");
      expect(result?.key).toBe("low");
      expect(result?.label).toBe("Low");
    });

    // IN-06: not important alias
    it("IN-06: should normalize not important to low", () => {
      const result = normalizeImportanceOption("not important");
      expect(result?.key).toBe("low");
    });

    // IN-07: case insensitive
    it("IN-07: should be case insensitive", () => {
      const result = normalizeImportanceOption("HIGH");
      expect(result?.key).toBe("high");
    });

    // IN-08: null input
    it("IN-08: should return null for null", () => {
      const result = normalizeImportanceOption(null);
      expect(result).toBeNull();
    });

    // IN-09: undefined input
    it("IN-09: should return null for undefined", () => {
      const result = normalizeImportanceOption(undefined);
      expect(result).toBeNull();
    });

    // IN-10: empty string
    it("IN-10: should return null for empty string", () => {
      const result = normalizeImportanceOption("");
      expect(result).toBeNull();
    });

    // IN-11: unknown value returns key as lowercase
    it("IN-11: should return unknown value with lowercase key", () => {
      const result = normalizeImportanceOption("unknown");
      expect(result?.key).toBe("unknown");
      expect(result?.label).toBe("Unknown");
    });
  });

  describe("normalizeUrgencyOption", () => {
    // IN-12: immediate
    it("IN-12: should normalize immediate", () => {
      const result = normalizeUrgencyOption("immediate");
      expect(result?.key).toBe("immediate");
    });

    // IN-13: urgent alias
    it("IN-13: should normalize urgent to immediate", () => {
      const result = normalizeUrgencyOption("urgent");
      expect(result?.key).toBe("immediate");
    });

    // IN-14: asap alias
    it("IN-14: should normalize asap to immediate", () => {
      const result = normalizeUrgencyOption("asap");
      expect(result?.key).toBe("immediate");
    });

    // IN-15: within 24h
    it("IN-15: should normalize within 24h", () => {
      const result = normalizeUrgencyOption("within 24 hours");
      expect(result?.key).toBe("within_24h");
    });

    // IN-16: 24h alias
    it("IN-16: should normalize 24h to within_24h", () => {
      const result = normalizeUrgencyOption("24h");
      expect(result?.key).toBe("within_24h");
    });

    // IN-17: not urgent
    it("IN-17: should normalize not urgent", () => {
      const result = normalizeUrgencyOption("not urgent");
      expect(result?.key).toBe("not_urgent");
    });

    // IN-18: case insensitive
    it("IN-18: should be case insensitive", () => {
      const result = normalizeUrgencyOption("IMMEDIATE");
      expect(result?.key).toBe("immediate");
    });

    // IN-19: null input
    it("IN-19: should return null for null", () => {
      const result = normalizeUrgencyOption(null);
      expect(result).toBeNull();
    });

    // IN-20: unknown value
    it("IN-20: should return unknown value with lowercase key", () => {
      const result = normalizeUrgencyOption("someday");
      expect(result?.key).toBe("someday");
    });
  });

  describe("normalizePlatformOption", () => {
    // IN-21: known platform - slack
    it("IN-21: should normalize slack", () => {
      const result = normalizePlatformOption("slack");
      expect(result?.key).toBe("slack");
      expect(result?.label).toBe("Slack");
    });

    // IN-22: known platform - discord
    it("IN-22: should normalize discord", () => {
      const result = normalizePlatformOption("discord");
      expect(result?.key).toBe("discord");
      expect(result?.label).toBe("Discord");
    });

    // IN-23: known platform - telegram
    it("IN-23: should normalize telegram", () => {
      const result = normalizePlatformOption("telegram");
      expect(result?.key).toBe("telegram");
      expect(result?.label).toBe("Telegram");
    });

    // IN-24: google_drive with underscore
    it("IN-24: should normalize google_drive", () => {
      const result = normalizePlatformOption("google_drive");
      expect(result?.key).toBe("googledrive");
      expect(result?.label).toBe("Google Drive");
    });

    // IN-25: unknown platform humanized
    it("IN-25: should humanize unknown platform", () => {
      const result = normalizePlatformOption("my_custom_app");
      expect(result?.key).toBe("mycustomapp");
      expect(result?.label).toBe("My Custom App");
    });

    // IN-26: case insensitive
    it("IN-26: should be case insensitive", () => {
      const result = normalizePlatformOption("SLACK");
      expect(result?.key).toBe("slack");
      expect(result?.label).toBe("Slack");
    });

    // IN-27: null input
    it("IN-27: should return null for null", () => {
      const result = normalizePlatformOption(null);
      expect(result).toBeNull();
    });

    // IN-28: empty string
    it("IN-28: should return null for empty string", () => {
      const result = normalizePlatformOption("");
      expect(result).toBeNull();
    });

    // IN-29: whitespace only
    it("IN-29: should return null for whitespace only", () => {
      const result = normalizePlatformOption("   ");
      expect(result).toBeNull();
    });

    // IN-30: twitter mapped to X
    it("IN-30: should normalize twitter to X", () => {
      const result = normalizePlatformOption("twitter");
      expect(result?.key).toBe("twitter");
      expect(result?.label).toBe("X");
    });
  });

  describe("normalizeBasicOption", () => {
    // IN-31: basic normalization
    it("IN-31: should normalize basic option", () => {
      const result = normalizeBasicOption("SomeValue");
      expect(result?.key).toBe("somevalue");
      expect(result?.label).toBe("SomeValue");
    });

    // IN-32: null input
    it("IN-32: should return null for null", () => {
      const result = normalizeBasicOption(null);
      expect(result).toBeNull();
    });

    // IN-33: empty string
    it("IN-33: should return null for empty string", () => {
      const result = normalizeBasicOption("");
      expect(result).toBeNull();
    });
  });

  describe("dedupeOptions", () => {
    // IN-34: removes exact duplicates
    it("IN-34: should remove exact duplicates", () => {
      const result = dedupeOptions(
        ["high", "high", "low"],
        normalizeImportanceOption,
      );
      expect(result).toEqual(["High", "Low"]);
    });

    // IN-35: keeps best label from aliases
    it("IN-35: should keep best label from aliases", () => {
      const result = dedupeOptions(
        ["high", "important"],
        normalizeImportanceOption,
      );
      expect(result).toEqual(["High"]);
    });

    // IN-36: handles mixed valid and invalid
    it("IN-36: should handle mixed options", () => {
      const result = dedupeOptions(
        ["high", "unknown", "low", null, undefined],
        normalizeImportanceOption,
      );
      expect(result).toContain("High");
      expect(result).toContain("Low");
    });

    // IN-37: empty array
    it("IN-37: should return empty array for empty input", () => {
      const result = dedupeOptions([], normalizeImportanceOption);
      expect(result).toEqual([]);
    });

    // IN-38: all null/undefined
    it("IN-38: should return empty array when all null/undefined", () => {
      const result = dedupeOptions(
        [null, undefined],
        normalizeImportanceOption,
      );
      expect(result).toEqual([]);
    });

    // IN-39: sorts alphabetically
    it("IN-39: should sort results alphabetically", () => {
      const result = dedupeOptions(
        ["low", "high", "medium"],
        normalizeImportanceOption,
      );
      expect(result).toEqual(["High", "Low", "Medium"]);
    });
  });

  describe("normalizePlatformKey", () => {
    // IN-40: returns key for known platform
    it("IN-40: should return key for known platform", () => {
      const result = normalizePlatformKey("slack");
      expect(result).toBe("slack");
    });

    // IN-41: returns empty string for null
    it("IN-41: should return empty string for null", () => {
      const result = normalizePlatformKey(null);
      expect(result).toBe("");
    });

    // IN-42: returns empty string for unknown
    it("IN-42: should return empty string for empty", () => {
      const result = normalizePlatformKey("");
      expect(result).toBe("");
    });
  });
});
