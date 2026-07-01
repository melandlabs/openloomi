import type { PlatformFileSystem, SaveFileOptions } from "../../filesystem";

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
};

export class BrowserFileSystem implements PlatformFileSystem {
  async saveFile(data: Uint8Array, options?: SaveFileOptions): Promise<void> {
    const bytes = new Uint8Array(data);
    const browserWindow = window as FilePickerWindow;
    if (browserWindow.showSaveFilePicker) {
      try {
        const handle = await browserWindow.showSaveFilePicker({
          suggestedName: options?.fileName,
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return;
      } catch (error) {
        // ignore user cancel error
        // others error fallback to download with `a` tag
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error("[BrowserFileSystem] saving file failed:", error);
      }
    }

    const blob = new Blob([bytes], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = options?.fileName || "";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}

export const browserFileSystem = new BrowserFileSystem();
