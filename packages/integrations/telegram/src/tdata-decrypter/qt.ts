// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Qt binary data format reader utilities.
 * Ported from telegram-tdata-decrypter qt.py
 */

import { Buffer } from "node:buffer";

/**
 * Read N bytes from buffer
 */
export function readBytes(
  buffer: Buffer,
  offset: number,
  size: number,
): Buffer {
  if (offset + size > buffer.length) {
    throw new Error(
      `Cannot read ${size} bytes at offset ${offset}, buffer length is ${buffer.length}`,
    );
  }
  return buffer.subarray(offset, offset + size);
}

/**
 * Read integer in big-endian format
 */
export function readQtInteger(
  buffer: Buffer,
  offset: number,
  size: number,
  signed: boolean,
): number {
  const value = readBytes(buffer, offset, size);
  const hex = value.toString("hex");

  // Convert to number (big-endian)
  let num = BigInt(`0x${hex}`);

  if (signed && num >= BigInt(2) ** BigInt(size * 8 - 1)) {
    num -= BigInt(2) ** BigInt(size * 8);
  }

  // Convert to Number (safe for 32-bit, for 64-bit return as Number but may lose precision)
  return Number(num);
}

/**
 * Read 32-bit signed integer (big-endian)
 */
export function readQtInt32(buffer: Buffer, offset: number): number {
  return readQtInteger(buffer, offset, 4, true);
}

/**
 * Read 32-bit unsigned integer (big-endian)
 */
export function readQtUint32(buffer: Buffer, offset: number): number {
  return readQtInteger(buffer, offset, 4, false);
}

/**
 * Read 64-bit signed integer (big-endian)
 */
export function readQtInt64(buffer: Buffer, offset: number): number {
  return readQtInteger(buffer, offset, 8, true);
}

/**
 * Read 64-bit unsigned integer (big-endian)
 */
export function readQtUint64(buffer: Buffer, offset: number): number {
  return readQtInteger(buffer, offset, 8, false);
}

/**
 * Read byte array (length-prefixed)
 * Returns { value, newOffset }
 */
export interface ReadResult<T> {
  value: T;
  newOffset: number;
}

export function readQtByteArray(
  buffer: Buffer,
  offset: number,
): ReadResult<Buffer> {
  const length = readQtInt32(buffer, offset);
  let newOffset = offset + 4;

  if (length <= 0) {
    return { value: Buffer.alloc(0), newOffset };
  }

  const value = readBytes(buffer, newOffset, length);
  newOffset += length;

  return { value, newOffset };
}

/**
 * Read UTF-16 string (byte array decoded as UTF-16)
 */
export function readQtUtf8(buffer: Buffer, offset: number): ReadResult<string> {
  const { value, newOffset } = readQtByteArray(buffer, offset);
  // The original Python code decodes as utf16
  const str = value.toString("utf16le");
  return { value: str, newOffset };
}
