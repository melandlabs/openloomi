/**
 * iMessage Integration Unit Tests
 *
 * Real sending tests (macOS only, requires environment variables):
 *   RUN_IMESSAGE_SEND=1 IMESSAGE_TEST_CHAT_ID="iMessage;-;+86yourphonenumber" pnpm test:unit imessage.test.ts -t "Real send single text message"
 * Or using phone number only:
 *   RUN_IMESSAGE_SEND=1 IMESSAGE_TEST_CHAT_ID="+8613800138000" pnpm test:unit imessage.test.ts -t "Real send single text message"
 */
import { describe, test, expect } from "vitest";

describe("iMessage Utility Functions", () => {
  test("parseIMessageChatId parses phone numbers", async () => {
    const { parseIMessageChatId } = await import("@/lib/integrations/imessage");
    expect(parseIMessageChatId("iMessage;-;+8613800138000")).toEqual({
      phoneNumber: "+8613800138000",
    });
    expect(parseIMessageChatId("+8613800138000")).toEqual({
      phoneNumber: "+8613800138000",
    });
  });

  test("parseIMessageChatId parses email addresses", async () => {
    const { parseIMessageChatId } = await import("@/lib/integrations/imessage");
    expect(parseIMessageChatId("iMessage;-;user@example.com")).toEqual({
      email: "user@example.com",
    });
  });

  test("formatIMessageChatId always returns iMessage; prefix", async () => {
    const { formatIMessageChatId } =
      await import("@/lib/integrations/imessage");
    // Already in iMessage format, return as-is
    expect(formatIMessageChatId("iMessage;-;+8615928069834")).toBe(
      "iMessage;-;+8615928069834",
    );
    expect(formatIMessageChatId("iMessage;+;chat123")).toBe(
      "iMessage;+;chat123",
    );
    // SMS; replaced with iMessage;-;
    expect(formatIMessageChatId("SMS;+8615928069834")).toBe(
      "iMessage;-;+8615928069834",
    );
    // Plain phone/email completed with iMessage;-;
    expect(formatIMessageChatId("user@example.com")).toBe(
      "iMessage;-;user@example.com",
    );
    expect(formatIMessageChatId("+8615928069834")).toBe(
      "iMessage;-;+8615928069834",
    );
  });
});

describe("iMessage Sending", () => {
  const allowRealSend =
    process.platform === "darwin" &&
    (process.env.RUN_IMESSAGE_SEND === "1" ||
      process.env.RUN_IMESSAGE_SEND === "true");
  const chatId = process.env.IMESSAGE_TEST_CHAT_ID?.trim();

  test.skipIf(!allowRealSend)(
    "Real send single text message (requires macOS + RUN_IMESSAGE_SEND=1 + IMESSAGE_TEST_CHAT_ID)",
    { timeout: 15000 },
    async () => {
      if (!chatId) {
        throw new Error(
          'Real sending test requires setting IMESSAGE_TEST_CHAT_ID, e.g.: IMESSAGE_TEST_CHAT_ID="iMessage;-;+8613800138000"',
        );
      }

      const { IMessageAdapter } = await import("@/lib/integrations/imessage");
      const adapter = new IMessageAdapter({ botId: "imessage-send-test" });
      const text = `[openloomi] iMessage unit test ${new Date().toISOString()}`;

      await adapter.sendMessage("private", chatId, text);
      await adapter.kill();

      // Success if no exception is thrown
      expect(true).toBe(true);
    },
  );
});
