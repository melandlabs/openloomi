/**
 * Telegram Adapter Unit Tests
 *
 * Tests for:
 * - markdownToTelegramHtml converter
 * - openloomiMessageToTgText utility
 * - tgMessageToopenloomiMessage utility
 */
import { describe, test, expect } from "vitest";
import { Api } from "telegram/tl";
import bigInt from "big-integer";

describe("markdownToTelegramHtml", async () => {
  const { markdownToTelegramHtml } =
    await import("@openloomi/integrations/telegram");

  test("converts plain text unchanged", async () => {
    expect(markdownToTelegramHtml("Hello world")).toBe("Hello world");
  });

  test("converts bold markdown to HTML", async () => {
    expect(markdownToTelegramHtml("**bold text**")).toBe("<b>bold text</b>");
  });

  test("converts italic markdown to HTML", async () => {
    expect(markdownToTelegramHtml("*italic text*")).toBe("<i>italic text</i>");
  });

  test("converts strikethrough markdown to HTML", async () => {
    expect(markdownToTelegramHtml("~~strikethrough~~")).toBe(
      "<s>strikethrough</s>",
    );
  });

  test("converts inline code to HTML", async () => {
    expect(markdownToTelegramHtml("`inline code`")).toBe(
      "<code>inline code</code>",
    );
  });

  test("converts code block to HTML", async () => {
    expect(markdownToTelegramHtml("```\ncode block\n```")).toBe(
      "<pre><code>code block\n</code></pre>",
    );
  });

  test("converts links to HTML anchor tags", async () => {
    expect(markdownToTelegramHtml("[link text](https://example.com)")).toBe(
      '<a href="https://example.com">link text</a>',
    );
  });

  test("handles empty string", async () => {
    expect(markdownToTelegramHtml("")).toBe("");
  });

  test("handles whitespace-only string", async () => {
    expect(markdownToTelegramHtml("   ")).toBe("");
  });

  test("escapes HTML special characters", async () => {
    expect(markdownToTelegramHtml("3 < 5 & 7 > 2")).toBe(
      "3 &lt; 5 &amp; 7 &gt; 2",
    );
  });

  test("handles multiple formatting in one string", async () => {
    const result = markdownToTelegramHtml("**bold** and *italic*");
    expect(result).toContain("<b>bold</b>");
    expect(result).toContain("<i>italic</i>");
  });
});

describe("openloomiMessageToTgText", async () => {
  const { openloomiMessageToTgText } =
    await import("@openloomi/integrations/telegram");

  test("converts plain string message", async () => {
    expect(openloomiMessageToTgText("Hello")).toBe("Hello");
  });

  test("converts message with text property", async () => {
    expect(openloomiMessageToTgText({ text: "Hello world" })).toBe(
      "Hello world",
    );
  });

  test("converts At mention to Telegram format", async () => {
    expect(openloomiMessageToTgText({ target: "username" })).toBe("@username");
  });

  test("converts nested message nodes", async () => {
    const message = {
      nodes: [
        { text: "Hello " },
        { target: "user" },
        { text: ", how are you?" },
      ],
    };
    expect(openloomiMessageToTgText(message)).toBe("Hello @user, how are you?");
  });

  test("returns empty string for unknown message type", async () => {
    expect(openloomiMessageToTgText({ unknown: "property" } as any)).toBe("");
  });
});

describe("tgMessageToopenloomiMessage", async () => {
  const { tgMessageToopenloomiMessage } =
    await import("@openloomi/integrations/telegram");

  test("converts basic text message", async () => {
    // Use 'message' property which is what the Api.Message class uses
    const tgMessage = new Api.Message({
      id: 1,
      message: "Hello world",
      date: Date.now(),
      peerId: new Api.PeerUser({ userId: bigInt(123) }),
    });

    const result = tgMessageToopenloomiMessage(tgMessage);
    expect(result).toContain("Hello world");
  });

  test("returns media placeholder for messages without text", async () => {
    const tgMessage = new Api.Message({
      id: 1,
      date: Date.now(),
      peerId: new Api.PeerUser({ userId: bigInt(123) }),
      media: new Api.MessageMediaPhoto({}),
    });

    const result = tgMessageToopenloomiMessage(tgMessage);
    expect(result).toContain("[Media content]");
  });

  test("extracts @mention entities", async () => {
    const tgMessage = new Api.Message({
      id: 1,
      message: "Hello @username",
      date: Date.now(),
      peerId: new Api.PeerUser({ userId: bigInt(123) }),
      entities: [
        new Api.MessageEntityMention({
          offset: 6,
          length: 9,
        }),
      ],
    });

    const result = tgMessageToopenloomiMessage(tgMessage);
    // Result is ['Hello @username', { target: 'username' }]
    expect(result).toContain("Hello @username");
    expect(result).toContainEqual({ target: "username" });
  });
});
