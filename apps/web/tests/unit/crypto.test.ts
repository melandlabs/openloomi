import {
  TokenEncryption,
  encryptToken,
  decryptToken,
} from "@openloomi/security/token-encryption";
import { test, expect } from "vitest";
import * as crypto from "node:crypto";

const generateValidFernetKey = () => {
  return crypto.randomBytes(32).toString("base64url");
};

test.beforeEach(() => {
  process.env.ENCRYPTION_KEY = generateValidFernetKey();
});

test.afterAll(() => {
  process.env.ENCRYPTION_KEY = originalEnvKey;
});

const originalEnvKey = process.env.ENCRYPTION_KEY;

test("should encrypt and decrypt token correctly with valid Fernet key", async () => {
  const encryption = new TokenEncryption();
  const originalToken = "test-valid-token-12345";

  const encrypted = encryption.encryptToken(originalToken);
  const decrypted = encryption.decryptToken(encrypted);

  expect(decrypted).toBe(originalToken);
  expect(encrypted).not.toBe(originalToken);
});

test("should handle token pair encryption and decryption", async () => {
  const encryption = new TokenEncryption();
  const accessToken = "access-123";
  const refreshToken = "refresh-456";

  const [encryptedAccess, encryptedRefresh] = encryption.encryptTokenPair(
    accessToken,
    refreshToken,
  );
  if (encryptedRefresh) {
    const [decryptedAccess, decryptedRefresh] = encryption.decryptTokenPair(
      encryptedAccess,
      encryptedRefresh,
    );

    expect(decryptedAccess).toBe(accessToken);
    expect(decryptedRefresh).toBe(refreshToken);
  }
});

test("should work with convenience functions", async () => {
  const originalToken = "convenience-test-token";

  const encrypted = encryptToken(originalToken);
  const decrypted = decryptToken(encrypted);

  expect(decrypted).toBe(originalToken);
});

test("should derive valid key from password when Fernet key is invalid", async () => {
  process.env.ENCRYPTION_KEY = "short-key";

  const encryption = new TokenEncryption();
  const originalToken = "derived-key-test";

  const encrypted = encryption.encryptToken(originalToken);
  const decrypted = encryption.decryptToken(encrypted);

  expect(decrypted).toBe(originalToken);
});

test("should throw error when no encryption key is provided", async () => {
  process.env.ENCRYPTION_KEY = "";

  const encryption = new TokenEncryption();

  expect(() => encryption.encryptToken("test")).toThrowError(
    "No encryption key available. Set ENCRYPTION_KEY environment variable.",
  );
});

test("should throw error when decrypting invalid token", async () => {
  const encryption = new TokenEncryption();

  expect(() => encryption.decryptToken("invalid-token")).toThrowError();
});

test("should handle refresh token being null", async () => {
  const encryption = new TokenEncryption();
  const accessToken = "access-only-token";

  const [encryptedAccess, encryptedRefresh] =
    encryption.encryptTokenPair(accessToken);
  expect(encryptedRefresh).toBeNull();

  const [decryptedAccess, decryptedRefresh] =
    encryption.decryptTokenPair(encryptedAccess);
  expect(decryptedAccess).toBe(accessToken);
  expect(decryptedRefresh).toBeNull();
});

test("should maintain consistent encryption with same key and data", async () => {
  const key = generateValidFernetKey();
  process.env.ENCRYPTION_KEY = key;

  const encryption1 = new TokenEncryption();
  const encryption2 = new TokenEncryption();
  const originalToken = "consistency-test";

  const encrypted1 = encryption1.encryptToken(originalToken);
  const encrypted2 = encryption2.encryptToken(originalToken);

  expect(encrypted1).not.toBe(encrypted2);
  expect(encryption1.decryptToken(encrypted1)).toBe(originalToken);
  expect(encryption2.decryptToken(encrypted2)).toBe(originalToken);
});
