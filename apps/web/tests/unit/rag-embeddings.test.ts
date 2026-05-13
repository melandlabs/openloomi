/**
 * RAG Embeddings Tests
 *
 * Tests for packages/rag/src/embeddings.ts
 * Tests calculateCreditCost, cosineSimilarity, getEmbeddingDimensions, getEmbeddingModel, getModelPricing
 */

import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  getEmbeddingDimensions,
  getEmbeddingModel,
  getModelPricing,
} from "@openloomi/rag";

describe("rag-embeddings", () => {
  describe("cosineSimilarity", () => {
    // RE-01: identical vectors
    it("RE-01: should return 1 for identical vectors", () => {
      const vec = [1, 2, 3];
      const result = cosineSimilarity(vec, vec);
      expect(result).toBeCloseTo(1, 5);
    });

    // RE-02: orthogonal vectors
    it("RE-02: should return 0 for orthogonal vectors", () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      const result = cosineSimilarity(vecA, vecB);
      expect(result).toBeCloseTo(0, 5);
    });

    // RE-03: opposite vectors
    it("RE-03: should return -1 for opposite vectors", () => {
      const vecA = [1, 2, 3];
      const vecB = [-1, -2, -3];
      const result = cosineSimilarity(vecA, vecB);
      expect(result).toBeCloseTo(-1, 5);
    });

    // RE-04: various dimensions - 2D
    it("RE-04: should work with 2D vectors", () => {
      const vecA = [1, 1];
      const vecB = [1, 0];
      const result = cosineSimilarity(vecA, vecB);
      expect(result).toBeCloseTo(Math.SQRT1_2, 3);
    });

    // RE-05: various dimensions - 4D
    it("RE-05: should work with 4D vectors", () => {
      const vecA = [1, 2, 3, 4];
      const vecB = [4, 3, 2, 1];
      const result = cosineSimilarity(vecA, vecB);
      expect(result).toBeCloseTo(0.7, 1);
    });

    // RE-06: mismatched lengths throws error
    it("RE-06: should throw error for mismatched lengths", () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2];
      expect(() => cosineSimilarity(vecA, vecB)).toThrow(
        "Vectors must have the same length",
      );
    });

    // RE-07: zero vector produces NaN (division by zero)
    it("RE-07: should handle zero vector (produces NaN)", () => {
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];
      const result = cosineSimilarity(vecA, vecB);
      expect(Number.isNaN(result)).toBe(true);
    });

    // RE-08: large vectors
    it("RE-08: should handle large vectors", () => {
      const vecA = Array(100).fill(1);
      const vecB = Array(100).fill(1);
      const result = cosineSimilarity(vecA, vecB);
      expect(result).toBeCloseTo(1, 5);
    });
  });

  describe("getEmbeddingDimensions", () => {
    // RE-09: returns correct dimensions
    it("RE-09: should return 1536 for text-embedding-3-small", () => {
      const result = getEmbeddingDimensions();
      expect(result).toBe(1536);
    });
  });

  describe("getEmbeddingModel", () => {
    // RE-10: returns model name
    it("RE-10: should return configured model", () => {
      const result = getEmbeddingModel();
      expect(result).toBe("openai/text-embedding-3-small");
    });
  });

  describe("getModelPricing", () => {
    // RE-11: text-embedding-3-small pricing
    it("RE-11: should return price for text-embedding-3-small", () => {
      const result = getModelPricing("openai/text-embedding-3-small");
      expect(result).toBe(0.02);
    });

    // RE-12: text-embedding-3-large pricing
    it("RE-12: should return price for text-embedding-3-large", () => {
      const result = getModelPricing("openai/text-embedding-3-large");
      expect(result).toBe(0.13);
    });

    // RE-13: text-embedding-ada-002 pricing
    it("RE-13: should return price for text-embedding-ada-002", () => {
      const result = getModelPricing("openai/text-embedding-ada-002");
      expect(result).toBe(0.1);
    });

    // RE-14: unknown model default pricing
    it("RE-14: should return default price for unknown model", () => {
      const result = getModelPricing("unknown/model");
      expect(result).toBe(0.02);
    });
  });
});
