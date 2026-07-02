import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getAgentRegistry, type AgentRegistry } from "../registry";
import {
  AgentRuntimeRequestError,
  runAgentRuntimeRequest,
  type AgentRuntimePermissionHandler,
  type AgentRuntimeRun,
} from "../runtime";
import type { SandboxConfig } from "../sandbox/types";
import {
  DEFAULT_ALLOWED_TOOLS,
  type AgentConfig,
  type AgentOptions,
  type AgentProvider,
  type FileAttachment,
  type ImageAttachment,
} from "../types";

export interface NativeAgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  platform?: string;
  phase?: "plan" | "execute";
  planId?: string;
  workDir?: string;
  useProvidedWorkDir?: boolean;
  taskId?: string;
  provider?: AgentProvider;
  providerConfig?: Record<string, unknown>;
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    thinkingLevel?: "disabled" | "low" | "adaptive";
  };
  allowedTools?: string[];
  disallowedTools?: string[];
  excludeTools?: string[];
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
    details?: unknown[] | string | null;
    timeline?: Array<{ title?: string; description?: string }> | string | null;
    groups?: string[] | null;
    platform?: string | null;
  }>;
  authToken?: string;
}

export interface NativeAgentSession {
  user?: {
    id?: string;
    email?: string;
    name?: string;
    type?: string;
    [key: string]: unknown;
  };
  platform?: string;
  expires?: string;
  [key: string]: unknown;
}

export interface NativeAgentRunnerContext {
  session: NativeAgentSession;
  userId: string;
  abortController: AbortController;
  permissionHandler?: AgentRuntimePermissionHandler;
  emitPermissionRequestEvents?: boolean;
}

export type NativeAgentRun = AgentRuntimeRun;
export { AgentRuntimeRequestError as NativeAgentRequestError };

export interface NativeAgentInsightSettings {
  aiSoulPrompt?: string | null;
  language?: string | null;
}

export interface NativeAgentLlmProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface NativeAgentDocument {
  fileName: string;
  blobPath?: string | null;
}

export interface NativeAgentDocumentChunk {
  chunkIndex: number;
  content: string;
}

export interface NativeAgentFocusedInsightData {
  notes?: Array<{
    content: string;
  }>;
  documents?: Array<{
    id: string;
    fileName: string;
    sizeBytes: number;
  }>;
}

