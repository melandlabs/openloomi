/**
 * Memory Path tool - searchMemoryPath
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Session } from "next-auth";
import { getAppDataDir, joinPath } from "@/lib/utils/path";

interface MemoryPathSearchResult {
  results: string[];
  fileCount: number;
  matchCount: number;
}

function listFilesRecursively(root: string): string[] {
  const files: string[] = [];

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

  return files;
}

function includesIgnoreCase(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function toRelativeMemoryPath(memoryPath: string, filePath: string): string {
  return path.relative(memoryPath, filePath) || filePath;
}

function searchMemoryPathOnWindows(input: {
  memoryPath: string;
  targetDir: string;
  keywords: string[];
  firstKeyword: string;
  searchInFiles: boolean;
}): MemoryPathSearchResult {
  const results: string[] = [];
  let fileCount = 0;
  let matchCount = 0;

  const files = listFilesRecursively(input.targetDir);
  const nameMatches = files.filter((filePath) =>
    includesIgnoreCase(path.basename(filePath), input.firstKeyword),
  );

  if (nameMatches.length > 0) {
    fileCount = nameMatches.length;
    results.push(
      `**Found ${fileCount} file(s) with names matching "${input.firstKeyword}":**`,
    );
    nameMatches.slice(0, 20).forEach((filePath) => {
      results.push(`- ${toRelativeMemoryPath(input.memoryPath, filePath)}`);
    });
    if (fileCount > 20) {
      results.push(`... and ${fileCount - 20} more files`);
    }
  }

  if (input.searchInFiles && input.keywords.length > 0) {
    const contentMatches: Array<{ filePath: string; lines: string[] }> = [];

    for (const filePath of files) {
      let content: string;

      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const lines = content
        .split(/\r?\n/)
        .filter((line) =>
          input.keywords.some((keyword) => includesIgnoreCase(line, keyword)),
        );

      if (lines.length > 0) {
        contentMatches.push({ filePath, lines });
      }
    }

    if (contentMatches.length > 0) {
      matchCount = Math.min(contentMatches.length, 20);
      results.push(
        `\n**Found ${matchCount} file(s) with content matching keywords "${input.keywords.join(", ")}":**`,
      );
      contentMatches.slice(0, 20).forEach(({ filePath }) => {
        results.push(`- ${toRelativeMemoryPath(input.memoryPath, filePath)}`);
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

  try {
    const entries = readdirSync(input.targetDir).slice(0, 30);
    if (entries.length > 0) {
      results.push("\n**Directory structure:**");
      results.push("```");
      entries.forEach((entry) => {
        const entryPath = path.join(input.targetDir, entry);
        const stats = statSync(entryPath);
        const type = stats.isDirectory() ? "d" : "-";
        results.push(`${type} ${entry}`);
      });
      results.push("```");
    }
  } catch {
    // Directory listing is best-effort, matching the existing shell behavior.
  }

  return { results, fileCount, matchCount };
}

/**
 * Create the searchMemoryPath tool
 */
