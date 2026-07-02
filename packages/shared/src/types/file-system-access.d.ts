// Module augmentation for the File System Access API.
// The standard `FileSystemDirectoryHandle` in TypeScript's `lib.dom.d.ts`
// does not yet expose `entries()` / `values()` / `keys()` async iterators,
// which are widely supported in Chromium and required for vault walks.
// See https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle

declare interface FileSystemDirectoryHandle {
  /**
   * Returns an async iterator over the directory's entries. Each yielded
   * value is a `[name, handle]` tuple (matching `Map.prototype.entries`).
   */
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  keys(): AsyncIterableIterator<string>;

  /**
   * Returns an async iterator over the directory's entries. Equivalent to
   * `values()` — provided to support `for await (const handle of dir)`.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<FileSystemHandle>;
}
