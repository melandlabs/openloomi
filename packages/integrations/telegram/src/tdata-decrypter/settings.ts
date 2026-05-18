// Copyright 2026 OpenLoomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

/**
 * Settings block reader.
 * Ported from telegram-tdata-decrypter settings.py
 */

import type { Buffer } from "node:buffer";
import { readQtInt32, readQtUint64, readQtByteArray, readQtUtf8 } from "./qt";

/**
 * Settings block IDs
 */
export enum SettingsBlocks {
  dbiKey = 0x00,
  dbiUser = 0x01,
  dbiDcOptionOldOld = 0x02,
  dbiChatSizeMaxOld = 0x03,
  dbiMutePeerOld = 0x04,
  dbiSendKeyOld = 0x05,
  dbiAutoStart = 0x06,
  dbiStartMinimized = 0x07,
  dbiSoundFlashBounceNotifyOld = 0x08,
  dbiWorkModeOld = 0x09,
  dbiSeenTrayTooltip = 0x0a,
  dbiDesktopNotifyOld = 0x0b,
  dbiAutoUpdate = 0x0c,
  dbiLastUpdateCheck = 0x0d,
  dbiWindowPositionOld = 0x0e,
  dbiConnectionTypeOldOld = 0x0f,
  dbiDefaultAttach = 0x11,
  dbiCatsAndDogsOld = 0x12,
  dbiReplaceEmojiOld = 0x13,
  dbiAskDownloadPathOld = 0x14,
  dbiDownloadPathOldOld = 0x15,
  dbiScaleOld = 0x16,
  dbiEmojiTabOld = 0x17,
  dbiRecentEmojiOldOldOld = 0x18,
  dbiLoggedPhoneNumberOld = 0x19,
  dbiMutedPeersOld = 0x1a,
  dbiNotifyViewOld = 0x1c,
  dbiSendToMenu = 0x1d,
  dbiCompressPastedImageOld = 0x1e,
  dbiLangOld = 0x1f,
  dbiLangFileOld = 0x20,
  dbiTileBackgroundOld = 0x21,
  dbiAutoLockOld = 0x22,
  dbiDialogLastPath = 0x23,
  dbiRecentEmojiOldOld = 0x24,
  dbiEmojiVariantsOldOld = 0x25,
  dbiRecentStickers = 0x26,
  dbiDcOptionOld = 0x27,
  dbiTryIPv6Old = 0x28,
  dbiSongVolumeOld = 0x29,
  dbiWindowsNotificationsOld = 0x30,
  dbiIncludeMutedOld = 0x31,
  dbiMegagroupSizeMaxOld = 0x32,
  dbiDownloadPathOld = 0x33,
  dbiAutoDownloadOld = 0x34,
  dbiSavedGifsLimitOld = 0x35,
  dbiShowingSavedGifsOld = 0x36,
  dbiAutoPlayOld = 0x37,
  dbiAdaptiveForWideOld = 0x38,
  dbiHiddenPinnedMessagesOld = 0x39,
  dbiRecentEmojiOld = 0x3a,
  dbiEmojiVariantsOld = 0x3b,
  dbiDialogsModeOld = 0x40,
  dbiModerateModeOld = 0x41,
  dbiVideoVolumeOld = 0x42,
  dbiStickersRecentLimitOld = 0x43,
  dbiNativeNotificationsOld = 0x44,
  dbiNotificationsCountOld = 0x45,
  dbiNotificationsCornerOld = 0x46,
  dbiThemeKeyOld = 0x47,
  dbiDialogsWidthRatioOld = 0x48,
  dbiUseExternalVideoPlayerOld = 0x49,
  dbiDcOptionsOld = 0x4a,
  dbiMtpAuthorization = 0x4b,
  dbiLastSeenWarningSeenOld = 0x4c,
  dbiSessionSettings = 0x4d,
  dbiLangPackKey = 0x4e,
  dbiConnectionTypeOld = 0x4f,
  dbiStickersFavedLimitOld = 0x50,
  dbiSuggestStickersByEmojiOld = 0x51,
  dbiSuggestEmojiOld = 0x52,
  dbiTxtDomainStringOldOld = 0x53,
  dbiThemeKey = 0x54,
  dbiTileBackground = 0x55,
  dbiCacheSettingsOld = 0x56,
  dbiPowerSaving = 0x57,
  dbiScalePercent = 0x58,
  dbiPlaybackSpeedOld = 0x59,
  dbiLanguagesKey = 0x5a,
  dbiCallSettingsOld = 0x5b,
  dbiCacheSettings = 0x5c,
  dbiTxtDomainStringOld = 0x5d,
  dbiApplicationSettings = 0x5e,
  dbiDialogsFiltersOld = 0x5f,
  dbiFallbackProductionConfig = 0x60,
  dbiBackgroundKey = 0x61,
  dbiEncryptedWithSalt = 333,
  dbiEncrypted = 444,
  dbiVersion = 666,
}

