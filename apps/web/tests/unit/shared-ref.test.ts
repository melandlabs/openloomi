/**
 * Shared Ref Tests
 *
 * Tests for packages/shared/src/ref.ts
 * Tests parseContentWithRefs, getRefMarkerRangeBeforeCursor, buildRefMarker, extractRefsFromContent
 */

import { describe, it, expect } from "vitest";
import {
  parseContentWithRefs,
  getRefMarkerRangeBeforeCursor,
  buildRefMarker,
  extractRefsFromContent,
} from "@openloomi/shared/ref";

describe("shared-ref", () => {
  describe("parseContentWithRefs", () => {
    // SR-01: plain text without refs
    it("SR-01: should return plain text as single text segment", () => {
      const result = parseContentWithRefs("Hello world");
      expect(result).toEqual([{ type: "text", value: "Hello world" }]);
    });

    // SR-02: null/undefined input
    it("SR-02: should handle null input", () => {
      const result = parseContentWithRefs(null as any);
      expect(result).toEqual([{ type: "text", value: "" }]);
    });

    it("SR-03: should handle undefined input", () => {
      const result = parseContentWithRefs(undefined as any);
      expect(result).toEqual([{ type: "text", value: "" }]);
    });

    // SR-04: single ref marker
    it("SR-04: should parse single ref marker", () => {
      const result = parseContentWithRefs("Hello [[ref:people:Alice]] world");
      expect(result).toEqual([
        { type: "text", value: "Hello " },
        { type: "ref", kind: "people", label: "Alice" },
        { type: "text", value: " world" },
      ]);
    });

    // SR-05: multiple refs of same type
    it("SR-05: should parse multiple refs", () => {
      const result = parseContentWithRefs(
        "Contact [[ref:people:Alice]] and [[ref:people:Bob]]",
      );
      expect(result).toEqual([
        { type: "text", value: "Contact " },
        { type: "ref", kind: "people", label: "Alice" },
        { type: "text", value: " and " },
        { type: "ref", kind: "people", label: "Bob" },
      ]);
    });

    // SR-06: mixed content with different ref types
    it("SR-06: should parse mixed ref types", () => {
      const result = parseContentWithRefs(
        "Task [[ref:task:123]] in [[ref:channel:general]]",
      );
      expect(result).toEqual([
        { type: "text", value: "Task " },
        { type: "ref", kind: "task", label: "123" },
        { type: "text", value: " in " },
        { type: "ref", kind: "channel", label: "general" },
      ]);
    });

    // SR-07: ref at start of content
    it("SR-07: should handle ref at start", () => {
      const result = parseContentWithRefs("[[ref:people:Alice]] says hello");
      expect(result).toEqual([
        { type: "ref", kind: "people", label: "Alice" },
        { type: "text", value: " says hello" },
      ]);
    });

    // SR-08: ref at end of content
    it("SR-08: should handle ref at end", () => {
      const result = parseContentWithRefs("Hello [[ref:people:Alice]]");
      expect(result).toEqual([
        { type: "text", value: "Hello " },
        { type: "ref", kind: "people", label: "Alice" },
      ]);
    });

    // SR-09: consecutive refs without space
    it("SR-09: should handle consecutive refs", () => {
      const result = parseContentWithRefs("[[ref:people:A]][[ref:people:B]]");
      expect(result).toEqual([
        { type: "ref", kind: "people", label: "A" },
        { type: "ref", kind: "people", label: "B" },
      ]);
    });

    // SR-10: empty string
    it("SR-10: should return empty text for empty string", () => {
      const result = parseContentWithRefs("");
      expect(result).toEqual([{ type: "text", value: "" }]);
    });

    // SR-11: only ref
    it("SR-11: should handle content with only ref", () => {
      const result = parseContentWithRefs("[[ref:task:123]]");
      expect(result).toEqual([{ type: "ref", kind: "task", label: "123" }]);
    });

    // SR-12: event ref with id|title format
    it("SR-12: should parse event ref", () => {
      const result = parseContentWithRefs("Event [[ref:event:123|Meeting]]");
      expect(result).toEqual([
        { type: "text", value: "Event " },
        { type: "ref", kind: "event", label: "123|Meeting" },
      ]);
    });
  });

  describe("getRefMarkerRangeBeforeCursor", () => {
    // SR-13: ref at end of content
    it("SR-13: should find ref marker at end", () => {
      const content = "Hello [[ref:people:Alice]]";
      const cursor = content.length;
      const result = getRefMarkerRangeBeforeCursor(content, cursor);
      expect(result).toEqual({ start: 6, end: cursor });
    });

    // SR-14: no ref before cursor
    it("SR-14: should return null when no ref before cursor", () => {
      const content = "Hello [[ref:people:Alice]]";
      const cursor = 5; // cursor at "Hello"
      const result = getRefMarkerRangeBeforeCursor(content, cursor);
      expect(result).toBeNull();
    });

    // SR-15: cursor at start
    it("SR-15: should return null when cursor at start", () => {
      const content = "Hello [[ref:people:Alice]]";
      const result = getRefMarkerRangeBeforeCursor(content, 0);
      expect(result).toBeNull();
    });

    // SR-16: cursor before ref
    it("SR-16: should return null when cursor before ref", () => {
      const content = "Hello [[ref:people:Alice]]";
      const cursor = 5; // after "Hello "
      const result = getRefMarkerRangeBeforeCursor(content, cursor);
      expect(result).toBeNull();
    });

    // SR-17: multiple refs, cursor after last
    it("SR-17: should find last ref when cursor after it", () => {
      const content = "[[ref:people:A]] text [[ref:people:B]]";
      const cursor = content.length;
      const result = getRefMarkerRangeBeforeCursor(content, cursor);
      expect(result).toBeDefined();
      expect(content.slice(result?.start, result?.end)).toBe(
        "[[ref:people:B]]",
      );
    });

    // SR-18: cursor in middle of ref
    it("SR-18: should return null when cursor in middle of ref", () => {
      const content = "Hello [[ref:people:Alice]]";
      const cursor = 10; // middle of the ref marker
      const result = getRefMarkerRangeBeforeCursor(content, cursor);
      expect(result).toBeNull();
    });
  });

  describe("buildRefMarker", () => {
    // SR-19: people kind
    it("SR-19: should build people ref marker", () => {
      const result = buildRefMarker("people", "Alice");
      expect(result).toBe("[[ref:people:Alice]]");
    });

    // SR-20: task kind
    it("SR-20: should build task ref marker", () => {
      const result = buildRefMarker("task", "123");
      expect(result).toBe("[[ref:task:123]]");
    });

    // SR-21: channel kind
    it("SR-21: should build channel ref marker", () => {
      const result = buildRefMarker("channel", "general");
      expect(result).toBe("[[ref:channel:general]]");
    });

    // SR-22: event kind
    it("SR-22: should build event ref marker", () => {
      const result = buildRefMarker("event", "456");
      expect(result).toBe("[[ref:event:456]]");
    });

    // SR-23: file kind
    it("SR-23: should build file ref marker", () => {
      const result = buildRefMarker("file", "document.pdf");
      expect(result).toBe("[[ref:file:document.pdf]]");
    });

    // SR-24: label with special characters - closing bracket
    it("SR-24: should escape closing bracket in label", () => {
      const result = buildRefMarker("people", "Alice]Bob");
      expect(result).toBe("[[ref:people:AliceBob]]");
    });

    // SR-25: label with multiple closing brackets
    it("SR-25: should escape multiple closing brackets", () => {
      const result = buildRefMarker("people", "A]B]C");
      expect(result).toBe("[[ref:people:ABC]]");
    });

    // SR-26: empty label
    it("SR-26: should handle empty label", () => {
      const result = buildRefMarker("people", "");
      expect(result).toBe("[[ref:people:]]");
    });
  });

  describe("extractRefsFromContent", () => {
    // SR-27: no refs in content
    it("SR-27: should return empty arrays for no refs", () => {
      const result = extractRefsFromContent("Hello world");
      expect(result).toEqual({
        people: [],
        taskIds: [],
        channels: [],
        eventIds: [],
      });
    });

    // SR-28: single people ref
    it("SR-28: should extract people ref", () => {
      const result = extractRefsFromContent("Hello [[ref:people:Alice]]");
      expect(result.people).toEqual([{ name: "Alice" }]);
      expect(result.taskIds).toEqual([]);
      expect(result.channels).toEqual([]);
      expect(result.eventIds).toEqual([]);
    });

    // SR-29: multiple people refs
    it("SR-29: should extract multiple people refs", () => {
      const result = extractRefsFromContent(
        "[[ref:people:Alice]] and [[ref:people:Bob]]",
      );
      expect(result.people).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    });

    // SR-30: task refs
    it("SR-30: should extract task refs", () => {
      const result = extractRefsFromContent(
        "Task [[ref:task:123]] and [[ref:task:456]]",
      );
      expect(result.taskIds).toEqual(["123", "456"]);
    });

    // SR-31: task ref with manual prefix
    it("SR-31: should extract task ref with manual prefix", () => {
      const result = extractRefsFromContent("Task [[ref:task:manual:789]]");
      expect(result.taskIds).toEqual(["manual:789"]);
    });

    // SR-32: channel ref without platform
    it("SR-32: should extract channel ref without platform", () => {
      const result = extractRefsFromContent("Channel [[ref:channel:general]]");
      expect(result.channels).toEqual([{ name: "general" }]);
    });

    // SR-33: channel ref with platform
    it("SR-33: should extract channel ref with platform", () => {
      const result = extractRefsFromContent(
        "Channel [[ref:channel:general:slack]]",
      );
      expect(result.channels).toEqual([{ name: "general", platform: "slack" }]);
    });

    // SR-34: event ref without title
    it("SR-34: should extract event ref without title", () => {
      const result = extractRefsFromContent("Event [[ref:event:123]]");
      expect(result.eventIds).toEqual(["123"]);
    });

    // SR-35: event ref with title
    it("SR-35: should extract event ref with title", () => {
      const result = extractRefsFromContent("Event [[ref:event:123|Meeting]]");
      expect(result.eventIds).toEqual(["123"]);
    });

    // SR-36: event ref with pipe in title
    it("SR-36: should handle event ref with multiple pipes", () => {
      const result = extractRefsFromContent("Event [[ref:event:123|A|B]]");
      expect(result.eventIds).toEqual(["123"]);
    });

    // SR-37: duplicate event refs - should not duplicate
    it("SR-37: should not duplicate event ids", () => {
      const result = extractRefsFromContent(
        "[[ref:event:123]] and [[ref:event:123]]",
      );
      expect(result.eventIds).toEqual(["123"]);
    });

    // SR-38: mixed ref types
    it("SR-38: should extract all ref types", () => {
      const result = extractRefsFromContent(
        "[[ref:people:Alice]] [[ref:task:123]] [[ref:channel:general:slack]] [[ref:event:456|Meeting]]",
      );
      expect(result.people).toEqual([{ name: "Alice" }]);
      expect(result.taskIds).toEqual(["123"]);
      expect(result.channels).toEqual([{ name: "general", platform: "slack" }]);
      expect(result.eventIds).toEqual(["456"]);
    });

    // SR-39: empty string
    it("SR-39: should handle empty string", () => {
      const result = extractRefsFromContent("");
      expect(result).toEqual({
        people: [],
        taskIds: [],
        channels: [],
        eventIds: [],
      });
    });
  });
});
