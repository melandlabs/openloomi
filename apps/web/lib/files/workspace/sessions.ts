/**
 * Workspace Sessions Manager
 *
 */

import {
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { join, dirname, resolve, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { workspaceLogger } from "@/lib/utils/logger";

/**
 * Cache for session files to avoid repeated directory traversal.
 * TTL: 30 seconds
 */
interface SessionFilesCache {
  files: SessionFile[];
  size: number;
}

const sessionFilesCache = new Map<
  string,
  { data: SessionFilesCache; timestamp: number }
>();
const CACHE_TTL_MS = 30_000;

function getCachedSessionFiles(sessionDir: string): SessionFilesCache | null {
  const cached = sessionFilesCache.get(sessionDir);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    sessionFilesCache.delete(sessionDir);
    return null;
  }
  return cached.data;
}

function setCachedSessionFiles(
  sessionDir: string,
  data: SessionFilesCache,
): void {
  sessionFilesCache.set(sessionDir, { data, timestamp: Date.now() });
}

export function invalidateSessionFilesCache(sessionDir?: string): void {
  if (sessionDir) {
    sessionFilesCache.delete(sessionDir);
  } else {
    sessionFilesCache.clear();
  }
}

export const SESSIONS_DIR_NAME = "sessions";
export const TASKS_DIR_NAME = "tasks";

/**
 * Get application data directory
 * macOS/Linux: ~/.openloomi
 * Windows: %USERPROFILE%\.openloomi
 */
export function getAppDataDir(): string {
  const home = homedir();
  return join(home, ".openloomi");
}

/**
 * Get sessions directory path
 */
export function getSessionsDir(): string {
  return join(getAppDataDir(), SESSIONS_DIR_NAME);
}

/**
 * Get session directory for specified task
 */
export function getTaskSessionDir(taskId: string): string {
  return join(getSessionsDir(), taskId);
}

/**
 * Initialize application data directory structure
 */
export function initializeWorkspace(): void {
  const appDataDir = getAppDataDir();
  const sessionsDir = getSessionsDir();

  // Create main directory
  if (!existsSync(appDataDir)) {
    mkdirSync(appDataDir, { recursive: true });
    workspaceLogger.info("Created app data directory", appDataDir);
  }

  // Create sessions directory
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
    workspaceLogger.info("Created sessions directory", sessionsDir);
  }
}

/**
 * Create new task session directory
 */
export function createTaskSession(taskId: string): string {
  initializeWorkspace();

  const sessionDir = getTaskSessionDir(taskId);

  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
    workspaceLogger.info("Created task session", sessionDir);
  }

  return sessionDir;
}

/**
 * Check if task session exists
 */
export function hasTaskSession(taskId: string): boolean {
  const sessionDir = getTaskSessionDir(taskId);
  return existsSync(sessionDir);
}

/**
 * Delete task session directory
 */
export function deleteTaskSession(taskId: string): boolean {
  const sessionDir = getTaskSessionDir(taskId);

  if (!existsSync(sessionDir)) {
    return false;
  }

  try {
    rmSync(sessionDir, { recursive: true, force: true });
    workspaceLogger.info("Deleted task session", sessionDir);
    return true;
  } catch (error) {
    workspaceLogger.error("Failed to delete task session:", error);
    return false;
  }
}

/**
 * Get list of files in session directory
 */
export interface SessionFile {
  name: string;
  path: string;
  /** Absolute path to the file (for direct file access like preview) */
  absolutePath?: string;
  size: number;
  isDirectory: boolean;
  modifiedTime: Date;
  type?: string; // File extension (e.g., "html", "js", "css")
}

export function listSessionFiles(
  taskId: string,
  relativePath = "",
): SessionFile[] {
  const sessionDir = getTaskSessionDir(taskId);
  const targetPath = relativePath ? join(sessionDir, relativePath) : sessionDir;

  if (!existsSync(targetPath)) {
    return [];
  }

  const files: SessionFile[] = [];
  const entries = readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(targetPath, entry.name);
    const stats = statSync(fullPath);

    // Extract file extension as type
    const ext = entry.name.includes(".")
      ? entry.name.split(".").pop()?.toLowerCase()
      : "";

    files.push({
      name: entry.name,
      path: fullPath,
      size: stats.size,
      isDirectory: entry.isDirectory(),
      modifiedTime: stats.mtime,
      type: entry.isDirectory() ? undefined : ext || undefined,
    });
  }

  // Sort by modification time (newest first)
  return files.sort((a, b) => {
    const timeA = a.modifiedTime?.getTime() ?? 0;
    const timeB = b.modifiedTime?.getTime() ?? 0;
    return timeB - timeA;
  });
}

