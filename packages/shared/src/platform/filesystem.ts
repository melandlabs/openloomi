import { getPlatformKind } from "./env";

export interface SaveFileOptions {
  fileName?: string;
}

export interface PlatformFileSystem {
  saveFile(data: Uint8Array, options?: SaveFileOptions): Promise<void>;
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
