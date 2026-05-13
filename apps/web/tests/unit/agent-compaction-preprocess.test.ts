/**
 * Agent Compaction Preprocess Tests
 *
 * Tests for packages/agent/src/compaction-preprocess.ts
 * Tests estimateTokens, normalizeOptions, replaceMediaMarkers, truncateCodeBlock,
 * sanitizeCompactionMessage, sanitizeCompactionMessages, mergeGroup, groupCompactionMessages,
 * flattenCompactionGroups, truncateOldestCompactionGroups, preprocessCompactionMessages
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeCompactionMessage,
  sanitizeCompactionMessages,
  groupCompactionMessages,
  flattenCompactionGroups,
  truncateOldestCompactionGroups,
  preprocessCompactionMessages,
  type CompactionPreprocessMessage,
} from "@openloomi/ai/agent";

describe("agent-compaction-preprocess", () => {
  describe("sanitizeCompactionMessage", () => {
    // ACP-01: empty content returns null
    it("ACP-01: should return null for empty content", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result).toBeNull();
    });

    // ACP-02: whitespace only returns null
    it("ACP-02: should return null for whitespace-only content", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "   \n\t  ",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result).toBeNull();
    });

    // ACP-03: preserves role and type
    it("ACP-03: should preserve role and type", () => {
      const message: CompactionPreprocessMessage = {
        role: "assistant",
        type: "tool_use",
        content: "Hello world",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.role).toBe("assistant");
      expect(result?.type).toBe("tool_use");
    });

    // ACP-04: removes image data URLs
    it("ACP-04: should replace image data URLs", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "Image: data:image/png;base64,abc123==",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("[image omitted for compaction]");
    });

    // ACP-05: removes file data URLs
    it("ACP-05: should replace file data URLs", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "File: data:application/pdf;base64,xyz789==",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("[document omitted for compaction]");
    });

    // ACP-06: removes markdown image syntax with data URL
    it("ACP-06: should replace markdown image with data URL", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "See ![image](data:image/png;base64,abc) for details",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("[image omitted for compaction]");
    });

    // ACP-07: keeps markdown image with regular URL
    it("ACP-07: should keep markdown image with regular URL", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "See ![image](https://example.com/image.png) for details",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("https://example.com/image.png");
    });

    // ACP-08: code blocks preserved under limit
    it("ACP-08: should preserve code blocks under limit", () => {
      const code = "function test() {\n  return 1;\n}";
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: `\`\`\`js\n${code}\n\`\`\``,
      };
      const result = sanitizeCompactionMessage(message, {
        maxCodeBlockLines: 120,
      });
      expect(result?.content).toContain(code);
    });

    // ACP-09: long code blocks truncated
    it("ACP-09: should truncate long code blocks", () => {
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
        "\n",
      );
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: `\`\`\`js\n${lines}\n\`\`\``,
      };
      const result = sanitizeCompactionMessage(message, {
        maxCodeBlockLines: 120,
        keepCodeBlockHeadLines: 40,
        keepCodeBlockTailLines: 20,
      });
      // Should contain omission notice and be shorter than original
      expect(result?.content).toContain("lines omitted for compaction");
      expect(result?.content.length).toBeLessThan(message.content.length);
    });
  });

  describe("sanitizeCompactionMessages", () => {
    // ACP-10: filters out null messages
    it("ACP-10: should filter out null messages", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Valid" },
        { role: "user", type: "message", content: "" },
        { role: "assistant", type: "message", content: "Also valid" },
      ];
      const result = sanitizeCompactionMessages(messages);
      expect(result).toHaveLength(2);
    });

    // ACP-11: empty array returns empty
    it("ACP-11: should return empty array for empty input", () => {
      const result = sanitizeCompactionMessages([]);
      expect(result).toEqual([]);
    });
  });

  describe("groupCompactionMessages", () => {
    // ACP-12: empty array
    it("ACP-12: should return empty array for empty input", () => {
      const result = groupCompactionMessages([]);
      expect(result).toEqual([]);
    });

    // ACP-13: single message
    it("ACP-13: should handle single message", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
      ];
      const result = groupCompactionMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Hello");
    });

    // ACP-14: multiple messages same role/type
    it("ACP-14: should merge messages with same role and type", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "user", type: "message", content: "World" },
      ];
      const result = groupCompactionMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0].messages).toHaveLength(2);
    });

    // ACP-15: different roles create separate groups
    it("ACP-15: should separate groups by role", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "assistant", type: "message", content: "Hi there" },
      ];
      const result = groupCompactionMessages(messages);
      expect(result).toHaveLength(2);
    });

    // ACP-16: different types create separate groups
    it("ACP-16: should separate groups by type", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "user", type: "tool_use", content: "Using tool" },
      ];
      const result = groupCompactionMessages(messages);
      expect(result).toHaveLength(2);
    });

    // ACP-17: respects maxMergedMessages
    it("ACP-17: should respect maxMergedMessages limit", () => {
      const messages: CompactionPreprocessMessage[] = Array.from(
        { length: 10 },
        (_, i) => ({
          role: "user" as const,
          type: "message" as const,
          content: `Message ${i}`,
        }),
      );
      const result = groupCompactionMessages(messages, {
        maxMergedMessages: 3,
      });
      // 10 messages with limit of 3 = 4 groups (3+3+3+1)
      expect(result.length).toBe(4);
    });

    // ACP-18: calculates tokens correctly
    it("ACP-18: should calculate tokens for group", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "user", type: "message", content: "World" },
      ];
      const result = groupCompactionMessages(messages);
      expect(result[0].tokens).toBeGreaterThan(0);
    });
  });

  describe("flattenCompactionGroups", () => {
    // ACP-19: converts groups back to messages
    it("ACP-19: should flatten groups to messages", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "user", type: "message", content: "World" },
      ];
      const groups = groupCompactionMessages(messages);
      const flattened = flattenCompactionGroups(groups);

      expect(flattened).toHaveLength(1);
      expect(flattened[0].role).toBe("user");
    });
  });

  describe("truncateOldestCompactionGroups", () => {
    // ACP-20: empty array
    it("ACP-20: should return empty array for empty input", () => {
      const result = truncateOldestCompactionGroups([], 100);
      expect(result).toEqual([]);
    });

    // ACP-21: single group returns unchanged
    it("ACP-21: should return unchanged for single group", () => {
      const groups = [
        {
          role: "user" as const,
          type: "message" as const,
          messages: [
            {
              role: "user" as const,
              type: "message" as const,
              content: "Hello",
            },
          ] as any[],
          content: "Hello",
          tokens: 10,
        },
      ];
      const result = truncateOldestCompactionGroups(groups, 100);
      expect(result).toHaveLength(1);
    });

    // ACP-22: removes groups to fill token gap
    it("ACP-22: should remove oldest groups to fill token gap", () => {
      const groups = [
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "First",
          tokens: 50,
        },
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "Second",
          tokens: 30,
        },
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "Third",
          tokens: 20,
        },
      ];
      const result = truncateOldestCompactionGroups(groups, 60);
      // Should remove first group (50 tokens) to free 50, still need 10 more so remove second (30) = 80 total freed
      expect(result.length).toBe(1);
      expect(result[0].content).toBe("Third");
    });

    // ACP-23: zero token gap returns unchanged
    it("ACP-23: should return unchanged for zero token gap", () => {
      const groups = [
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "First",
          tokens: 50,
        },
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "Second",
          tokens: 30,
        },
      ];
      const result = truncateOldestCompactionGroups(groups, 0);
      expect(result).toHaveLength(2);
    });

    // ACP-24: token gap larger than all but one
    it("ACP-24: should keep at least one group", () => {
      const groups = [
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "First",
          tokens: 50,
        },
        {
          role: "user" as const,
          type: "message" as const,
          messages: [] as any[],
          content: "Second",
          tokens: 30,
        },
      ];
      const result = truncateOldestCompactionGroups(groups, 200);
      expect(result.length).toBe(1);
    });
  });

  describe("preprocessCompactionMessages", () => {
    // ACP-25: full preprocessing pipeline
    it("ACP-25: should run full preprocessing pipeline", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
        { role: "user", type: "message", content: "World" },
      ];
      const result = preprocessCompactionMessages(messages);

      expect(result.sanitized).toBeDefined();
      expect(result.groups).toBeDefined();
      expect(result.flattened).toBeDefined();
      expect(result.sanitized.length).toBeGreaterThan(0);
      expect(result.groups.length).toBeGreaterThan(0);
      expect(result.flattened.length).toBeGreaterThan(0);
    });

    // ACP-26: respects custom options
    it("ACP-26: should respect custom options", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "Hello" },
      ];
      const result = preprocessCompactionMessages(messages, {
        maxMergedMessages: 1,
      });

      expect(result.groups.length).toBe(1);
    });

    // ACP-27: handles empty messages
    it("ACP-27: should handle empty messages array", () => {
      const result = preprocessCompactionMessages([]);
      expect(result.sanitized).toEqual([]);
      expect(result.groups).toEqual([]);
      expect(result.flattened).toEqual([]);
    });

    // ACP-28: removes empty messages in sanitization
    it("ACP-28: should remove empty messages during sanitization", () => {
      const messages: CompactionPreprocessMessage[] = [
        { role: "user", type: "message", content: "" },
        { role: "user", type: "message", content: "Valid" },
      ];
      const result = preprocessCompactionMessages(messages);
      expect(result.sanitized).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    // ACP-29: message with only media markers - replaced with placeholder text
    it("ACP-29: should replace media with placeholder text", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "data:image/png;base64,abc",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toBe("[image omitted for compaction]");
    });

    // ACP-30: multiple code blocks
    it("ACP-30: should handle multiple code blocks", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: `\`\`\`js\nconsole.log('a')\n\`\`\`\n\n\`\`\`js\nconsole.log('b')\n\`\`\``,
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("console.log('a')");
      expect(result?.content).toContain("console.log('b')");
    });

    // ACP-31: unicode content
    it("ACP-31: should handle unicode content", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "Hello 世界 🌍",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toBe("Hello 世界 🌍");
    });

    // ACP-32: very long message truncation
    it("ACP-32: should truncate very long messages", () => {
      const longContent = "a".repeat(20000);
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: longContent,
      };
      const result = sanitizeCompactionMessage(message, {
        maxCharsPerMessage: 1000,
      });
      expect(result?.content.length).toBeLessThan(longContent.length);
      expect(result?.content).toContain("omitted for compaction");
    });

    // ACP-33: mixed media and text - note: data URL replacement consumes the rest of line
    it("ACP-33: should handle media at end of content", () => {
      const message: CompactionPreprocessMessage = {
        role: "user",
        type: "message",
        content: "Look at this: data:image/png;base64,abc",
      };
      const result = sanitizeCompactionMessage(message);
      expect(result?.content).toContain("Look at this:");
      expect(result?.content).toContain("[image omitted for compaction]");
    });
  });
});
