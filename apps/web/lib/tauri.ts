/**
 * Tauri API helper functions
 * Used to call native functionality in Tauri environment
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Check if in Tauri environment (supports both server and client)
 * Server environment determined by IS_TAURI environment variable
 * Client environment checks window.__TAURI__
 */
export const isTauri = () => {
  // Client: check window.__TAURI__
  return typeof window !== "undefined" && "__TAURI__" in window;
};

function resolveBrowserUrl(url: string) {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

/**
 * Get data directory path
 */
export const getDataDirectory = async () => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<string>("get_data_directory");
  } catch (error) {
    console.error("Failed to get data directory:", error);
    return null;
  }
};

/**
 * Get the storage data directory
 */
export const getStorageDirectory = async () => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<string>("get_storage_directory");
  } catch (error) {
    console.error("Failed to get storage directory:", error);
    return null;
  }
};

/**
 * Get memory directory path
 * Memory directory used for storing user memory files
 */
export const getMemoryDirectory = async () => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<string>("get_memory_directory");
  } catch (error) {
    console.error("Failed to get memory directory:", error);
    return null;
  }
};

/**
 * Get the operating system's UI locale (e.g. "en-US", "zh-CN").
 * Reads the OS-level language rather than the webview's `navigator.language`.
 * Returns null on web (non-Tauri) environments.
 */
export const getSystemLocale = async (): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<string>("get_system_locale");
  } catch (error) {
    console.error("Failed to get system locale:", error);
    return null;
  }
};

/**
 * Get application information
 */
export const getAppInfo = async () => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke("get_app_info");
  } catch (error) {
    console.error("Failed to get app info:", error);
    return null;
  }
};

/**
 * Open developer tools (only available in development mode)
 * Note: Tauri automatically opens devtools in development mode
 */
export const openDevTools = async () => {
  if (!isTauri()) {
    return;
  }
  // Tauri 2.0 automatically opens devtools in development mode
  // This feature is not available in production environment
  console.warn("DevTools are only available in development mode");
};

/**
 * Open URL in browser
 */
export const openUrl = async (url: string) => {
  if (isTauri()) {
    const browserUrl = resolveBrowserUrl(url);
    // Tauri Webview environment - use custom commands
    try {
      await invoke("open_url_custom", { url: browserUrl });
    } catch (error) {
      console.error("Failed to open URL with Tauri:", error);
      window.open(browserUrl, "_blank");
    }
  } else if (typeof window !== "undefined") {
    // Browser environment
    window.open(url, "_blank");
  } else {
    // Node.js server environment
    // In server, can't directly open browser
    // Return URL for frontend to handle
    console.warn("openUrl called in server environment, returning URL:", url);
    return url;
  }
};

/**
 * Open file/path
 */
export const openPathCustom = async (path: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  try {
    await invoke("open_path_custom", { path });
    return true;
  } catch (error) {
    console.error("Failed to open path:", error);
    return false;
  }
};

/**
 * Open folder selection dialog
 * Returns selected folder path, returns null if user cancels
 */
export const pickFolderDialog = async (): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    const path = await invoke<string | null>("pick_folder_dialog");
    return path;
  } catch (error) {
    console.error("Failed to pick folder:", error);
    return null;
  }
};

/**
 * Read file content (returns Uint8Array, for binary files)
 */
export const readFileBinary = async (
  path: string,
): Promise<Uint8Array | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    const data = await invoke<number[]>("read_file_custom", { path });
    return new Uint8Array(data);
  } catch (error) {
    console.error("Failed to read file:", error);
    return null;
  }
};

/**
 * Read file content (returns string, for text files)
 */
export const readFile = async (path: string): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    const data = await readFileBinary(path);
    if (!data) return null;
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(data);
  } catch (error) {
    console.error("Failed to read file:", error);
    return null;
  }
};

/**
 * Get file metadata
 */
export const fileStat = async (
  path: string,
): Promise<{ size: number; isFile: boolean; isDir: boolean } | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke("file_stat_custom", { path });
  } catch (error) {
    console.error(`[fileStat] for ${path} Error:`, error);
    return null;
  }
};

/**
 * Check if file exists
 */
export const fileExists = async (path: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  try {
    return await invoke("file_exists_custom", { path });
  } catch (error) {
    return false;
  }
};

/**
 * Create directory
 */
export const mkdirCustom = async (dirPath: string): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("mkdir_custom", { dirPath });
  } catch (error) {
    console.warn(`Failed to create directory ${dirPath}:`, error);
  }
};

/**
 * Write text file
 */
export const writeTextFileCustom = async (
  filePath: string,
  content: string,
): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("write_text_file_custom", { filePath, content });
  } catch (error) {
    console.error(`Failed to write file ${filePath}:`, error);
  }
};