export interface NativeAgentHost {
  registry?: AgentRegistry;
  registerProviders?: () => void | Promise<void>;
  getUserInsightSettings?: (
    userId: string,
  ) => Promise<NativeAgentInsightSettings | null>;
  getUserLlmProviderConfig?: (params: {
    userId: string;
    providerType: "anthropic_compatible";
  }) => Promise<NativeAgentLlmProviderConfig | undefined>;
  getDocument?: (documentId: string) => Promise<NativeAgentDocument | null>;
  getDocumentChunks?: (
    documentId: string,
  ) => Promise<NativeAgentDocumentChunk[]>;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  getFocusedInsightsWithNotesAndDocuments?: (params: {
    userId: string;
    insightIds: string[];
  }) => Promise<Map<string, NativeAgentFocusedInsightData>>;
  detectPasswordPrompt?: (output: string) => boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * Package-level native agent runner.
 *
 * This function is intentionally host-agnostic: it owns request normalization,
 * prompt/context assembly, model/tool option assembly, and dispatch into the
 * shared agent runtime, while the app supplies provider registration and data
 * access through NativeAgentHost ports.
 */
export async function runNativeAgentRequest(
  body: NativeAgentRequest,
  context: NativeAgentRunnerContext,
  host: NativeAgentHost = {},
): Promise<NativeAgentRun> {
  await host.registerProviders?.();

  const finalPrompt = await buildNativeAgentPrompt(body, context.session, host);
  const userSettings = await host.getUserInsightSettings?.(context.userId);
  const config = await buildAgentConfig(body, context.userId, host);
  const agentOptions = buildAgentOptions(body, context, {
    aiSoulPrompt: userSettings?.aiSoulPrompt ?? null,
    language: userSettings?.language ?? null,
  });

  return runAgentRuntimeRequest(
    {
      prompt: finalPrompt,
      phase: body.phase,
      planId: body.planId,
      config,
      options: agentOptions,
    },
    {
      registry: host.registry ?? getAgentRegistry(),
      permissionHandler: context.permissionHandler,
      emitPermissionRequestEvents: context.emitPermissionRequestEvents ?? false,
      detectPasswordPrompt: host.detectPasswordPrompt,
      logger: host.logger ?? console,
    },
  );
}

async function buildAgentConfig(
  body: NativeAgentRequest,
  userId: string,
  host: NativeAgentHost,
): Promise<AgentConfig> {
  const provider = body.provider || "claude";
  const useAnthropicCompatibleConfig = provider === "claude";

  const userAnthropicConfig = useAnthropicCompatibleConfig
    ? await host.getUserLlmProviderConfig?.({
        userId,
        providerType: "anthropic_compatible",
      })
    : undefined;

  const effectiveModelConfig = {
    ...body.modelConfig,
    ...userAnthropicConfig,
  };

  // User-saved Anthropic settings win over request defaults such as the
  // frontend's selectedModel fallback to claude-sonnet-4.6.
  return {
    provider,
    apiKey: useAnthropicCompatibleConfig
      ? effectiveModelConfig.apiKey
      : undefined,
    baseUrl: useAnthropicCompatibleConfig
      ? effectiveModelConfig.baseUrl
      : undefined,
    model: effectiveModelConfig.model,
    thinkingLevel: useAnthropicCompatibleConfig
      ? body.modelConfig?.thinkingLevel
      : undefined,
    workDir: body.workDir,
    providerConfig: body.providerConfig,
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
    useProvidedWorkDir: body.useProvidedWorkDir,
    taskId: body.taskId,
    sandbox: body.sandboxConfig,
    skillsConfig: body.skillsConfig,
    mcpConfig: body.mcpConfig,
    permissionMode: body.permissionMode,
    images: body.images,
    focusedInsightIds: body.focusedInsightIds,
    focusedInsights: normalizeFocusedInsightsForOptions(body.focusedInsights),
    allowedTools: body.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
    disallowedTools: body.disallowedTools,
    excludeTools: body.excludeTools,
    aiSoulPrompt: userSettings.aiSoulPrompt,
    language: userSettings.language,
    abortController: context.abortController,
    stream: true,
  };
}

function normalizeFocusedInsightsForOptions(
  focusedInsights: NativeAgentRequest["focusedInsights"],
): AgentOptions["focusedInsights"] {
  return focusedInsights?.map((insight) => ({
    ...insight,
    details: normalizeMaybeJsonArray(insight.details),
    timeline: normalizeTimelineForOptions(insight.timeline),
  }));
}

function normalizeTimelineForOptions(
  value: unknown[] | string | null | undefined,
): Array<{ title?: string; description?: string }> {
  return normalizeMaybeJsonArray(value).map((item) => {
    if (!item || typeof item !== "object") {
      return {};
    }
    const record = item as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
    };
  });
}

async function buildNativeAgentPrompt(
  body: NativeAgentRequest,
  session: NativeAgentSession,
  host: NativeAgentHost,
): Promise<string> {
  const contextParts: string[] = [];

  const permissionContext = buildPermissionPromptContext(body);
  if (permissionContext) {
    contextParts.push(permissionContext);
  }

  if (body.ragDocuments && body.ragDocuments.length > 0) {
    contextParts.push(buildRagDocumentPromptContext(body.ragDocuments));
  }

  if (body.focusedInsights && body.focusedInsights.length > 0) {
    contextParts.push(
      await buildFocusedInsightsPromptContext(body, session, host),
    );
  }

  let finalPrompt = contextParts.join("") + body.prompt;
  const savedFilesContext = await buildSavedFilesPromptContext(body, host);
  if (savedFilesContext) {
    finalPrompt = savedFilesContext + finalPrompt;
  }

  return finalPrompt;
}

function buildPermissionPromptContext(body: NativeAgentRequest): string {
  if (!body.disallowedTools || body.disallowedTools.length === 0) {
    return "";
  }

  // Non-interactive CLI runs hide protected tools instead of waiting forever
  // for a desktop permission dialog. Make that explicit so the model does not
  // claim it completed filesystem/shell actions it was not allowed to perform.
  return `[System Note: This run has the following tools disabled by permission policy: ${body.disallowedTools.join(", ")}. Do not claim that you completed an action requiring a disabled tool. If the user requests such an action, explain that it cannot be performed in the current permission mode and provide a safe command or next step instead.]\n\n`;
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

  return documentContext;
}

