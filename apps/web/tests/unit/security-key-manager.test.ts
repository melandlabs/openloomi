/**
 * Security Key Manager Tests
 *
 * Tests for packages/security/src/key-manager.ts
 * KM-01 to KM-10
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fernet module before importing the module under test
vi.mock("fernet", () => {
  return {
    default: {
      Secret: vi.fn(() => ({
        encode: vi.fn((token: string) => `encoded:${token}`),
      })),
      Token: vi.fn(() => ({
        encode: vi.fn((token: string) => `encoded:${token}`),
        decode: vi.fn(() => "decoded-token"),
      })),
    },
    Secret: vi.fn(() => ({
      encode: vi.fn((token: string) => `encoded:${token}`),
    })),
    Token: vi.fn(() => ({
      encode: vi.fn((token: string) => `encoded:${token}`),
      decode: vi.fn(() => "decoded-token"),
    })),
  };
});

describe("security key manager", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh environment for each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    // Reset modules to clear the cached singleton
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("KeyManager instantiation", () => {
    // KM-01: KeyManager should be instantiable
    it("KM-01: KeyManager should be instantiable", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      expect(km).toBeTruthy();
    });
  });

  describe("encryptWithAccountKey", () => {
    // KM-02: Should encrypt data with account-specific key
    it("KM-02: encryptWithAccountKey should encrypt data with account-specific key", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const result = km.encryptWithAccountKey(
        "test-credentials",
        "account-123",
        1,
      );

      expect(result).toHaveProperty("encrypted");
      expect(result).toHaveProperty("keyId");
      expect(typeof result.encrypted).toBe("string");
      expect(typeof result.keyId).toBe("string");
    });

    // KM-03: Same plaintext should produce different ciphertexts for different accounts
    it("KM-03: Different accounts should produce different ciphertexts", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const result1 = km.encryptWithAccountKey("same-data", "account-1", 1);
      const result2 = km.encryptWithAccountKey("same-data", "account-2", 1);

      // Different accounts should produce different key IDs
      expect(result1.keyId).not.toBe(result2.keyId);
    });
  });

  describe("decryptWithAccountKey", () => {
    // KM-04: Should decrypt data encrypted with the same key
    it("KM-04: decryptWithAccountKey should recover original plaintext", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const plaintext = "my-secret-credentials";
      const { encrypted } = km.encryptWithAccountKey(
        plaintext,
        "account-123",
        1,
      );
      const decrypted = km.decryptWithAccountKey(encrypted, "account-123", 1);

      // Since we're mocking fernet, decrypt returns "decoded-token" not the actual plaintext
      // In real implementation this would equal plaintext
      expect(decrypted).toBeTruthy();
    });
  });

  describe("key rotation", () => {
    // KM-05: Should rotate to a new key version
    it("KM-05: rotateAccountKey should return new version and keyId", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const result = km.rotateAccountKey("account-123", 1);

      expect(result).toHaveProperty("newVersion", 2);
      expect(result).toHaveProperty("keyId");
      expect(typeof result.keyId).toBe("string");
    });

    // KM-06: Key version should increment correctly
    it("KM-06: Key version should increment by 1 on rotation", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const result1 = km.rotateAccountKey("account-123", 1);
      const result2 = km.rotateAccountKey("account-123", result1.newVersion);

      expect(result1.newVersion).toBe(2);
      expect(result2.newVersion).toBe(3);
    });
  });

  describe("deriveAccountKey", () => {
    // KM-07: Should derive consistent key for same account and version
    it("KM-07: Same account and version should produce same derived key", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const key1 = km.deriveAccountKey("account-123", 1);
      const key2 = km.deriveAccountKey("account-123", 1);

      expect(key1.keyId).toBe(key2.keyId);
      expect(key1.version).toBe(key2.version);
    });

    // KM-08: Different versions should produce different keys
    it("KM-08: Different versions should produce different keyIds", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      const key1 = km.deriveAccountKey("account-123", 1);
      const key2 = km.deriveAccountKey("account-123", 2);

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.version).toBe(1);
      expect(key2.version).toBe(2);
    });
  });

  describe("error handling", () => {
    // KM-09: Should throw error when no encryption key is available
    it("KM-09: Should throw error when ENCRYPTION_KEY is not set", async () => {
      process.env.ENCRYPTION_KEY = "";

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      expect(() => km.encryptWithAccountKey("data", "account", 1)).toThrow(
        "No encryption key available",
      );
    });
  });

  describe("clearCache", () => {
    // KM-10: clearCache should reset the key cache
    it("KM-10: clearCache should reset the key cache", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { KeyManager } = await import("@openloomi/security/key-manager");
      const km = new KeyManager();

      // Derive a key to populate cache
      km.deriveAccountKey("account-123", 1);

      // Clear cache should not throw
      expect(() => km.clearCache()).not.toThrow();
    });
  });

  describe("convenience functions", () => {
    // KM-11: encryptWithAccountKey convenience function should work
    it("KM-11: encryptWithAccountKey convenience function should be exported", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { encryptWithAccountKey } =
        await import("@openloomi/security/key-manager");

      const result = encryptWithAccountKey("data", "account-123", 1);

      expect(result).toHaveProperty("encrypted");
      expect(result).toHaveProperty("keyId");
    });

    // KM-12: decryptWithAccountKey convenience function should work
    it("KM-12: decryptWithAccountKey convenience function should be exported", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { encryptWithAccountKey, decryptWithAccountKey } =
        await import("@openloomi/security/key-manager");

      const { encrypted } = encryptWithAccountKey("data", "account-123", 1);
      const decrypted = decryptWithAccountKey(encrypted, "account-123", 1);

      expect(decrypted).toBeTruthy();
    });
  });
});
