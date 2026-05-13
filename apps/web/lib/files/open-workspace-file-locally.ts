/**
 * Open chat vault / session workspace files with the OS default application.
 * Paths mirror server-side `getTaskSessionDir` in `lib/workspace/sessions.ts`.
 */

import {
  fileExists,
  homeDirCustom,
  isTauri,
  openPathCustom,
  revealItemInDir,
} from "@/lib/tauri";

export type OpenWorkspaceFileResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_tauri" | "no_home" | "missing_file" | "open_failed";
    };

/**
 * Resolves `~/.openloomi/sessions/{taskId}/{relativePath}` on the local machine (Tauri only).
 */
/**
 * Resolves a path (absolute or already relative) to a path relative to the session root,
 * for Tauri to open or show in folder.
 * Falls back to filename only if unrecognized (common when file is at session root).
 */
export function sessionRelativePathFromStoredPath(
  filePath: string,
  taskId: string,
): string {
  const norm = filePath.replace(/\\/g, "/");
  const needle = `/.openloomi/sessions/${taskId}/`;
  const idx = norm.indexOf(needle);
  if (idx >= 0) {
    return norm.slice(idx + needle.length).replace(/^\/+/, "");
  }
  const tailRe = new RegExp(
    `/\\.openloomi/sessions/${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(.+)$`,
    "i",
  );
  const m = norm.match(tailRe);
  if (m?.[1]) return m[1].replace(/^\/+/, "");
  const base = norm.split("/").pop() || norm;
  return base.replace(/^\/+/, "");
}

function looksLikeAbsolutePath(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(filePath) ||
    filePath.startsWith("\\\\")
  );
}

export async function resolveWorkspaceSessionAbsolutePath(
  taskId: string,
  relativePath: string,
): Promise<string | null> {
  if (!isTauri()) return null;

  const candidate = relativePath.trim();
  if (looksLikeAbsolutePath(candidate)) {
    const exists = await fileExists(candidate);
    if (exists) return candidate;
  }

  const home = await homeDirCustom();
  if (!home) return null;
  const norm = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
  const isWin =
    typeof navigator !== "undefined" &&
    /Windows|Win32|Win64/i.test(navigator.userAgent);
  const sep = isWin ? "\\" : "/";
  const parts = norm.split("/").filter(Boolean);
  return [home, ".openloomi", "sessions", taskId, ...parts].join(sep);
}

/**
 * Opens a workspace file with the system default handler (desktop shell).
 */
export async function openWorkspaceFileInSystemDefaultApp(options: {
  taskId: string;
  path: string;
}): Promise<OpenWorkspaceFileResult> {
  const { taskId, path: relPath } = options;
  if (!isTauri()) return { ok: false, reason: "not_tauri" };
  const absolute = await resolveWorkspaceSessionAbsolutePath(taskId, relPath);
  if (!absolute) return { ok: false, reason: "no_home" };
  const exists = await fileExists(absolute);
  if (!exists) return { ok: false, reason: "missing_file" };
  const opened = await openPathCustom(absolute);
  return opened ? { ok: true } : { ok: false, reason: "open_failed" };
}

export type RevealWorkspaceFileResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_tauri" | "no_home" | "missing_file" | "reveal_failed";
    };

/**
 * Reveals the workspace file in the system file manager (Finder / Explorer / file manager).
 */
export async function revealWorkspaceFileInParentFolder(options: {
  taskId: string;
  path: string;
}): Promise<RevealWorkspaceFileResult> {
  const { taskId, path: relPath } = options;
  if (!isTauri()) return { ok: false, reason: "not_tauri" };
  const absolute = await resolveWorkspaceSessionAbsolutePath(taskId, relPath);
  if (!absolute) return { ok: false, reason: "no_home" };
  const exists = await fileExists(absolute);
  if (!exists) return { ok: false, reason: "missing_file" };
  const ok = await revealItemInDir(absolute);
  return ok ? { ok: true } : { ok: false, reason: "reveal_failed" };
}
