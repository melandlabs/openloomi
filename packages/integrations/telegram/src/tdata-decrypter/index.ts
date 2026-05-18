// Copyright 2026 OpenLoomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Pure TypeScript implementation of Telegram Desktop tdata decryption.
 * Ported from telegram-tdata-decrypter Python library.
 *
 * This module provides functionality to extract auth keys from
 * Telegram Desktop's tdata folder without requiring Python.
 */

export { TdataReader } from "./decrypter";
export type { MtpData, ParsedAccount, ParsedTdata } from "./decrypter";

export { readTdfFile, parseRawTdf, TDF_MAGIC } from "./tdf";
export type { RawTdfFile } from "./tdf";

export {
  createLocalKey,
  createLegacyLocalKey,
  decryptLocal,
  aesDecryptLocal,
  prepareAesOldMtp,
} from "./crypto";

export {
  readQtInt32,
  readQtUint32,
  readQtInt64,
  readQtUint64,
  readQtByteArray,
  readQtUtf8,
  readBytes,
  readQtInteger,
} from "./qt";

export type { ReadResult } from "./qt";

export {
  decryptSettingsTdf,
  decryptKeyDataTdf,
  readKeyDataAccounts,
} from "./storage";

export {
  readSettingsBlocks,
  readSettingsBlock,
  SettingsBlocks,
} from "./settings";

// Re-export errors
export {
  TdfParserError,
  WrongMagicTdfParserError,
  WrongHashsumTdfParserError,
} from "./tdf";

export { CryptoException } from "./crypto";

/**
 * Extract auth key from tdata directory
 * @param tdataPath Path to tdata directory
 * @returns Auth key data
 */
export async function extractAuthKey(tdataPath: string): Promise<{
  success: boolean;
  userId?: number;
  dcId?: number;
  authKey?: string;
  error?: string;
}> {
  try {
    const { TdataReader } = await import("./decrypter");

    // Normalize path
    let path = tdataPath;
    if (!path.endsWith("tdata")) {
      const tdataDir = require("node:path").join(tdataPath, "tdata");
      if (require("node:fs").existsSync(tdataDir)) {
        path = tdataDir;
      }
    }

    const reader = new TdataReader(path);
    const result = reader.read();

    if (!result.accounts || result.accounts.size === 0) {
      return {
        success: false,
        error:
          "No accounts found in tdata. Please make sure you're logged into Telegram Desktop.",
      };
    }

    // Get first account
    const firstAccount = result.accounts.values().next().value;
    if (!firstAccount) {
      return {
        success: false,
        error: "No accounts found in tdata.",
      };
    }

    const { mtpData } = firstAccount;
    const authKeyBytes = mtpData.keys.get(mtpData.currentDcId);

    if (!authKeyBytes) {
      return {
        success: false,
        error: `No auth key found for DC ${mtpData.currentDcId}`,
      };
    }

    return {
      success: true,
      userId: mtpData.userId,
      dcId: mtpData.currentDcId,
      authKey: authKeyBytes.toString("hex"),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
