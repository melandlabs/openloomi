import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Session } from "next-auth";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import type { SandboxConfig } from "@openloomi/ai/agent/sandbox/types";
import {
  DEFAULT_ALLOWED_TOOLS,
  type AgentConfig,
  type AgentMessage,
  type AgentOptions,
  type FileAttachment,
  type ImageAttachment,
  type IAgent,
} from "@openloomi/ai/agent/types";

import { claudePlugin } from "@/lib/ai/extensions";
import { getDocument, getDocumentChunks } from "@/lib/ai/rag/langchain-service";
import { getUserInsightSettings } from "@/lib/db/queries";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import { readFile } from "@/lib/storage";
import { permissionResponses } from "./permissions";
import { detectSudoPasswordPrompt } from "./sudo";

export interface NativeAgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  platform?: string;
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
  fileAttachments?: FileAttachment[];
  ragDocuments?: Array<{
    id: string;
    name: string;
  }>;
  focusedInsightIds?: string[];
  focusedInsights?: Array<{
    id: string;
    title: string;
    description?: string | null;
    details?: unknown[] | null;
    timeline?: Array<{ title?: string; description?: string }> | null;
    groups?: string[] | null;
    platform?: string | null;
  }>;
  authToken?: string;
}

export type AuthenticatedNativeAgentSession = Session & {
  platform?: string;
};

export interface NativeAgentRunnerContext {
  session: AuthenticatedNativeAgentSession;
  userId: string;
  abortController: AbortController;
}

export interface NativeAgentRun {
  generator: AsyncGenerator<AgentMessage>;
  shouldAbortOnClose: () => boolean;
}

export class NativeAgentRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "NativeAgentRequestError";
  }
}

type PermissionRequest = Parameters<
  NonNullable<AgentOptions["onPermissionRequest"]>
>[0];

type InsightChange = Parameters<
  NonNullable<AgentOptions["onInsightChange"]>
>[0];

// Registering is idempotent in the provider registry and keeps every native
// agent entry point from needing to remember provider setup.
getAgentRegistry().register(claudePlugin);

/**
 * Run a native agent request and return a reusable message generator.
 */
export async function runNativeAgentRequest(
  body: NativeAgentRequest,
  context: NativeAgentRunnerContext,
): Promise<NativeAgentRun> {
  validateNativeAgentRequest(body);

  const finalPrompt = await buildNativeAgentPrompt(body, context.session);
  const userSettings = await getUserInsightSettings(context.userId);
  const config = await buildAgentConfig(body, context.userId);
  const agentOptions = buildAgentOptions(body, context, {
    aiSoulPrompt: userSettings?.aiSoulPrompt ?? null,
    language: userSettings?.language ?? null,
  });
  const agent = getAgentRegistry().create(config);

  const permissionRequestEventQueue: PermissionRequest[] = [];
  const pendingSudoCommands = new Map<
    string,
    { command: string; cwd?: string }
  >();

  let selectedGenerator: AsyncGenerator<AgentMessage>;

  if (body.phase === "plan") {
    selectedGenerator = agent.plan(finalPrompt, {
      ...agentOptions,
      onPermissionRequest: async (request) => {
        console.log("[AgentAPI] Permission request (plan mode):", request);
        // Planning should describe actions, not perform them.
        return { behavior: "allow" };
      },
    });
  } else if (body.phase === "execute") {
    if (!body.planId) {
      throw new NativeAgentRequestError(
        "planId is required for execute phase",
        400,
      );
    }

    const plan = agent.getPlan(body.planId);
    if (!plan) {
      throw new NativeAgentRequestError("Plan not found or expired", 404);
    }

    selectedGenerator = createExecuteGenerator({
      agent,
      planId: body.planId,
      finalPrompt,
      agentOptions,
      permissionRequestEventQueue,
    });
  } else {
    selectedGenerator = createRunGenerator({
      agent,
      finalPrompt,
      agentOptions,
      permissionRequestEventQueue,
      pendingSudoCommands,
    });
  }

  let completedNormally = false;
  const generator = (async function* () {
    try {
      yield* selectedGenerator;
    } finally {
      completedNormally = true;
    }
  })();

  return {
    generator,
    shouldAbortOnClose: () => !completedNormally,
  };
}

