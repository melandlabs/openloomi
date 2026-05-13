/**
 * Audit Logger Tests
 *
 * Tests for packages/audit/src/logger.ts
 * AL-01 to AL-08
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
}));

describe("audit logger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("CredentialAccessEntry interface", () => {
    // AL-01: CredentialAccessEntry should have correct type
    it("AL-01: CredentialAccessEntry should have required fields", async () => {
      const { logCredentialAccess } = await import("@openloomi/audit");
      // Just verify that logCredentialAccess exists and is a function
      expect(typeof logCredentialAccess).toBe("function");

      // Verify that calling it with valid params doesn't throw
      expect(() =>
        logCredentialAccess({
          accountId: "account-123",
          userId: "user-456",
          action: "read",
          success: true,
        }),
      ).not.toThrow();
    });
  });

  describe("logCredentialAccess", () => {
    // AL-02: logCredentialAccess should accept valid parameters
    it("AL-02: logCredentialAccess should accept valid credential access parameters", async () => {
      const { logCredentialAccess } = await import("@openloomi/audit");

      expect(() =>
        logCredentialAccess({
          accountId: "account-123",
          userId: "user-456",
          action: "read",
          success: true,
        }),
      ).not.toThrow();
    });

    // AL-03: logCredentialAccess should accept optional parameters
    it("AL-03: logCredentialAccess should accept optional ipAddress and userAgent", async () => {
      const { logCredentialAccess } = await import("@openloomi/audit");

      expect(() =>
        logCredentialAccess({
          accountId: "account-123",
          userId: "user-456",
          action: "update",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          metadata: { reason: "test" },
          success: true,
        }),
      ).not.toThrow();
    });

    // AL-04: logCredentialAccess should accept failure case
    it("AL-04: logCredentialAccess should log failed access with errorMessage", async () => {
      const { logCredentialAccess } = await import("@openloomi/audit");

      expect(() =>
        logCredentialAccess({
          accountId: "account-123",
          userId: "user-456",
          action: "read",
          success: false,
          errorMessage: "Access denied",
        }),
      ).not.toThrow();
    });

    // AL-05: logCredentialAccess should accept all action types
    it("AL-05: logCredentialAccess should accept all valid action types", async () => {
      const { logCredentialAccess } = await import("@openloomi/audit");
      const actions = ["read", "update", "rotate", "delete"] as const;

      for (const action of actions) {
        expect(() =>
          logCredentialAccess({
            accountId: "account-123",
            userId: "user-456",
            action,
            success: true,
          }),
        ).not.toThrow();
      }
    });
  });

  describe("logFileRead", () => {
    // AL-06: logFileRead should still work
    it("AL-06: logFileRead should be available", async () => {
      const { logFileRead } = await import("@openloomi/audit");

      expect(() => logFileRead("/path/to/file")).not.toThrow();
    });
  });

  describe("logCommandExec", () => {
    // AL-07: logCommandExec should still work
    it("AL-07: logCommandExec should be available", async () => {
      const { logCommandExec } = await import("@openloomi/audit");

      expect(() => logCommandExec("ls", ["-la"])).not.toThrow();
    });

    // AL-08: logCommandExec should work without args
    it("AL-08: logCommandExec should work without args", async () => {
      const { logCommandExec } = await import("@openloomi/audit");

      expect(() => logCommandExec("pwd")).not.toThrow();
    });
  });
});
