/**
 * Download Insight Attachment tool - Download attachment from an insight
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { getAppUrl } from "@/lib/env";

/**
 * Create the downloadInsightAttachment tool
 */
export function createDownloadAttachmentTool(
  session: Session,
  chatId?: string,
) {
  return tool(
    "downloadInsightAttachment",
    [
      "**📎 WHAT THIS TOOL DOES**",
      "Download an attachment from an insight directly to session workDir.",
      "",
      "**🎯 USE WHEN:**",
      "- User wants to download/view an attachment from an insight",
      "- User asks 'download this file', 'show me the attachment', 'open the file'",
      "",
      "**📝 HOW TO USE:**",
      "1. First, use chatInsight with withDetail=true to get the insight details including attachments",
      "2. Find the attachment name in the insight's details[].attachments array",
      "3. Call this tool with insightId and attachmentName to download the file",
      "",
      "**📤 RESPONSE FORMAT:**",
      "- success: boolean indicating if download succeeded",
      "- filePath: absolute path where file was saved",
      "- fileName: original filename of the attachment",
      "- message: confirmation message with file path",
      "",
      "**📋 PARAMETERS:**",
      "- insightId: The insight ID to get attachment from (tool will fetch attachment info from database)",
      "- attachmentName: The name of the attachment file to download (e.g., 'Agent-20260327.pdf')",
    ].join("\n"),
    {
      insightId: z
        .string()
        .describe("The insight ID that contains the attachment"),
      attachmentName: z
        .string()
        .describe("The name of the attachment file to download"),
    },
    async ({ insightId, attachmentName }) => {
      try {
        // Get insight from database to find the attachment
        const { getInsightByIdForUser } = await import("@/lib/db/queries");
        const result = await getInsightByIdForUser({
          userId: session.user.id,
          insightId,
        });

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: false, message: "Insight not found" },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const { insight } = result;

        // Find the attachment by name in insight details
        let attachment = null;
        if (insight.details && Array.isArray(insight.details)) {
          for (const detail of insight.details) {
            if (detail.attachments && Array.isArray(detail.attachments)) {
              attachment = detail.attachments.find(
                (a: { name?: string }) => a.name === attachmentName,
              );
              if (attachment) break;
            }
          }
        }

        if (!attachment) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    message: `Attachment '${attachmentName}' not found in insight`,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        console.log(
          "[downloadInsightAttachment] Found attachment:",
          attachment,
        );

        // Build download URL from attachment
        const downloadUrl = attachment.downloadUrl || attachment.url;
        if (!downloadUrl) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    message: "Attachment has no download URL",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Build session workDir path
        const sessionWorkDir = join(
          homedir(),
          ".openloomi",
          "sessions",
          chatId || "default",
        );
        mkdirSync(sessionWorkDir, { recursive: true });

        // Fetch the file
        const fullUrl = downloadUrl.startsWith("http")
          ? downloadUrl
          : `${getAppUrl()}${downloadUrl}`;
        console.log("[downloadInsightAttachment] Fetching:", fullUrl);

        const fileResponse = await fetch(fullUrl);
        if (!fileResponse.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    message: `Failed to fetch file: ${fileResponse.status} ${fileResponse.statusText}`,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const filePath = join(sessionWorkDir, attachmentName);
        writeFileSync(filePath, fileBuffer);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  filePath,
                  fileName: attachmentName,
                  message: `File saved to ${filePath}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        console.error("[downloadInsightAttachment] Error:", error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
