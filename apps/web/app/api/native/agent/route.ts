/**
 * Native Agent API Routes
 *
 * Provides API endpoints for Claude Agent execution
 */

import type { NextRequest } from "next/server";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { claudePlugin } from "@/lib/ai/extensions";

// Set max duration for long-running agent tasks
// This prevents "TypeError: Load failed" when tool calls take a long time
// NOTE: Vercel has hard limits (Hobby: 10s, Pro: 800s)
export const maxDuration = 800;
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  FileAttachment,
  ImageAttachment,
} from "@openloomi/ai/agent/types";
import type { SandboxConfig } from "@openloomi/ai/agent/sandbox/types";
import { auth } from "@/app/(auth)/auth";
import { promises as fs } from "node:fs";
import { getUserInsightSettings } from "@/lib/db/queries";
import path from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import { getDocument, getDocumentChunks } from "@/lib/ai/rag/langchain-service";
import { readFile } from "@/lib/storage";
import { permissionResponses } from "./permission/route";
import { detectSudoPasswordPrompt } from "./password/route";

// Register Claude Agent plugin
getAgentRegistry().register(claudePlugin);

interface AgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  phase?: "plan" | "execute";
  planId?: string;
  workDir?: string;
  taskId?: string;
  provider?: "claude" | "deepagents";
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    thinkingLevel?: "disabled" | "low" | "adaptive";
  };
  sandboxConfig?: SandboxConfig;
  skillsConfig?: {
    enabled: boolean;
    userDirEnabled: boolean;
    appDirEnabled: boolean;
  };
  mcpConfig?: {
    enabled: boolean;
    userDirEnabled: boolean;
    appDirEnabled: boolean;
  };
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk";
  images?: ImageAttachment[];
  // File attachments to be saved to workspace
  fileAttachments?: FileAttachment[];
  // RAG documents support (from web agent)
  ragDocuments?: Array<{
    id: string;
    name: string;
  }>;
  // Focused insights support (from web agent)
  focusedInsightIds?: string[];
  focusedInsights?: Array<{
    id: string;
    title: string;
    description?: string | null;
    details?: any[] | null;
    timeline?: Array<{ title?: string; description?: string }> | null;
    groups?: string[] | null;
    platform?: string | null;
  }>;
  // Cloud auth token for embeddings API (needed in Tauri mode)
  authToken?: string;
}