/**
 * Read session file content (text)
 */
function validatePath(taskId: string, filePath: string): string | null {
  const sessionDir = resolve(getTaskSessionDir(taskId));

  // If filePath is already an absolute path within the session directory, use it directly
  if (isAbsolute(filePath)) {
    const resolved = resolve(filePath);
    if (resolved.startsWith(sessionDir + sep) || resolved === sessionDir) {
      return resolved;
    }
    workspaceLogger.error("Absolute path outside session directory:", filePath);
    return null;
  }

  // Relative path: join with session directory
  const fullPath = resolve(join(sessionDir, filePath));

  // Must be within sessionDir to read
  if (!fullPath.startsWith(sessionDir + sep)) {
    workspaceLogger.error("Path traversal attempt detected:", filePath);
    return null;
  }

  return fullPath;
}

export function readSessionFile(
  taskId: string,
  filePath: string,
): string | null {
  const fullPath = validatePath(taskId, filePath);
  if (!fullPath) {
    return null;
  }

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    return readFileSync(fullPath, "utf-8");
  } catch (error) {
    workspaceLogger.error("Failed to read file:", error);
    return null;
  }
}

/**
 * Read session binary file content
 */
export function readSessionFileBinary(
  taskId: string,
  filePath: string,
): Buffer | null {
  const fullPath = validatePath(taskId, filePath);
  if (!fullPath) {
    return null;
  }

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    return readFileSync(fullPath) as Buffer;
  } catch (error) {
    workspaceLogger.error("Failed to read binary file:", error);
    return null;
  }
}

/**
 * Check if file exists
 */
export function sessionFileExists(taskId: string, filePath: string): boolean {
  const fullPath = join(getTaskSessionDir(taskId), filePath);
  return existsSync(fullPath);
}

/**
 * Get file size
 */
export function getSessionFileSize(
  taskId: string,
  filePath: string,
): number | null {
  const fullPath = join(getTaskSessionDir(taskId), filePath);

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    const stats = statSync(fullPath);
    return stats.size;
  } catch (error) {
    workspaceLogger.error("Failed to get file size:", error);
    return null;
  }
}

/**
 * Write session file
 */
export function writeSessionFile(
  taskId: string,
  filePath: string,
  content: string,
): boolean {
  const fullPath = join(getTaskSessionDir(taskId), filePath);

  try {
    const dir = dirname(fullPath);

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content, "utf-8");
    workspaceLogger.debug("Written file", fullPath);
    invalidateSessionFilesCache(getTaskSessionDir(taskId));
    return true;
  } catch (error) {
    workspaceLogger.error("Failed to write file:", error);
    return false;
  }
}

/**
 * Delete a single session file safely within the session directory boundary.
 */
export function deleteSessionFile(taskId: string, filePath: string): boolean {
  const fullPath = validatePath(taskId, filePath);
  if (!fullPath) {
    return false;
  }

  if (!existsSync(fullPath)) {
    return false;
  }

  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) {
      return false;
    }
    unlinkSync(fullPath);
    workspaceLogger.debug("Deleted file", fullPath);
    invalidateSessionFilesCache(getTaskSessionDir(taskId));
    return true;
  } catch (error) {
    workspaceLogger.error("Failed to delete file:", error);
    return false;
  }
}

/**
 * Get session directory size
 */
export function getSessionSize(taskId: string): number {
  const sessionDir = getTaskSessionDir(taskId);

  if (!existsSync(sessionDir)) {
    return 0;
  }

  let totalSize = 0;

  function calculateSize(dirPath: string) {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const stats = statSync(fullPath);

      if (entry.isDirectory()) {
        calculateSize(fullPath);
      } else {
        totalSize += stats.size;
      }
    }
  }

  try {
    calculateSize(sessionDir);
  } catch (error) {
    workspaceLogger.error("Failed to calculate size:", error);
  }

  return totalSize;
}

/**
 * List all sessions
 */
export function listAllSessions(): string[] {
  const sessionsDir = getSessionsDir();

  if (!existsSync(sessionsDir)) {
    return [];
  }

  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    workspaceLogger.error("Failed to list sessions:", error);
    return [];
  }
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Recursively get all files in session directory (including subdirectories)
 * Returns flat file list for building file tree
 */