export function createMemoryPathTool(session: Session) {
  return tool(
    "searchMemoryPath",
    [
      "**MUST USE this tool when user asks about:**",
      "- Personal information stored in memory (e.g., 'Who is my boss?', 'Tell me about my team')",
      "- Notes or files they've created (e.g., 'What did I write about X?', 'Find my notes about Y')",
      "- People information (e.g., 'What do you know about John?', 'My colleague info')",
      "- Projects or tasks in memory (e.g., 'What are my project notes?', 'Show my task list')",
      "- Strategy or planning documents (e.g., 'What is my strategy?', 'Show my plans')",
      "- Past conversations / chat history (e.g., 'what did we talk about yesterday?', 'what did I say before?')",
      "",
      "**CRITICAL: This tool provides ADDITIONAL search results to complement searchKnowledgeBase results.**",
      "- If this tool finds no results, do NOT conclude that 'no information exists'",
      "- Always combine results from this tool with searchKnowledgeBase results",
      "- This tool searches user-created markdown files, while searchKnowledgeBase searches uploaded documents",
      "- Use BOTH tools together for comprehensive results",
      "",
      "**MEMORY STRUCTURE:**",
      "- /people/ - Person profiles and contact info",
      "- /projects/ - Project notes and documentation",
      "- /notes/ - Personal notes and memos",
      "- /strategy/ - Strategy and planning documents",
      "",
      "**CONVERSATION HISTORY (cross-platform):**",
      "Use the Read tool to access conversation history stored in:",
      "  <appDataDir>/data/memory/{platform}/YYYY-MM-DD.json",
      "Where {platform} is one of: whatsapp, gmail, weixin, imessage, telegram, feishu, lark",
      "Each file contains JSON with messages grouped by userKey and accountId.",
      "Use this to look up past conversations across days — especially useful when:",
      "- User asks about something discussed earlier ('what did we talk about yesterday?')",
      "- User references a previous topic ('as I mentioned before...')",
      "- Building context for a continuing conversation",
      "",
      "**Usage Examples:**",
      "- 'Who is my boss?' → Searches for 'boss' in all memory files",
      "- 'What are my project notes?' → Searches /projects/ directory",
      "- 'Tell me about John' → Searches for 'John' in all memory files",
    ].join("\n"),
    {
      query: z
        .string()
        .describe("Search query to find matching files and content"),
      searchInFiles: z
        .boolean()
        .default(true)
        .describe(
          "Whether to search within file content (using grep). Defaults to true.",
        ),
      directory: z
        .string()
        .optional()
        .describe(
          "Specific subdirectory to search (e.g., 'people', 'projects'). If not specified, searches all directories.",
        ),
    },
    async (args) => {
      try {
        const { query, searchInFiles = true, directory } = args;

        // Validate user session
        if (!session?.user?.id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Unauthorized: invalid user session",
              },
            ],
            isError: true,
          };
        }

        // Get the actual memory directory path
        const memoryPath = joinPath(getAppDataDir(), "data", "memory");

        // Check if memory directory exists
        if (!existsSync(memoryPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Memory directory does not exist at ${memoryPath}. You may need to create memory files first.`,
              },
            ],
            data: {
              memoryPath,
              query,
              message: "Memory directory not found",
            },
          };
        }

        const targetDir = directory ? `${memoryPath}/${directory}` : memoryPath;

        // Check if target directory exists
        if (!existsSync(targetDir)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Directory does not exist: ${targetDir}`,
              },
            ],
            data: {
              memoryPath,
              targetDir,
              query,
              message: "Target directory not found",
            },
          };
        }

        // Collect search results
        const results: string[] = [];
        let fileCount = 0;
        let matchCount = 0;

        // Split query into keywords for better search coverage
        const keywords = query.split(/[\s,，,、]+/).filter((k) => k.length > 0);

        // 1. Search for files with matching names (use first keyword for filename search)
        const firstKeyword = keywords[0] || query;
        if (process.platform === "win32") {
          const windowsResult = searchMemoryPathOnWindows({
            memoryPath,
            targetDir,
            keywords,
            firstKeyword,
            searchInFiles,
          });
          results.push(...windowsResult.results);
          fileCount = windowsResult.fileCount;
          matchCount = windowsResult.matchCount;
        } else {
          try {
            const findOutput = spawnSync(
              "find",
              [targetDir, "-type", "f", "-iname", `*${firstKeyword}*`],
              {
                encoding: "utf-8",
                maxBuffer: 100 * 1024 * 1024,
                shell: false,
              },
            );
            const findStdout = findOutput.stdout as string;
            if (findStdout?.trim()) {
              const matchingFiles = findStdout.trim().split("\n");
              fileCount = matchingFiles.length;
              results.push(
                `**Found ${fileCount} file(s) with names matching "${firstKeyword}":**`,
              );
              matchingFiles.slice(0, 20).forEach((file) => {
                const relativePath = file.replace(`${memoryPath}/`, "");
                results.push(`- ${relativePath}`);
              });
              if (fileCount > 20) {
                results.push(`... and ${fileCount - 20} more files`);
              }
            }
          } catch (error) {
            // No matching files found, continue
          }

          // 2. Search for content matching any keyword (OR search)
          if (searchInFiles && keywords.length > 0) {
            // Build grep pattern: search for any keyword (OR logic)

            try {
              // Search files containing any keyword
              const grepOutput = spawnSync(
                "grep",
                ["-r", "-i", "-l", "-E", keywords.join("|"), targetDir],
                {
                  encoding: "utf-8",
                  maxBuffer: 100 * 1024 * 1024,
                  shell: false,
                },
              );
              const grepStdout = grepOutput.stdout as string;
              if (grepStdout?.trim()) {
                const matchingFiles = grepStdout
                  .trim()
                  .split("\n")
                  .slice(0, 20);
                matchCount = matchingFiles.length;
                results.push(
                  `\n**Found ${matchCount} file(s) with content matching keywords "${keywords.join(", ")}":**`,
                );
                matchingFiles.forEach((file) => {
                  const relativePath = file.replace(`${memoryPath}/`, "");
                  results.push(`- ${relativePath}`);
                });

                // Also show some actual content matches for each keyword
                try {
                  const contentOutput = spawnSync(
                    "grep",
                    ["-r", "-i", "-h", "-E", keywords.join("|"), targetDir],
                    {
                      encoding: "utf-8",
                      maxBuffer: 100 * 1024 * 1024,
                      shell: false,
                    },
                  );
                  const contentStdout = contentOutput.stdout as string;
                  if (contentStdout?.trim()) {
                    results.push("\n**Sample content matches:**");
                    contentStdout
                      .trim()
                      .split("\n")
                      .slice(0, 15)
                      .forEach((line) => {
                        // Truncate long lines
                        const truncated =
                          line.length > 150 ? `${line.slice(0, 150)}...` : line;
                        results.push(`  ${truncated}`);
                      });
                  }
                } catch (e) {
                  // Content grep failed, continue
                }
              }
            } catch (error) {
              // No matching content found, continue
            }
          }

          // 3. List directory structure
          try {
            const lsOutput = spawnSync("ls", ["-la", targetDir], {
              encoding: "utf-8",
              maxBuffer: 100 * 1024 * 1024,
              shell: false,
            });
            const lsStdout = lsOutput.stdout as string;
            if (lsStdout?.trim()) {
              results.push("\n**Directory structure:**");
              results.push("```");
              lsStdout
                .trim()
                .split("\n")
                .slice(0, 30)
                .forEach((line) => {
                  results.push(line);
                });
              results.push("```");
            }
          } catch (error) {
            // ls failed, continue
          }
        }

        // Format response
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No matches found for "${query}" in memory directory (${targetDir}).`,
              },
            ],
            data: {
              memoryPath,
              targetDir,
              query,
              message: "No matches found",
            },
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: results.join("\n"),
            },
          ],
          data: {
            memoryPath,
            targetDir,
            query,
            fileCount,
            matchCount,
            results: results.join("\n"),
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to search memory directory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          data: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
          isError: true,
        };
      }
    },
  );
}