function validateNativeAgentRequest(body: NativeAgentRequest) {
  if (!body.prompt) {
    console.error("[AgentAPI] ERROR: prompt is missing or empty!");
    throw new NativeAgentRequestError("prompt is required", 400);
  }

  if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
    console.error("[AgentAPI] ERROR: prompt is not a valid string:", {
      type: typeof body.prompt,
      value: body.prompt,
      trimmedLength: body.prompt?.trim()?.length || 0,
    });
    throw new NativeAgentRequestError("prompt must be a non-empty string", 400);
  }
}

async function buildAgentConfig(
  body: NativeAgentRequest,
  userId: string,
): Promise<AgentConfig> {
  const userAnthropicConfig = await getUserLlmProviderConfig({
    userId,
    providerType: "anthropic_compatible",
  });

  const effectiveModelConfig = {
    ...body.modelConfig,
    ...userAnthropicConfig,
  };

  // User-saved Anthropic settings win over request defaults such as the
  // frontend's selectedModel fallback to claude-sonnet-4.6.
  return {
    provider: body.provider || "claude",
    apiKey: effectiveModelConfig.apiKey,
    baseUrl: effectiveModelConfig.baseUrl,
    model: effectiveModelConfig.model,
    thinkingLevel: body.modelConfig?.thinkingLevel,
    workDir: body.workDir,
  };
}

function buildAgentOptions(
  body: NativeAgentRequest,
  context: NativeAgentRunnerContext,
  userSettings: {
    aiSoulPrompt: string | null;
    language: string | null;
  },
): AgentOptions {
  return {
    sessionId: body.sessionId,
    session: context.session,
    authToken: body.authToken,
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
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    aiSoulPrompt: userSettings.aiSoulPrompt,
    language: userSettings.language,
    abortController: context.abortController,
    stream: true,
  };
}

async function buildNativeAgentPrompt(
  body: NativeAgentRequest,
  session: AuthenticatedNativeAgentSession,
): Promise<string> {
  const contextParts: string[] = [];

  if (body.ragDocuments && body.ragDocuments.length > 0) {
    contextParts.push(buildRagDocumentPromptContext(body.ragDocuments));
  }

  if (body.focusedInsights && body.focusedInsights.length > 0) {
    contextParts.push(await buildFocusedInsightsPromptContext(body, session));
  }

  let finalPrompt = contextParts.join("") + body.prompt;
  const savedFilesContext = await buildSavedFilesPromptContext(body);
  if (savedFilesContext) {
    finalPrompt = savedFilesContext + finalPrompt;
  }

  return finalPrompt;
}

function buildRagDocumentPromptContext(
  ragDocuments: Array<{ id: string; name: string }>,
): string {
  const ragDocumentNames = ragDocuments.map((doc) => doc.name);
  const ragDocumentIds = ragDocuments.map((doc) => doc.id);

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
    documentCount: ragDocuments.length,
    documentIds: ragDocumentIds,
    contextLength: documentContext.length,
  });

  return documentContext;
}