// Helper to create SSE stream with heartbeat to keep connection alive
// SSE heartbeat sends a comment every 30 seconds to prevent idle timeouts
// from proxies, load balancers, and browsers
function createSSEStream(
  generator: AsyncGenerator<AgentMessage>,
  onClose?: () => void,
) {
  const encoder = new TextEncoder();
  const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds - safe margin for most idle timeouts

  return new ReadableStream({
    async start(controller) {
      let heartbeatTimer: NodeJS.Timeout | undefined;

      // Clear heartbeat timer
      const clearHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      };

      // Setup heartbeat to send SSE comments (ignored by clients, keeps connection alive)
      const setupHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          try {
            // SSE comment format - client ignores this but keeps connection active
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch (error) {
            // Controller already closed, stop heartbeat
            clearHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      try {
        // Start heartbeat immediately
        setupHeartbeat();

        for await (const message of generator) {
          const data = `data: ${JSON.stringify(message)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        console.error("[AgentAPI] Generator error:", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : String(error),
        });
        // Client may have disconnected — only send error if controller is still open
        const errorData = `data: ${JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        })}\n\n`;
        try {
          controller.enqueue(encoder.encode(errorData));
        } catch {}
      } finally {
        clearHeartbeat();
        try {
          controller.close();
        } catch {}
        // Call callback when connection closes
        onClose?.();
        // Log chat completion
        console.log("[AgentAPI] ===== CHAT COMPLETE =====");
      }
    },
  });
}

// SSE Response headers
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Convert home directory tilde path to absolute path
 */
function resolveHomeDir(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Save file attachments to the workspace directory
 * Returns array of saved file paths
 */
async function saveFileAttachmentsToWorkspace(
  fileAttachments: FileAttachment[],
  workDir: string,
): Promise<string[]> {
  const savedFilePaths: string[] = [];

  // Resolve the working directory path
  const resolvedWorkDir = resolveHomeDir(workDir);

  // Ensure workspace directory exists
  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    console.log("[AgentAPI] Created workspace directory:", resolvedWorkDir);
  }

  for (const attachment of fileAttachments) {
    try {
      // Decode base64 data
      const base64Data = attachment.data.includes(",")
        ? attachment.data.split(",")[1]
        : attachment.data;

      const buffer = Buffer.from(base64Data, "base64");
      const fileName = attachment.name;
      const filePath = path.join(resolvedWorkDir, fileName);

      // Write file to workspace
      await fs.writeFile(filePath, buffer);
      savedFilePaths.push(filePath);

      console.log(
        `[AgentAPI] Saved file attachment to workspace: ${fileName} -> ${filePath}`,
      );
    } catch (error) {
      console.error(
        `[AgentAPI] Failed to save file attachment: ${attachment.name}`,
        error,
      );
      // Continue with other files even if one fails
    }
  }

  return savedFilePaths;
}

/**
 * Save RAG documents to workspace by reconstructing from chunks
 *
 * NOTE: Since RAG only stores text content (not original binary files),
 * the reconstructed files are saved as .txt files with .pdf/.docx extensions preserved.
 * This preserves context about the original file type while indicating the actual content format.
 *
 * Returns array of saved file paths
 */
async function saveRAGDocumentsToWorkspace(
  ragDocuments: Array<{ id: string; name: string }>,
  workDir: string,
): Promise<string[]> {
  const savedFilePaths: string[] = [];

  // Resolve the working directory path
  const resolvedWorkDir = resolveHomeDir(workDir);

  // Ensure workspace directory exists
  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    console.log("[AgentAPI] Created workspace directory:", resolvedWorkDir);
  }

  for (const ragDoc of ragDocuments) {
    try {
      // Get document metadata from database
      const document = await getDocument(ragDoc.id);

      if (!document) {
        console.warn(`[AgentAPI] RAG document not found: ${ragDoc.id}`);
        continue;
      }

      const fileName = document.fileName;
      const filePath = path.join(resolvedWorkDir, fileName);

      // Check if we have an original binary file stored
      if (document.blobPath) {
        // Read original binary file from storage system and save it
        const fileBuffer = await readFile(document.blobPath);
        await fs.writeFile(filePath, fileBuffer);
        savedFilePaths.push(filePath);
        console.log(
          `[AgentAPI] Saved original RAG document to workspace: ${fileName} -> ${filePath} (${fileBuffer.length} bytes)`,
        );
      } else {
        // Fallback: reconstruct from chunks and save as .txt
        const chunks = await getDocumentChunks(ragDoc.id);

        if (!chunks || chunks.length === 0) {
          console.warn(`[AgentAPI] No chunks found for document: ${ragDoc.id}`);
          continue;
        }

        const sortedChunks = chunks.sort(
          (a: { chunkIndex: number }, b: { chunkIndex: number }) =>
            a.chunkIndex - b.chunkIndex,
        );

        const fullText = sortedChunks
          .map((chunk: { content: string }) => chunk.content)
          .join("\n\n");

        // Save as .txt file to indicate reconstructed content
        const txtFileName = `${fileName}.txt`;
        const txtFilePath = path.join(resolvedWorkDir, txtFileName);
        await fs.writeFile(txtFilePath, fullText, "utf-8");
        savedFilePaths.push(txtFilePath);

        console.log(
          `[AgentAPI] Saved RAG document (text reconstructed from chunks) to workspace: ${txtFileName} -> ${txtFilePath} (${chunks.length} chunks)`,
        );
      }
    } catch (error) {
      console.error(
        `[AgentAPI] Failed to save RAG document: ${ragDoc.name} (${ragDoc.id})`,
        error,
      );
      // Continue with other documents even if one fails
    }
  }

  return savedFilePaths;
}

// POST /api/native/agent - Run agent (direct execution mode)
export async function POST(req: NextRequest) {
  // Create AbortController for interrupting Agent
  const abortController = new AbortController();

  try {
    // Try to read raw body text for debugging
    const rawBodyText = await req.text();
    // Parse JSON
    let body: AgentRequest;
    try {
      body = JSON.parse(rawBodyText) as AgentRequest;
    } catch (parseError) {
      console.error(
        "[AgentAPI] ERROR: Failed to parse request body:",
        parseError,
        rawBodyText,
      );
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    // Get user session for business tools
    const session = await auth();

    // Check authentication - unauthenticated users cannot run the agent
    if (!session?.user?.id) {
      console.error("[AgentAPI] ERROR: Unauthorized access attempt");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user insight settings (including aiSoulPrompt and language)
    const userSettings = await getUserInsightSettings(session.user.id);

    if (!body.prompt) {
      console.error("[AgentAPI] ERROR: prompt is missing or empty!");
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    // Check again if prompt is empty string
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      console.error("[AgentAPI] ERROR: prompt is not a valid string:", {
        type: typeof body.prompt,
        value: body.prompt,
        trimmedLength: body.prompt?.trim()?.length || 0,
      });
      return Response.json(
        { error: "prompt must be a non-empty string" },
        { status: 400 },
      );
    }

    // Build context with priority order: Images > RAG Documents > Focused Insights > User Question
    let finalPrompt = "";
    const contextParts: string[] = [];
    // 1. RAG Documents context (SECOND priority - after images which are handled by Claude agent)
    if (body.ragDocuments && body.ragDocuments.length > 0) {
      const ragDocumentNames = body.ragDocuments.map((doc) => doc.name);
      const ragDocumentIds = body.ragDocuments.map((doc) => doc.id);

      const documentContext = `[System Note: The user has uploaded the following documents to their strategy memory:
${ragDocumentNames.map((name, i) => `- ${name} (ID: ${ragDocumentIds[i]})`).join("\n")}

**CRITICAL INSTRUCTION**: When the user asks questions like "What's in THIS document?", "Summarize THIS file", or references "this document", they are referring to the document(s) listed above. You MUST use the searchKnowledgeBase tool with the documentIds parameter set to [${ragDocumentIds.join(", ")}] to search ONLY within these specific documents.

System Note: User has uploaded the following documents to strategy memory:
${ragDocumentNames.map((name, i) => `- ${name} (ID: ${ragDocumentIds[i]})`).join("\n")}

**IMPORTANT**: When the user asks questions like "What's in THIS document?", "Summarize THIS file", or uses expressions like "this document", they are referring to the document(s) listed above. You MUST use the searchKnowledgeBase tool and set the documentIds parameter to [${ragDocumentIds.join(", ")}] to search ONLY within these specific documents.

For general questions about the user's strategy memory or previous uploads, you can omit the documentIds parameter to search all documents.
For general questions about the user's entire strategy memory or previously uploaded documents, you can omit the documentIds parameter to search all documents.
]\n\n`;

      console.log("[AgentAPI] Injecting RAG documents context into prompt:", {
        documentCount: body.ragDocuments.length,
        documentIds: ragDocumentIds,
        contextLength: documentContext.length,
      });

      contextParts.push(documentContext);
    }

    // 2. Focused Insights context (THIRD priority - after documents)
    if (body.focusedInsights && body.focusedInsights.length > 0) {
      // Fetch notes and documents for focused insights
      let insightsNotesDocumentsMap = new Map();
      if (session?.user?.id) {
        try {
          const { getInsightsWithNotesAndDocuments } =
            await import("@/lib/db/queries");
          insightsNotesDocumentsMap = await getInsightsWithNotesAndDocuments({
            userId: session.user.id,
            insightIds: body.focusedInsights.map((i) => i.id),
          });
          console.log(
            "[AgentAPI] Fetched notes and documents for focused insights:",
            {
              insightCount: body.focusedInsights.length,
              insightsWithData: Array.from(insightsNotesDocumentsMap.keys())
                .length,
            },
          );
        } catch (error) {
          console.error(
            "[AgentAPI] Failed to fetch notes and documents for insights:",
            error,
          );
          // Continue without notes/documents
        }
      }

      const insightsContent = body.focusedInsights
        .map((insight, index) => {
          let content = `\n[${index + 1}] **${insight.title}**\n`;

          // Add description (if any)
          if (insight.description) {
            const descStr =
              typeof insight.description === "string"
                ? insight.description
                : JSON.stringify(insight.description);
            content += `   Description: ${descStr}\n`;
          }

          // More friendly display of details instead of raw JSON.stringify
          if (insight.details) {
            // Parse details if it's a string (SQLite mode stores as JSON string)
            const details =
              typeof insight.details === "string"
                ? JSON.parse(insight.details || "[]")
                : insight.details;

            if (details.length > 0) {
              content += "   Details:\n";
              details.forEach((detail: any, detailIndex: number) => {
                const detailStr =
                  typeof detail === "string" ? detail : JSON.stringify(detail);
                if (detailStr.length > 500) {
                  content += `     [${detailIndex + 1}] ${detailStr.substring(0, 500)}... (content too long, truncated)\n`;
                } else {
                  content += `     [${detailIndex + 1}] ${detailStr}\n`;
                }
              });
            }
          }

          // Add timeline events (new emails) - only title/description, deduplicated
          if (insight.timeline) {
            const timeline =
              typeof insight.timeline === "string"
                ? JSON.parse(insight.timeline || "[]")
                : insight.timeline;

            if (timeline.length > 0) {
              content += "   Recent Emails:\n";
              const seen = new Set<string>();
              timeline.forEach((event: any) => {
                const title = event?.title ?? "";
                const description = event?.description ?? "";
                const isDuplicate = title === description;
                const key = isDuplicate ? title : `${title}||${description}`;

                if (seen.has(key)) return;
                seen.add(key);

                if (isDuplicate) {
                  const truncated =
                    title.length > 200
                      ? `${title.substring(0, 200)}...`
                      : title;
                  content += `     - ${truncated}\n`;
                } else {
                  const t =
                    title.length > 200
                      ? `${title.substring(0, 200)}...`
                      : title;
                  const d =
                    description.length > 200
                      ? `${description.substring(0, 200)}...`
                      : description;
                  content += `     - ${t}: ${d}\n`;
                }
              });
            }
          }

          // Add platform info (if any)
          if (insight.platform) {
            content += `   Platform: ${insight.platform}\n`;
          }

          // Add notes
          const insightData = insightsNotesDocumentsMap.get(insight.id);
          if (insightData?.notes && insightData.notes.length > 0) {
            content += `   Notes (${insightData.notes.length}):\n`;
            insightData.notes.forEach((note: any, noteIndex: number) => {
              const noteContent =
                note.content.length > 200
                  ? `${note.content.substring(0, 200)}... (truncated)`
                  : note.content;
              content += `     [${noteIndex + 1}] ${noteContent}\n`;
            });
          }

          // Add files/documents
          if (insightData?.documents && insightData.documents.length > 0) {
            content += `   Files (${insightData.documents.length}):\n`;
            const documentIds: string[] = [];
            insightData.documents.forEach((doc: any, docIndex: number) => {
              content += `     [${docIndex + 1}] ${doc.fileName} (${(doc.sizeBytes / 1024).toFixed(2)} KB)\n`;
              documentIds.push(doc.id);
            });
            // Add note about retrieving full content from knowledge base
            if (documentIds.length > 0) {
              content += `     Note: You can use searchKnowledgeBase tool with documentIds parameter [${documentIds.join(", ")}] to retrieve full content from these files.\n`;
              content += `     Tip: You can use searchKnowledgeBase tool with documentIds parameter [${documentIds.join(", ")}] to retrieve full content from these files.\n`;
            }
          }

          // Add ID reference
          content += `   ID: ${insight.id}\n`;

          return content;
        })
        .join("\n");

      const insightContext = `[System Note: The user is focusing on ${body.focusedInsights.length} specific Insights. Below are the details of each focused insight (including associated notes and files):

${insightsContent}

**CRITICAL INSTRUCTION**: When the user asks questions like "in this", "this", "here", or any reference that could point to these focused insights, you MUST:
1. FIRST check if their question refers to the focused insights listed above
2. Answer based on the insight details, notes, and files shown above
3. For files listed above, you can use searchKnowledgeBase tool with the documentIds parameter to retrieve their full content from the knowledge base
4. ONLY search all strategy memory if the question is clearly NOT about these insights

System Note: User is currently focusing on ${body.focusedInsights.length} specific Insights. Below are the details of each focused insight (including related notes and files):

${insightsContent}

**IMPORTANT**: When the user asks questions like "in this", "this", "here", etc., you MUST:
1. FIRST check if their question refers to the focused insights listed above
2. Answer based on the insight details, notes, and files shown above
3. For files listed above, you can use searchKnowledgeBase tool and set documentIds parameter to retrieve full content from the knowledge base
4. ONLY search all strategy memory when the question is clearly NOT about these insights

]\n\n`;

      console.log(
        "[AgentAPI] Injecting focused insights context into prompt:",
        {
          insightCount: body.focusedInsights.length,
          contextLength: insightContext.length,
        },
      );

      contextParts.push(insightContext);
    }

    // Combine all context parts with the user prompt
    finalPrompt = contextParts.join("") + body.prompt;

    // Save file attachments to workspace (if any)
    let savedFilesContext = "";
    if (
      body.fileAttachments &&
      body.fileAttachments.length > 0 &&
      body.workDir
    ) {
      try {
        const savedFilePaths = await saveFileAttachmentsToWorkspace(
          body.fileAttachments,
          body.workDir,
        );

        if (savedFilePaths.length > 0) {
          // Add context about saved files to the prompt
          savedFilesContext = `\n[System Note: The user has attached ${savedFilePaths.length} file(s) that have been saved to your workspace directory (${body.workDir}):\n${savedFilePaths.map((p, i) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has attached ${savedFilePaths.length} file(s) that have been saved to the workspace directory (${body.workDir}):\n${savedFilePaths.map((p, i) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

          console.log(
            `[AgentAPI] Saved ${savedFilePaths.length} file(s) to workspace:`,
            savedFilePaths,
          );
        }
      } catch (error) {
        console.error("[AgentAPI] Error saving file attachments:", error);
        // Continue even if file saving fails
      }
    }

    // Save RAG documents to workspace (if any)
    if (body.ragDocuments && body.ragDocuments.length > 0 && body.workDir) {
      try {
        const savedRAGFilePaths = await saveRAGDocumentsToWorkspace(
          body.ragDocuments,
          body.workDir,
        );

        if (savedRAGFilePaths.length > 0) {
          // Add context about saved RAG documents to the prompt
          const ragContext = `\n[System Note: The user has uploaded ${savedRAGFilePaths.length} RAG document(s) from strategy memory that have been reconstructed and saved to your workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p, i) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from the original documents. You can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has extracted ${savedRAGFilePaths.length} RAG document(s) from strategy memory and reconstructed and saved them to the workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p, i) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from original documents. You can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

          savedFilesContext = ragContext + savedFilesContext;

          console.log(
            `[AgentAPI] Saved ${savedRAGFilePaths.length} RAG document(s) to workspace:`,
            savedRAGFilePaths,
          );
        }
      } catch (error) {
        console.error("[AgentAPI] Error saving RAG documents:", error);
        // Continue even if RAG document saving fails
      }
    }

    // Prepend saved files context to the prompt
    if (savedFilesContext) {
      finalPrompt = savedFilesContext + finalPrompt;
    }

    // Build agent config
    const config: AgentConfig = {
      provider: body.provider || "claude",
      apiKey: body.modelConfig?.apiKey,
      baseUrl: body.modelConfig?.baseUrl,
      model: body.modelConfig?.model,
      thinkingLevel: body.modelConfig?.thinkingLevel,
      workDir: body.workDir,
    };

    const agentOptions: AgentOptions = {
      sessionId: body.sessionId,
      session: session || undefined, // Pass session for business tools
      authToken: body.authToken, // Cloud auth token for embeddings API (needed in Tauri mode)
      conversation: body.conversation,
      cwd: body.workDir,
      taskId: body.taskId,
      sandbox: body.sandboxConfig,
      skillsConfig: body.skillsConfig,
      mcpConfig: body.mcpConfig,
      permissionMode: body.permissionMode,
      images: body.images,
      focusedInsightIds: body.focusedInsightIds,
      focusedInsights: body.focusedInsights,
      allowedTools: [
        "Read",
        "Edit",
        "Write",
        "Glob",
        "Grep",
        "Bash",
        "WebSearch",
        "WebFetch",
        "Skill",
        "Task",
        "LSP",
        "TodoWrite",
      ],
      aiSoulPrompt: userSettings?.aiSoulPrompt ?? null,
      language: userSettings?.language ?? null,
      abortController, // Pass AbortController for interruption
      stream: true,
    };

    // Get agent instance
    const agent = getAgentRegistry().create(config);

    // Create permission request event queue
    const permissionRequestEventQueue: Array<{
      toolName: string;
      toolInput: Record<string, unknown>;
      toolUseID: string;
      decisionReason?: string;
      blockedPath?: string;
    }> = [];

    // Track pending sudo commands for password input flow
    const pendingSudoCommands = new Map<
      string,
      { command: string; cwd?: string }
    >();

    let generator: AsyncGenerator<AgentMessage>;
    let generatorCompletedNormally = false;

    // Route based on phase
    if (body.phase === "plan") {
      // Planning phase only
      generator = agent.plan(finalPrompt, {
        ...agentOptions,
        onPermissionRequest: async (request) => {
          console.log("[AgentAPI] Permission request (plan mode):", request);
          // Auto-allow in plan mode since no actual execution
          return { behavior: "allow" };
        },
      });
    } else if (body.phase === "execute" && body.planId) {
      // Execute approved plan
      if (!body.planId) {
        return Response.json(
          { error: "planId is required for execute phase" },
          { status: 400 },
        );
      }
      const plan = agent.getPlan(body.planId);
      if (!plan) {
        return Response.json(
          { error: "Plan not found or expired" },
          { status: 404 },
        );
      }

      // Assign planId to local const for type narrowing
      const planId = body.planId;

      // Create an event queue for insight changes
      const insightChangeEventQueue: Array<{
        action: "create" | "update" | "delete";
        insightId?: string;
        insight?: Record<string, unknown>;
      }> = [];

      // Wrap the generator to intercept messages and add insight change events
      generator = (async function* () {
        const innerGenerator = agent.execute({
          planId,
          originalPrompt: finalPrompt,
          ...agentOptions,
          onInsightChange: (data) => {
            // Add to event queue
            insightChangeEventQueue.push(data);
          },
          onPermissionRequest: async (request) => {
            console.log(
              "[AgentAPI] Permission request (execute mode):",
              request,
            );
            // Add to event queue and wait for user response
            permissionRequestEventQueue.push(request);

            // Create a promise that will be resolved when user responds.
            // A TTL timer prevents the Map entry from leaking if the user
            // never responds (e.g. tab closed, agent crashed).
            const PERMISSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
            return new Promise((resolve) => {
              const ttl = setTimeout(() => {
                if (permissionResponses.has(request.toolUseID)) {
                  permissionResponses.delete(request.toolUseID);
                  console.warn(
                    `[AgentAPI] Permission request timed out, auto-denying: ${request.toolUseID}`,
                  );
                  resolve({ behavior: "deny" });
                }
              }, PERMISSION_TTL_MS);
              permissionResponses.set(request.toolUseID, {
                resolve: (result) => {
                  clearTimeout(ttl);
                  resolve(result);
                },
                reject: (error) => {
                  clearTimeout(ttl);
                  permissionResponses.delete(request.toolUseID);
                  console.error(
                    "[AgentAPI] Permission request rejected:",
                    error,
                  );
                  resolve({ behavior: "deny" });
                },
              });
            });
          },
        });

        for await (const message of innerGenerator) {
          // Yield the original message
          yield message;

          // After yielding, check if there are any insight change events to send
          while (insightChangeEventQueue.length > 0) {
            const event = insightChangeEventQueue.shift();
            if (event) {
              // Send insight change event as a special message type
              yield {
                type: "insightsRefresh" as const,
                ...event,
              };
            }
          }

          // Check if there are any permission request events to send
          while (permissionRequestEventQueue.length > 0) {
            const request = permissionRequestEventQueue.shift();
            if (request) {
              // Send permission request as a special message type
              yield {
                type: "permission_request" as const,
                permissionRequest: request,
              };
            }
          }
        }
      })();
    } else {
      // Direct execution (default)
      // Create an event queue for insight changes
      const insightChangeEventQueue: Array<{
        action: "create" | "update" | "delete";
        insightId?: string;
        insight?: Record<string, unknown>;
      }> = [];

      // Reuse the permission request event queue from outer scope
      generator = (async function* () {
        try {
          const innerGenerator = agent.run(finalPrompt, {
            ...agentOptions,
            onInsightChange: (data) => {
              // Add to event queue
              insightChangeEventQueue.push(data);
            },
            onPermissionRequest: async (request) => {
              console.log("[AgentAPI] Permission request (run mode):", request);

              // Check if this is a Bash command that needs sudo
              if (request.toolName === "Bash") {
                const command = request.toolInput?.command as string;
                if (command && /\bsudo\b/.test(command)) {
                  // Store the command for potential re-execution
                  pendingSudoCommands.set(request.toolUseID, {
                    command,
                    cwd: request.toolInput?.cwd as string | undefined,
                  });
                  console.log(
                    "[AgentAPI] Stored sudo command for toolUseID:",
                    request.toolUseID,
                  );
                }
              }

              // Add to event queue and wait for user response
              permissionRequestEventQueue.push(request);

              // Create a promise that will be resolved when user responds.
              // A TTL timer prevents the Map entry from leaking if the user
              // never responds (e.g. tab closed, agent crashed).
              const PERMISSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
              return new Promise((resolve) => {
                const ttl = setTimeout(() => {
                  if (permissionResponses.has(request.toolUseID)) {
                    permissionResponses.delete(request.toolUseID);
                    console.warn(
                      `[AgentAPI] Permission request timed out, auto-denying: ${request.toolUseID}`,
                    );
                    resolve({ behavior: "deny" });
                  }
                }, PERMISSION_TTL_MS);
                permissionResponses.set(request.toolUseID, {
                  resolve: (result) => {
                    clearTimeout(ttl);
                    resolve(result);
                  },
                  reject: (error) => {
                    clearTimeout(ttl);
                    permissionResponses.delete(request.toolUseID);
                    console.error(
                      "[AgentAPI] Permission request rejected:",
                      error,
                    );
                    resolve({ behavior: "deny" });
                  },
                });
              });
            },
          });

          for await (const message of innerGenerator) {
            // Check for password prompt in tool results
            if (
              message.type === "tool_result" &&
              message.output &&
              message.toolUseId
            ) {
              if (detectSudoPasswordPrompt(message.output)) {
                const pendingCmd = pendingSudoCommands.get(message.toolUseId);
                if (pendingCmd) {
                  console.log(
                    "[AgentAPI] Detected sudo password prompt for toolUseID:",
                    message.toolUseId,
                  );
                  // Emit password_input message to frontend
                  yield {
                    type: "password_input" as const,
                    toolUseId: message.toolUseId,
                    passwordInput: {
                      toolUseID: message.toolUseId,
                      originalCommand: pendingCmd.command,
                    },
                  };
                }
              }
            }

            // Yield the original message
            yield message;

            // After yielding, check if there are any insight change events to send
            while (insightChangeEventQueue.length > 0) {
              const event = insightChangeEventQueue.shift();
              if (event) {
                // Send insight change event as a special message type
                yield {
                  type: "insightsRefresh" as const,
                  ...event,
                };
              }
            }

            // Check if there are any permission request events to send
            while (permissionRequestEventQueue.length > 0) {
              const request = permissionRequestEventQueue.shift();
              if (request) {
                // Send permission request as a special message type
                yield {
                  type: "permission_request" as const,
                  permissionRequest: request,
                };
              }
            }
          }
        } finally {
          generatorCompletedNormally = true;
        }
      })();
    }

    // Create SSE stream
    const readable = createSSEStream(generator, () => {
      // Only abort if generator did not complete normally
      if (!generatorCompletedNormally) {
        abortController.abort();
      }
    });

    return new Response(readable, { headers: SSE_HEADERS });
  } catch (error) {
    console.error("[AgentAPI] Error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
