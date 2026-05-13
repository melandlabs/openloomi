/**
 * Job Executor
 * Executes custom scheduled jobs using the agent
 */

import type {
  ExecuteJobOptions,
  JobConfig,
  JobExecutionResult,
  JobExecutionContext,
} from "./types";
import { prepareConversationWindows } from "@/lib/ai";
import { preprocessCompactionMessages } from "@openloomi/ai/agent";
import { formatAgentStreamErrorForUser } from "@/lib/ai/runtime/format-error";
import {
  saveChat,
  saveMessages,
  getMessageById,
  updateMessageFileMetadata,
  saveChatInsights,
} from "@/lib/db/queries";
import { db } from "../db/index";
import {
  characters,
  insight,
  message as messageTable,
  jobExecutions,
  scheduledJobs,
} from "../db/schema";
import { desc, eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { generateUUID } from "@/lib/utils";
import { stripMalformedToolCalls } from "@/lib/utils/tool-names";
import {
  buildStructuredExecutionReport,
  parseStructuredOutput,
  type ExecutionTraceEvent,
  type ReasoningFile,
  type StructuredExecutionOutput,
} from "@/lib/types/execution-result";
import {
  reconcileExecutionArtifacts,
  type ArtifactToolPart,
} from "./artifact-reconciliation";
import { getAllFilesAtPathWithSize } from "@/lib/files/workspace/sessions";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_JOB_TIMEOUT_MS } from "../env/config/constants";
import { APP_DIR_NAME } from "../env/config/constants";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";

const MAX_JOB_HISTORY_TOKENS = 20_000;
const JOB_HISTORY_LIMIT = 100;
const SUBMIT_EXECUTION_REPORT_TOOL = "submitExecutionReport";

// Reason passed to AbortController.abort() to distinguish between user stop and client disconnect
export const REASON_USER_STOPPED = "user_stopped";
const REASON_CLIENT_DISCONNECT = "client_disconnect";

// Registry for custom job handlers
export const customJobHandlers: Record<
  string,
  (context: JobExecutionContext) => Promise<JobExecutionResult>
> = {};

/**
 * Register a custom job handler
 */
export function registerCustomHandler(
  name: string,
  handler: (context: JobExecutionContext) => Promise<JobExecutionResult>,
) {
  customJobHandlers[name] = handler;
}

function extractTextFromParts(parts: any): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p?.type === "text" && typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function normalizeRole(role: unknown): "user" | "assistant" {
  return role === "user" ? "user" : "assistant";
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildSchedulerWorkspaceOverride(
  messageText: string,
  sessionDir: string,
): string {
  return `[Scheduler Workspace Override]
The current working directory is already the execution output directory:
${sessionDir}

This instruction overrides any generic workspace instruction that asks you to recreate or hand-copy the full ~/.openloomi/sessions path.

File output rules for this scheduled execution:
- Do NOT run mkdir for ~/.openloomi/sessions/...; the runtime has already created the output directory.
- Do NOT manually reconstruct chatId/executionId paths.
- Save final deliverables directly in the current working directory using short paths such as "report.md", "output.html", or "analysis.xlsx".
- Save temporary scripts under "temp/" using short paths such as "temp/script.py".
- In scripts, use the current working directory as OUTPUT_DIR: os.getcwd() in Python, process.cwd() in Node.js.
- If a tool absolutely requires an absolute file path, use the current working directory exactly as provided above and append only the filename; do not alter any UUID/path segment.

User task:
${messageText}`;
}

function buildToolUseContent(part: Record<string, unknown>): string {
  const toolName =
    typeof part.toolName === "string" && part.toolName.trim().length > 0
      ? part.toolName
      : "UnknownTool";
  const toolInput = stringifyToolPayload(part.toolInput);

  return toolInput
    ? `[TOOL_USE] ${toolName}\n${toolInput}`
    : `[TOOL_USE] ${toolName}`;
}

function buildToolResultContent(part: Record<string, unknown>): string {
  const toolName =
    typeof part.toolName === "string" && part.toolName.trim().length > 0
      ? part.toolName
      : "UnknownTool";
  const status =
    typeof part.status === "string" && part.status.trim().length > 0
      ? part.status
      : "completed";
  const toolOutput = stringifyToolPayload(part.toolOutput);
  const errorLine = part.isError === true ? "\n[ERROR]" : "";

  return toolOutput
    ? `[TOOL_RESULT] ${toolName} (${status})${errorLine}\n${toolOutput}`
    : `[TOOL_RESULT] ${toolName} (${status})${errorLine}`;
}

type JobHistoryMessage = {
  id: string;
  sourceMessageId: string;
  role: "user" | "assistant";
  content: string;
  messageType: "message" | "tool_use" | "tool_result";
  timestamp?: number;
};

function isCompactionSummaryMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  return (metadata as Record<string, unknown>).type === "compaction_summary";
}

