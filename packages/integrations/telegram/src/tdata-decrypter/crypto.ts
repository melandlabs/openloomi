// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Cryptography utilities for Telegram Desktop tdata decryption.
 * Ported from telegram-tdata-decrypter crypto.py
 *
 * AES-256-IGE implementation based on:
 * https://gist.github.com/f4ddf6e7a859b837f996b3f50097153a
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";

const LocalEncryptNoPwdIterCount = 4;
const LocalEncryptIterCount = 400;
const kStrongIterationsCount = 100000;

export class CryptoException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoException";
  }
}

/**
 * XOR two buffers in place
 */
function xorBuffer(a: Buffer, b: Buffer): void {
  for (let i = 0; i < a.length; i++) {
    a.writeUInt8(a.readUInt8(i) ^ b.readUInt8(i), i);
  }
}

/**
 * AES-256-IGE encrypt/decrypt
 */
function igeCrypt(
  buffer: Buffer,
  aesKey: Buffer,
  aesIv: Buffer,
  isEncrypt: boolean,
): Buffer {
  // AES-256-ECB cipher (no IV, we handle IGE manually)
  const cipher = isEncrypt
    ? crypto.createCipheriv("aes-256-ecb", aesKey, null)
    : crypto.createDecipheriv("aes-256-ecb", aesKey, null);

  cipher.setAutoPadding(false);

  const result = Buffer.allocUnsafe(buffer.length);

  // IGE uses IV as two 16-byte blocks
  let prevCipherblock: Buffer;
  let prevPlainblock: Buffer;

  if (isEncrypt) {
    prevCipherblock = aesIv.subarray(0, 16); // IV1
    prevPlainblock = aesIv.subarray(16, 32); // IV2
  } else {
    // For decryption, swap the order
    prevCipherblock = aesIv.subarray(16, 32); // IV2
    prevPlainblock = aesIv.subarray(0, 16); // IV1
  }

  const current = Buffer.allocUnsafe(16);

  for (let offset = 0; offset < buffer.length; offset += 16) {
    const chunk = buffer.subarray(offset, offset + 16);
    chunk.copy(current);

    // IGE: XOR with previous cipher block before AES
    xorBuffer(current, prevCipherblock);

    // AES encryption/decryption
    const crypted = Buffer.from(cipher.update(current));

    // IGE: XOR with previous plaintext block after AES
    xorBuffer(crypted, prevPlainblock);

    crypted.copy(result, offset);

    prevCipherblock = crypted;
    prevPlainblock = chunk;
  }

  // Finalize (should produce empty buffer for full blocks)
  cipher.final();

  return result;
}

/**
 * Create local key from passcode and salt
 */
export function createLocalKey(passcode: Buffer, salt: Buffer): Buffer {
  const iterations = passcode.length > 0 ? kStrongIterationsCount : 1;

  const password = crypto.createHash("sha512");
  password.update(salt);
  password.update(passcode);
  password.update(salt);

  return crypto.pbkdf2Sync(password.digest(), salt, iterations, 256, "sha512");
}

/**
 * Create legacy local key (for older Telegram Desktop versions)
 */
export function createLegacyLocalKey(passcode: Buffer, salt: Buffer): Buffer {
  const iterations =
    passcode.length > 0 ? LocalEncryptIterCount : LocalEncryptNoPwdIterCount;

  return crypto.pbkdf2Sync(passcode, salt, iterations, 256, "sha1");
}

/**
 * Decrypt local encrypted data
 */
export function decryptLocal(encryptedMsg: Buffer, localKey: Buffer): Buffer {
  const msgKey = encryptedMsg.subarray(0, 16);
  const encryptedData = encryptedMsg.subarray(16);

  const decrypted = aesDecryptLocal(encryptedData, msgKey, localKey);

  // Verify SHA1 hash
  const sha1 = crypto.createHash("sha1");
  sha1.update(decrypted);
  const calculatedMsgKey = sha1.digest().subarray(0, 16);

  if (calculatedMsgKey.compare(msgKey) !== 0) {
    throw new CryptoException(
      "bad decrypt key, data not decrypted - incorrect password",
    );
  }

  // Read length
  const length = decrypted.readUInt32LE(0);
  if (length > decrypted.length) {
    throw new CryptoException(`corrupted data. wrong length: ${length}`);
  }

  return decrypted.subarray(4, 4 + length);
}

/**
 * AES-256-IGE decrypt for local data
 */
export function aesDecryptLocal(
  encryptedData: Buffer,
  msgKey: Buffer,
  localKey: Buffer,
): Buffer {
  const { aesKey, aesIv } = prepareAesOldMtp(localKey, msgKey, false);
  return igeCrypt(encryptedData, aesKey, aesIv, false);
}

/**
 * Prepare AES key and IV for old MTProto format
 */
interface AesKeyIv {
  aesKey: Buffer;
  aesIv: Buffer;
}

export function prepareAesOldMtp(
  localKey: Buffer,
  msgKey: Buffer,
  send = false,
): AesKeyIv {
  const x = send ? 0 : 8;

  const keyPos = (pos: number, size: number): Buffer => {
    return localKey.subarray(pos, pos + size);
  };

  const dataA = Buffer.concat([msgKey, keyPos(x, 32)]);
  const dataB = Buffer.concat([keyPos(x + 32, 16), msgKey, keyPos(x + 48, 16)]);
  const dataC = Buffer.concat([keyPos(x + 64, 32), msgKey]);
  const dataD = Buffer.concat([msgKey, keyPos(x + 96, 32)]);

  const sha1A = crypto.createHash("sha1").update(dataA).digest();
  const sha1B = crypto.createHash("sha1").update(dataB).digest();
  const sha1C = crypto.createHash("sha1").update(dataC).digest();
  const sha1D = crypto.createHash("sha1").update(dataD).digest();

  const aesKey = Buffer.concat([
    sha1A.subarray(0, 8),
    sha1B.subarray(8, 20),
    sha1C.subarray(4, 16),
  ]);

  const aesIv = Buffer.concat([
    sha1A.subarray(8, 20),
    sha1B.subarray(0, 8),
    sha1C.subarray(16, 20),
    sha1D.subarray(0, 8),
  ]);

  return { aesKey, aesIv };
}
