/**
 * RSS OPML Tests
 *
 * Tests for packages/rss/src/opml.ts
 * Tests parseOpmlFeeds, normalizeFeedUrl
 */

import { describe, it, expect } from "vitest";
import { parseOpmlFeeds } from "@openloomi/rss";

describe("rss-opml", () => {
  describe("parseOpmlFeeds", () => {
    // RO-01: valid OPML with single feed
    it("RO-01: should parse single feed from OPML", () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My Feeds</title>
  </head>
  <body>
    <outline text="Example Feed" title="Example Feed" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds).toHaveLength(1);
      expect(result.feeds[0].sourceUrl).toBe("https://example.com/feed.xml");
      expect(result.feeds[0].title).toBe("Example Feed");
      expect(result.totalFound).toBe(1);
    });

    // RO-02: valid OPML with multiple feeds
    it("RO-02: should parse multiple feeds from OPML", () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline text="Feed 1" xmlUrl="https://example.com/feed1.xml"/>
    <outline text="Feed 2" xmlUrl="https://example.com/feed2.xml"/>
    <outline text="Feed 3" xmlUrl="https://example.com/feed3.xml"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds).toHaveLength(3);
      expect(result.totalFound).toBe(3);
    });

    // RO-03: empty OPML string
    it("RO-03: should throw error for empty OPML", () => {
      expect(() => parseOpmlFeeds("")).toThrow("Empty OPML file.");
      expect(() => parseOpmlFeeds("   ")).toThrow("Empty OPML file.");
    });

    // RO-04: OPML with no outlines
    it("RO-04: should throw error when no outlines found", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Empty</title></head>
  <body></body>
</opml>`;

      expect(() => parseOpmlFeeds(opml)).toThrow(
        "No outlines were found inside this OPML file.",
      );
    });

    // RO-05: OPML with no RSS feeds (no xmlUrl)
    it("RO-05: should throw error when no RSS feeds found", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>No Feeds</title></head>
  <body>
    <outline text="Not a feed"/>
  </body>
</opml>`;

      expect(() => parseOpmlFeeds(opml)).toThrow(
        "No RSS feeds were found inside this OPML file.",
      );
    });

    // RO-06: duplicate feeds should be skipped
    it("RO-06: should skip duplicate feeds", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Duplicates</title></head>
  <body>
    <outline text="Feed 1" xmlUrl="https://example.com/feed.xml"/>
    <outline text="Feed 1 Duplicate" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("Duplicate feed skipped.");
    });

    // RO-07: maxFeeds limit
    it("RO-07: should limit feeds to maxFeeds", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Many Feeds</title></head>
  <body>
    ${Array.from({ length: 10 }, (_, i) => `<outline text="Feed ${i}" xmlUrl="https://example.com/feed${i}.xml"/>`).join("\n    ")}
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml, { maxFeeds: 5 });
      expect(result.feeds).toHaveLength(5);
      expect(result.skipped).toHaveLength(5);
      expect(result.skipped[0].reason).toContain("Upload limit reached");
    });

    // RO-08: nested outlines
    it("RO-08: should parse feeds from nested outlines", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Nested</title></head>
  <body>
    <outline text="Category 1">
      <outline text="Feed 1" xmlUrl="https://example.com/feed1.xml"/>
    </outline>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds).toHaveLength(1);
      expect(result.feeds[0].sourceUrl).toBe("https://example.com/feed1.xml");
      expect(result.feeds[0].category).toBe("Category 1");
    });

    // RO-09: feed title from text attribute when title missing
    it("RO-09: should use text as title when title missing", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline text="Feed Title Only" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds[0].title).toBe("Feed Title Only");
    });

    // RO-10: invalid feed URL
    it("RO-10: should skip feeds with invalid URL", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Invalid</title></head>
  <body>
    <outline text="Bad Feed" xmlUrl="ftp://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds).toHaveLength(0);
      expect(result.skipped[0].reason).toBe(
        "Only HTTP/HTTPS feed URLs are supported.",
      );
    });

    // RO-11: URL hash should be removed
    it("RO-11: should remove hash from feed URL", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Hash</title></head>
  <body>
    <outline text="Feed" xmlUrl="https://example.com/feed.xml#section"/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds[0].sourceUrl).toBe("https://example.com/feed.xml");
    });

    // RO-12: whitespace in URL should be trimmed
    it("RO-12: should trim whitespace from feed URL", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Whitespace</title></head>
  <body>
    <outline text="Feed" xmlUrl="  https://example.com/feed.xml  "/>
  </body>
</opml>`;

      const result = parseOpmlFeeds(opml);
      expect(result.feeds[0].sourceUrl).toBe("https://example.com/feed.xml");
    });

    // RO-13: missing URL - empty string treated as no feed
    it("RO-13: should throw error when no RSS feeds found", () => {
      const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Missing URL</title></head>
  <body>
    <outline text="No URL" xmlUrl=""/>
  </body>
</opml>`;

      expect(() => parseOpmlFeeds(opml)).toThrow(
        "No RSS feeds were found inside this OPML file.",
      );
    });
  });
});
