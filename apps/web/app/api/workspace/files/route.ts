/**
 * Files API Routes
 *
 * Provides filesystem management interface
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import {
  createTaskSession,
  getTaskSessionDir,
  listSessionFiles,
  writeSessionFile,
  formatFileSize,
  getAllFilesAtPathWithSize,
  getAllWorkspaceFilesRecursive,
} from "@/lib/files/workspace/sessions";
import { db } from "@/lib/db/queries";
import { chat } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { existsSync } from "node:fs";

// GET /api/workspace/files - List task files (with taskId) or entire workspace files (without taskId)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api", "Unauthorized").toResponse();
  }

  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");
    const path = searchParams.get("path") || "";
    // Pagination parameters
    const page = Number.parseInt(searchParams.get("page") || "0", 10);
    const pageSize = Number.parseInt(searchParams.get("pageSize") || "50", 10);
    // Cursor pagination parameters (for infinite scroll)
    const cursor = searchParams.get("cursor");

    // If taskId not provided: return all session files in entire workspace (used for "add file from workspace" etc.)
    if (!taskId) {
      // Get all chat IDs belonging to the current user for filtering
      const userChats = await db
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, session.user.id));
      const userChatIds = new Set(userChats.map((c: { id: string }) => c.id));

      const allFiles = await getAllWorkspaceFilesRecursive();
      const cleanedFiles = allFiles
        .map((file) => ({
          ...file,
          name: file.name?.trim(),
          path: file.path?.trim(),
          type: file.type?.trim(),
        }))
        // Filter: only files belonging to user's chats
        .filter((file) => file.taskId && userChatIds.has(file.taskId))
        // Filter out directories, only return files
        .filter((file) => !file.isDirectory)
        // Code files only show HTML, HTM, Markdown, other file types are displayed normally
        .filter((file) => {
          const name = file.name?.toLowerCase() || "";
          const ext = file.type?.toLowerCase();

          // First filter out unnecessary file types
          if (
            name.endsWith(".map") ||
            name.endsWith(".lock") ||
            name.endsWith(".tmpl") ||
            name.endsWith(".pdl") ||
            name.endsWith(".bare") ||
            name.endsWith(".d.cts") ||
            name.endsWith(".d.ts") ||
            name.endsWith(".cjs") ||
            name.endsWith(".mjs") ||
            name === "package.json" ||
            name === "package-lock.json" ||
            name.endsWith("package-lock.json") ||
            name.endsWith("package-lock.json")
          ) {
            return false;
          }

          // Code files only show HTML, HTM, Markdown
          const codeExtensions = [
            "js",
            "jsx",
            "ts",
            "tsx",
            "d.ts",
            "css",
            "scss",
            "json",
            "py",
            "java",
            "c",
            "cpp",
            "go",
            "rs",
            "php",
            "rb",
            "sql",
            "rust",
          ];
          const isCodeFile = codeExtensions.some((codeExt) =>
            name.endsWith(`.${codeExt}`),
          );

          if (isCodeFile)
            return (
              ext === "html" ||
              ext === "htm" ||
              ext === "md" ||
              ext === "markdown"
            );
          return true;
        })
        .sort((a, b) => {
          // Sort by modifiedTime in descending order (newest first)
          const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
          const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
          const timeCompare = bTime - aTime;
          if (timeCompare !== 0) return timeCompare;
          // Same time sort by taskId
          return a.taskId.localeCompare(b.taskId);
        });

      // Use cursor pagination: cursor format is "taskId|timestamp|filePath"
      let startIndex = 0;
      if (cursor) {
        const [cursorTaskId, cursorTimeStr, cursorPath] = cursor.split("|");
        const cursorTime = Number.parseInt(cursorTimeStr, 10);
        startIndex = cleanedFiles.findIndex((f) => {
          const fileTime = f.modifiedTime
            ? new Date(f.modifiedTime).getTime()
            : 0;
          return (
            f.taskId === cursorTaskId &&
            fileTime === cursorTime &&
            f.path === cursorPath
          );
        });
        if (startIndex !== -1) {
          startIndex += 1;
        } else {
          // If no exact match found, find first file with time less than cursor
          startIndex = cleanedFiles.findIndex((f) => {
            const fileTime = f.modifiedTime
              ? new Date(f.modifiedTime).getTime()
              : 0;
            if (fileTime < cursorTime) return true;
            if (fileTime === cursorTime)
              return f.taskId.localeCompare(cursorTaskId) < 0;
            return false;
          });
          if (startIndex === -1) startIndex = 0;
        }
      }

      const files = cleanedFiles.slice(startIndex, startIndex + pageSize);
      const hasMore = startIndex + pageSize < cleanedFiles.length;
      // Use last file's taskId|timestamp|path as next cursor
      const lastFile = files[files.length - 1];
      const nextCursor =
        hasMore && lastFile
          ? `${lastFile.taskId}|${lastFile.modifiedTime ? new Date(lastFile.modifiedTime).getTime() : 0}|${lastFile.path}`
          : null;

      return NextResponse.json({
        files,
        scope: "workspace",
        hasMore,
        nextCursor,
        total: cleanedFiles.length,
      });
    }

    // Verify taskId belongs to current user
    const [chatRecord] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(and(eq(chat.id, taskId), eq(chat.userId, session.user.id)))
      .limit(1);

    if (!chatRecord) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Ensure session directory exists
    if (!existsSync(getTaskSessionDir(taskId))) {
      return NextResponse.json({ files: [], size: 0 });
    }

    const files = listSessionFiles(taskId, path);
    let size = 0;

    // If root directory request (path is empty), recursively fetch all files
    // and compute total size in a single traversal.
    let allFiles = files;
    if (!path) {
      const result = await getAllFilesAtPathWithSize(
        taskId,
        getTaskSessionDir(taskId),
      );
      allFiles = result.files;
      size = result.size;
    }

    // Clean file data: trim whitespace from all string fields
    const cleanedFiles = allFiles.map((file) => ({
      ...file,
      name: file.name?.trim(),
      path: file.path?.trim(),
      type: file.type?.trim(),
    }));

    // Filter files: code files only show HTML and Markdown, other file types (images, text, etc.) are displayed normally
    const codeExtensions = [
      "js",
      "jsx",
      "ts",
      "tsx",
      "css",
      "scss",
      "json",
      "py",
      "java",
      "c",
      "cpp",
      "go",
      "rs",
      "php",
      "rb",
      "sql",
    ];

    const filteredFiles = cleanedFiles.filter((file) => {
      if (file.isDirectory) {
        // Directories always show
        return true;
      }
      const ext = file.type?.toLowerCase();
      if (codeExtensions.includes(ext || "")) {
        // Code files: only show HTML and Markdown
        const isHtml = ext === "html" || ext === "htm";
        const isMarkdown = ext === "md" || ext === "markdown";
        return isHtml || isMarkdown;
      }
      // Non-code files always show
      return true;
    });

    return NextResponse.json({
      files: filteredFiles,
      size,
      formattedSize: formatFileSize(size),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to list files",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// POST /api/workspace/files - Write file
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api", "Unauthorized").toResponse();
  }

  try {
    const body = await req.json();
    const { taskId, path, content } = body;

    if (!taskId || !path) {
      return NextResponse.json(
        { error: "taskId and path are required" },
        { status: 400 },
      );
    }

    // Verify taskId belongs to current user
    const [chatRecord] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(and(eq(chat.id, taskId), eq(chat.userId, session.user.id)))
      .limit(1);

    if (!chatRecord) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Ensure session directory exists
    createTaskSession(taskId);

    const success = writeSessionFile(taskId, path, content || "");

    if (success) {
      return NextResponse.json({
        success: true,
        message: "File written successfully",
      });
    }
    return NextResponse.json(
      { error: "Failed to write file" },
      { status: 500 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to write file",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
