// Copyright 2026 OpenLoomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Storage decryption utilities.
 * Ported from telegram-tdata-decrypter storage.py
 */

import { Buffer } from "node:buffer";
import type { RawTdfFile } from "./tdf";
import { createLocalKey, createLegacyLocalKey, decryptLocal } from "./crypto";
import { readQtByteArray } from "./qt";

/**
 * Decrypt settings TDF file
 */
export function decryptSettingsTdf(settingsTdf: RawTdfFile): Buffer {
  const encryptedData = settingsTdf.encryptedData;

  let offset = 0;
  const { value: salt, newOffset: offset1 } = readQtByteArray(
    encryptedData,
    offset,
  );
  offset = offset1;
  const { value: encryptedSettings, newOffset: _ } = readQtByteArray(
    encryptedData,
    offset,
  );

  // Settings key is created with empty passcode
  const settingsKey = createLegacyLocalKey(Buffer.alloc(0), salt);

  return decryptLocal(encryptedSettings, settingsKey);
}

/**
 * Decrypt key data TDF file
 * Returns [localKey, infoDecrypted]
 */
export function decryptKeyDataTdf(
  passcode: Buffer,
  keyDataTdf: RawTdfFile,
): [Buffer, Buffer] {
  const stream = keyDataTdf.encryptedData;

  let offset = 0;
  const { value: salt, newOffset: offset1 } = readQtByteArray(stream, offset);
  offset = offset1;
  const { value: keyEncrypted, newOffset: offset2 } = readQtByteArray(
    stream,
    offset,
  );
  offset = offset2;
  const { value: infoEncrypted, newOffset: _ } = readQtByteArray(
    stream,
    offset,
  );

  // Create passcode key
  const passcodeKey = createLocalKey(passcode, salt);

  // Decrypt local key
  const localKey = decryptLocal(keyEncrypted, passcodeKey);

  // Decrypt info
  const infoDecrypted = decryptLocal(infoEncrypted, localKey);

  return [localKey, infoDecrypted];
}

/**
 * Read key data accounts
 * Returns [indexes, mainAccount]
 */
export function readKeyDataAccounts(data: Buffer): [number[], number] {
  let offset = 0;
  const count = data.readInt32BE(offset);
  offset += 4;

  const indexes: number[] = [];
  for (let i = 0; i < count; i++) {
    const index = data.readInt32BE(offset);
    offset += 4;
    indexes.push(index);
  }

  const mainAccount = data.readInt32BE(offset);

  return [indexes, mainAccount];
}
