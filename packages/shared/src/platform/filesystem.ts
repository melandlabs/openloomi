import { getPlatformKind } from "./env";

export interface SaveFileOptions {
  fileName?: string;
}

export interface DirEntry {
  name: string;
  /** Absolute, slash-normalized path. */
  path: string;
  isDirectory: boolean;
  /** Modification time in epoch milliseconds. Used for incremental scanning. */
  mtimeMs: number;
  /** File size in bytes. 0 for directories. */
  size: number;
}

export interface ListDirectoryOptions {
  /** Recurse into subdirectories. Defaults to false. */
  recursive?: boolean;
  /** Filter to entries whose name ends with one of these extensions (e.g. [".md"]). */
  ext?: string[];
}

export interface PlatformFileSystem {
  saveFile(data: Uint8Array, options?: SaveFileOptions): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listDirectory(
    path: string,
    options?: ListDirectoryOptions,
  ): Promise<DirEntry[]>;
}

export async function getFileSystem(): Promise<PlatformFileSystem> {
  const platform = getPlatformKind();

  if (platform === "tauri") {
    const mod = await import("./adapters/tauri/filesystem");
    return mod.tauriFileSystem;
  }
  if (platform === "browser") {
    const mod = await import("./adapters/browser/filesystem");
    return mod.browserFileSystem;
  }

  throw new Error("unsupported platform");
}
