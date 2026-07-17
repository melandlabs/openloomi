import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APP_DIR_NAME = ".openloomi";
const WINDOWS_APPDATA_DIR_NAME = "openloomi";

export function getDefaultOpenLoomiAppDataDir(env = process.env) {
  const home = homedir();

  if (process.platform === "win32") {
    if (env.USERPROFILE) {
      return path.join(env.USERPROFILE, APP_DIR_NAME);
    }
    return path.join(env.APPDATA || home, WINDOWS_APPDATA_DIR_NAME);
  }

  return path.join(home, APP_DIR_NAME);
}

export function getDefaultMemoryPath(env = process.env) {
  return path.join(getDefaultOpenLoomiAppDataDir(env), "data", "memory");
}

export function searchMemoryPath({
  query,
  searchInFiles = true,
  directory,
  memoryPath = getDefaultMemoryPath(),
}) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";

  if (!trimmedQuery) {
    return {
      content: "Search query is required.",
      data: {
        memoryPath,
        query,
        message: "Search query is required",
      },
      isError: true,
    };
  }

  if (!existsSync(memoryPath)) {
    return {
      content: `Memory directory does not exist at ${memoryPath}. You may need to create memory files first.`,
      data: {
        memoryPath,
        query: trimmedQuery,
        message: "Memory directory not found",
      },
    };
  }

  const targetDirResult = resolveTargetDir(memoryPath, directory);
  if (!targetDirResult.ok) {
    return {
      content: targetDirResult.message,
      data: {
        memoryPath,
        query: trimmedQuery,
        message: targetDirResult.message,
      },
      isError: true,
    };
  }

  const targetDir = targetDirResult.targetDir;
  if (!existsSync(targetDir)) {
    return {
      content: `Directory does not exist: ${targetDir}`,
      data: {
        memoryPath,
        targetDir,
        query: trimmedQuery,
        message: "Target directory not found",
      },
    };
  }

  const keywords = splitSearchKeywords(trimmedQuery);
  const firstKeyword = keywords[0] || trimmedQuery;
  const results = [];
  let fileCount = 0;
  let matchCount = 0;

  const files = listFilesRecursively(targetDir);
  const nameMatches = files.filter((filePath) =>
    includesIgnoreCase(path.basename(filePath), firstKeyword),
  );

  if (nameMatches.length > 0) {
    fileCount = nameMatches.length;
    results.push(
      `**Found ${fileCount} file(s) with names matching "${firstKeyword}":**`,
    );
    nameMatches.slice(0, 20).forEach((filePath) => {
      results.push(`- ${toRelativeMemoryPath(memoryPath, filePath)}`);
    });
    if (fileCount > 20) {
      results.push(`... and ${fileCount - 20} more files`);
    }
  }

  if (searchInFiles && keywords.length > 0) {
    const contentMatches = findContentMatches(files, keywords);

    if (contentMatches.length > 0) {
      matchCount = Math.min(contentMatches.length, 20);
      results.push(
        `\n**Found ${matchCount} file(s) with content matching keywords "${keywords.join(", ")}":**`,
      );
      contentMatches.slice(0, 20).forEach(({ filePath }) => {
        results.push(`- ${toRelativeMemoryPath(memoryPath, filePath)}`);
      });

      const sampleLines = contentMatches.flatMap(({ lines }) => lines);
      if (sampleLines.length > 0) {
        results.push("\n**Sample content matches:**");
        sampleLines.slice(0, 15).forEach((line) => {
          const trimmed = line.trim();
          const truncated =
            trimmed.length > 150 ? `${trimmed.slice(0, 150)}...` : trimmed;
          results.push(`  ${truncated}`);
        });
      }
    }
  }

  const directoryListing = listDirectoryStructure(targetDir);
  if (directoryListing.length > 0) {
    results.push("\n**Directory structure:**");
    results.push("```");
    results.push(...directoryListing);
    results.push("```");
  }

  if (results.length === 0) {
    return {
      content: `No matches found for "${trimmedQuery}" in memory directory (${targetDir}).`,
      data: {
        memoryPath,
        targetDir,
        query: trimmedQuery,
        message: "No matches found",
      },
    };
  }

  const text = results.join("\n");
  return {
    content: text,
    data: {
      memoryPath,
      targetDir,
      query: trimmedQuery,
      fileCount,
      matchCount,
      results: text,
    },
  };
}

export function splitSearchKeywords(query) {
  return String(query)
    .split(/[\s,，、]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

function resolveTargetDir(memoryPath, directory) {
  if (!directory) {
    return { ok: true, targetDir: memoryPath };
  }

  const root = path.resolve(memoryPath);
  const targetDir = path.resolve(root, directory);
  const isInsideRoot =
    targetDir === root || targetDir.startsWith(root + path.sep);

  if (!isInsideRoot) {
    return {
      ok: false,
      message: "Directory must stay inside the OpenLoomi memory directory.",
    };
  }

  return { ok: true, targetDir };
}

function listFilesRecursively(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function findContentMatches(files, keywords) {
  const matches = [];

  for (const filePath of files) {
    let content;

    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content
      .split(/\r?\n/)
      .filter((line) =>
        keywords.some((keyword) => includesIgnoreCase(line, keyword)),
      );

    if (lines.length > 0) {
      matches.push({ filePath, lines });
    }
  }

  return matches;
}

function listDirectoryStructure(targetDir) {
  try {
    return readdirSync(targetDir)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 30)
      .map((entry) => {
        const entryPath = path.join(targetDir, entry);
        const stats = statSync(entryPath);
        const type = stats.isDirectory() ? "d" : "-";
        return `${type} ${entry}`;
      });
  } catch {
    return [];
  }
}

function includesIgnoreCase(value, query) {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function toRelativeMemoryPath(memoryPath, filePath) {
  return path.relative(memoryPath, filePath) || filePath;
}