export function getAllFilesRecursive(taskId: string): SessionFile[] {
  const sessionDir = getTaskSessionDir(taskId);

  if (!existsSync(sessionDir)) {
    return [];
  }

  const allFiles: SessionFile[] = [];

  function traverseDir(currentPath: string, relativePath: string) {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);
      const fileRelativePath = relativePath
        ? join(relativePath, entry.name)
        : entry.name;
      const stats = statSync(fullPath);

      // Extract file extension as type
      const ext = entry.name.includes(".")
        ? entry.name.split(".").pop()?.toLowerCase()
        : "";

      allFiles.push({
        name: entry.name,
        path: fileRelativePath, // Use relative path (relative to task session directory)
        absolutePath: fullPath, // Absolute path for direct file access
        size: stats.size,
        isDirectory: entry.isDirectory(),
        modifiedTime: stats.mtime,
        type: entry.isDirectory() ? undefined : ext || undefined,
      });

      // If directory, recursively traverse
      if (entry.isDirectory()) {
        traverseDir(fullPath, fileRelativePath);
      }
    }
  }

  try {
    traverseDir(sessionDir, "");
  } catch (error) {
    workspaceLogger.error("Failed to traverse directory:", error);
  }

  // Sort by modification time (newest first)
  return allFiles.sort((a, b) => {
    const timeA = a.modifiedTime?.getTime() ?? 0;
    const timeB = b.modifiedTime?.getTime() ?? 0;
    return timeB - timeA;
  });
}

/**
 * Recursively get all files in a given absolute session directory path.
 * Used when the session directory is known (e.g., from execution result)
 * rather than being derived from taskId.
 */
export function getAllFilesAtPath(sessionDir: string): SessionFile[] {
  if (!existsSync(sessionDir)) {
    return [];
  }

  const allFiles: SessionFile[] = [];

  function traverseDir(currentPath: string, relativePath: string) {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);
      const fileRelativePath = relativePath
        ? join(relativePath, entry.name)
        : entry.name;
      const stats = statSync(fullPath);

      const ext = entry.name.includes(".")
        ? entry.name.split(".").pop()?.toLowerCase()
        : "";

      allFiles.push({
        name: entry.name,
        path: fileRelativePath,
        // Store absolute path for direct file access (preview, etc.)
        absolutePath: join(sessionDir, fileRelativePath),
        size: stats.size,
        isDirectory: entry.isDirectory(),
        modifiedTime: stats.mtime,
        type: entry.isDirectory() ? undefined : ext || undefined,
      });

      if (entry.isDirectory()) {
        traverseDir(fullPath, fileRelativePath);
      }
    }
  }

  try {
    traverseDir(sessionDir, "");
  } catch (error) {
    workspaceLogger.error("Failed to traverse directory:", error);
  }

  return allFiles.sort((a, b) => {
    const timeA = a.modifiedTime?.getTime() ?? 0;
    const timeB = b.modifiedTime?.getTime() ?? 0;
    return timeB - timeA;
  });
}

/**
 * Directories to skip during file traversal for performance.
 */
const TRAVERSAL_SKIP_DIRS = new Set([
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".next",
  ".nuxt",
  ".cache",
  "dist",
  "build",
  ".venv",
  "venv",
  "vendor",
  "target",
]);

/**
 * Recursively collect all files and total directory size in a single traversal.
 * Combines the logic of getAllFilesAtPath + getSessionSize to avoid duplicate directory walks.
 * Skips known large directories (node_modules, .next, etc.) during traversal.
 * Uses caching with 30s TTL and parallel stat for improved performance.
 */