function extractCompactionMessagesFromParts(row: any): JobHistoryMessage[] {
  // Scheduler chats persist assistant output as mixed "parts", so we expand a
  // single DB row into message/tool_use/tool_result items before preprocessing.
  const parts = Array.isArray(row.parts) ? row.parts : [];
  const role = normalizeRole(row.role);
  const timestamp = row.createdAt
    ? new Date(row.createdAt).getTime()
    : undefined;
  const sourceMessageId = String(row.id);
  const messages: JobHistoryMessage[] = [];

  parts.forEach((part: any, index: number) => {
    if (part?.type === "text" && typeof part.text === "string") {
      const content = part.text.trim();
      if (!content) return;
      messages.push({
        id: `${sourceMessageId}:text:${index}`,
        sourceMessageId,
        role,
        content,
        messageType: "message",
        timestamp,
      });
    }
  });

  if (messages.length > 0) {
    return messages;
  }

  const fallbackContent = extractTextFromParts(row.parts);
  if (!fallbackContent) {
    return [];
  }

  return [
    {
      id: `${sourceMessageId}:fallback:0`,
      sourceMessageId,
      role,
      content: fallbackContent,
      messageType: "message",
      timestamp,
    },
  ];
}

function compareJobHistoryMessages(
  a: Pick<JobHistoryMessage, "timestamp" | "sourceMessageId" | "id">,
  b: Pick<JobHistoryMessage, "timestamp" | "sourceMessageId" | "id">,
): number {
  const timestampDiff = (a.timestamp ?? 0) - (b.timestamp ?? 0);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const sourceDiff = a.sourceMessageId.localeCompare(b.sourceMessageId);
  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  return a.id.localeCompare(b.id);
}

/**
 * Execute a job based on its configuration
 */
