import type {
  DirEntry,
  ListDirectoryOptions,
  PlatformFileSystem,
  SaveFileOptions,
} from "../../filesystem";
import { save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

function normalizePath(p: string): string {
  // Tauri uses platform-native separators on Windows; collapse to forward
  // slashes so downstream consumers (memory index, signals.jsonl) can do
  // string matching portably.
  return p.replace(/\\/g, "/");
}

function toExtList(ext: string[] | undefined): string[] {
  if (!ext || ext.length === 0) return [];
  return ext.map((e) => e.toLowerCase());
}

function matchesExt(name: string, exts: string[]): boolean {
  if (exts.length === 0) return true;
  const lower = name.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

export class TauriFileSystem implements PlatformFileSystem {
  async saveFile(data: Uint8Array, options?: SaveFileOptions): Promise<void> {
    const path = await save({
      defaultPath: options?.fileName,
    });
    if (!path) return;

    await writeFile(path, data);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = await readFile(path);
    // plugin-fs returns Uint8Array<ArrayBuffer>; widen for the shared interface.
    return new Uint8Array(bytes);
  }

  async listDirectory(
    path: string,
    options?: ListDirectoryOptions,
  ): Promise<DirEntry[]> {
    const recursive = options?.recursive ?? false;
    const exts = toExtList(options?.ext);
    const out: DirEntry[] = [];
    await this.walk(path, recursive, exts, out);
    return out;
  }

  private async walk(
    base: string,
    recursive: boolean,
    exts: string[],
    out: DirEntry[],
  ): Promise<void> {
    const entries = await readDir(base);
    for (const entry of entries) {
      const childPath = await join(base, entry.name);
      if (entry.isDirectory) {
        if (!recursive) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          // Skip hidden and well-known noise directories during recursive scans.
          continue;
        }
        await this.walk(childPath, recursive, exts, out);
        continue;
      }
      if (!entry.isFile) continue;
      if (!matchesExt(entry.name, exts)) continue;

      let mtimeMs = 0;
      let size = 0;
      try {
        const info = await stat(childPath);
        mtimeMs = info.mtime ? info.mtime.getTime() : 0;
        size = info.size ?? 0;
      } catch {
        // best-effort: leave zeros if stat fails (e.g. transient perms)
      }

      out.push({
        name: entry.name,
        path: normalizePath(childPath),
        isDirectory: false,
        mtimeMs,
        size,
      });
    }
  }
}

export const tauriFileSystem = new TauriFileSystem();
