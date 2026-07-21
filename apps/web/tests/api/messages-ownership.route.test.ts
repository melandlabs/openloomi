import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const authMocks = vi.hoisted(() => ({
  authenticateCloudRequest: vi.fn(),
}));

vi.mock("@/lib/auth/cloud-auth", () => authMocks);

const dbMocks = vi.hoisted(() => ({
  getBotWithAccountById: vi.fn(),
  getContact: vi.fn(),
  getContactsByName: vi.fn(),
  getContactsBySearchTerm: vi.fn(),
  getContactByIMessageIdentifier: vi.fn(),
  updateIntegrationAccount: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => dbMocks);

const credentialMocks = vi.hoisted(() => ({
  getBotCredentials: vi.fn(),
}));

vi.mock("@/lib/bots/token", () => credentialMocks);

const connectorMocks = vi.hoisted(() => ({
  constructSlackAdapter: vi.fn(),
  sendMessages: vi.fn(),
  kill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/integrations/slack", () => ({
  SlackAdapter: class {
    constructor(options: unknown) {
      connectorMocks.constructSlackAdapter(options);
    }

    sendMessages = connectorMocks.sendMessages;
    kill = connectorMocks.kill;
  },
}));

vi.mock("@/lib/integrations/providers/file-ingester", () => ({
  fileIngester: {},
}));

vi.mock("@/lib/integrations/telegram/client-registry", () => ({
  telegramClientRegistry: {},
}));

import { POST } from "@/app/api/messages/route";

describe("POST /api/messages bot ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.authenticateCloudRequest.mockResolvedValue({
      id: "requesting-user",
      email: "requester@example.com",
    });

    // Emulate an existing bot owned by somebody else. A correctly scoped
    // lookup must not return it; an id-only lookup would continue to Slack.
    dbMocks.getBotWithAccountById.mockImplementation(
      async ({ userId }: { userId?: string }) =>
        userId === "requesting-user"
          ? undefined
          : {
              id: "foreign-bot",
              userId: "other-user",
              adapter: "slack",
            },
    );
    dbMocks.getContact.mockResolvedValue({
      botId: "foreign-bot",
      contactId: "foreign-channel",
    });
    dbMocks.getContactsByName.mockResolvedValue([]);
    dbMocks.getContactsBySearchTerm.mockResolvedValue([]);
    credentialMocks.getBotCredentials.mockResolvedValue("foreign-secret");
  });

  test("rejects a cross-user bot without invoking its connector", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      new NextRequest("http://localhost/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: "foreign-bot",
          recipients: ["Foreign channel"],
          message: "This must not be sent",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: false,
      error: "No valid account provided for the reply",
    });
    expect(dbMocks.getBotWithAccountById).toHaveBeenCalledWith({
      id: "foreign-bot",
      userId: "requesting-user",
    });
    expect(credentialMocks.getBotCredentials).not.toHaveBeenCalled();
    expect(connectorMocks.constructSlackAdapter).not.toHaveBeenCalled();
    expect(connectorMocks.sendMessages).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