/**
 * Read text file
 */
export const readTextFileCustom = async (
  filePath: string,
): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke("read_text_file_custom", { filePath });
  } catch (error) {
    console.error(`Failed to read file ${filePath}:`, error);
    return null;
  }
};

/**
 * Delete file
 */
export const removeFileCustom = async (filePath: string): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("remove_file_custom", { filePath });
  } catch (error) {
    console.error("Failed to remove file:", error);
  }
};

/**
 * Show file in file manager
 */
export const revealItemInDir = async (path: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  try {
    await invoke("reveal_item_in_dir_custom", { path });
    return true;
  } catch (error) {
    console.error("Failed to reveal item:", error);
    return false;
  }
};

/**
 * Copy a file to the system clipboard as a native file reference.
 * On macOS, writes a public.file-url UTI to the pasteboard, matching
 * Finder's ⌘C behavior.  Works for all file types (PPTX, DOCX, PDF, etc.).
 * Returns true on success, false if not in Tauri or on failure.
 */
export const copyFileToClipboard = async (path: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  try {
    await invoke("copy_file_to_clipboard", { path });
    return true;
  } catch (error) {
    console.error("Failed to copy file to clipboard:", error);
    return false;
  }
};

/**
 * Get home directory path
 */
export const homeDirCustom = async (): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke("home_dir_custom");
  } catch (error) {
    console.error("Failed to get home dir:", error);
    return null;
  }
};

/**
 * Get platform information
 */
export const getPlatform = () => {
  if (typeof window === "undefined") {
    return "unknown";
  }

  if (isTauri()) {
    // Tauri environment
    return "tauri";
  }

  // Browser environment
  return "browser";
};

/**
 * Host operating system as reported by the Tauri runtime.
 * `null` while the platform is being resolved or when not running in Tauri.
 */
export type DesktopOS = "macos" | "windows" | "linux" | "browser";

let cachedOS: DesktopOS | null = null;
let osPromise: Promise<DesktopOS> | null = null;

/**
 * Resolve the host OS. Safe to call from any context — returns `"browser"`
 * outside of Tauri and caches the result so subsequent calls are synchronous.
 *
 * The value comes from the `get_host_os` Rust command (see
 * `apps/web/src-tauri/src/system.rs`), which uses `cfg!(target_os = ...)` to
 * report `"macos" | "windows" | "linux" | "other"`.
 */
export function getOS(): Promise<DesktopOS> {
  if (cachedOS) return Promise.resolve(cachedOS);
  if (osPromise) return osPromise;

  osPromise = (async () => {
    if (typeof window === "undefined" || !isTauri()) {
      cachedOS = "browser";
      return cachedOS;
    }
    try {
      const value = await invoke<string>("get_host_os");
      if (value === "macos" || value === "windows" || value === "linux") {
        cachedOS = value;
      } else {
        cachedOS = "browser";
      }
    } catch (error) {
      console.error("Failed to detect host OS:", error);
      cachedOS = "browser";
    }
    return cachedOS;
  })();

  return osPromise;
}

/**
 * Read the cached OS synchronously. Returns `null` if detection has not yet
 * completed (first render before the async resolve).
 */
export function getCachedOS(): DesktopOS | null {
  return cachedOS;
}

// ============ Auto Update ============

/**
 * Update check result type
 */
export interface UpdateCheckResult {
  has_update: boolean;
  latest_version: string;
  current_version: string;
  download_url: string;
  release_url: string;
  file_size: number;
}

/**
 * Check GitHub tags to determine if there's a new version
 */
export const checkForUpdate = async (): Promise<UpdateCheckResult | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<UpdateCheckResult>("check_for_update");
  } catch (error) {
    console.warn("Failed to check for update:", error);
    return null;
  }
};

/**
 * Auto installation result
 */
export interface UpdateInstallResult {
  auto_installed: boolean;
  message: string;
  backup_created: boolean;
  backup_path: string | null;
}

export interface UpdateInstallOptions {
  backup?: boolean;
}

/**
 * Download progress type (for polling)
 */
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  error: string | null;
}

/**
 * Start update download (non-blocking, use pollUpdateDownloadProgress to track)
 */
export const startUpdateDownload = async (
  downloadUrl: string,
  fileSize: number,
): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("start_update_download", {
      downloadUrl,
      fileSize,
    });
  } catch (error) {
    console.error("Failed to start update download:", error);
    throw error;
  }
};

/**
 * Poll download progress (call repeatedly while downloading)
 */
