// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Main tdata decrypter.
 * Ported from telegram-tdata-decrypter decrypter.py
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { readTdfFile } from "./tdf";
import { decryptLocal } from "./crypto";
import { readSettingsBlocks } from "./settings";
import { decryptKeyDataTdf, readKeyDataAccounts } from "./storage";
import { readQtInt32, readQtUint64, readQtByteArray } from "./qt";

/**
 * Convert file key to string representation
 * Reverses each byte's hex pair (e.g., D8 -> 8D)
 */
function fileKeyToStr(fileKey: Buffer): string {
  let result = "";
  for (const b of fileKey) {
    const hex = b.toString(16).toUpperCase();
    const padded = hex.length === 1 ? `0${hex}` : hex;
    // Reverse the 2-character hex string
    result += padded[1] + padded[0];
  }
  return result;
}

/**
 * Compute data name key from dataname string
 */
function computeDataNameKey(dataName: string): string {
  const fileKey = crypto
    .createHash("md5")
    .update(dataName, "utf8")
    .digest()
    .subarray(0, 8);
  return fileKeyToStr(fileKey);
}

/**
 * Compose account name with index
 */
function composeAccountName(dataName: string, index: number): string {
  if (index > 0) {
    return `${dataName}#${index + 1}`;
  }
  return dataName;
}

/**
 * MTP authorization data
 */
export interface MtpData {
  userId: number;
  currentDcId: number;
  keys: Map<number, Buffer>;
  keysToDestroy: Map<number, Buffer>;
}

/**
 * Read MTP authorization from buffer
 */
function readMtpAuthorization(buffer: Buffer): MtpData {
  let offset = 0;

  const legacyUserId = readQtInt32(buffer, offset);
  const legacyMainDcId = readQtInt32(buffer, offset + 4);
  offset += 8;

  let userId: number;
  let mainDcId: number;

  if (legacyUserId === -1 && legacyMainDcId === -1) {
    userId = Number(readQtUint64(buffer, offset));
    offset += 8;
    mainDcId = readQtInt32(buffer, offset);
    offset += 4;
  } else {
    userId = legacyUserId;
    mainDcId = legacyMainDcId;
  }

  // Read keys
  const count = readQtInt32(buffer, offset);
  offset += 4;

  const keys = new Map<number, Buffer>();
  for (let i = 0; i < count; i++) {
    const dcId = readQtInt32(buffer, offset);
    offset += 4;
    const key = Buffer.from(buffer.subarray(offset, offset + 256));
    offset += 256;
    keys.set(dcId, key);
  }

  // Read keys to destroy
  const destroyCount = readQtInt32(buffer, offset);
  offset += 4;

  const keysToDestroy = new Map<number, Buffer>();
  for (let i = 0; i < destroyCount; i++) {
    const dcId = readQtInt32(buffer, offset);
    offset += 4;
    const key = Buffer.from(buffer.subarray(offset, offset + 256));
    offset += 256;
    keysToDestroy.set(dcId, key);
  }

  return {
    userId,
    currentDcId: mainDcId,
    keys,
    keysToDestroy,
  };
}

/**
 * Parsed account data
 */
export interface ParsedAccount {
  index: number;
  mtpData: MtpData;
}

/**
 * Account reader class
 */
class AccountReader {
  private basePath: string;
  private index: number;
  private accountName: string;
  private dataNameKey: string;

  constructor(basePath: string, index: number, dataName: string) {
    this.basePath = basePath;
    this.index = index;
    this.accountName = composeAccountName(dataName, index);
    this.dataNameKey = computeDataNameKey(this.accountName);
  }

  /**
   * Read account data using local key
   */
  read(localKey: Buffer): ParsedAccount {
    const mtpData = this.readMtpData(localKey);
    return {
      index: this.index,
      mtpData,
    };
  }

  /**
   * Read MTP data
   */
  readMtpData(localKey: Buffer): MtpData {
    const mtpDataFilePath = path.join(this.basePath, this.dataNameKey);

    // Read TDF file
    const tdfFile = readTdfFile(mtpDataFilePath);

    // Read encrypted data
    const offset = 0;
    const { value: encryptedData, newOffset: _ } = readQtByteArray(
      Buffer.from(tdfFile.encryptedData),
      offset,
    );

    // Decrypt
    const decrypted = decryptLocal(encryptedData, localKey);

    // Read settings blocks
    const blocks = readSettingsBlocks(tdfFile.version, decrypted);

    // Get MTP authorization block
    const mtpAuth = blocks.get(0x4b); // dbiMtpAuthorization
    if (!mtpAuth || !(mtpAuth instanceof Buffer)) {
      throw new Error("MTP authorization not found");
    }

    return readMtpAuthorization(mtpAuth);
  }
}

/**
 * Parsed tdata result
 */
export interface ParsedTdata {
  settings: Map<number, unknown>;
  accounts: Map<number, ParsedAccount>;
}

/**
 * Tdata Reader class
 */
export class TdataReader {
  private basePath: string;
  private dataName: string;

  static readonly DEFAULT_DATANAME = "data";

  constructor(basePath: string, dataName?: string) {
    this.basePath = basePath;
    this.dataName = dataName ?? TdataReader.DEFAULT_DATANAME;
  }

  /**
   * Read tdata directory
   */
  read(passcode?: string): ParsedTdata {
    // Read settings
    const settings = this.readSettings();

    // Read key data
    const [localKey, accountIndexes] = this.readKeyData(passcode ?? "");

    // Read accounts
    const accounts = new Map<number, ParsedAccount>();
    for (const accountIndex of accountIndexes) {
      const reader = new AccountReader(
        this.basePath,
        accountIndex,
        this.dataName,
      );
      const account = reader.read(localKey);
      accounts.set(accountIndex, account);
    }

    return { settings, accounts };
  }

  /**
   * Read key data
   */
  readKeyData(passcode: string): [Buffer, number[]] {
    const keyDataName = `key_${this.dataName}`;
    const keyDataPath = path.join(this.basePath, keyDataName);

    const keyDataTdf = readTdfFile(keyDataPath);
    const [localKey, infoDecrypted] = decryptKeyDataTdf(
      Buffer.from(passcode),
      keyDataTdf,
    );
    const [accountIndexes, _] = readKeyDataAccounts(infoDecrypted);

    return [localKey, accountIndexes];
  }

  /**
   * Read settings
   */
  readSettings(): Map<number, unknown> {
    const settingsPath = path.join(this.basePath, "settings");
    const settingsTdf = readTdfFile(settingsPath);

    const decrypted = settingsTdf.encryptedData;

    return readSettingsBlocks(settingsTdf.version, decrypted);
  }
}
