// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * TDF (Telegram Desktop File) format parser.
 * Ported from telegram-tdata-decrypter tdf.py
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

export const TDF_MAGIC = Buffer.from("TDF$", "ascii");

export class TdfParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TdfParserError";
  }
}

export class WrongMagicTdfParserError extends TdfParserError {
  constructor(message = "Wrong magic. Not a TDF file?") {
    super(message);
    this.name = "WrongMagicTdfParserError";
  }
}

export class WrongHashsumTdfParserError extends TdfParserError {
  constructor(message = "Wrong hashsum. Corrupted file?") {
    super(message);
    this.name = "WrongHashsumTdfParserError";
  }
}

export interface RawTdfFile {
  version: number;
  encryptedData: Buffer;
  hashsum: Buffer;
}

/**
 * Parse raw TDF file from buffer
 */
export function parseRawTdf(data: Buffer): RawTdfFile {
  // Check magic
  if (data.subarray(0, 4).compare(TDF_MAGIC) !== 0) {
    throw new WrongMagicTdfParserError();
  }

  // Read version (little-endian)
  const version = data.readUInt32LE(4);

  // Extract encrypted data and hashsum
  const encryptedData = data.subarray(8, data.length - 16);
  const hashsum = data.subarray(data.length - 16);

  // Verify MD5 hashsum
  const actualMd5 = crypto.createHash("md5");
  actualMd5.update(encryptedData);

  const lengthBuffer = Buffer.allocUnsafe(4);
  lengthBuffer.writeUInt32LE(encryptedData.length, 0);
  actualMd5.update(lengthBuffer);

  const versionBuffer = Buffer.allocUnsafe(4);
  versionBuffer.writeUInt32LE(version, 0);
  actualMd5.update(versionBuffer);

  actualMd5.update(TDF_MAGIC);

  const actualMd5Digest = actualMd5.digest();

  if (actualMd5Digest.compare(hashsum) !== 0) {
    throw new WrongHashsumTdfParserError();
  }

  return {
    version,
    encryptedData,
    hashsum,
  };
}

/**
 * Read TDF file from disk
 * Tries both filepath + 's' and filepath
 */
export function readTdfFile(filepath: string): RawTdfFile {
  const candidates = [`${filepath}s`, filepath];

  for (const candidate of candidates) {
    try {
      const data = fs.readFileSync(candidate);
      return parseRawTdf(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`TDF file not found: ${filepath}`);
}
