import type {
  DirEntry,
  ListDirectoryOptions,
  PlatformFileSystem,
  SaveFileOptions,
} from "../../filesystem";

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};

type FSHandle = FileSystemDirectoryHandle | FileSystemFileHandle;

const VAULT_HANDLE_KEY = "openloomi:obsidian:vault-handle";
const VAULT_HANDLE_ID = "openloomi-obsidian-vault";

function isSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as FilePickerWindow;
  return (
    typeof w.showSaveFilePicker === "function" &&
    typeof w.showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as FilePickerWindow;
  return (
    typeof w.showSaveFilePicker === "function" &&
    typeof w.showDirectoryPicker === "function"
  );
}

async function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("openloomi-fs", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await openIDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const store = tx.objectStore("handles");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    const store = tx.objectStore("handles");
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    const store = tx.objectStore("handles");
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function matchesExt(name: string, exts: string[]): boolean {
  if (exts.length === 0) return true;
  const lower = name.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

function lastModifiedMs(file: File): number {
  // File.lastModified is epoch ms. Fall back to 0 if absent.
  return typeof file.lastModified === "number" ? file.lastModified : 0;
}

async function walkDirectory(
  base: FileSystemDirectoryHandle,
  basePath: string,
  recursive: boolean,
  exts: string[],
  out: DirEntry[],
): Promise<void> {
  // `FileSystemDirectoryHandle.prototype.entries()` is in the spec but not yet
  // in TypeScript's lib.dom.d.ts; cast through `unknown` to the WICG shape.
  const entries = (
    base as unknown as {
      entries(): AsyncIterableIterator<[string, FSHandle]>;
    }
  ).entries();
  for await (const [name, child] of entries) {
    const childPath = basePath ? `${basePath}/${name}` : name;
    if (child.kind === "directory") {
      if (!recursive) continue;
      if (name.startsWith(".") || name === "node_modules") continue;
      const dir = child as FileSystemDirectoryHandle;
      await walkDirectory(dir, childPath, recursive, exts, out);
      continue;
    }
    if (child.kind !== "file") continue;
    if (!matchesExt(name, exts)) continue;

    const fileHandle = child as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    out.push({
      name,
      path: childPath,
      isDirectory: false,
      mtimeMs: lastModifiedMs(file),
      size: file.size,
    });
  }
}

async function readFileFromHandle(
  handle: FileSystemFileHandle,
): Promise<Uint8Array> {
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

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

  async readFile(path: string): Promise<Uint8Array> {
    if (!isFileSystemAccessSupported()) {
      throw new Error(
        "[BrowserFileSystem] readFile requires File System Access API (Chromium-only).",
      );
    }
    const handle = await this.resolveFileHandle(path);
    if (!handle) {
      throw new Error(
        `[BrowserFileSystem] readFile could not resolve a handle for "${path}". ` +
          `Pick a vault via the settings UI first.`,
      );
    }
    return readFileFromHandle(handle);
  }

  async listDirectory(
    path: string,
    options?: ListDirectoryOptions,
  ): Promise<DirEntry[]> {
    if (!isFileSystemAccessSupported()) {
      throw new Error(
        "[BrowserFileSystem] listDirectory requires File System Access API (Chromium-only).",
      );
    }
    const handle = await this.resolveDirectoryHandle(path);
    if (!handle) {
      throw new Error(
        `[BrowserFileSystem] listDirectory could not resolve a handle for "${path}". ` +
          `Pick a vault via the settings UI first.`,
      );
    }
    const recursive = options?.recursive ?? false;
    const exts = (options?.ext ?? []).map((e) => e.toLowerCase());
    const out: DirEntry[] = [];
    await walkDirectory(handle, "", recursive, exts, out);
    return out;
  }

  /**
   * Prompt the user to pick an Obsidian-style vault directory. Must be called
   * from a user gesture (e.g. button click) — the File System Access API
   * rejects otherwise. The handle is persisted in IndexedDB so subsequent
   * ticks can read without re-prompting.
   */
  async pickVaultDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!isFileSystemAccessSupported()) {
      throw new Error(
        "[BrowserFileSystem] pickVaultDirectory requires File System Access API " +
          "(Chromium-only). Safari and Firefox cannot grant persistent directory access.",
      );
    }
    const browserWindow = window as FilePickerWindow;
    if (!browserWindow.showDirectoryPicker) {
      throw new Error("showDirectoryPicker is not available in this browser.");
    }
    const handle = await browserWindow.showDirectoryPicker({
      id: VAULT_HANDLE_ID,
      mode: "read",
    });
    await idbSet(VAULT_HANDLE_KEY, handle);
    return handle;
  }

  /**
   * Return the currently persisted vault handle, if any. Does not prompt.
   */
  async getPersistedVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!isSupported()) return null;
    const handle = await idbGet<FileSystemDirectoryHandle>(VAULT_HANDLE_KEY);
    if (!handle) return null;
    // The browser may invalidate the handle (permission revoked, sandbox reset);
    // queryPermission surfaces that so the caller can decide whether to re-prompt.
    try {
      const perm =
        (await (
          handle as unknown as {
            queryPermission?: (o: {
              mode: "read" | "readwrite";
            }) => Promise<string>;
          }
        ).queryPermission?.({ mode: "read" })) ?? "granted";
      if (perm !== "granted") return null;
      return handle;
    } catch {
      return handle;
    }
  }

  async clearPersistedVaultHandle(): Promise<void> {
    await idbDelete(VAULT_HANDLE_KEY);
  }

  /**
   * Resolve a slash-normalized absolute path to a FileSystemFileHandle by
   * walking the persisted vault. Returns null when the vault isn't picked or
   * the path lives outside of it.
   */
  private async resolveFileHandle(
    path: string,
  ): Promise<FileSystemFileHandle | null> {
    const vault = await this.getPersistedVaultHandle();
    if (!vault) return null;
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    return this.walkForFile(vault, segments);
  }

  private async resolveDirectoryHandle(
    path: string,
  ): Promise<FileSystemDirectoryHandle | null> {
    const vault = await this.getPersistedVaultHandle();
    if (!vault) return null;
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) return vault;
    return this.walkForDirectory(vault, segments);
  }

  private async walkForFile(
    dir: FileSystemDirectoryHandle,
    segments: string[],
  ): Promise<FileSystemFileHandle | null> {
    let current: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < segments.length - 1; i++) {
      const next = await current.getDirectoryHandle(segments[i], {
        create: false,
      });
      current = next;
    }
    try {
      return await current.getFileHandle(segments[segments.length - 1], {
        create: false,
      });
    } catch {
      return null;
    }
  }

  private async walkForDirectory(
    dir: FileSystemDirectoryHandle,
    segments: string[],
  ): Promise<FileSystemDirectoryHandle | null> {
    let current: FileSystemDirectoryHandle = dir;
    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment, { create: false });
      } catch {
        return null;
      }
    }
    return current;
  }
}

export const browserFileSystem = new BrowserFileSystem();
