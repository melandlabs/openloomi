import * as crypto from "node:crypto";
import * as FernetImport from "fernet";

const Fernet = ((FernetImport as unknown as { default?: typeof FernetImport })
  .default ?? FernetImport) as typeof FernetImport;

export class TokenEncryption {
  private fernetSecret?: FernetImport.Secret;
  private encryptionKey?: Buffer;
  private ttl: number;

  constructor() {
    const TTL_SECONDS = Number(process.env.FERNET_TTL_SECONDS) || 3153600000;
    this.ttl = TTL_SECONDS;
  }

  /**
   * Gets or creates the encryption key from environment variables
   * @returns Buffer containing the encryption key
   */
  private getEncryptionKey(): Buffer {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    const envKey = process.env.ENCRYPTION_KEY;
    if (!envKey) {
      throw new Error(
        "No encryption key available. Set ENCRYPTION_KEY environment variable.",
      );
    }

    try {
      // Try to use as a direct Fernet key
      const testKey = Buffer.from(envKey);
      // Simple validation of Fernet key format (32 URL-safe Base64 encoded bytes)
      if (testKey.length === 32) {
        this.encryptionKey = testKey;
      } else {
        throw new Error("Key length is not valid for Fernet");
      }
    } catch {
      // If not a valid Fernet key, derive from password
      const derivedKey = this.deriveKeyFromPassword(Buffer.from(envKey));
      this.encryptionKey = derivedKey;
    }

    return this.encryptionKey;
  }

  /**
   * Derives an encryption key from a password using PBKDF2
   * @param password Buffer containing the password
   * @param salt Optional salt value
   * @returns The derived key
   */
  private deriveKeyFromPassword(password: Buffer, salt?: Buffer): Buffer {
    const calSalt = salt ? salt : Buffer.from("mypraxos-salt");

    return crypto.pbkdf2Sync(password, calSalt, 100000, 32, "sha256");
  }

  /**
   * Gets the Fernet Secret instance (cached)
   * @returns Fernet Secret instance
   */
  private getFernetSecret(): FernetImport.Secret {
    if (!this.fernetSecret) {
      const keyBytes = this.getEncryptionKey();
      this.fernetSecret = new Fernet.Secret(keyBytes.toString("base64"));
    }
    return this.fernetSecret;
  }

  /**
   * Encrypts a token string
   * @param token Plaintext token to encrypt
   * @returns Base64 encoded encrypted token
   */
  encryptToken(token: string): string {
    const secret = this.getFernetSecret();

    // Create a new Token instance for each encryption to avoid state issues
    const fernetToken = new Fernet.Token({
      secret,
      ttl: this.ttl,
    });

    // Fernet's encode method automatically handles encryption
    const encrypted = fernetToken.encode(token);
    return encrypted;
  }

  /**
   * Decrypts an encrypted token
   * @param encryptedToken Base64 encoded encrypted token
   * @returns Plaintext token
   */
  decryptToken(encryptedToken: string): string {
    const secret = this.getFernetSecret();

    // Create a new Token instance for each decryption to avoid state issues
    const fernetToken = new Fernet.Token({
      secret,
      token: encryptedToken,
      ttl: this.ttl,
    });

    // Fernet's decode method automatically handles decryption
    const decrypted = fernetToken.decode();

    return decrypted as string;
  }

  /**
   * Encrypts a pair of access and refresh tokens
   * @param accessToken Access token to encrypt
   * @param refreshToken Optional refresh token to encrypt
   * @returns Encrypted token pair
   */
  encryptTokenPair(
    accessToken: string,
    refreshToken?: string,
  ): [string, string | null] {
    const encryptedAccess = this.encryptToken(accessToken);
    const encryptedRefresh = refreshToken
      ? this.encryptToken(refreshToken)
      : null;

    return [encryptedAccess, encryptedRefresh];
  }

  /**
   * Decrypts a pair of access and refresh tokens
   * @param encryptedAccessToken Encrypted access token
   * @param encryptedRefreshToken Optional encrypted refresh token
   * @returns Decrypted token pair
   */
  decryptTokenPair(
    encryptedAccessToken: string,
    encryptedRefreshToken?: string,
  ): [string, string | null] {
    const accessToken = this.decryptToken(encryptedAccessToken);
    const refreshToken = encryptedRefreshToken
      ? this.decryptToken(encryptedRefreshToken)
      : null;
    return [accessToken, refreshToken];
  }
}

// Global instance
const tokenEncryption = new TokenEncryption();

// Convenience functions
export function encryptToken(token: string): string {
  return tokenEncryption.encryptToken(token);
}

export function decryptToken(encryptedToken: string): string {
  return tokenEncryption.decryptToken(encryptedToken);
}

export function encryptTokenPair(
  accessToken: string,
  refreshToken?: string,
): [string, string | null] {
  return tokenEncryption.encryptTokenPair(accessToken, refreshToken);
}

export function decryptTokenPair(
  encryptedAccessToken: string,
  encryptedRefreshToken?: string,
): [string, string | null] {
  return tokenEncryption.decryptTokenPair(
    encryptedAccessToken,
    encryptedRefreshToken,
  );
}