export async function executeJob(
  context: JobExecutionContext,
  jobConfigStr: string,
  jobDescription?: string,
  options?: ExecuteJobOptions,
): Promise<JobExecutionResult> {
  const startTime = Date.now();

  try {
    // Parse job configuration
    const jobConfig: JobConfig = JSON.parse(jobConfigStr);
    console.log("[JobExecutor] Executing job:", {
      jobId: context.jobId,
      type: jobConfig.type,
      config: jobConfig,
      description: jobDescription,
    });

    // Check for registered custom handlers first
    const handlerName = (jobConfig as any).handler;
    if (
      handlerName &&
      typeof handlerName === "string" &&
      customJobHandlers[handlerName]
    ) {
      console.log(`[JobExecutor] Using custom handler: ${handlerName}`);
      const result = await customJobHandlers[handlerName](context);
      result.duration = Date.now() - startTime;
      return result;
    }

    // Only custom type is supported
    const result = await executeCustomJob(
      context,
      jobConfig,
      jobDescription,
      options,
    );

    result.duration = Date.now() - startTime;
    return result;
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute a custom job
 * For custom jobs, we use the agent chat API to execute the task
 */
async function executeCustomJob(
  context: JobExecutionContext,
  config: Extract<JobConfig, { type: "custom" }>,
  jobDescription?: string,
  options?: ExecuteJobOptions,
): Promise<JobExecutionResult> {
  // Phase 1.1: Check Character status before executing
  let char: (typeof characters.$inferSelect & Record<string, unknown>) | null =
    null;
  let charSources: Array<{ type: string; name: string; id?: string }> = [];
  let charNotificationChannels: string[] = [];
  let charSystemNotification = true;
  if (context.characterId) {
    [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, context.characterId))
      .limit(1);

    // Parse sources (stored as JSON string in DB)
    if (char?.sources) {
      charSources =
        typeof char.sources === "string"
          ? JSON.parse(char.sources)
          : Array.isArray(char.sources)
            ? char.sources
            : [];
    }

    // Parse notification channels (stored as JSON string in DB)
    if (char?.notificationChannels) {
      charNotificationChannels =
        typeof char.notificationChannels === "string"
          ? JSON.parse(char.notificationChannels)
          : Array.isArray(char.notificationChannels)
            ? char.notificationChannels
            : [];
    }

    // Parse system notification toggle (default true for backward compatibility)
    if (
      char?.systemNotification !== undefined &&
      char?.systemNotification !== null
    ) {
      charSystemNotification =
        typeof char.systemNotification === "number"
          ? char.systemNotification === 1
          : char.systemNotification === true;
    }

    if (char && char.status !== "active") {
      console.log(
        `[JobExecutor] Character ${context.characterId} is "${char.status}", skipping execution`,
      );
      return {
        status: "success",
        output: "Skipped: character is paused",
        duration: 0,
      };
    }

    // Phase 1.3: Auto-create missing insight
    if (char) {
      const [existingInsight] = await db
        .select()
        .from(insight)
        .where(eq(insight.id, char.insightId))
        .limit(1);

      if (!existingInsight) {
        console.log(
          `[JobExecutor] Bound insight ${char.insightId} not found for character ${context.characterId}, recreating...`,
        );
        const now = new Date();
        await db.insert(insight).values({
          id: char.insightId,
          botId: char.jobId,
          taskLabel: "Character Execution",
          title: `Character Insight: ${char.name}`,
          description: "",
          importance: "medium",
          urgency: "medium",
          platform: "manual",
          time: now,
        });
      }
    }
  }

  // Build character context section for the system prompt
  const characterContextSection = char
    ? `

**CHARACTER CONTEXT:**
- characterName: ${char.name}
- insightId: ${char.insightId}
${charSources.length > 0 ? `- Monitored Sources:\n${charSources.map((s) => `  - [${s.type}] ${s.name}`).join("\n")}` : "- Monitored Sources: none"}
${charNotificationChannels.length > 0 ? `- Notification Channels:\n${charNotificationChannels.map((ch) => `  - ${ch}`).join("\n")}` : "- Notification Channels: none"}

**INSIGHT ATTACHMENT HANDLING (MANDATORY):**
After calling chatInsight with withDetail=true, if any insights have attachments:
1. You MUST download ALL attachments immediately using downloadInsightAttachment tool
2. Save them to the session workDir so they are available for the task
3. Do NOT proceed with the task until all attachments are downloaded

**OUTPUT RULES (STRICT — unless user specifies otherwise):**
- If the user explicitly specifies an output format, structure, or length in their request, follow their specification instead of the rules below
- Direct output only — no explanations, no process description, no "Here's what I found..."
- Output conclusions directly — give the key takeaway/conclusion without sentence count restrictions
- If nothing significant happened, say "No updates" (under 10 words)
- Prefer short bullet points (under 15 words each) over paragraphs
- Never start with "Sure", "Of course", "I'll", "Let me", "Here's", "The task..."
- Never explain what you did — only state the result
- **SOURCE ATTRIBUTION (CRITICAL):** When outputting information from insights, ALWAYS prefix with source attribution in brackets:
  - Format: [SourceType SourceName] content
  - Examples:
    - [Slack #team-engineering] Critical bug in production - Alex investigating
    - [Notion Q2 Goals Doc] Marketing spend approval pending review
    - [Direct Message Alex] Project Orion hiring sync scheduled for Mon 10 AM
    - [Gmail] Payment confirmation received from Stripe
    - [Calendar Company Webinar] Optional event on Thursday
  - SourceType options: Slack, Notion, Gmail, Calendar, Telegram, Discord, Direct Message, or the actual channel/doc name
  - If the insight has a specific group/channel (from insight.groups), use that name
  - If content came from a document/file, use the document name
  - If from a direct message, use [Direct Message PersonName]
  - **Do NOT omit source attribution** — every bullet point should have it

**BOUND INSIGHT UPDATE (ONLY IF THERE IS CONTENT):**
- ONLY call modifyInsight if there is actual content to record (e.g., new data, events, results)
- If the task completed without producing any new information to track, DO NOT call modifyInsight
- When calling modifyInsight, you MUST pass the updates object with the fields you want to change:
  - modifyInsight({ insightId: "${char.insightId}", updates: { timeline: [{ summary: "...", tags: [...], label: "..." }] } })
  - NEVER call modifyInsight without the updates parameter`
    : "";

  try {
    // Lazily import createClaudeAgent to avoid loading AI providers at module init
    const { createClaudeAgent } = await import("@/lib/ai/extensions");

    // Prepare the message from job description
    // The job description should contain the full message/task to execute
    const messageText: string = jobDescription || config.handler || "";

    // Use jobId as chatId - all executions of the same job share the same chat
    // This allows the agent to maintain context across executions
    const chatId = context.jobId;
    const sessionDir = join(
      homedir(),
      APP_DIR_NAME,
      "sessions",
      chatId,
      context.executionId,
    );
    const agentPrompt = buildSchedulerWorkspaceOverride(
      messageText,
      sessionDir,
    );

    // Build model config for agent
    // Use default proxy baseUrl instead of database-stored config.modelConfig.baseUrl
    const defaultBaseUrl = AI_PROXY_BASE_URL || process.env.LLM_BASE_URL;
    const rawModelConfig = context.modelConfig || config.modelConfig;
    const modelConfig = {
      ...rawModelConfig,
      baseUrl: defaultBaseUrl || rawModelConfig?.baseUrl,
      model:
        rawModelConfig?.model ||
        (config as any).modelConfig?.model ||
        process.env.LLM_MODEL ||
        DEFAULT_AI_MODEL,
    };

    const agent = createClaudeAgent({
      provider: "claude",
      ...modelConfig,
    });

    // Extract authToken for business-tools MCP server (used for embeddings API)
    const authToken = modelConfig?.apiKey;

    // Track insight IDs created/modified during this execution for chat association
    const createdInsightIds: string[] = [];
    const onInsightChange = (data: {
      action: "create" | "update" | "delete";
      insightId?: string;
      insight?: Record<string, unknown>;
    }) => {
      if (
        (data.action === "create" || data.action === "update") &&
        data.insightId &&
        !createdInsightIds.includes(data.insightId)
      ) {
        createdInsightIds.push(data.insightId);
      }
    };

    const sessionId = chatId; // Use jobId as sessionId
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Get user settings before building prompts so structured output follows
    // the same language as the user's configured assistant language.
    const { getUserInsightSettings } = await import("@/lib/db/queries");
    const userSettings = context.userId
      ? await getUserInsightSettings(context.userId)
      : null;
    const userLanguage = userSettings?.language ?? null;
    const useEnglishOutput =
      userLanguage?.toLowerCase().startsWith("en") ?? false;
    const structuredOutputLanguage = useEnglishOutput
      ? "English"
      : "Simplified Chinese";
    const traceTitles = useEnglishOutput
      ? {
          taskReceived: "Task received",
          executionError: "Execution error",
          executionFailed: "Execution failed",
          executionCompleted: "Execution completed",
        }
      : {
          taskReceived: "接收任务",
          executionError: "执行异常",
          executionFailed: "执行失败",
          executionCompleted: "执行完成",
        };

    // Determine platform for system notifications
    const osPlatform = platform();
    const isMacOS = osPlatform === "darwin";
    const isLinux = osPlatform === "linux";
    const isWindows = osPlatform === "win32";

    let platformNotificationSection = "";
    let platformNotificationWorkflow = "";
    let platformNotificationExamples = "";
    let platformNotificationName: string = osPlatform;

    if (charSystemNotification) {
      if (isMacOS) {
        platformNotificationName = "macOS";
        platformNotificationSection = `**macOS Notification (ALWAYS send if no platform specified):**
- dialog: (sleep 18 && osascript -e 'display dialog "Notification content" buttons {"OK"} default button 1 with title "openloomi Reminder"') &
- notification: (sleep 18 && osascript -e 'display notification "Notification content" with title "openloomi Reminder"') &`;
        platformNotificationWorkflow =
          "5. macOS notification - ALWAYS use the delayed notification pattern: (sleep 18 && osascript -e 'display notification ...' with title \"openloomi Reminder\") & AND also (sleep 18 && osascript -e 'display dialog ...' with title \"openloomi Reminder\") & - BOTH commands must be used with proper background delay execution (the & at the end makes it run in background)";
        platformNotificationExamples = `- Task: "Remind me to attend meeting at 9 AM every day" (no platform specified)
  - Platforms: ALL available platforms + macOS notification
  - Reminder: "Time for meeting!"

- Task: "Remind me to submit weekly report every Friday" (no platform specified)
  - Platforms: ALL available platforms + macOS notification
  - Reminder: "Time to submit weekly report!"`;
      } else if (isLinux) {
        platformNotificationName = "Linux";
        platformNotificationSection = `**Linux Notification (ALWAYS send if no platform specified):**
- Use the Bash tool to send system notification: (sleep 18 && notify-send "openloomi Reminder" "Notification content") &
- Alternative: (sleep 18 && zenity --info --text="Notification content" --title="openloomi Reminder") &`;
        platformNotificationWorkflow =
          '5. Linux notification - ALWAYS use the delayed notification pattern: (sleep 18 && notify-send "openloomi Reminder" "Notification content") & - must run in background with & at the end';
        platformNotificationExamples = `- Task: "Remind me to attend meeting at 9 AM every day" (no platform specified)
  - Platforms: ALL available platforms + Linux notification
  - Reminder: "Time for meeting!"

- Task: "Remind me to submit weekly report every Friday" (no platform specified)
  - Platforms: ALL available platforms + Linux notification
  - Reminder: "Time to submit weekly report!"`;
      } else if (isWindows) {
        platformNotificationName = "Windows";
        platformNotificationSection = `**Windows Notification (ALWAYS send if no platform specified):**
- Use PowerShell: Start-Process powershell -ArgumentList '-Command', 'Start-Sleep -Seconds 18; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\"Notification content\", \"openloomi Reminder\")'`;
        platformNotificationWorkflow =
          "5. Windows notification - ALWAYS use the delayed notification pattern: Start-Process powershell -ArgumentList '-Command', 'Start-Sleep -Seconds 18; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\"Notification content\", \"openloomi Reminder\")' - must run in background";
        platformNotificationExamples = `- Task: "Remind me to attend meeting at 9 AM every day" (no platform specified)
  - Platforms: ALL available platforms + Windows notification
  - Reminder: "Time for meeting!"

- Task: "Remind me to submit weekly report every Friday" (no platform specified)
  - Platforms: ALL available platforms + Windows notification
  - Reminder: "Time to submit weekly report!"`;
      } else {
        platformNotificationName = "your system";
        platformNotificationSection = `**System Notification:**
Current platform (${osPlatform}) system notification is not configured. Only send to connected platforms.`;
        platformNotificationWorkflow =
          "5. System notification - send to connected platforms only";
        platformNotificationExamples = `- Task: "Remind me to attend meeting at 9 AM every day" (no platform specified)
  - Platforms: ALL available platforms
  - Reminder: "Time for meeting!"`;
      }
    } // end charSystemNotification

    // Add system prompt as first assistant message to guide behavior
    messages.push({
      role: "assistant",
      content: `**SCHEDULED TASK EXECUTION**

You are executing a scheduled task on **${platformNotificationName} (${osPlatform})**.

**TASK DESCRIPTION:**
"${jobDescription}"

**YOUR JOB:**
Parse the task description and execute it. If it asks for a report or dashboard, write the output to a file.

**OUTPUT RULES (Conclusion First):**
- Start with the key conclusion/takeaway — NOT background, methodology, or "Here's what I found"
- If the task is "generate report" or "generate dashboard/kanban": write output to a file in session workDir
- For dashboards/kanbans: use frontend-design skill to create embedded HTML
- Then update the bound insight with modifyInsight

**REMINDER RULES (if sending notification):**
- Send the reminder to the USER (yourself), NOT others
- Keep reminder message SHORT and FRIENDLY (e.g., "Time to drink water!")
- DO NOT send the task description itself as the message

**INSIGHT/EVENT/TRACK UPDATE RULES (CRITICAL):**
When the task description mentions or is associated with a specific insight, event, or track:
- If the task says things like "update my [X] tracking", "add to [X]", "log to [X] insight", etc.
- The user has explicitly associated this scheduled task with an existing insight/event/track
- **ALWAYS use modifyInsight (with the correct insightId) to UPDATE the existing insight/event/track**
- **DO NOT create a new insight using createInsight**
- The insightId may be provided in the task description, or you should query the user's insights to find the matching one
- When adding timeline updates, be specific in the summary — describe exactly what happened, what data changed, what trends emerged
- Add **tags** for categorization and **action** for next steps (e.g., "Review competitor update", "Schedule follow-up", "Share with team")

**PLATFORM SELECTION:**
1. First, use queryIntegrations to check which platforms the user has connected
2. If the task specifies a platform (e.g., "Remind me on Telegram"), only use that platform
3. If no platform is specified, ONLY send to the user's configured Notification Channels (from CHARACTER CONTEXT):
   - Send to each channel listed in Notification Channels using sendReply
   - Do NOT send to platforms not in Notification Channels
${charSystemNotification ? `   - System notification (${platformNotificationName}) is still sent if configured` : "   - Do NOT send system/desktop notifications"}

**EXECUTION WORKFLOW:**
1. queryIntegrations - Verify the configured Notification Channels are available
2. Determine target platforms based on task description:
   - If platform specified (e.g., "Telegram reminder") -> use that platform only (must be in Notification Channels)
   - If no platform specified -> use ONLY the Notification Channels configured for this character
3. Determine recipient for each platform:
   - **For Telegram: Use "me" directly as the contact identifier** - "me" refers to your own Telegram account and will always work without needing to look up contacts
   - For other platforms: Find the user's own contact via queryContacts (the recipient is the user themselves)
4. sendReply - Send the reminder message to the user via each configured Notification Channel
5. If the task description references an existing insight/event/track -> use modifyInsight to update it
${platformNotificationWorkflow}

${platformNotificationSection}

**EXAMPLES:**
- Task: "Remind me to drink water at 8 PM every day on Telegram"
  - Platforms: Telegram only (specified)
  - Contact: Use "me" as the contact identifier
  - Reminder: "Time to drink water!"

- Task: "Every day at 9 PM, update my 'Gym Progress' tracking with today's workout"
  - The user has associated this task with the "Gym Progress" insight
  - Action: Use modifyInsight to add a timeline event to the existing "Gym Progress" insight
  - DO NOT create a new insight

- Task: "Log my daily reading to 'Book Tracker' every evening"
  - The user has associated this task with the "Book Tracker" insight
  - Action: Use modifyInsight to add a timeline event to the existing "Book Tracker" insight

${platformNotificationExamples}

**IMPORTANT:**
- Recipient is always the USER (yourself), not other people
- Send a short, actionable reminder message, NOT the task description
- If the task is associated with a specific insight/event/track, ALWAYS update the existing one - never create a new insight
- After sending the reminder and completing all actions, respond with a concise conclusion summarizing the result. Focus on the key outcome rather than step-by-step details. If the output is too long or complex, save it to a file and just respond with the file path instead.
${characterContextSection}`,
    });

    console.log(
      "[JobExecutor] Starting native agent execution with sessionId:",
      chatId,
    );

    let lastTextContent = ""; // Track only the last text for output
    let submittedStructuredData: StructuredExecutionOutput | undefined;
    const internalToolUseIds = new Set<string>();
    let hasError = false;
    let errorMessage = "";
    const executionToolParts: ArtifactToolPart[] = [];
    const executionToolPartsById = new Map<string, ArtifactToolPart>();
    const traceEvents: ExecutionTraceEvent[] = [
      {
        type: "task_received",
        title: traceTitles.taskReceived,
        detail: jobDescription || config.handler || context.jobId,
        timestamp: new Date().toISOString(),
      },
    ];

    try {
      // Get job name for chat title
      const { getJob } = await import("@/lib/cron/service");
      const job = await getJob(context.userId, context.jobId);

      // Pull the newest rows first to keep the history query bounded, then
      // restore chronological order before windowing/compaction.
      const historyRowsDescRaw = await db
        .select()
        .from(messageTable)
        .where(eq(messageTable.chatId, chatId))
        .orderBy(desc(messageTable.createdAt))
        .limit(JOB_HISTORY_LIMIT);

      const historyRows = [...historyRowsDescRaw]
        .map((row: any) => {
          let parts = row.parts;
          if (typeof parts === "string") {
            try {
              parts = JSON.parse(parts);
            } catch {
              parts = [];
            }
          }

          let metadata = row.metadata;
          if (typeof metadata === "string") {
            try {
              metadata = JSON.parse(metadata);
            } catch {
              metadata = null;
            }
          }

          return {
            ...row,
            parts,
            metadata,
          };
        })
        .reverse();
      const compactionSummarySourceMessageIds = new Set(
        historyRows
          .filter((row: any) => isCompactionSummaryMetadata(row.metadata))
          .map((row: any) => String(row.id)),
      );
      const historyConversation: JobHistoryMessage[] = historyRows.flatMap(
        (row: any) => extractCompactionMessagesFromParts(row),
      );

      const preparedHistory = prepareConversationWindows(historyConversation, {
        maxTokens: MAX_JOB_HISTORY_TOKENS,
      });

      const compactionCandidates =
        preparedHistory.candidatesForCompaction as Array<
          JobHistoryMessage & {
            tokens: number;
            bucket: string;
            ageMs: number;
          }
        >;
      const immediateHistory = preparedHistory.immediate as Array<
        JobHistoryMessage & {
          tokens: number;
          bucket: string;
          ageMs: number;
        }
      >;

      // Existing compaction summaries should stay visible to the agent but must
      // never be fed back into a second compaction pass.
      const protectedFromCompaction = compactionCandidates.filter((message) =>
        compactionSummarySourceMessageIds.has(message.sourceMessageId),
      );
      const compactionCandidatePool = compactionCandidates.filter(
        (message) =>
          !compactionSummarySourceMessageIds.has(message.sourceMessageId),
      );

      const immediateSourceIds = new Set(
        immediateHistory.map((message) => message.sourceMessageId),
      );
      // A single stored DB message can expand into multiple synthetic history
      // items, so keep partially-overlapping rows on the immediate side to
      // avoid deleting only half of a persisted message.
      const overlappingSourceMessageIds = new Set(
        compactionCandidatePool
          .filter((message) => immediateSourceIds.has(message.sourceMessageId))
          .map((message) => message.sourceMessageId),
      );
      const safeCompactionCandidates = compactionCandidatePool.filter(
        (message) => !overlappingSourceMessageIds.has(message.sourceMessageId),
      );
      const safeImmediateHistory = [
        ...immediateHistory,
        ...protectedFromCompaction,
        ...compactionCandidatePool.filter((message) =>
          overlappingSourceMessageIds.has(message.sourceMessageId),
        ),
      ].sort(compareJobHistoryMessages);

      const preprocessedHistory = preprocessCompactionMessages(
        safeImmediateHistory.map(({ role, content, messageType }) => ({
          role,
          type: messageType,
          content,
        })),
      );

      // Historical messages are excluded from the runtime conversation to avoid
      // context overflow
      const runtimeConversation: Array<{
        role: "user" | "assistant";
        content: string;
      }> = [...messages];

      // Save chat to database
      try {
        await saveChat({
          id: chatId,
          userId: context.userId,
          title: `Scheduled Job: ${job?.name || context.jobId.slice(0, 8)}`,
        });
      } catch (error) {
        // Ignore UNIQUE constraint error - chat may already exist
        if (
          (error as Error).message &&
          !(error as Error).message.includes("UNIQUE")
        ) {
          console.error("[JobExecutor] Failed to save chat:", error);
        }
      }

      // Save user message
      const userMessageId = options?.userMessageId ?? generateUUID();
      await saveMessages({
        messages: [
          {
            chatId,
            id: userMessageId,
            role: "user",
            parts: [{ type: "text", text: messageText }],
            attachments: [],
            createdAt: new Date(),
            metadata: undefined,
          },
        ],
      });

      // Run the agent with timeout
      // Use bypassPermissions mode - same as normal execution
      // Use stream: false for non-streaming mode (reference handleAgentRuntime in shared.ts)
      mkdirSync(sessionDir, { recursive: true });
      mkdirSync(join(sessionDir, "temp"), { recursive: true });
      const generator = agent.run(agentPrompt, {
        sessionId,
        cwd: sessionDir,
        taskId: `${chatId}/${context.executionId}`, // Each execution uses an independent sub-directory to prevent file overwrite
        conversation: runtimeConversation,
        permissionMode: "bypassPermissions", // Full permissions for scheduled tasks
        stream: false, // Non-stream mode, simpler message handling
        excludeTools: ["createScheduledJob"], // Exclude createScheduledJob to prevent recursive job creation
        session: {
          user: { id: context.userId, type: "pro" },
          expires: new Date(Date.now() + 3600000), // 1 hour
        } as any,
        authToken, // Pass auth token for business-tools MCP server (embeddings API)
        onInsightChange, // Track created insights for chat association
        skillsConfig: {
          enabled: true,
          userDirEnabled: true,
          appDirEnabled: false,
        },
        aiSoulPrompt: jobDescription
          ? `${jobDescription}\n\n${userSettings?.aiSoulPrompt ?? ""}`
          : (userSettings?.aiSoulPrompt ?? null),
        language: userSettings?.language ?? null,
        timezone: context.timezone ?? null,
        executionReport: {
          enabled: true,
          onSubmit: (report) => {
            submittedStructuredData = report as StructuredExecutionOutput;
          },
        },
        abortController: options?.abortController,
      });

      // Track messages for real-time saving and final output
      const assistantMessages: Array<{ id: string; content: string }> = [];
      const timeout = DEFAULT_JOB_TIMEOUT_MS;
      const startTime = Date.now();
      let toolCallCount = 0;
      const maxToolCalls = 200; // Prevent infinite loops

      // Current assistant message being built - like chat-context.tsx
      // All tool calls and text are accumulated in parts array of a single message
      let currentMessageId = options?.assistantMessageId ?? generateUUID();
      let currentParts: Array<any> = [];
      let hasSavedCurrentMessage = false;

      // Save the current assistant message with all accumulated parts
      const saveCurrentAssistantMessage = async () => {
        if (currentParts.length > 0) {
          await saveMessages({
            messages: [
              {
                chatId,
                id: currentMessageId,
                role: "assistant",
                parts: currentParts,
                attachments: [],
                createdAt: new Date(),
                metadata: undefined,
              },
            ],
          });
          // Extract text content for output (only once)
          if (!hasSavedCurrentMessage) {
            const textPart = currentParts.find((p) => p.type === "text");
            if (textPart) {
              assistantMessages.push({
                id: currentMessageId,
                content: textPart.text,
              });
            }
            hasSavedCurrentMessage = true;
          }
        }
      };

      // Reset for next assistant message
      const resetCurrentMessage = () => {
        currentMessageId = generateUUID();
        currentParts = [];
        hasSavedCurrentMessage = false;
      };

      for await (const message of generator) {
        // Check if execution was aborted
        if (options?.abortController?.signal?.aborted) {
          const reason = options.abortController.signal.reason as string;
          // If abort reason is "client_disconnect" (page refresh/close), don't treat as error
          if (reason === REASON_CLIENT_DISCONNECT) {
            break;
          }
          hasError = true;
          errorMessage =
            reason === REASON_USER_STOPPED
              ? "Execution stopped by user"
              : "Execution aborted by user";
          break;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          console.error("[JobExecutor] Agent execution timeout");
          hasError = true;
          errorMessage = "Agent execution timeout (1200 minutes)";
          break;
        }

        if (
          message.type === "tool_result" &&
          message.toolUseId &&
          internalToolUseIds.has(message.toolUseId)
        ) {
          continue;
        }

        // Check tool call count
        if (message.type === "tool_use") {
          toolCallCount++;
          await options?.onAgentEvent?.({
            type: "tool_use",
            id: message.id || generateUUID(),
            name: message.name || "",
            input: message.input,
            messageId: currentMessageId,
          });
          if (toolCallCount > maxToolCalls) {
            console.error("[JobExecutor] Too many tool calls:", toolCallCount);
            hasError = true;
            errorMessage = `Too many tool calls (${maxToolCalls})`;
            break;
          }
        }

        if (message.type === "text") {
          // With stream: false, text messages are complete (not incremental deltas)
          // Use the complete text directly without accumulation
          const textContent = message.content || "";
          const { cleanText: displayText } = parseStructuredOutput(textContent);
          const sanitizedText = stripMalformedToolCalls(displayText);

          lastTextContent = textContent;
          if (sanitizedText) {
            await options?.onAgentEvent?.({
              type: "text",
              content: sanitizedText,
              messageId: currentMessageId,
            });
          }

          // Save complete text message
          if (sanitizedText) {
            currentParts.push({ type: "text", text: sanitizedText });
          }
          await saveCurrentAssistantMessage();
          resetCurrentMessage();
        } else if (message.type === "tool_use") {
          // Don't save here - let tool calls accumulate in the same message
          // Only save when we have text content that user needs to see

          // Skip if no message id
          if (!message.id) {
            console.log("[JobExecutor] Skipping tool_use - no message id");
          } else {
            // Add tool call to current parts (same message)
            const toolPart = {
              type: "tool-native",
              toolName: message.name || "",
              toolUseId: message.id,
              toolInput: message.input,
              status: "executing",
            };
            currentParts.push(toolPart);
            executionToolParts.push(toolPart);
            executionToolPartsById.set(message.id, toolPart);

            // Save immediately
            await saveCurrentAssistantMessage();
          }

          // Don't reset here - let multiple tool calls accumulate in same message
          // Only reset when starting a new assistant message (on text or explicit reset)
        } else if (message.type === "tool_result") {
          // Update the corresponding tool call part with result
          // This updates the in-memory currentParts, then saves

          // Skip if no tool use id
          if (!message.toolUseId) {
            console.log("[JobExecutor] Skipping tool_result - no tool use id");
          } else {
            await options?.onAgentEvent?.({
              type: "tool_result",
              toolUseId: message.toolUseId,
              output: message.output,
              isError: message.isError,
              messageId: currentMessageId,
            });
            const trackedToolPart = executionToolPartsById.get(
              message.toolUseId,
            );
            if (trackedToolPart) {
              trackedToolPart.toolOutput = message.output;
              trackedToolPart.isError = message.isError;
            }
            // Find and update the tool-native part in currentParts
            let found = false;
            currentParts = currentParts.map((part) => {
              if (
                part.type === "tool-native" &&
                part.toolUseId === message.toolUseId
              ) {
                found = true;
                return {
                  ...part,
                  status: message.isError ? "error" : "completed",
                  toolOutput: message.output,
                  isError: message.isError,
                };
              }
              return part;
            });

            if (found) {
              // Save the updated message
              await saveCurrentAssistantMessage();
            } else {
              // Tool result came for a tool that was saved in a previous message
              // Need to update the previous message in DB
              console.log(
                "[JobExecutor] Tool result for previous message, updating DB:",
                {
                  toolUseId: message.toolUseId,
                  currentMessageId,
                },
              );

              try {
                // Use currentMessageId to query the message, not toolUseId
                const existingMessages = await getMessageById({
                  id: currentMessageId,
                });
                const existingMessage = existingMessages?.[0];

                if (
                  existingMessage?.parts &&
                  Array.isArray(existingMessage.parts)
                ) {
                  const updatedParts = existingMessage.parts.map(
                    (part: any) => {
                      if (
                        part.type === "tool-native" &&
                        part.toolUseId === message.toolUseId
                      ) {
                        return {
                          ...part,
                          status: message.isError ? "error" : "completed",
                          toolOutput: message.output,
                          isError: message.isError,
                        };
                      }
                      return part;
                    },
                  );

                  await updateMessageFileMetadata({
                    messageId: currentMessageId,
                    attachments: existingMessage.attachments || [],
                    parts: updatedParts,
                  });
                }
              } catch (error) {
                console.error(
                  "[JobExecutor] Failed to update tool result in DB:",
                  error,
                );
              }
            }
          }
        } else if (message.type === "error") {
          // Convert raw error code to user-friendly message
          const rawError = message.message || "Unknown error";
          const userFriendlyError = formatAgentStreamErrorForUser(
            "scheduler",
            rawError,
          );

          // Add error to current parts
          currentParts.push({
            type: "text",
            text: `**Error:** ${userFriendlyError}`,
          });

          hasError = true;
          errorMessage = userFriendlyError;
          console.error("[JobExecutor] Native agent error:", rawError);

          // Save error message
          await saveCurrentAssistantMessage();

          // Reset for next message
          resetCurrentMessage();
        } else if (message.type === "done") {
          // Save any remaining parts before done
          await saveCurrentAssistantMessage();
        }
      }

      // If we exited the loop due to abort, ensure hasError is set
      // This handles the case where the generator ended without throwing an error
      if (!hasError && options?.abortController?.signal?.aborted) {
        const reason = options.abortController.signal.reason as string;
        // If abort reason is "client_disconnect" (page refresh/close), don't treat as error
        if (reason !== REASON_CLIENT_DISCONNECT) {
          hasError = true;
          errorMessage =
            reason === REASON_USER_STOPPED
              ? "Execution stopped by user"
              : "Execution aborted by user";
        }
      }

      // Save any remaining message
      await saveCurrentAssistantMessage();

      // Associate created insights with the job's chat
      if (createdInsightIds.length > 0) {
        try {
          await saveChatInsights({
            chatId,
            insightIds: createdInsightIds,
          });
          console.log(
            `[JobExecutor] Associated ${createdInsightIds.length} insight(s) with chat ${chatId}: ${createdInsightIds.join(", ")}`,
          );
        } catch (error) {
          console.error("[JobExecutor] Failed to save chat insights:", error);
        }
      }
    } catch (error) {
      // Check if this is an abort error with client_disconnect reason
      const isAbortError =
        error instanceof Error && error.name === "AbortError";
      const abortReason = isAbortError
        ? ((error as unknown as { reason?: string }).reason ??
          options?.abortController?.signal.reason)
        : null;

      // If abort reason is "client_disconnect" (page refresh/close), return early without error
      if (isAbortError && abortReason === REASON_CLIENT_DISCONNECT) {
        console.log("[JobExecutor] Execution aborted due to client disconnect");
        // Return minimal success result - client disconnected, no meaningful output
        return {
          status: "success" as const,
          duration: 0,
        };
      }

      console.error("[JobExecutor] Native agent execution failed:", error);
      hasError = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // --- Extract structured output from agent response ---
    const { data: parsedStructuredData, cleanText } =
      parseStructuredOutput(lastTextContent);
    const artifactReconciliation = reconcileExecutionArtifacts({
      sessionDir,
      sessionsRoot: join(homedir(), APP_DIR_NAME, "sessions"),
      executionId: context.executionId,
      toolParts: executionToolParts,
      finalText: lastTextContent,
      structuredData: submittedStructuredData ?? parsedStructuredData,
    });
    const structuredData = artifactReconciliation.structuredData;

    const sessionFiles: ReasoningFile[] = [];
    try {
      const result = await getAllFilesAtPathWithSize(chatId, sessionDir);
      for (const file of result.files) {
        if (file.isDirectory) continue;
        sessionFiles.push({
          name: file.name,
          path: file.absolutePath ?? file.path,
          type: file.type,
          role: "output",
        });
      }
    } catch (error) {
      console.warn("[JobExecutor] Failed to scan execution files:", error);
    }

    const structuredReport = buildStructuredExecutionReport({
      structuredData,
      cleanText,
      rawText: lastTextContent,
      taskText: messageText,
      traceEvents,
      sessionFiles,
      hasError,
      errorMessage,
      language: userLanguage,
    });

    if (structuredReport.diagnostics?.source === "model") {
      console.log(
        "[JobExecutor] Parsed structured output from agent response:",
        JSON.stringify(structuredReport).slice(0, 200),
      );
    } else {
      console.log(
        "[JobExecutor] Repaired structured execution report:",
        JSON.stringify(structuredReport).slice(0, 200),
      );
    }

    const jobResult: JobExecutionResult = {
      status: (hasError ? "error" : "success") as "error" | "success",
      // Use cleanText (structured-output block stripped) for display
      output: stripMalformedToolCalls(cleanText) || "Task completed",
      error: hasError ? errorMessage : undefined,
      result: {
        chatId,
        message: messageText,
        executionId: context.executionId,
        sessionDir,
      },
      duration: 0,
    };

    // Directly update execution record and job status in DB before returning.
    // This ensures the status is correct even if the caller's .then() callback
    // is interrupted (e.g. by process exit, hot reload, or navigation).
    // The caller's completeJobExecution() will re-write these rows as a no-op.
    try {
      await db
        .update(jobExecutions)
        .set({
          status: jobResult.status,
          completedAt: new Date(),
          durationMs: jobResult.duration,
          output: jobResult.output,
          error: jobResult.error,
          result: jobResult.result ? JSON.stringify(jobResult.result) : null,
        })
        .where(eq(jobExecutions.id, context.executionId));

      // Update scheduled_jobs.lastStatus so that getDueJobs correctly
      // excludes/completes this job.
      await db
        .update(scheduledJobs)
        .set({
          lastStatus: jobResult.status,
          lastRunAt: new Date(),
          lastError: jobResult.error ?? null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledJobs.id, context.jobId));
    } catch (e) {
      console.error(
        "[JobExecutor] Failed to update execution/job status in DB (caller's completeJobExecution will retry):",
        e,
      );
    }

    return jobResult;
  } catch (error) {
    console.error("[JobExecutor] Custom job error:", error);
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      duration: 0,
    };
  }
}
