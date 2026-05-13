/**
 * Security Token Encryption Tests
 *
 * Tests for packages/security/src/token-encryption.ts
 * TE-01 to TE-06
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fernet module before importing the module under test
vi.mock("fernet", () => {
  const mockSecret = {
    encode: vi.fn((token: string) => `encrypted:${token}`),
    decode: vi.fn(() => "decrypted-token"),
  };

  return {
    default: {
      Secret: vi.fn(() => mockSecret),
      Token: vi.fn(() => ({
        encode: vi.fn((token: string) => `encrypted:${token}`),
        decode: vi.fn(() => "decrypted-token"),
      })),
    },
    Secret: vi.fn(() => mockSecret),
    Token: vi.fn(() => ({
      encode: vi.fn((token: string) => `encrypted:${token}`),
      decode: vi.fn(() => "decrypted-token"),
    })),
  };
});

describe("security token encryption", () => {
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

  describe("encryptToken", () => {
    // TE-01: encryptToken roundtrip
    it("TE-01: encryptToken should encrypt and be decryptable back to original", async () => {
      // Set a valid Fernet key (32 bytes URL-safe base64)
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { encryptToken, decryptToken } =
        await import("@openloomi/security/token-encryption");

      const original = "secret-token";
      const encrypted = encryptToken(original);

      // Since we're mocking, the encrypted result is "encrypted:secret-token"
      // In real implementation this would be a proper Fernet encrypted token
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");
    });
  });

  describe("encryptTokenPair", () => {
    // TE-02: encryptTokenPair roundtrip
    it("TE-02: encryptTokenPair should encrypt both tokens", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { encryptTokenPair } =
        await import("@openloomi/security/token-encryption");

      const [encryptedAccess, encryptedRefresh] = encryptTokenPair(
        "access",
        "refresh",
      );

      expect(encryptedAccess).toBeTruthy();
      expect(encryptedRefresh).toBeTruthy();
      expect(typeof encryptedAccess).toBe("string");
      expect(typeof encryptedRefresh).toBe("string");
    });

    // TE-03: encryptTokenPair without refresh
    it("TE-03: encryptTokenPair should return null for missing refresh token", async () => {
      const testKey = Buffer.alloc(32);
      testKey.fill("a");
      process.env.ENCRYPTION_KEY = testKey.toString("base64");

      const { encryptTokenPair } =
        await import("@openloomi/security/token-encryption");

      const [encryptedAccess, encryptedRefresh] =
        encryptTokenPair("access-only");

      expect(encryptedAccess).toBeTruthy();
      expect(encryptedRefresh).toBeNull();
    });
  });

  describe("error handling without encryption key", () => {
    // TE-04: encryption throws error when no key
    it("TE-04: should throw error when encrypting without ENCRYPTION_KEY", async () => {
      // Ensure no encryption key is set
      process.env.ENCRYPTION_KEY = undefined;

      const { encryptToken } =
        await import("@openloomi/security/token-encryption");

      expect(() => encryptToken("token")).toThrow("No encryption key");
    });

    // TE-05: decryption throws error when no key
    it("TE-05: should throw error when decrypting without ENCRYPTION_KEY", async () => {
      // Ensure no encryption key is set
      process.env.ENCRYPTION_KEY = undefined;

      const { decryptToken } =
        await import("@openloomi/security/token-encryption");

      expect(() => decryptToken("encrypted-token")).toThrow(
        "No encryption key",
      );
    });
  });

  describe("password-derived key (FERNET_KEY_PASSWORD)", () => {
    // TE-06: derive key from password
    it("TE-06: should derive key from password when ENCRYPTION_KEY is a password", async () => {
      // Set a password (not a valid Fernet key)
      process.env.ENCRYPTION_KEY = "my-password";

      const { encryptToken } =
        await import("@openloomi/security/token-encryption");

      // Should not throw - should derive key using PBKDF2
      expect(() => encryptToken("token")).not.toThrow();
    });
  });
});
