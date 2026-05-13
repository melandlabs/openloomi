/**
 * Integration Interfaces Unit Tests
 *
 * Tests for core interfaces in @openloomi/integrations
 */
import { describe, test, expect, vi } from "vitest";
import type {
  BaileysAuthStateProvider,
  InboundMessageHandler,
  ClientRegistry,
  CredentialStore,
  ConfigProvider,
} from "@openloomi/integrations/core";

describe("BaileysAuthStateProvider", () => {
  test("should be a valid interface", () => {
    const mockProvider: BaileysAuthStateProvider = {
      createAuthState: vi.fn().mockResolvedValue({
        creds: { me: { id: "test" } } as any,
        keys: {
          get: vi.fn(),
          set: vi.fn(),
          clear: vi.fn(),
        },
      }),
    };

    expect(mockProvider.createAuthState).toBeDefined();
  });

  test("createAuthState should return authentication state", async () => {
    const mockState = {
      creds: { me: { id: "test-user" } } as any,
      keys: {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn(),
      },
    };

    const mockProvider: BaileysAuthStateProvider = {
      createAuthState: vi.fn().mockResolvedValue(mockState),
    };

    const result = await mockProvider.createAuthState("session-123");
    expect(result).toBeDefined();
    expect(result.creds).toBeDefined();
  });
});

describe("InboundMessageHandler", () => {
  test("should be a valid function type", () => {
    const handler: InboundMessageHandler = vi.fn().mockResolvedValue(undefined);

    expect(handler).toBeDefined();
  });

  test("should accept valid message event", async () => {
    const handler: InboundMessageHandler = vi.fn().mockResolvedValue(undefined);

    await handler({
      platform: "whatsapp",
      accountId: "acc-123",
      message: {
        chatId: "chat-456",
        msgId: "msg-789",
        senderId: "sender-123",
        senderName: "Test User",
        text: "Hello",
        chatType: "p2p",
        raw: { someData: true },
      },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "whatsapp",
        accountId: "acc-123",
        message: expect.objectContaining({
          chatId: "chat-456",
          msgId: "msg-789",
          senderId: "sender-123",
          text: "Hello",
          chatType: "p2p",
        }),
      }),
    );
  });

  test("should handle group messages", async () => {
    const handler: InboundMessageHandler = vi.fn().mockResolvedValue(undefined);

    await handler({
      platform: "weixin",
      accountId: "acc-123",
      message: {
        chatId: "group-456",
        msgId: "msg-789",
        senderId: "sender-123",
        senderName: "Group User",
        text: "Hello group",
        chatType: "group",
      },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          chatType: "group",
        }),
      }),
    );
  });

  test("should work without optional senderName", async () => {
    const handler: InboundMessageHandler = vi.fn().mockResolvedValue(undefined);

    await handler({
      platform: "telegram",
      accountId: "acc-123",
      message: {
        chatId: "chat-456",
        msgId: "msg-789",
        senderId: "sender-123",
        text: "Hello",
        chatType: "p2p",
      },
    });

    // senderName is optional, so it should not be present in the message object
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "telegram",
        accountId: "acc-123",
        message: expect.not.objectContaining({ senderName: expect.anything() }),
      }),
    );
  });
});

describe("ClientRegistry", () => {
  test("should be a valid interface", () => {
    const mockRegistry: ClientRegistry = {
      registerClient: vi.fn(),
      unregisterClient: vi.fn(),
      getClientBySessionKey: vi.fn().mockReturnValue(undefined),
    };

    expect(mockRegistry.registerClient).toBeDefined();
    expect(mockRegistry.getClientBySessionKey).toBeDefined();
  });

  test("registerClient should register a client", () => {
    const mockRegistry: ClientRegistry = {
      registerClient: vi.fn(),
      unregisterClient: vi.fn(),
      getClientBySessionKey: vi.fn().mockReturnValue(undefined),
    };

    const mockClient = { id: "test-client" } as any;
    mockRegistry.registerClient("session-1", mockClient);

    expect(mockRegistry.registerClient).toHaveBeenCalledWith(
      "session-1",
      mockClient,
    );
  });

  test("getClientBySessionKey should return registered client", () => {
    const mockClient = { id: "test-client" } as any;
    const mockRegistry: ClientRegistry = {
      registerClient: vi.fn(),
      unregisterClient: vi.fn(),
      getClientBySessionKey: vi.fn().mockReturnValue(mockClient),
    };

    const result = mockRegistry.getClientBySessionKey("session-1");
    expect(result).toBe(mockClient);
  });
});

describe("ConfigProvider", () => {
  test("should be a valid interface", () => {
    const mockConfig: ConfigProvider = {
      get: vi.fn().mockReturnValue("value"),
      getRequired: vi.fn().mockReturnValue("required-value"),
    };

    expect(mockConfig.get).toBeDefined();
    expect(mockConfig.getRequired).toBeDefined();
  });

  test("get should return undefined for missing key", () => {
    const mockConfig: ConfigProvider = {
      get: vi.fn().mockReturnValue(undefined),
      getRequired: vi.fn(),
    };

    expect(mockConfig.get("MISSING_KEY")).toBeUndefined();
  });

  test("getRequired should throw for missing key", () => {
    const mockConfig: ConfigProvider = {
      get: vi.fn().mockReturnValue(undefined),
      getRequired: vi.fn().mockImplementation((key) => {
        throw new Error(`Config key "${key}" not configured`);
      }),
    };

    expect(() => mockConfig.getRequired("MISSING_KEY")).toThrow();
  });

  test("get should return configured value", () => {
    const mockConfig: ConfigProvider = {
      get: vi.fn().mockReturnValue("test-value"),
      getRequired: vi.fn(),
    };

    expect(mockConfig.get("EXISTING_KEY")).toBe("test-value");
  });
});

describe("CredentialStore", () => {
  test("should be a valid interface", async () => {
    const mockStore: CredentialStore = {
      getAccountsByUserId: vi.fn().mockResolvedValue([]),
      getAccountByPlatform: vi.fn().mockResolvedValue(null),
      getAccountById: vi.fn().mockResolvedValue(null),
      updateAccount: vi.fn().mockResolvedValue(undefined),
      createAccount: vi.fn().mockResolvedValue({} as any),
    };

    expect(mockStore.getAccountsByUserId).toBeDefined();
    expect(mockStore.getAccountByPlatform).toBeDefined();
  });

  test("getAccountsByUserId should return accounts array", async () => {
    const mockAccounts = [
      { id: "acc-1", platform: "whatsapp", userId: "user-1" } as any,
      { id: "acc-2", platform: "weixin", userId: "user-1" } as any,
    ];

    const mockStore: CredentialStore = {
      getAccountsByUserId: vi.fn().mockResolvedValue(mockAccounts),
      getAccountByPlatform: vi.fn(),
      getAccountById: vi.fn(),
      updateAccount: vi.fn(),
      createAccount: vi.fn(),
    };

    const result = await mockStore.getAccountsByUserId("user-1");
    expect(result).toHaveLength(2);
  });
});