async function buildFocusedInsightsPromptContext(
  body: NativeAgentRequest,
  session: AuthenticatedNativeAgentSession,
): Promise<string> {
  const focusedInsights = body.focusedInsights ?? [];
  let insightsNotesDocumentsMap = new Map();

  if (session.user?.id) {
    try {
      const { getInsightsWithNotesAndDocuments } =
        await import("@/lib/db/queries");
      insightsNotesDocumentsMap = await getInsightsWithNotesAndDocuments({
        userId: session.user.id,
        insightIds: focusedInsights.map((i) => i.id),
      });
      console.log(
        "[AgentAPI] Fetched notes and documents for focused insights:",
        {
          insightCount: focusedInsights.length,
          insightsWithData: Array.from(insightsNotesDocumentsMap.keys()).length,
        },
      );
    } catch (error) {
      console.error(
        "[AgentAPI] Failed to fetch notes and documents for insights:",
        error,
      );
    }
  }

  const insightsContent = focusedInsights
    .map((insight, index) => {
      let content = `\n[${index + 1}] **${insight.title}**\n`;

      if (insight.description) {
        const descStr =
          typeof insight.description === "string"
            ? insight.description
            : JSON.stringify(insight.description);
        content += `   Description: ${descStr}\n`;
      }

      if (insight.details) {
        const rawDetails = insight.details as unknown;
        const details =
          typeof rawDetails === "string"
            ? JSON.parse(rawDetails || "[]")
            : rawDetails;

        if (Array.isArray(details) && details.length > 0) {
          content += "   Details:\n";
          details.forEach((detail: unknown, detailIndex: number) => {
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

      if (insight.timeline) {
        const rawTimeline = insight.timeline as unknown;
        const timeline =
          typeof rawTimeline === "string"
            ? JSON.parse(rawTimeline || "[]")
            : rawTimeline;

        if (Array.isArray(timeline) && timeline.length > 0) {
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
                title.length > 200 ? `${title.substring(0, 200)}...` : title;
              content += `     - ${truncated}\n`;
            } else {
              const t =
                title.length > 200 ? `${title.substring(0, 200)}...` : title;
              const d =
                description.length > 200
                  ? `${description.substring(0, 200)}...`
                  : description;
              content += `     - ${t}: ${d}\n`;
            }
          });
        }
      }

      if (insight.platform) {
        content += `   Platform: ${insight.platform}\n`;
      }

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

      if (insightData?.documents && insightData.documents.length > 0) {
        content += `   Files (${insightData.documents.length}):\n`;
        const documentIds: string[] = [];
        insightData.documents.forEach((doc: any, docIndex: number) => {
          content += `     [${docIndex + 1}] ${doc.fileName} (${(doc.sizeBytes / 1024).toFixed(2)} KB)\n`;
          documentIds.push(doc.id);
        });
        if (documentIds.length > 0) {
          content += `     Note: You can use searchKnowledgeBase tool with documentIds parameter [${documentIds.join(", ")}] to retrieve full content from these files.\n`;
          content += `     Tip: You can use searchKnowledgeBase tool with documentIds parameter [${documentIds.join(", ")}] to retrieve full content from these files.\n`;
        }
      }

      content += `   ID: ${insight.id}\n`;

      return content;
    })
    .join("\n");

  const insightContext = `[System Note: The user is focusing on ${focusedInsights.length} specific Insights. Below are the details of each focused insight (including associated notes and files):

${insightsContent}

**CRITICAL INSTRUCTION**: When the user asks questions like "in this", "this", "here", or any reference that could point to these focused insights, you MUST:
1. FIRST check if their question refers to the focused insights listed above
2. Answer based on the insight details, notes, and files shown above
3. For files listed above, you can use searchKnowledgeBase tool with the documentIds parameter to retrieve their full content from the knowledge base
4. ONLY search all strategy memory if the question is clearly NOT about these insights

System Note: User is currently focusing on ${focusedInsights.length} specific Insights. Below are the details of each focused insight (including related notes and files):

${insightsContent}

**IMPORTANT**: When the user asks questions like "in this", "this", "here", etc., you MUST:
1. FIRST check if their question refers to the focused insights listed above
2. Answer based on the insight details, notes, and files shown above
3. For files listed above, you can use searchKnowledgeBase tool and set documentIds parameter to retrieve full content from the knowledge base
4. ONLY search all strategy memory when the question is clearly NOT about these insights

]\n\n`;

  console.log("[AgentAPI] Injecting focused insights context into prompt:", {
    insightCount: focusedInsights.length,
    contextLength: insightContext.length,
  });

  return insightContext;
}

async function buildSavedFilesPromptContext(
  body: NativeAgentRequest,
): Promise<string> {
  let savedFilesContext = "";

  if (body.fileAttachments && body.fileAttachments.length > 0 && body.workDir) {
    try {
      const savedFilePaths = await saveFileAttachmentsToWorkspace(
        body.fileAttachments,
        body.workDir,
      );

      if (savedFilePaths.length > 0) {
        savedFilesContext = `\n[System Note: The user has attached ${savedFilePaths.length} file(s) that have been saved to your workspace directory (${body.workDir}):\n${savedFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has attached ${savedFilePaths.length} file(s) that have been saved to the workspace directory (${body.workDir}):\n${savedFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

        console.log(
          `[AgentAPI] Saved ${savedFilePaths.length} file(s) to workspace:`,
          savedFilePaths,
        );
      }
    } catch (error) {
      console.error("[AgentAPI] Error saving file attachments:", error);
    }
  }

  if (body.ragDocuments && body.ragDocuments.length > 0 && body.workDir) {
    try {
      const savedRAGFilePaths = await saveRAGDocumentsToWorkspace(
        body.ragDocuments,
        body.workDir,
      );

      if (savedRAGFilePaths.length > 0) {
        const ragContext = `\n[System Note: The user has uploaded ${savedRAGFilePaths.length} RAG document(s) from strategy memory that have been reconstructed and saved to your workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from the original documents. You can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has extracted ${savedRAGFilePaths.length} RAG document(s) from strategy memory and reconstructed and saved them to the workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from original documents. You can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

        savedFilesContext = ragContext + savedFilesContext;

        console.log(
          `[AgentAPI] Saved ${savedRAGFilePaths.length} RAG document(s) to workspace:`,
          savedRAGFilePaths,
        );
      }
    } catch (error) {
      console.error("[AgentAPI] Error saving RAG documents:", error);
    }
  }

  return savedFilesContext;
}

function createExecuteGenerator({
  agent,
  planId,
  finalPrompt,
  agentOptions,
  permissionRequestEventQueue,
}: {
  agent: IAgent;
  planId: string;
  finalPrompt: string;
  agentOptions: AgentOptions;
  permissionRequestEventQueue: PermissionRequest[];
}): AsyncGenerator<AgentMessage> {
  const insightChangeEventQueue: InsightChange[] = [];

  return (async function* () {
    const innerGenerator = agent.execute({
      planId,
      originalPrompt: finalPrompt,
      ...agentOptions,
      onInsightChange: (data) => {
        insightChangeEventQueue.push(data);
      },
      onPermissionRequest: async (request) => {
        console.log("[AgentAPI] Permission request (execute mode):", request);
        permissionRequestEventQueue.push(request);
        return waitForPermissionResponse(request);
      },
    });

    for await (const message of innerGenerator) {
      yield message;
      yield* drainQueuedAgentEvents(
        insightChangeEventQueue,
        permissionRequestEventQueue,
      );
    }
  })();
}

function createRunGenerator({
  agent,
  finalPrompt,
  agentOptions,
  permissionRequestEventQueue,
  pendingSudoCommands,
}: {
  agent: IAgent;
  finalPrompt: string;
  agentOptions: AgentOptions;
  permissionRequestEventQueue: PermissionRequest[];
  pendingSudoCommands: Map<string, { command: string; cwd?: string }>;
}): AsyncGenerator<AgentMessage> {
  const insightChangeEventQueue: InsightChange[] = [];

  return (async function* () {
    const innerGenerator = agent.run(finalPrompt, {
      ...agentOptions,
      onInsightChange: (data) => {
        insightChangeEventQueue.push(data);
      },
      onPermissionRequest: async (request) => {
        console.log("[AgentAPI] Permission request (run mode):", request);

        if (request.toolName === "Bash") {
          const command = request.toolInput?.command as string;
          if (command && /\bsudo\b/.test(command)) {
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

        permissionRequestEventQueue.push(request);
        return waitForPermissionResponse(request);
      },
    });

    for await (const message of innerGenerator) {
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
            yield {
              type: "password_input",
              toolUseId: message.toolUseId,
              passwordInput: {
                toolUseID: message.toolUseId,
                originalCommand: pendingCmd.command,
              },
            };
          }
        }
      }

      yield message;
      yield* drainQueuedAgentEvents(
        insightChangeEventQueue,
        permissionRequestEventQueue,
      );
    }
  })();
}

function waitForPermissionResponse(request: PermissionRequest): Promise<{
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
}> {
  // A TTL timer prevents the Map entry from leaking if the user never responds
  // because a tab closed or the agent crashed.
  const PERMISSION_TTL_MS = 5 * 60 * 1000;
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
        console.error("[AgentAPI] Permission request rejected:", error);
        resolve({ behavior: "deny" });
      },
    });
  });
}

