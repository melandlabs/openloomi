import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const sessionMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => sessionMocks);

const dbMocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getUserTypeForService: vi.fn(),
  getUserContacts: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => dbMocks);

const messageMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/bots/message-service", () => messageMocks);

import { GET as queryContacts } from "@/app/api/contacts/route";
import { POST as sendMessage } from "@/app/api/messages/route";
import { generateToken } from "@/lib/auth/remote-auth-utils";

const AUTH_SECRET = "connector-route-test-secret";
const originalAuthSecret = process.env.AUTH_SECRET;

function bearerRequest(
  url: string,
  token: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers).entries()),
      Authorization: `Bearer ${token}`,
    },
  });
}

describe("connector-facing API bearer authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = AUTH_SECRET;
    sessionMocks.auth.mockResolvedValue(null);
    dbMocks.getUserById.mockResolvedValue({
      id: "user-from-bearer",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
    });
    dbMocks.getUserTypeForService.mockResolvedValue("regular");
    dbMocks.getUserContacts.mockResolvedValue([]);
    messageMocks.sendMessage.mockResolvedValue({ success: true });
  });

  afterAll(() => {
    if (originalAuthSecret === undefined) {
      Reflect.deleteProperty(process.env, "AUTH_SECRET");
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  });

  test("queries contacts with a valid signed bearer token", async () => {
    const token = generateToken("user-from-bearer", "ada@example.com");
    const request = bearerRequest(
      "http://localhost/api/contacts?name=Ada&page=1&pageSize=10",
      token,
    );

    const response = await queryContacts(request);

    expect(response.status).toBe(200);
    expect(dbMocks.getUserById).toHaveBeenCalledWith("user-from-bearer");
    expect(dbMocks.getUserTypeForService).toHaveBeenCalledWith(
      "user-from-bearer",
    );
    expect(dbMocks.getUserContacts).toHaveBeenCalledWith("user-from-bearer");
    expect(sessionMocks.auth).not.toHaveBeenCalled();
  });

  test("rejects a bearer token with a forged signature", async () => {
    const token = generateToken("user-from-bearer", "ada@example.com");
    const [payload] = token.split(".");
    const request = bearerRequest(
      "http://localhost/api/contacts",
      `${payload}.forged-signature`,
    );

    const response = await queryContacts(request);

    expect(response.status).toBe(401);
    expect(dbMocks.getUserById).not.toHaveBeenCalled();
    expect(dbMocks.getUserContacts).not.toHaveBeenCalled();
    expect(sessionMocks.auth).not.toHaveBeenCalled();
  });

  test("rejects a valid bearer token when its database user is missing", async () => {
    dbMocks.getUserById.mockResolvedValue(null);
    const token = generateToken("missing-user", "missing@example.com");
    const request = bearerRequest("http://localhost/api/contacts", token);

    const response = await queryContacts(request);

    expect(response.status).toBe(401);
    expect(dbMocks.getUserById).toHaveBeenNthCalledWith(1, "missing-user");
    expect(dbMocks.getUserById).toHaveBeenNthCalledWith(
      2,
      "cloud_missing-user",
    );
    expect(dbMocks.getUserContacts).not.toHaveBeenCalled();
  });

  test("rejects a contacts request without authentication", async () => {
    const response = await queryContacts(
      new NextRequest("http://localhost/api/contacts"),
    );

    expect(response.status).toBe(401);
    expect(sessionMocks.auth).toHaveBeenCalledOnce();
    expect(dbMocks.getUserContacts).not.toHaveBeenCalled();
  });

  test("sends with a valid signed bearer token and preserves subject", async () => {
    const token = generateToken("user-from-bearer", "ada@example.com");
    const request = bearerRequest("http://localhost/api/messages", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        recipients: ["ada@example.com"],
        message: "Hello",
        subject: "Greeting",
      }),
    });

    const response = await sendMessage(request);

    expect(response.status).toBe(200);
    expect(messageMocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        recipients: ["ada@example.com"],
        message: "Hello",
        subject: "Greeting",
      }),
      "user-from-bearer",
    );
  });

  test("rejects an unauthenticated send before parsing or dispatching", async () => {
    const response = await sendMessage(
      new NextRequest("http://localhost/api/messages", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(sessionMocks.auth).toHaveBeenCalledOnce();
    expect(messageMocks.sendMessage).not.toHaveBeenCalled();
  });
});
