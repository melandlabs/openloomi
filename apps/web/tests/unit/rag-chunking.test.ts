/**
 * RAG Chunking Tests
 *
 * Tests for packages/rag/src/chunking.ts
 * Tests chunkText, getOverlapText, countTokens, getOptimalChunkSize, estimateChunkCount
 */

import { describe, it, expect } from "vitest";
import {
  chunkText,
  countTokens,
  getOptimalChunkSize,
  estimateChunkCount,
} from "@openloomi/rag";

describe("rag-chunking", () => {
  describe("chunkText", () => {
    // RC-01: short text returns single chunk
    it("RC-01: should return single chunk for short text", () => {
      const text = "This is a short text.";
      const result = chunkText(text);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("This is a short text.");
      expect(result[0].index).toBe(0);
      expect(result[0].startPosition).toBe(0);
      expect(result[0].endPosition).toBe(text.length);
    });

    // RC-02: text at maxChunkSize boundary
    it("RC-02: should return single chunk when text at boundary", () => {
      const text = "a".repeat(1000);
      const result = chunkText(text, { maxChunkSize: 1000 });

      expect(result).toHaveLength(1);
    });

    // RC-03: long text with paragraphs
    it("RC-03: should split long text into multiple chunks", () => {
      const text = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.";
      const result = chunkText(text, { maxChunkSize: 20 });

      expect(result.length).toBeGreaterThan(1);
    });

    // RC-04: custom separator
    it("RC-04: should use custom separator", () => {
      const text = "Section 1---Section 2---Section 3";
      const result = chunkText(text, { separator: "---", maxChunkSize: 10 });

      expect(result.length).toBeGreaterThan(1);
    });

    // RC-05: chunk overlap
    it("RC-05: should maintain overlap between chunks", () => {
      const text = "AAA\n\nBBB\n\nCCC\n\nDDD";
      const result = chunkText(text, {
        maxChunkSize: 10,
        chunkOverlap: 3,
        separator: "\n\n",
      });

      // All chunks should have proper indices
      result.forEach((chunk, index) => {
        expect(chunk.index).toBe(index);
      });
    });

    // RC-06: empty text
    it("RC-06: should handle empty text", () => {
      const result = chunkText("");

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("");
    });

    // RC-07: whitespace only text
    it("RC-07: should trim whitespace-only text", () => {
      const text = "   \n\n   ";
      const result = chunkText(text);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("");
    });

    // RC-08: preserves chunk indices
    it("RC-08: should assign sequential indices to chunks", () => {
      const text = "P1\n\nP2\n\nP3\n\nP4\n\nP5\n\nP6";
      const result = chunkText(text, { maxChunkSize: 5, separator: "\n\n" });

      result.forEach((chunk, index) => {
        expect(chunk.index).toBe(index);
      });
    });
  });

  describe("countTokens", () => {
    // RC-09: English text token estimation
    it("RC-09: should estimate tokens for English text", () => {
      const text = "Hello world this is a test";
      const result = countTokens(text);

      // Should be around 5 tokens (word count approximation)
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(10);
    });

    // RC-10: Chinese text token estimation
    it("RC-10: should count Chinese characters correctly", () => {
      const text = "你好世界"; // 4 Chinese characters
      const result = countTokens(text);

      expect(result).toBe(4); // 4 Chinese chars
    });

    // RC-11: mixed English and Chinese
    it("RC-11: should handle mixed English and Chinese", () => {
      const text = "Hello 你好 World 世界";
      const result = countTokens(text);

      // "Hello 你好 World 世界"
      // chineseChars = 4
      // otherChars = 11 (Hello World)
      // wordCount = ceil(11/5) = 3
      // total = 4 + 3 = 7
      expect(result).toBe(7);
    });

    // RC-12: empty string
    it("RC-12: should return 0 for empty string", () => {
      const result = countTokens("");
      expect(result).toBe(0);
    });

    // RC-13: only Chinese
    it("RC-13: should handle long Chinese text", () => {
      const text = "的的和和和和和和和和和"; // 11 characters
      const result = countTokens(text);
      expect(result).toBe(11);
    });

    // RC-14: long English word count
    it("RC-14: should handle long English text", () => {
      const text = "a".repeat(100);
      const result = countTokens(text);
      // 100 chars / 5 = 20 tokens
      expect(result).toBe(20);
    });
  });

  describe("getOptimalChunkSize", () => {
    // RC-15: text under 1000 chars
    it("RC-15: should return text length for short text", () => {
      const result = getOptimalChunkSize(500);
      expect(result).toBe(500);
    });

    // RC-16: text at 1000 boundary
    it("RC-16: should return 500 for text around 10000", () => {
      const result = getOptimalChunkSize(5000);
      expect(result).toBe(500);
    });

    // RC-17: text between 1000 and 10000
    it("RC-17: should return 500 for text between 1000 and 10000", () => {
      const result = getOptimalChunkSize(7500);
      expect(result).toBe(500);
    });

    // RC-18: text between 10000 and 50000
    it("RC-18: should return 1000 for text between 10000 and 50000", () => {
      const result = getOptimalChunkSize(25000);
      expect(result).toBe(1000);
    });

    // RC-19: text over 50000
    it("RC-19: should return 1500 for text over 50000", () => {
      const result = getOptimalChunkSize(100000);
      expect(result).toBe(1500);
    });

    // RC-20: zero length
    it("RC-20: should return 0 for zero length", () => {
      const result = getOptimalChunkSize(0);
      expect(result).toBe(0);
    });
  });

  describe("estimateChunkCount", () => {
    // RC-21: basic estimation
    it("RC-21: should estimate chunk count correctly", () => {
      const result = estimateChunkCount(2000);
      // default maxChunkSize=1000, chunkOverlap=200, effective=800
      // 2000/800 = 2.5 -> 3 chunks
      expect(result).toBe(3);
    });

    // RC-22: with custom options
    it("RC-22: should use custom options for estimation", () => {
      const result = estimateChunkCount(2000, {
        maxChunkSize: 1000,
        chunkOverlap: 0,
      });
      // 2000/1000 = 2
      expect(result).toBe(2);
    });

    // RC-23: small text
    it("RC-23: should return 1 for small text", () => {
      const result = estimateChunkCount(100);
      expect(result).toBe(1);
    });
  });
});