function* drainQueuedAgentEvents(
  insightChangeEventQueue: InsightChange[],
  permissionRequestEventQueue: PermissionRequest[],
): Generator<AgentMessage> {
  while (insightChangeEventQueue.length > 0) {
    const event = insightChangeEventQueue.shift();
    if (event) {
      yield {
        type: "insightsRefresh",
        ...event,
      };
    }
  }

  while (permissionRequestEventQueue.length > 0) {
    const request = permissionRequestEventQueue.shift();
    if (request) {
      yield {
        type: "permission_request",
        permissionRequest: request,
      };
    }
  }
}

function resolveHomeDir(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

async function saveFileAttachmentsToWorkspace(
  fileAttachments: FileAttachment[],
  workDir: string,
): Promise<string[]> {
  const savedFilePaths: string[] = [];
  const resolvedWorkDir = resolveHomeDir(workDir);

  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    console.log("[AgentAPI] Created workspace directory:", resolvedWorkDir);
  }

  for (const attachment of fileAttachments) {
    try {
      const base64Data = attachment.data.includes(",")
        ? attachment.data.split(",")[1]
        : attachment.data;

      const buffer = Buffer.from(base64Data, "base64");
      const filePath = path.join(resolvedWorkDir, attachment.name);

      await fs.writeFile(filePath, buffer);
      savedFilePaths.push(filePath);

      console.log(
        `[AgentAPI] Saved file attachment to workspace: ${attachment.name} -> ${filePath}`,
      );
    } catch (error) {
      console.error(
        `[AgentAPI] Failed to save file attachment: ${attachment.name}`,
        error,
      );
    }
  }

  return savedFilePaths;
}

async function saveRAGDocumentsToWorkspace(
  ragDocuments: Array<{ id: string; name: string }>,
  workDir: string,
): Promise<string[]> {
  const savedFilePaths: string[] = [];
  const resolvedWorkDir = resolveHomeDir(workDir);

  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    console.log("[AgentAPI] Created workspace directory:", resolvedWorkDir);
  }

  for (const ragDoc of ragDocuments) {
    try {
      const document = await getDocument(ragDoc.id);

      if (!document) {
        console.warn(`[AgentAPI] RAG document not found: ${ragDoc.id}`);
        continue;
      }

      const fileName = document.fileName;
      const filePath = path.join(resolvedWorkDir, fileName);

      if (document.blobPath) {
        const fileBuffer = await readFile(document.blobPath);
        await fs.writeFile(filePath, fileBuffer);
        savedFilePaths.push(filePath);
        console.log(
          `[AgentAPI] Saved original RAG document to workspace: ${fileName} -> ${filePath} (${fileBuffer.length} bytes)`,
        );
      } else {
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
    }
  }

  return savedFilePaths;
}
