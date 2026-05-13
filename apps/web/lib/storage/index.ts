/**
 * Unified entry point for storage adapters
 * Automatically selects Vercel Blob or local file system based on deployment mode
 */

import type {
  BlobUploadResult,
  BlobListResult,
} from "@openloomi/storage/adapters";
import type {
  LocalUploadResult,
  LocalFileMeta,
} from "@openloomi/storage/adapters";
import {
  uploadToVercelBlob,
  deleteFromVercelBlob,
  listVercelBlobs,
} from "@openloomi/storage/adapters";
import {
  uploadToLocalFs,
  deleteFromLocalFs,
  listLocalFiles,
  readLocalFile,
  localFileExists,
} from "@openloomi/storage/adapters";
import { TAURI_STORAGE_PATH, isTauriMode } from "@/lib/env";

export type StorageUploadResult = BlobUploadResult | LocalUploadResult;
export type StorageFileMeta = BlobListResult | LocalFileMeta;

/**
 * Upload file (automatically selects storage method based on deployment mode)
 */
export async function uploadFile(
  pathname: string,
  data: ArrayBuffer | Buffer,
  contentType: string,
): Promise<StorageUploadResult> {
  if (isTauriMode()) {
    return uploadToLocalFs(pathname, data, contentType, TAURI_STORAGE_PATH);
  }
  return uploadToVercelBlob(pathname, data, contentType);
}

/**
 * Delete file (automatically selects storage method based on deployment mode)
 */
export async function deleteFile(
  url: string,
  pathname?: string,
): Promise<void> {
  if (isTauriMode()) {
    if (!pathname) {
      throw new Error("pathname is required for local file deletion");
    }
    return deleteFromLocalFs(pathname, TAURI_STORAGE_PATH);
  }
  return deleteFromVercelBlob(url);
}

/**
 * List files (automatically selects storage method based on deployment mode)
 */
export async function listFiles(prefix?: string): Promise<StorageFileMeta[]> {
  if (isTauriMode()) {
    return listLocalFiles(TAURI_STORAGE_PATH, prefix);
  }
  return listVercelBlobs(prefix);
}

/**
 * Read local file (Tauri mode only)
 */
export async function readFile(pathname: string): Promise<Buffer> {
  if (!isTauriMode()) {
    throw new Error("readFile is only available in Tauri mode");
  }
  return readLocalFile(pathname, TAURI_STORAGE_PATH);
}

/**
 * Check if local file exists (Tauri mode only)
 */
export function fileExists(pathname: string): boolean {
  if (!isTauriMode()) {
    throw new Error("fileExists is only available in Tauri mode");
  }
  return localFileExists(pathname, TAURI_STORAGE_PATH);
}

// Export types
export type { BlobUploadResult, LocalUploadResult };