async function buildFocusedInsightsPromptContext(
  body: NativeAgentRequest,
  session: NativeAgentSession,
  host: NativeAgentHost,
): Promise<string> {
  const focusedInsights = body.focusedInsights ?? [];
  let insightsNotesDocumentsMap = new Map<
    string,
    NativeAgentFocusedInsightData
  >();

  if (session.user?.id && host.getFocusedInsightsWithNotesAndDocuments) {
    try {
      insightsNotesDocumentsMap =
        await host.getFocusedInsightsWithNotesAndDocuments({
          userId: session.user.id,
          insightIds: focusedInsights.map((insight) => insight.id),
        });
      host.logger?.log(
        "[NativeAgentRunner] Fetched notes and documents for focused insights:",
        {
          insightCount: focusedInsights.length,
          insightsWithData: Array.from(insightsNotesDocumentsMap.keys()).length,
        },
      );
    } catch (error) {
      host.logger?.error(
        "[NativeAgentRunner] Failed to fetch notes and documents for insights:",
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

      const details = normalizeMaybeJsonArray(insight.details);
      if (details.length > 0) {
        content += "   Details:\n";
        details.forEach((detail, detailIndex) => {
          const detailStr =
            typeof detail === "string" ? detail : JSON.stringify(detail);
          if (detailStr.length > 500) {
            content += `     [${detailIndex + 1}] ${detailStr.substring(0, 500)}... (content too long, truncated)\n`;
          } else {
            content += `     [${detailIndex + 1}] ${detailStr}\n`;
          }
        });
      }

      const timeline = normalizeMaybeJsonArray(insight.timeline);
      if (timeline.length > 0) {
        content += "   Recent Emails:\n";
        const seen = new Set<string>();
        timeline.forEach((rawEvent) => {
          const event =
            rawEvent && typeof rawEvent === "object"
              ? (rawEvent as { title?: string; description?: string })
              : {};
          const title = event.title ?? "";
          const description = event.description ?? "";
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

      if (insight.platform) {
        content += `   Platform: ${insight.platform}\n`;
      }

      const insightData = insightsNotesDocumentsMap.get(insight.id);
      if (insightData?.notes && insightData.notes.length > 0) {
        content += `   Notes (${insightData.notes.length}):\n`;
        insightData.notes.forEach((note, noteIndex) => {
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
        insightData.documents.forEach((doc, docIndex) => {
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

  host.logger?.log("[NativeAgentRunner] Injecting focused insights context:", {
    insightCount: focusedInsights.length,
    contextLength: insightContext.length,
  });

  return insightContext;
}

async function buildSavedFilesPromptContext(
  body: NativeAgentRequest,
  host: NativeAgentHost,
): Promise<string> {
  let savedFilesContext = "";

  if (body.fileAttachments && body.fileAttachments.length > 0 && body.workDir) {
    try {
      const savedFilePaths = await saveFileAttachmentsToWorkspace(
        body.fileAttachments,
        body.workDir,
        host,
      );

      if (savedFilePaths.length > 0) {
        savedFilesContext = `\n[System Note: The user has attached ${savedFilePaths.length} file(s) that have been saved to your workspace directory (${body.workDir}):\n${savedFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has attached ${savedFilePaths.length} file(s) that have been saved to the workspace directory (${body.workDir}):\n${savedFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nYou can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

        host.logger?.log(
          `[NativeAgentRunner] Saved ${savedFilePaths.length} file(s) to workspace:`,
          savedFilePaths,
        );
      }
    } catch (error) {
      host.logger?.error(
        "[NativeAgentRunner] Error saving file attachments:",
        error,
      );
    }
  }

  if (body.ragDocuments && body.ragDocuments.length > 0 && body.workDir) {
    try {
      const savedRAGFilePaths = await saveRAGDocumentsToWorkspace(
        body.ragDocuments,
        body.workDir,
        host,
      );

      if (savedRAGFilePaths.length > 0) {
        const ragContext = `\n[System Note: The user has uploaded ${savedRAGFilePaths.length} RAG document(s) from strategy memory that have been reconstructed and saved to your workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from the original documents. You can access these files using standard file operations like Read, Write, Edit, etc.\n\nSystem Note: User has extracted ${savedRAGFilePaths.length} RAG document(s) from strategy memory and reconstructed and saved them to the workspace directory (${body.workDir}):\n${savedRAGFilePaths.map((p) => `- ${path.basename(p)}`).join("\n")}\n\nNote: These are text-based reconstructions from original documents. You can access these files using Read, Write, Edit, and other tools.\n]\n\n`;

        savedFilesContext = ragContext + savedFilesContext;

        host.logger?.log(
          `[NativeAgentRunner] Saved ${savedRAGFilePaths.length} RAG document(s) to workspace:`,
          savedRAGFilePaths,
        );
      }
    } catch (error) {
      host.logger?.error(
        "[NativeAgentRunner] Error saving RAG documents:",
        error,
      );
    }
  }

  return savedFilesContext;
}

function normalizeMaybeJsonArray(value: unknown[] | string | null | undefined) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
  host: NativeAgentHost,
): Promise<string[]> {
  const savedFilePaths: string[] = [];
  const resolvedWorkDir = resolveHomeDir(workDir);
  const usedFileNames = new Set<string>();

  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    host.logger?.log(
      "[NativeAgentRunner] Created workspace directory:",
      resolvedWorkDir,
    );
  }

  for (const [index, attachment] of fileAttachments.entries()) {
    try {
      const base64Data = attachment.data.includes(",")
        ? attachment.data.split(",")[1]
        : attachment.data;

      const buffer = Buffer.from(base64Data, "base64");
      const safeFileName = makeUniqueFileName(
        sanitizeAttachmentFileName(attachment.name, index),
        usedFileNames,
      );
      const filePath = path.join(resolvedWorkDir, safeFileName);

      await fs.writeFile(filePath, buffer);
      savedFilePaths.push(filePath);

      host.logger?.log(
        `[NativeAgentRunner] Saved file attachment to workspace: ${attachment.name} -> ${filePath}`,
      );
    } catch (error) {
      host.logger?.error(
        `[NativeAgentRunner] Failed to save file attachment: ${attachment.name}`,
        error,
      );
    }
  }

  return savedFilePaths;
}

function sanitizeAttachmentFileName(fileName: string, index: number): string {
  const fallback = `attachment-${index + 1}`;
  const baseName = path
    .basename(fileName.replace(/\\/g, "/"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  const normalized = baseName.replace(/^\.+$/, "").trim();
  return normalized || fallback;
}

function makeUniqueFileName(fileName: string, usedFileNames: Set<string>) {
  if (!usedFileNames.has(fileName)) {
    usedFileNames.add(fileName);
    return fileName;
  }

  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let counter = 2;

  while (true) {
    const candidate = `${stem}-${counter}${extension}`;
    if (!usedFileNames.has(candidate)) {
      usedFileNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

async function saveRAGDocumentsToWorkspace(
  ragDocuments: Array<{ id: string; name: string }>,
  workDir: string,
  host: NativeAgentHost,
): Promise<string[]> {
  if (!host.getDocument || !host.getDocumentChunks || !host.readFile) {
    return [];
  }

  const savedFilePaths: string[] = [];
  const resolvedWorkDir = resolveHomeDir(workDir);

  if (!existsSync(resolvedWorkDir)) {
    await fs.mkdir(resolvedWorkDir, { recursive: true });
    host.logger?.log(
      "[NativeAgentRunner] Created workspace directory:",
      resolvedWorkDir,
    );
  }

  for (const ragDoc of ragDocuments) {
    try {
      const document = await host.getDocument(ragDoc.id);

      if (!document) {
        host.logger?.warn(
          `[NativeAgentRunner] RAG document not found: ${ragDoc.id}`,
        );
        continue;
      }

      const fileName = document.fileName;
      const filePath = path.join(resolvedWorkDir, fileName);

      if (document.blobPath) {
        const fileBuffer = await host.readFile(document.blobPath);
        await fs.writeFile(filePath, fileBuffer);
        savedFilePaths.push(filePath);
        host.logger?.log(
          `[NativeAgentRunner] Saved original RAG document to workspace: ${fileName} -> ${filePath} (${fileBuffer.length} bytes)`,
        );
      } else {
        const chunks = await host.getDocumentChunks(ragDoc.id);

        if (!chunks || chunks.length === 0) {
          host.logger?.warn(
            `[NativeAgentRunner] No chunks found for document: ${ragDoc.id}`,
          );
          continue;
        }

        const sortedChunks = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

        const fullText = sortedChunks
          .map((chunk) => chunk.content)
          .join("\n\n");

        const txtFileName = `${fileName}.txt`;
        const txtFilePath = path.join(resolvedWorkDir, txtFileName);
        await fs.writeFile(txtFilePath, fullText, "utf-8");
        savedFilePaths.push(txtFilePath);

        host.logger?.log(
          `[NativeAgentRunner] Saved RAG document (text reconstructed from chunks) to workspace: ${txtFileName} -> ${txtFilePath} (${chunks.length} chunks)`,
        );
      }
    } catch (error) {
      host.logger?.error(
        `[NativeAgentRunner] Failed to save RAG document: ${ragDoc.name} (${ragDoc.id})`,
        error,
      );
    }
  }

  return savedFilePaths;
}