/**
 * Read settings block value based on block ID
 */
export function readSettingsBlock(
  version: number,
  buffer: Buffer,
  offset: number,
  blockId: SettingsBlocks,
): { value: unknown; newOffset: number } {
  switch (blockId) {
    case SettingsBlocks.dbiAutoStart:
    case SettingsBlocks.dbiStartMinimized:
    case SettingsBlocks.dbiSendToMenu:
    case SettingsBlocks.dbiSeenTrayTooltip:
    case SettingsBlocks.dbiAutoUpdate: {
      const value = readQtInt32(buffer, offset) === 1;
      return { value, newOffset: offset + 4 };
    }

    case SettingsBlocks.dbiSongVolumeOld: {
      const value = readQtInt32(buffer, offset) / 1e6;
      return { value, newOffset: offset + 4 };
    }

    case SettingsBlocks.dbiLastUpdateCheck:
    case SettingsBlocks.dbiScalePercent:
    case SettingsBlocks.dbiPowerSaving: {
      const value = readQtInt32(buffer, offset);
      return { value, newOffset: offset + 4 };
    }

    case SettingsBlocks.dbiFallbackProductionConfig:
    case SettingsBlocks.dbiApplicationSettings: {
      const { value, newOffset } = readQtByteArray(buffer, offset);
      return { value, newOffset };
    }

    case SettingsBlocks.dbiDialogLastPath: {
      const { value, newOffset } = readQtUtf8(buffer, offset);
      return { value, newOffset };
    }

    case SettingsBlocks.dbiThemeKey: {
      const day = readQtUint64(buffer, offset);
      const night = readQtUint64(buffer, offset + 8);
      const nightMode = readQtInt32(buffer, offset + 16) === 1;
      return {
        value: { day, night, nightMode },
        newOffset: offset + 20,
      };
    }

    case SettingsBlocks.dbiBackgroundKey: {
      const day = readQtUint64(buffer, offset);
      const night = readQtUint64(buffer, offset + 8);
      return {
        value: { day, night },
        newOffset: offset + 16,
      };
    }

    case SettingsBlocks.dbiTileBackground: {
      const day = readQtInt32(buffer, offset);
      const night = readQtInt32(buffer, offset + 4);
      return {
        value: { day, night },
        newOffset: offset + 8,
      };
    }

    case SettingsBlocks.dbiLangPackKey: {
      const value = readQtUint64(buffer, offset);
      return { value, newOffset: offset + 8 };
    }

    case SettingsBlocks.dbiMtpAuthorization: {
      const { value, newOffset } = readQtByteArray(buffer, offset);
      return { value, newOffset };
    }

    default:
      throw new Error(`Unknown block ID while reading settings: ${blockId}`);
  }
}

/**
 * Read all settings blocks from buffer
 */
export function readSettingsBlocks(
  version: number,
  buffer: Buffer,
): Map<SettingsBlocks, unknown> {
  const blocks = new Map<SettingsBlocks, unknown>();
  let offset = 0;

  try {
    while (offset < buffer.length) {
      const blockId = readQtInt32(buffer, offset) as SettingsBlocks;
      offset += 4;

      const { value, newOffset } = readSettingsBlock(
        version,
        buffer,
        offset,
        blockId,
      );
      offset = newOffset;

      blocks.set(blockId, value);
    }
  } catch {
    // End of data
  }

  return blocks;
}
