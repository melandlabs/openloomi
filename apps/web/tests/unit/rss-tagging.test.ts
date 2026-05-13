/**
 * RSS Tagging Tests
 *
 * Tests for packages/rss/src/tagging.ts
 * Tests getTagConfig, extractRssTags, buildTagConfigMetadata
 */

import { describe, it, expect } from "vitest";
import {
  getTagConfig,
  extractRssTags,
  buildTagConfigMetadata,
} from "@openloomi/rss";
import type { RssSubscription, InsertRssItem } from "@openloomi/rss";

describe("rss-tagging", () => {
  describe("getTagConfig", () => {
    // RT-01: subscription without tagConfig
    it("RT-01: should return null when no tagConfig in subscription", () => {
      const subscription = {
        id: "sub-1",
        userId: "user-1",
        sourceUrl: "https://example.com/feed.xml",
        title: "Test Feed",
        category: null,
        sourceType: "news-feed",
        status: "active",
      } as RssSubscription;

      const result = getTagConfig(subscription);
      expect(result).toBeNull();
    });

    // RT-02: subscription with tagConfig
    it("RT-02: should return tagConfig when present", () => {
      const tagConfig = {
        defaultCategories: ["R&D" as const],
        defaultImportance: "high" as const,
        keywordRules: [],
      };
      const subscription = {
        id: "sub-1",
        userId: "user-1",
        sourceUrl: "https://example.com/feed.xml",
        title: "Test Feed",
        category: null,
        sourceType: "news-feed",
        status: "active",
        tagConfig,
      } as unknown as RssSubscription;

      const result = getTagConfig(subscription);
      expect(result).toEqual(tagConfig);
    });
  });

  describe("extractRssTags", () => {
    const baseSubscription: RssSubscription = {
      id: "sub-1",
      userId: "user-1",
      sourceUrl: "https://example.com/feed.xml",
      title: "Tech Blog",
      category: null,
      sourceType: "tech-blog",
      status: "active",
    };

    const baseItem: InsertRssItem = {
      subscriptionId: "sub-1",
      guidHash: "abc123",
      title: "Test Article",
      summary: "Test summary",
      content: null,
      link: null,
      publishedAt: null,
      fetchedAt: new Date(),
      status: "pending",
      metadata: {},
    };

    // RT-03: default extraction with sourceType rules
    it("RT-03: should use sourceType default rules", () => {
      const result = extractRssTags(baseItem, baseSubscription);

      expect(result.categories).toContain("R&D");
      expect(result.categories).toContain("Product");
      expect(result.importance).toBe("medium");
      expect(result.urgency).toBe("not_urgent");
    });

    // RT-04: keyword matching - product keywords
    it("RT-04: should match product keywords", () => {
      const item: InsertRssItem = {
        ...baseItem,
        title: "New Feature Launch",
        summary: "We released a new feature",
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("Product");
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    // RT-05: keyword matching - security keywords
    it("RT-05: should match security keywords and set high importance", () => {
      const item: InsertRssItem = {
        ...baseItem,
        title: "Security Patch Released",
        summary: "Fixed vulnerability CVE-2024-1234",
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("Security");
      expect(result.importance).toBe("high");
      expect(result.urgency).toBe("24h");
    });

    // RT-06: keyword matching - funding keywords
    it("RT-06: should match funding keywords", () => {
      const item: InsertRssItem = {
        ...baseItem,
        title: "Company Raises Series A",
        summary: "Investment from top VCs",
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("Funding");
    });

    // RT-07: metadata categories from RSS
    it("RT-07: should extract categories from metadata", () => {
      const item: InsertRssItem = {
        ...baseItem,
        metadata: {
          categories: ["Tech", "Developer"],
        },
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("R&D");
    });

    // RT-08: subscriptionCategory from metadata
    it("RT-08: should extract subscriptionCategory from metadata", () => {
      const item: InsertRssItem = {
        ...baseItem,
        metadata: {
          subscriptionCategory: "Security News",
        },
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("Security");
    });

    // RT-09: feedTitle inference
    it("RT-09: should infer category from feedTitle", () => {
      const item: InsertRssItem = {
        ...baseItem,
        metadata: {
          feedTitle: "Security Advisory Blog",
        },
      };

      const result = extractRssTags(item, baseSubscription);

      expect(result.categories).toContain("Security");
    });

    // RT-10: security-advisory sourceType
    it("RT-10: should use security-advisory defaults", () => {
      const subscription: RssSubscription = {
        ...baseSubscription,
        sourceType: "security-advisory",
      };

      const result = extractRssTags(baseItem, subscription);

      expect(result.categories).toContain("Security");
      expect(result.importance).toBe("high");
      expect(result.urgency).toBe("24h");
    });

    // RT-11: job-board sourceType
    it("RT-11: should use job-board defaults", () => {
      const subscription: RssSubscription = {
        ...baseSubscription,
        sourceType: "job-board",
      };

      const result = extractRssTags(baseItem, subscription);

      expect(result.categories).toContain("HR & Recruiting");
      expect(result.importance).toBe("low");
    });

    // RT-12: custom tagConfig overrides sourceType
    it("RT-12: should use custom tagConfig when provided", () => {
      const subscription: RssSubscription = {
        ...baseSubscription,
        sourceType: "tech-blog",
        tagConfig: {
          defaultCategories: ["News" as const],
          defaultImportance: "high" as const,
          keywordRules: [],
        },
      } as unknown as RssSubscription;

      const result = extractRssTags(baseItem, subscription);

      expect(result.importance).toBe("high");
      expect(result.categories).toContain("News");
    });
  });

  describe("buildTagConfigMetadata", () => {
    // RT-13: returns correct metadata structure
    it("RT-13: should return correct metadata structure", () => {
      const config = {
        defaultCategories: ["News" as const],
        defaultImportance: "high" as const,
        keywordRules: [],
      };

      const result = buildTagConfigMetadata(config);

      expect(result).toEqual({ tagConfig: config });
    });
  });
});