export const pollUpdateDownloadProgress =
  async (): Promise<DownloadProgress> => {
    if (!isTauri()) {
      return { downloaded: 0, total: 0, percent: 0, done: false, error: null };
    }
    try {
      return await invoke<DownloadProgress>("poll_update_download_progress");
    } catch (error) {
      console.error("Failed to poll download progress:", error);
      return { downloaded: 0, total: 0, percent: 0, done: false, error: null };
    }
  };

/**
 * Finish update (install the downloaded file, called after poll shows done)
 */
export const finishUpdateDownload = async (
  options?: UpdateInstallOptions,
): Promise<UpdateInstallResult | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<UpdateInstallResult>("finish_update_download", {
      options: options ?? null,
    });
  } catch (error) {
    console.error("Failed to finish update:", error);
    throw error;
  }
};
/**
 * Restart application to complete update
 */
export const restartForUpdate = async (): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("restart_for_update");
  } catch (error) {
    console.error("Failed to restart for update:", error);
  }
};

/**
 * Restart the application
 */
export const restartApp = async (): Promise<void> => {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("restart_app");
  } catch (error) {
    console.error("Failed to restart app:", error);
  }
};

// ============ Server Status ============

/**
 * Server status type
 */
export interface ServerStatus {
  running: boolean;
  status: string; // "starting", "downloading", "running", "error"
  error_message: string | null;
  node_version: string | null;
}

/**
 * Get server status (Tauri specific)
 */
export async function getServerStatus(): Promise<ServerStatus | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<ServerStatus>("get_server_status");
  } catch (error) {
    console.error("Failed to get server status:", error);
    return null;
  }
}

/**
 * Restart the Next.js server (Tauri specific)
 */
export async function restartServer(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("restart_server");
  } catch (error) {
    console.error("Failed to restart server:", error);
    throw error;
  }
}

// ============ Render Engine ============

export interface DesktopRuntimeComponentStatus {
  available: boolean;
  install_dir: string | null;
  installed: boolean;
  downloading: boolean;
  reason: string | null;
  error_message: string | null;
}

export interface DesktopRenderRuntimeStatus {
  available: boolean;
  install_dir: string | null;
  installed: boolean;
  downloading: boolean;
  reason: string | null;
  error_message: string | null;
  soffice_binary_path: string | null;
  pdftoppm_binary_path: string | null;
}

export interface DesktopRenderEngineInstalled {
  version: string;
  installed_at: string;
  install_dir: string;
  soffice_path: string;
  pdftoppm_path: string;
  python_path?: string;
}

export interface DesktopRenderEngineStatus {
  available: boolean;
  install_dir: string | null;
  installed: boolean;
  downloading: boolean;
  reason: string | null;
  error_message: string | null;
}

export async function getRenderEngineStatus(): Promise<DesktopRenderEngineStatus | null> {
  if (!isTauri()) {
    return null;
  }
  let status: DesktopRenderRuntimeStatus | null = null;
  try {
    status = await invoke<DesktopRenderRuntimeStatus>(
      "get_render_engine_status_cmd",
    );
  } catch (error) {
    console.error("Failed to get render engine status:", error);
    return null;
  }
  if (!status) {
    return null;
  }
  return {
    available: status.available,
    install_dir: status.install_dir,
    installed: status.installed,
    downloading: status.downloading,
    reason: status.reason,
    error_message: status.error_message,
  };
}

export async function ensureRenderEngineDownloadStarted(): Promise<DesktopRenderEngineStatus | null> {
  if (!isTauri()) {
    return null;
  }
  let status: DesktopRenderRuntimeStatus | null = null;
  try {
    status = await invoke<DesktopRenderRuntimeStatus>(
      "ensure_render_engine_download_started_cmd",
    );
  } catch (error) {
    console.error("Failed to start render engine download:", error);
    return null;
  }
  if (!status) {
    return null;
  }
  return {
    available: status.available,
    install_dir: status.install_dir,
    installed: status.installed,
    downloading: status.downloading,
    reason: status.reason,
    error_message: status.error_message,
  };
}

// ============ Notification ============

/**
 * Send a system notification
 */
export async function sendNotification(
  title: string,
  body: string,
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("send_notification", { title, body });
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

/**
 * Tauri API exports
 */
export const tauriApi = {
  isTauri,
  getDataDirectory,
  getStorageDirectory,
  getMemoryDirectory,
  getAppInfo,
  openDevTools,
  openUrl,
  openPathCustom,
  readFile,
  readFileBinary,
  fileStat,
  fileExists,
  mkdirCustom,
  writeTextFileCustom,
  readTextFileCustom,
  removeFileCustom,
  revealItemInDir,
  copyFileToClipboard,
  homeDirCustom,
  getPlatform,
  // Server status
  getServerStatus,
  restartServer,
  checkForUpdate,
  restartForUpdate,
  restartApp,
  // Render engine
  getRenderEngineStatus,
  // Notification
  sendNotification,
};
