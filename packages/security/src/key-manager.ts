/**
 * Key Manager for per-account credential encryption
 *
 * Derives per-account encryption keys from the master ENCRYPTION_KEY + account-specific salt
 * using PBKDF2 with 100,000 iterations and SHA-256.
 *
 * This enables per-account key rotation without re-encrypting all data.
 */

import * as crypto from "node:crypto";

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits for Fernet
const SALT_PREFIX = "openloomi-account-key-v1:";

export interface DerivedKey {
  key: Buffer;
  keyId: string;
  version: number;
}

/**
 * KeyManager provides per-account key derivation and encryption/decryption
 * using the master ENCRYPTION_KEY and account-specific salts.
 */
export class KeyManager {
  private masterKey: Buffer | null = null;
  private keyCache: Map<string, DerivedKey> = new Map();

  /**
   * Gets the master encryption key from environment
   */
  private getMasterKey(): Buffer {
    if (this.masterKey) {
      return this.masterKey;
    }

    const envKey = process.env.ENCRYPTION_KEY;
    if (!envKey) {
      throw new Error(
        "No encryption key available. Set ENCRYPTION_KEY environment variable.",
      );
    }

    this.masterKey = Buffer.from(envKey);
    if (this.masterKey.length !== 32) {
      // If not a valid Fernet key (32 bytes), derive using PBKDF2
      this.masterKey = this.deriveKey(
        this.masterKey,
        Buffer.from("openloomi-master-salt"),
      );
    }

    return this.masterKey;
  }

  /**
   * Derives a key from password using PBKDF2
   */
  private deriveKey(password: Buffer, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      password,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      "sha256",
    );
  }

  /**
   * Generates a unique salt for an account
   */
  private generateSalt(accountId: string): Buffer {
    const saltInput = `${SALT_PREFIX}${accountId}`;
    return crypto.createHash("sha256").update(saltInput).digest();
  }

  /**
   * Derives a per-account encryption key from the master key
   *
   * @param accountId - The account ID to derive the key for
   * @param version - The key version (for rotation support)
   * @returns The derived key and its identifier
   */
  public deriveAccountKey(accountId: string, version: number = 1): DerivedKey {
    const cacheKey = `${accountId}:${version}`;

    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!;
    }

    const masterKey = this.getMasterKey();
    const salt = this.generateSalt(accountId);

    // Include version in the salt to support rotation
    const versionSalt = Buffer.concat([salt, Buffer.from(`:v${version}`)]);

    const derivedKey = this.deriveKey(masterKey, versionSalt);
    const keyId = this.generateKeyId(accountId, version);

    const result: DerivedKey = {
      key: derivedKey,
      keyId,
      version,
    };

    this.keyCache.set(cacheKey, result);
    return result;
  }

  /**
   * Generates a unique key identifier
   */
  private generateKeyId(accountId: string, version: number): string {
    const input = `${accountId}:${version}:${Date.now()}`;
    const hash = crypto.createHash("sha256").update(input).digest("hex");
    return `key_${hash.substring(0, 16)}`;
  }

  /**
   * Encrypts data using the per-account key
   *
   * @param plaintext - The data to encrypt
   * @param accountId - The account ID for key derivation
   * @param version - The key version (default: 1)
   * @returns Object containing the encrypted data and key identifier
   */
  public encryptWithAccountKey(
    plaintext: string,
    accountId: string,
    version: number = 1,
  ): { encrypted: string; keyId: string } {
    const { key, keyId } = this.deriveAccountKey(accountId, version);

    // Use Fernet for symmetric encryption
    const Fernet = require("fernet");
    const secret = new Fernet.Secret(key.toString("base64"));
    const fernetToken = new Fernet.Token({ secret });
    const encrypted = fernetToken.encode(plaintext);

    return { encrypted, keyId };
  }

  /**
   * Decrypts data using the per-account key
   *
   * @param encryptedData - The encrypted data
   * @param accountId - The account ID for key derivation
   * @param version - The key version used for encryption
   * @returns The decrypted plaintext
   */
  public decryptWithAccountKey(
    encryptedData: string,
    accountId: string,
    version: number = 1,
  ): string {
    const { key } = this.deriveAccountKey(accountId, version);

    const Fernet = require("fernet");
    const secret = new Fernet.Secret(key.toString("base64"));
    const fernetToken = new Fernet.Token({
      secret,
      token: encryptedData,
    });
    return fernetToken.decode() as string;
  }

  /**
   * Clears the key cache (useful for testing or key rotation)
   */
  public clearCache(): void {
    this.keyCache.clear();
  }

  /**
   * Rotates the key for an account by deriving a new version
   *
   * @param accountId - The account ID
   * @param currentVersion - The current key version
   * @returns The new key version and its identifier
   */
  public rotateAccountKey(
    accountId: string,
    currentVersion: number,
  ): { newVersion: number; keyId: string } {
    const newVersion = currentVersion + 1;
    const { keyId } = this.deriveAccountKey(accountId, newVersion);
    return { newVersion, keyId };
  }
}

// Global instance for convenience
const keyManager = new KeyManager();

export const getKeyManager = (): KeyManager => keyManager;

/**
 * Convenience function to encrypt with account key
 */
export function encryptWithAccountKey(
  plaintext: string,
  accountId: string,
  version?: number,
): { encrypted: string; keyId: string } {
  return keyManager.encryptWithAccountKey(plaintext, accountId, version);
}

/**
 * Convenience function to decrypt with account key
 */
export function decryptWithAccountKey(
  encryptedData: string,
  accountId: string,
  version?: number,
): string {
  return keyManager.decryptWithAccountKey(encryptedData, accountId, version);
}
