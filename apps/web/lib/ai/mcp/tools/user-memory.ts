/**
 * User memory tool - persists explicit durable facts the user asks to
 * remember. This complements raw file tools with a narrow, user-facing path.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session } from "next-auth";
import { getUserMemoryPath } from "@/lib/utils/path";

export type MemoryUpdatePayload = {
  category: string;
  fileName: string;
  displayLabel: string;
  action: "create" | "update";
  description?: string;
  filePath: string;
};
export type MemoryUpdateCallback = (data: MemoryUpdatePayload) => void;

const MEMORY_CATEGORIES = ["people", "projects", "notes", "strategy"] as const;

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|#]+/g, " ")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || `memory-${Date.now()}`;
}

function ensureMarkdown(title: string, content: string): string {
  const trimmed = content.trim();
  if (/^#{1,6}\s+\S/m.test(trimmed)) {
    return `${trimmed}\n`;
  }
  return `# ${title.trim()}\n\n${trimmed}\n`;
}

function compactDescription(content: string): string | undefined {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^[-*_]{3,}$/.test(line));

  const first = lines[0]?.replace(/^[-*]\s+/, "").trim();
  if (!first) return undefined;
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

export function createUserMemoryTool(
  session: Session,
  onMemoryUpdate?: MemoryUpdateCallback,
) {
  return tool(
    "saveUserMemory",
    [
      "Save a durable user fact when the user EXPLICITLY asks you to remember, save, or update information about them.",
      "",
      "**WHEN TO USE:**",
      "- User says 'remember that...', 'note that...', 'save this to memory', or asks to update a persistent fact.",
      "- The information is useful in future conversations, such as people, projects, personal notes, or strategy.",
      "",
      "**WHEN NOT TO USE:**",
      "- Do NOT infer memories silently from ordinary conversation.",
      "- Do NOT save secrets, passwords, tokens, or highly sensitive information.",
      "- Do NOT use this for reminders or tracked events; use insight/task tools instead.",
      "",
      "**CATEGORIES:**",
      "- people: person profiles, relationships, contacts",
      "- projects: ongoing work, project context, decisions",
      "- notes: general personal notes and durable facts",
      "- strategy: planning, goals, positioning, long-term strategy",
    ].join("\n"),
    {
      category: z
        .enum(MEMORY_CATEGORIES)
        .describe("The memory category that best matches the fact."),
      title: z
        .string()
        .min(1)
        .max(120)
        .describe("A concise user-facing title for the memory."),
      content: z
        .string()
        .min(1)
        .max(4000)
        .describe(
          "The durable memory content in concise Markdown. Keep it factual and useful.",
        ),
    },
    async ({ category, title, content }) => {
      try {
        // Validate user session for security/isolation
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

        const userId = session.user.id;
        const memoryRoot = getUserMemoryPath(userId);
        const categoryDir = path.join(memoryRoot, category);
        await fs.mkdir(categoryDir, { recursive: true });

        const fileName = `${slugifyTitle(title)}.md`;
        const filePath = path.join(categoryDir, fileName);
        const action: MemoryUpdatePayload["action"] = await fs
          .access(filePath)
          .then(() => "update" as const)
          .catch(() => "create" as const);
        const markdown = ensureMarkdown(title, content);

        await fs.writeFile(filePath, markdown, "utf8");

        const payload: MemoryUpdatePayload = {
          category,
          fileName,
          displayLabel: title.trim(),
          action,
          description: compactDescription(markdown),
          filePath,
        };

        onMemoryUpdate?.(payload);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                ...payload,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: `Failed to save memory: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
