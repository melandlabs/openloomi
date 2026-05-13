import { describe, test, expect, it } from "vitest";
import { buildRssItemInserts, type RssSubscription } from "@openloomi/rss";

const baseSubscription: RssSubscription = {
  id: "sub-1",
  userId: "user-1",
  sourceUrl: "https://example.com/feed.xml",
  status: "active",
  sourceType: "custom",
  title: null,
  category: null,
};

// Helper to test parseDate indirectly via buildRssItemInserts
function extractDateFromItem(item: any): Date | null {
  return item.publishedAt;
}

describe("buildRssItemInserts", () => {
  test("generates stable hashes and metadata", () => {
    const inserts = buildRssItemInserts({
      subscription: baseSubscription,
      feedTitle: "Example Feed",
      items: [
        {
          title: "Hello",
          link: "https://example.com/hello",
          guid: "guid-123",
          isoDate: "2024-01-01T00:00:00.000Z",
          categories: ["web3"],
          contentSnippet: "Summary",
          content: "<p>Summary</p>",
        },
      ],
    });

    expect(inserts.length).toBe(1);
    const [item] = inserts;
    expect(item.subscriptionId).toBe(baseSubscription.id);
    expect(item.guidHash.length).toBeGreaterThan(10);
    expect(item.metadata?.categories).toEqual(["web3"]);
    expect(item.metadata?.feedTitle).toBe("Example Feed");
    expect(item.status).toBe("pending");
    expect(item.link).toBe("https://example.com/hello");
  });

  test("respects limit when truncating items", () => {
    const manyItems = Array.from({ length: 50 }, (_, index) => ({
      title: `Item ${index}`,
      guid: `guid-${index}`,
    }));

    const inserts = buildRssItemInserts({
      subscription: baseSubscription,
      items: manyItems,
      limit: 5,
    });

    expect(inserts.length).toBe(5);
    // Check all guidHash are unique
    expect(new Set(inserts.map((item) => item.guidHash)).size).toBe(5);
  });

  describe("parseDate (via buildRssItemInserts)", () => {
    // RN-01: ISO 8601 date format
    it("RN-01: should parse ISO 8601 date format", () => {
      const inserts = buildRssItemInserts({
        subscription: baseSubscription,
        items: [
          {
            title: "Test",
            isoDate: "2024-01-15T10:30:00.000Z",
          },
        ],
      });
      expect(inserts[0].publishedAt).toBeInstanceOf(Date);
      expect(inserts[0].publishedAt?.toISOString()).toContain("2024-01-15");
    });

    // RN-02: RFC 2822 date format (pubDate)
    it("RN-02: should parse RFC 2822 date format", () => {
      const inserts = buildRssItemInserts({
        subscription: baseSubscription,
        items: [
          {
            title: "Test",
            pubDate: "Mon, 15 Jan 2024 10:30:00 +0000",
          },
        ],
      });
      expect(inserts[0].publishedAt).toBeInstanceOf(Date);
    });

    // RN-03: null date
    it("RN-03: should handle null date", () => {
      const inserts = buildRssItemInserts({
        subscription: baseSubscription,
        items: [
          {
            title: "Test",
          },
        ],
      });
      expect(inserts[0].publishedAt).toBeNull();
    });

    // RN-04: invalid date
    it("RN-04: should handle invalid date", () => {
      const inserts = buildRssItemInserts({
        subscription: baseSubscription,
        items: [
          {
            title: "Test",
            isoDate: "not-a-date",
          },
        ],
      });
      expect(inserts[0].publishedAt).toBeNull();
    });

    // RN-05: empty string date
    it("RN-05: should handle empty string date", () => {
      const inserts = buildRssItemInserts({
        subscription: baseSubscription,
        items: [
          {
            title: "Test",
            isoDate: "",
          },
        ],
      });
      expect(inserts[0].publishedAt).toBeNull();
    });
  });
});
