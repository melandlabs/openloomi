import type { PlatformFileSystem, SaveFileOptions } from "../../filesystem";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export class TauriFileSystem implements PlatformFileSystem {
  async saveFile(data: Uint8Array, options?: SaveFileOptions): Promise<void> {
    const path = await save({
      defaultPath: options?.fileName,
    });
    if (!path) return;

    await writeFile(path, data);
  }
}

export const tauriFileSystem = new TauriFileSystem();
