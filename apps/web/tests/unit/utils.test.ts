import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cn,
  fetcher,
  fetchWithErrorHandlers,
  getLocalStorage,
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
  sanitizeText,
  convertToUIMessages,
  getTextFromMessage,
  getCurrentTimestamp,
  createPageUrl,
  judgeGuest,
  formatToLocalTime,
  getCurrentYearMonth,
  formatBytes,
  filterToolCallText,
} from "@/lib/utils";
import { AppError } from "@openloomi/shared/errors";
import type { DBMessage } from "@/lib/db/schema";
import type { ChatMessage } from "@openloomi/shared";
import { formatISO } from "date-fns";

const uuidRegex =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

describe("utils", () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalLocalStorage = (global as any).localStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    const globalAny = global as typeof globalThis & {
      window?: typeof globalThis.window;
      localStorage?: typeof globalThis.localStorage;
    };
    globalAny.window = originalWindow;
    globalAny.localStorage = originalLocalStorage;
  });

  it("merges class names with tailwind precedence", () => {
    const merged = cn("p-2", "text-sm", "p-4", { hidden: true });
    expect(merged.includes("p-2")).toBe(false);
    expect(merged.split(" ")).toEqual(
      expect.arrayContaining(["p-4", "text-sm", "hidden"]),
    );
  });

  it("fetcher returns parsed data on success", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    const result = await fetcher("/api/test");

    expect(global.fetch).toHaveBeenCalledWith("/api/test", {
      credentials: "include",
      headers: {
        "x-user-timezone": expect.any(String),
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("fetcher throws AppError on API error", async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: "bad_request:api",
        cause: "oops",
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(fetcher("/api/error")).rejects.toBeInstanceOf(AppError);
    expect(mockResponse.json).toHaveBeenCalled();
  });

  it("fetchWithErrorHandlers returns response on success", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    const response = await fetchWithErrorHandlers("/api/ok");

    expect(response.status).toBe(200);
  });

  it("fetchWithErrorHandlers throws offline error when navigator offline", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const navigatorSpy = vi
      .spyOn(globalThis, "navigator", "get")
      .mockReturnValue({ onLine: false } as any);

    await expect(fetchWithErrorHandlers("/api/offline")).rejects.toMatchObject({
      surface: "chat",
      type: "offline",
    });
    navigatorSpy.mockRestore();
  });

  it("fetchWithErrorHandlers throws AppError on bad response", async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: "bad_request:chat",
        cause: "Bad request",
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(fetchWithErrorHandlers("/api/bad")).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("reads parsed values from localStorage", () => {
    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    };
    const globalAny = global as typeof globalThis & {
      window?: typeof globalThis.window;
      localStorage?: typeof globalThis.localStorage;
    };
    globalAny.window = {} as Window & typeof globalThis;
    globalAny.localStorage = localStorageMock as unknown as Storage;
    localStorageMock.setItem("key", JSON.stringify(["a", "b"]));

    expect(getLocalStorage("key")).toEqual(["a", "b"]);
  });

  it("generates UUIDs with v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(uuidRegex);
  });

  it("returns most recent user message", () => {
    const messages = [
      { id: "1", role: "assistant" },
      { id: "2", role: "user" },
      { id: "3", role: "user" },
    ] as any[];

    expect(getMostRecentUserMessage(messages)?.id).toBe("3");
  });

  it("returns trailing message id", () => {
    const messages = [
      { id: "1", role: "assistant" },
      { id: "2", role: "assistant" },
    ] as any[];

    expect(
      getTrailingMessageId({
        messages,
      }),
    ).toBe("2");
  });

  it("sanitizes function call markers", () => {
    expect(sanitizeText("hello<has_function_call>world")).toBe("helloworld");
  });

  it("converts DB messages to UI messages", () => {
    const createdAt = new Date("2024-02-01T00:00:00Z");
    const messages: DBMessage[] = [
      {
        id: "m1",
        chatId: "c1",
        role: "user",
        parts: [{ type: "text", text: "hi" }] as any,
        attachments: [],
        createdAt,
        metadata: undefined,
      },
    ];

    const result = convertToUIMessages(messages);
    const formatted = formatISO(createdAt);
    expect(result[0]).toMatchObject({
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
      metadata: { createdAt: formatted },
    });
  });

  it("extracts text parts from chat message", () => {
    const message = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: " World" },
        { type: "tool-call", text: "ignored" },
      ],
    } as unknown as ChatMessage;

    expect(getTextFromMessage(message)).toBe("Hello World");
  });

  it("returns current timestamp in seconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    expect(getCurrentTimestamp()).toBe(5);
  });

  it("creates kebab-cased page urls", () => {
    expect(createPageUrl("My New Page")).toBe("/my-new-page");
  });

  it("identifies guest sessions", () => {
    const session = { user: { type: "guest" } } as any;
    expect(judgeGuest(session)).toBe(true);
  });

  it("formats to local time using toLocaleString", () => {
    const spy = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("localized");

    expect(formatToLocalTime("2024-02-01T00:00:00Z")).toBe("localized");
    spy.mockRestore();
  });

  it("returns current year and month from system time", () => {
    vi.setSystemTime(new Date("2024-06-15T00:00:00Z"));
    expect(getCurrentYearMonth()).toEqual({ year: 2024, month: 6 });
    vi.useRealTimers();
  });

  it("formats bytes with units and guards invalid values", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1_048_576, 2)).toBe("1 MB");
  });
});

describe("filterToolCallText", () => {
  it("should strip malformed XML tool calls", () => {
    const input =
      '<invoke name="mcp_business-tools modifyInsight">content</invoke>';
    expect(filterToolCallText(input)).toBe("");
  });

  it("should strip tool call with complex content", () => {
    const input = `<invoke name="mcp_business-tools modifyInsight"> <parametername="insightId">test</parametername></invoke>`;
    expect(filterToolCallText(input)).toBe("");
  });

  it("should handle chat output prefix", () => {
    const input =
      'chat output: \n<invoke name="mcp_business-tools modifyInsight">...</invoke>\n\nsome real text';
    expect(filterToolCallText(input)).toBe("some real text");
  });

  it("should handle real MiniMax malformed output", () => {
    const input = `chat output:
<invoke name="mcp_business-tools modifyInsight"> <parametername="insightId">0cblc9de-ece5-463d-8255-cel9ac6d19c</parametername="updates">{"timeline": [{"time": 17762636000000,"summary":"Candidate report updated"}]}</invoke>

some real response text`;
    expect(filterToolCallText(input)).toBe("some real response text");
  });

  it("should return empty string for input with only malformed tool calls", () => {
    const input = '<invoke name="test">...</invoke>';
    expect(filterToolCallText(input)).toBe("");
  });

  it("should preserve normal text without tool calls", () => {
    const input = "This is a normal message";
    expect(filterToolCallText(input)).toBe(input);
  });
});