export async function getAllFilesAtPathWithSize(
  taskId: string,
  sessionDir: string,
): Promise<{ files: SessionFile[]; size: number }> {
  // Check cache first
  const cached = getCachedSessionFiles(sessionDir);
  if (cached) {
    return cached;
  }

  if (!existsSync(sessionDir)) {
    return { files: [], size: 0 };
  }

  const allFiles: SessionFile[] = [];
  let totalSize = 0;

  async function traverse(
    currentPath: string,
    relativePath: string,
  ): Promise<void> {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Parallel stat all entries at current level
    const fileResults = await Promise.all(
      entries.map(async (entry) => {
        const name = String(entry.name);
        if (name.startsWith(".")) return null;
        if (entry.isDirectory() && TRAVERSAL_SKIP_DIRS.has(name)) return null;

        const fullPath = join(currentPath, name);
        const fileRelativePath = relativePath ? join(relativePath, name) : name;

        try {
          const stats = await fs.stat(fullPath);
          return {
            name,
            fullPath,
            fileRelativePath,
            stats,
            isDirectory: entry.isDirectory(),
          };
        } catch {
          return null;
        }
      }),
    );

    // Process results and queue directories for recursive traversal
    const dirQueue: { path: string; relative: string }[] = [];

    for (const result of fileResults) {
      if (!result) continue;

      const { name, fullPath, fileRelativePath, stats, isDirectory } = result;
      const ext = name.includes(".")
        ? name.split(".").pop()?.toLowerCase()
        : "";

      allFiles.push({
        name,
        path: fileRelativePath,
        absolutePath: fullPath,
        size: stats.size,
        isDirectory,
        modifiedTime: stats.mtime,
        type: isDirectory ? undefined : ext || undefined,
      });

      if (isDirectory) {
        dirQueue.push({ path: fullPath, relative: fileRelativePath });
      } else {
        totalSize += stats.size;
      }
    }

    // Recursively traverse directories in parallel
    await Promise.all(dirQueue.map((d) => traverse(d.path, d.relative)));
  }

  try {
    await traverse(sessionDir, "");
  } catch (error) {
    workspaceLogger.error("Failed to traverse directory:", error);
  }

  const sortedFiles = allFiles.sort((a, b) => {
    const timeA = a.modifiedTime?.getTime() ?? 0;
    const timeB = b.modifiedTime?.getTime() ?? 0;
    return timeB - timeA;
  });

  const result = { files: sortedFiles, size: totalSize };

  // Cache the result
  setCachedSessionFiles(sessionDir, result);

  return result;
}

/**
 * Workspace-level file item (includes taskId, path is relative to that task session directory, for use with readSessionFile)
 */
export interface WorkspaceFileItem {
  taskId: string;
  name: string;
  path: string;
  type?: string;
  size?: number;
  isDirectory?: boolean;
  /** Modification time, for grouping/sorting by time */
  modifiedTime?: string;
}

/**
 * Recursively list all files in all sessions in the workspace
 * Used for scenarios like "add file from workspace" that require searching the entire workspace
 * @param taskIdFilter - Optional set of task IDs to limit traversal to (for performance)
 * @returns Flat list, each item includes taskId and path relative to that task directory
 */
export async function getAllWorkspaceFilesRecursive(
  taskIdFilter?: Set<string>,
): Promise<WorkspaceFileItem[]> {
  const allTaskIds = listAllSessions();
  const taskIds = taskIdFilter
    ? allTaskIds.filter((id) => taskIdFilter.has(id))
    : allTaskIds;

  const skipDirs = TRAVERSAL_SKIP_DIRS;

  // Process sessions in parallel
  const sessionResults = await Promise.all(
    taskIds.map(async (taskId) => {
      const sessionDir = getTaskSessionDir(taskId);
      if (!existsSync(sessionDir)) return [];

      const files: WorkspaceFileItem[] = [];
      await traverseDir(sessionDir, "", taskId, files);
      return files;
    }),
  );

  const result = sessionResults.flat();

  return result.sort((a, b) => {
    const taskCmp = a.taskId.localeCompare(b.taskId);
    if (taskCmp !== 0) return taskCmp;
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  async function traverseDir(
    currentPath: string,
    relativePath: string,
    taskId: string,
    files: WorkspaceFileItem[],
  ) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      // Process entries in parallel: stat all files, then recurse directories
      const fileInfos = await Promise.all(
        entries
          .filter((e) => !e.name.startsWith("."))
          .filter((e) => !e.isDirectory() || !skipDirs.has(e.name))
          .map(async (entry) => {
            const fullPath = join(currentPath, entry.name);
            const fileRelativePath = relativePath
              ? join(relativePath, entry.name)
              : entry.name;
            const stats = await fs.stat(fullPath);
            const ext = entry.name.includes(".")
              ? entry.name.split(".").pop()?.toLowerCase()
              : "";
            return { entry, fullPath, fileRelativePath, stats, ext };
          }),
      );

      for (const {
        entry,
        fullPath,
        fileRelativePath,
        stats,
        ext,
      } of fileInfos) {
        files.push({
          taskId,
          name: entry.name,
          path: fileRelativePath,
          type: entry.isDirectory() ? undefined : ext || undefined,
          size: stats.size,
          isDirectory: entry.isDirectory(),
          modifiedTime: stats.mtime.toISOString(),
        });

        if (entry.isDirectory()) {
          await traverseDir(fullPath, fileRelativePath, taskId, files);
        }
      }
    } catch (err) {
      workspaceLogger.error("Failed to traverse session", { taskId, err });
    }
  }
}
