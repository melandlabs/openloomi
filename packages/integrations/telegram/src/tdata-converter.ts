// Copyright 2026 OpenLoomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Telegram Desktop tdata to GramJS StringSession converter
 *
 * Now uses pure TypeScript implementation (tdata-decrypter)
 * instead of Python telegram-tdata-decrypter library.
 *
 * No external Python dependencies required!
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AuthKey } from "telegram/crypto/AuthKey";
import { StringSession } from "telegram/sessions";
import { fileURLToPath } from "node:url";
import { TdataReader } from "./tdata-decrypter/index";

// Get the directory name of the current module (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DC server addresses
function getServerAddress(dcId: number): string {
  const addresses: Record<number, string> = {
    1: "149.154.175.53",
    2: "149.154.167.51",
    3: "149.154.175.100",
    4: "149.154.167.92",
    5: "149.154.171.5",
  };
  return addresses[dcId] || "149.154.175.53";
}

/**
 * Extract auth key from tdata using pure TypeScript implementation
 */
function extractAuthKey(tdataPath: string): {
  userId: number;
  dcId: number;
  authKey: Buffer;
} {
  console.log(
    "[TdataConverter] Using pure JS implementation to extract auth key...",
  );

  try {
    const reader = new TdataReader(tdataPath);
    const result = reader.read();

    if (!result.accounts || result.accounts.size === 0) {
      throw new Error(
        "No accounts found in tdata. Please make sure you're logged into Telegram Desktop.",
      );
    }

    // Get first account
    const firstAccount = result.accounts.values().next().value;
    if (!firstAccount) {
      throw new Error("No accounts found in tdata.");
    }

    const { mtpData } = firstAccount;
    const authKeyBytes = mtpData.keys.get(mtpData.currentDcId);

    if (!authKeyBytes) {
      throw new Error(`No auth key found for DC ${mtpData.currentDcId}`);
    }

    console.log("[TdataConverter] Pure JS implementation extracted:", {
      userId: mtpData.userId,
      dcId: mtpData.currentDcId,
      authKeyLength: authKeyBytes.length,
    });

    return {
      userId: mtpData.userId,
      dcId: mtpData.currentDcId,
      authKey: authKeyBytes,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to extract auth key from tdata");
  }
}

/**
 * Normalize tdata path
 */
function normalizeTdataPath(inputPath: string): string {
  if (inputPath.endsWith("tdata")) {
    return inputPath;
  }

  const tdataSubdir = path.join(inputPath, "tdata");
  if (fs.existsSync(tdataSubdir) && fs.statSync(tdataSubdir).isDirectory()) {
    return tdataSubdir;
  }

  return inputPath;
}

/**
 * Main conversion function: Convert tdata to StringSession
 */
export async function convertTdataToStringSession(
  tdataPath: string,
): Promise<string> {
  const normalizedPath = normalizeTdataPath(tdataPath);
  console.log("[TdataConverter] Starting conversion from:", tdataPath);
  console.log("[TdataConverter] Normalized path:", normalizedPath);

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`tdata directory not found: ${normalizedPath}`);
  }

  try {
    // Use pure JS implementation to extract auth key
    const { userId, dcId, authKey } = extractAuthKey(normalizedPath);

    console.log("[TdataConverter] Creating GramJS StringSession...");

    // Create GramJS StringSession
    const mainAuthKey = new AuthKey();
    await mainAuthKey.setKey(authKey);

    const session = new StringSession("");
    session.setDC(dcId, getServerAddress(dcId), 443);
    session.setAuthKey(mainAuthKey);

    const sessionString = session.save();
    console.log("[TdataConverter] Conversion successful!");

    return sessionString;
  } catch (error) {
    console.error("[TdataConverter] Conversion error:", error);

    if (error instanceof Error) {
      const errorMessage = error.message;

      // No accounts found
      if (
        errorMessage.includes("No accounts found") ||
        errorMessage.includes("logged into Telegram Desktop")
      ) {
        throw new Error(
          "No active session found in Telegram Desktop.\n\n" +
            "Please make sure:\n" +
            "• You're logged into Telegram Desktop\n" +
            "• You've logged in at least once before\n" +
            "• You're using the official Telegram Desktop from desktop.telegram.org",
        );
      }

      // Generic error with original message
      throw new Error(
        `Failed to read Telegram Desktop session: ${errorMessage}\n\nSuggestions:\n1. Make sure Telegram Desktop is closed\n2. Verify you're using the official Telegram Desktop from desktop.telegram.org\n3. Try using the QR code or phone number login method instead`,
      );
    }

    throw new Error(
      "Failed to read Telegram Desktop session: Unknown error\n\n" +
        "Please try:\n" +
        "1. Closing Telegram Desktop completely\n" +
        "2. Using the QR code or phone number login method instead",
    );
  }
}

/**
 * Validate if a directory contains valid Telegram Desktop tdata
 */
export function validateTdataDirectory(tdataPath: string): {
  valid: boolean;
  error?: string;
} {
  try {
    if (!fs.existsSync(tdataPath)) {
      return { valid: false, error: "Directory does not exist" };
    }

    if (!fs.statSync(tdataPath).isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }

    const normalizedPath = normalizeTdataPath(tdataPath);
    const keyDataPath = path.join(normalizedPath, "key_datas");

    if (!fs.existsSync(keyDataPath)) {
      return {
        valid: false,
        error: `key_datas file missing.\n\nChecked path: ${normalizedPath}\n\nThis usually means:\n1. Telegram Desktop has never been logged in on this machine\n2. You're using the macOS App Store version (not supported)\n3. The tdata path is incorrect`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extract basic account info from tdata
 */
export interface TdataAccountInfo {
  userId: number;
  dcId: number;
}

export function extractAccountInfo(tdataPath: string): TdataAccountInfo | null {
  try {
    const normalizedPath = normalizeTdataPath(tdataPath);

    // Use pure JS implementation to extract account info
    const { userId, dcId } = extractAuthKey(normalizedPath);

    return {
      userId,
      dcId,
    };
  } catch (error) {
    console.error("[TdataConverter] Failed to extract account info:", error);
    return null;
  }
}
