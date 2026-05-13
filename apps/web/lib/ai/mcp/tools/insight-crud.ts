/**
 * Insight CRUD tools - createInsight, modifyInsight, deleteInsight
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import {
  getBotsByUserId,
  getInsightByIdForUser,
  updateInsightById,
  insertInsightRecords,
  createBot as createBotRecord,
  deleteInsightsByIds,
  saveChatInsights,
} from "@/lib/db/queries";
import type { GeneratedInsightPayload } from "@/lib/insights/types";
import { AppError } from "@openloomi/shared/errors";
import {
  normalizeTask,
  normalizeImportance,
  normalizeUrgency,
  associateDocumentsToInsight,
  removeDocumentAssociations,
  type InsightChangeCallback,
} from "./shared";

/**
 * Create the insight CRUD tools
 */
export function createInsightCrudTools(
  session: Session,
  chatId: string | undefined,
  onInsightChange?: InsightChangeCallback,
) {
  return [
    // createInsight tool
    tool(
      "createInsight",
      [
        "Create a new insight from the user's description.",
        "",
        "⚠️ CRITICAL: YOU MUST INCLUDE COMPLETE CHAT CONTEXT ⚠️",
        "- When creating an insight, you MUST extract ALL relevant messages from the current conversation",
        "- Include the user's original request, your responses, and ALL follow-up discussion",
        "- Use the 'details' field to preserve the COMPLETE conversation history",
        "- DO NOT create insights without details - more context is better than too little",
        "",
        "⭐ TRACKING RESPONSIBILITY ⭐",
        "- When there is a focused/active insight in the conversation, YOU are responsible for tracking operations",
        "- In the SAME chat, whenever related operations occur (e.g., GitHub issue created, file created, task completed),",
        "  you MUST call modifyInsight to append these details to the insight",
        "- When myTasks exist in the insight, you must auto-update task status when operations complete",
        "",
        "Use this when the user says things like:",
        '- "Tomorrow I need to..."',
        '- "Remind me to..."',
        '- "I want to track this..."',
        '- "Create an insight for..."',
        "",
        "⚠️ DO NOT use createInsight to update an existing tracking!",
        "If the user wants to update/add progress to an existing insight (e.g., 'update the progress', 'add an update'),",
        "you MUST use modifyInsight instead with the existing insightId and append to the timeline field.",
        "createInsight is ONLY for creating brand NEW insights.",
        "",
        "⭐ CRITICAL: DESCRIPTION vs DETAILS ⭐",
        "Keep them SEPARATE and PURPOSEFUL:",
        "",
        "1. DESCRIPTION (summary):",
        "   - Keep it SHORT: 1-2 sentences, 20-60 words",
        "   - Focus on WHAT and WHY, not the background",
        "   - Use natural, conversational language",
        "   - Example: 'Need to create scenario-based demos to improve sales credibility with SMB customers'",
        "",
        "2. DETAILS (rich context):",
        "   - Put ALL the rich context here: user input, conversation history, memory search results",
        "   - Each detail can have: content (main text), person (who said it), context (additional info)",
        "   - Use this to preserve the full conversation flow and reasoning",
        "   - Example detail: {content: 'User mentioned: \"We need to show how the product works in real scenarios\"'}",
        "",
        "3. WHEN TO USE DETAILS: ⚠️ ALWAYS REQUIRED ⚠️",
        "   - MUST include ALL relevant chat context and conversation history",
        "   - ALWAYS add details when user provides context, questions, or thought process",
        "   - Capture the COMPLETE conversation that led to this insight",
        "   - Include ALL relevant information from memory/knowledge base searches",
        "   - NEVER omit details - more context is always better than too little",
        "   - Format: [{content: '...', context: '...', person: '...', time: ...}]",
        "   - CRITICAL: Extract ALL messages from current conversation that are related to this insight",
        "   - Include user's original input, your responses, and any follow-up discussion",
        "",
        "4. EXAMPLE WITH COMPLETE CHAT CONTEXT:",
        "   User: 'I need to give a demo to the client tomorrow'",
        "   Assistant: 'Sure, what is the demo about? What needs to be prepared?'",
        "   User: 'A demo of openloomi's features, need to show scenario-based features'",
        "   Assistant: 'Got it, I'll create a todo item to track this'",
        "   ",
        "   CORRECT createInsight call:",
        "   - title: 'Prepare client product demo'",
        "   - description: 'Need to prepare openloomi scenario-based feature demo for client'",
        "   - details: [",
        "     {content: 'I need to give a demo to the client tomorrow', person: 'User'},",
        "     {content: 'Sure, what is the demo about? What needs to be prepared?', person: 'Assistant'},",
        "     {content: 'A demo of openloomi features, need to show scenario-based features', person: 'User'},",
        "     {content: 'Got it, I will create a todo item to track this', person: 'Assistant'}",
        "   ]",
        "",
        "   WRONG (missing context):",
        "   - details: [] OR details not provided",
        "",
        "Required fields:",
        "- title: A concise title for the insight",
        "- description: SHORT summary (1-2 sentences, 20-60 words), NOT a detailed explanation",
        "",
        "Optional fields (extract from user input):",
        "- importance: Choose ONE value - 'Important' or 'General' or 'Not Important'",
        "- urgency: Choose ONE value - 'As soon as possible' or 'Within 24 hours' or 'Not urgent'",
        "- myTasks: Array of TASK OBJECTS (not strings!) - each task must have 'text' field, 'completed' defaults to false",
        "- timeline: Array of timeline events with time, summary, and label (⚠️ REQUIRED - Must include at least one timeline event to track the progression of this insight!)",
        "- details: Array of detailed messages with content, person, platform, channel (⚠️ REQUIRED - Must include ALL relevant chat messages from current conversation with AI!)",
        "- groups: Array of group/category tags for organizing insights (include all tags at once)",
        "- people: Array of people names mentioned in the insight (include all people at once)",
        "- attachments: Array of document IDs to attach to this insight. Documents must be uploaded first via file upload (document IDs are from rag_documents table)",
        "- ⚠️ CRITICAL: When attaching multiple documents, include ALL document IDs in the array at once. Example: {attachments: ['doc-id-1', 'doc-id-2', 'doc-id-3']}",
        "- time: Unix timestamp in milliseconds as a NUMBER (e.g., 1705287600123)",
        "- platform: Platform this insight is related to (e.g., 'manual', 'chat')",
      ].join("\n"),
      {
        title: z.string().describe("Concise title for the insight"),
        description: z
          .string()
          .describe(
            "SHORT summary (1-2 sentences, 20-60 words), not detailed explanation",
          ),
        importance: z
          .string()
          .optional()
          .describe(
            "Importance level: 'Important', 'General', or 'Not Important'",
          ),
        urgency: z
          .string()
          .optional()
          .describe(
            "Urgency level: 'As soon as possible', 'Within 24 hours', 'Not urgent', or 'General'",
          ),
        myTasks: z
          .array(
            z.union([
              z.object({
                text: z.string().describe("Task description"),
                completed: z
                  .boolean()
                  .default(false)
                  .describe("Whether the task is completed (default: false)"),
                deadline: z
                  .string()
                  .optional()
                  .describe("Task deadline (e.g., '2025-01-15', 'tomorrow')"),
                owner: z
                  .string()
                  .optional()
                  .describe("Person responsible for this task"),
              }),
              z.string(),
            ]),
          )
          .optional()
          .describe(
            "Array of tasks. Can be objects [{text: 'task', completed: false}] or strings ['task1', 'task2'] or JSON strings.",
          ),
        timeline: z
          .array(
            z.object({
              time: z
                .number()
                .optional()
                .describe(
                  "Numeric Unix timestamp in milliseconds (e.g., 1705287600123), NOT an object like {format: 'timestamp'}",
                ),
              summary: z
                .string()
                .optional()
                .describe("Brief summary of the timeline event"),
              label: z
                .string()
                .optional()
                .describe("Event type or category label"),
              emoji: z.string().optional().describe("Emoji icon for the event"),
              id: z
                .string()
                .optional()
                .describe(
                  "Unique identifier for this timeline event (for tracking history)",
                ),
              version: z
                .number()
                .optional()
                .describe(
                  "Current version number of this event (starts at 1, increments on updates)",
                ),
              lastUpdatedAt: z
                .number()
                .optional()
                .describe("Timestamp when this event was last updated"),
              changeCount: z
                .number()
                .optional()
                .describe("Total number of times this event has been changed"),
              urgency: z
                .string()
                .optional()
                .describe(
                  "Urgency level: immediate/24h/not_urgent (for matching AI prompt output)",
                ),
              tags: z
                .array(z.string())
                .optional()
                .describe("Keywords/tags for categorizing the event"),
              action: z
                .string()
                .optional()
                .describe(
                  "Recommended action for the user based on this timeline event (e.g., 'Review the competitor update', 'Schedule a follow-up')",
                ),
            }),
          )
          .optional()
          .describe(
            "Array of timeline events showing progression or key moments",
          ),
        details: z
          .array(
            z.object({
              time: z
                .number()
                .optional()
                .nullable()
                .describe(
                  "Numeric Unix timestamp in milliseconds (e.g., 1705287600123), NOT an object like {format: 'timestamp'}",
                ),
              person: z.string().optional().describe("Sender's user name"),
              platform: z
                .string()
                .optional()
                .nullable()
                .describe(
                  'Name of the platform (e.g., "telegram", "slack", etc...)',
                ),
              channel: z.string().optional().describe("Channel identifier"),
              content: z.string().optional().describe("Content of the message"),
            }),
          )
          .optional()
          .describe(
            "⚠️ REQUIRED: Array of detailed messages from current conversation with AI. Include ALL relevant chat messages - user input, AI responses, and follow-up discussion. Format: [{content: 'message text', person: 'User'/'Assistant', time: timestamp}]. NEVER omit this field - context is critical!",
          ),
        groups: z
          .array(z.string())
          .optional()
          .describe(
            "Group or category tags for organizing insights (e.g., ['work'] or ['project-x']). Do NOT create multiple groups here.",
          ),
        categories: z
          .array(z.string())
          .optional()
          .describe(
            "Categories for the insight (e.g., ['sales', 'feedback', 'bug']). Use this to categorize insights for filtering and organization.",
          ),
        people: z
          .array(z.string())
          .optional()
          .describe(
            "Names of people mentioned in the insight (e.g., ['Alice', 'Bob'])",
          ),
        time: z
          .union([z.string(), z.number()])
          .optional()
          .describe(
            "Unix timestamp in milliseconds as a NUMBER (e.g., 1705287600123), NOT an object like {format: 'timestamp'}",
          ),
        platform: z
          .string()
          .optional()
          .describe(
            "Platform this insight is related to (e.g., 'manual', 'chat')",
          ),
        attachments: z
          .array(z.string())
          .optional()
          .describe(
            "Array of document IDs to attach to this insight. Documents must be uploaded first via file upload (document IDs are from rag_documents table). Example: ['doc-id-1', 'doc-id-2']. ⚠️ CRITICAL: Include ALL document IDs in the array at once, not one at a time.",
          ),
      },
      async (args) => {
        try {
          const {
            title,
            description,
            importance,
            urgency,
            myTasks,
            timeline,
            details,
            groups,
            categories,
            people,
            time,
            platform,
            attachments,
          } = args;

          const normalizedImportance = normalizeImportance(importance);
          const normalizedUrgency = normalizeUrgency(urgency);
          const normalizedTasks = myTasks?.map(normalizeTask);

          // Handle timestamp
          let normalizedTime: Date | null = null;
          if (time) {
            if (typeof time === "string") {
              normalizedTime = new Date(time);
            } else if (typeof time === "number") {
              normalizedTime = new Date(time);
            }
          }

          // Get user's bots to find or create a manual bot
          const bots = await getBotsByUserId({
            id: session.user.id,
            limit: null,
            startingAfter: null,
            endingBefore: null,
            onlyEnable: false,
          });

          const manualBot = bots.bots.find((bot) => bot.adapter === "manual");

          let botId: string;
          if (manualBot) {
            botId = manualBot.id;
          } else {
            botId = await createBotRecord({
              name: "My Bot",
              userId: session.user.id,
              description: "Default bot for manual insights",
              adapter: "manual",
              adapterConfig: {},
              enable: true,
            });
          }

          // Create the insight payload
          const payload: GeneratedInsightPayload = {
            dedupeKey: null,
            taskLabel:
              normalizedTasks && normalizedTasks.length > 0
                ? "task"
                : "insight",
            title,
            description,
            importance: normalizedImportance,
            urgency: normalizedUrgency,
            platform: platform || "manual",
            account: null,
            groups: groups || [],
            categories: categories || [],
            people: people || [],
            time: normalizedTime || new Date(),
            details: details
              ? details.map((d) => ({
                  ...d,
                  time: d.time ?? Date.now(),
                }))
              : null,
            timeline: timeline
              ? timeline.map((t) => ({ ...t, time: Date.now() }))
              : null,
            insights: null,
            trendDirection: null,
            trendConfidence: null,
            sentiment: null,
            sentimentConfidence: null,
            intent: null,
            trend: null,
            issueStatus: null,
            communityTrend: null,
            duplicateFlag: null,
            impactLevel: null,
            resolutionHint: null,
            topKeywords: [],
            topEntities: [],
            topVoices: null,
            sources: null,
            sourceConcentration: null,
            buyerSignals: [],
            stakeholders: null,
            contractStatus: null,
            signalType: null,
            confidence: null,
            scope: null,
            nextActions: null,
            followUps: null,
            actionRequired:
              (normalizedTasks && normalizedTasks.length > 0) || false,
            actionRequiredDetails: null,
            myTasks: normalizedTasks
              ? normalizedTasks.map((task) => ({
                  title: task.text,
                  status: task.completed ? "completed" : "pending",
                  deadline: task.deadline || null,
                  owner: task.owner || null,
                }))
              : null,
            waitingForMe: null,
            waitingForOthers: null,
            clarifyNeeded: false,
            learning: null,
            experimentIdeas: null,
            executiveSummary: null,
            riskFlags: null,
            strategic: null,
            client: null,
            projectName: null,
            nextMilestone: null,
            dueDate: null,
            paymentInfo: null,
            entity: null,
            why: null,
            historySummary: null,
            roleAttribution: null,
            alerts: null,
          };

          // Insert the insight
          // Note: payload already contains time field, and insertInsightRecords
          // will handle JSON field serialization for SQLite compatibility
          const insertPayload = {
            ...payload,
            botId,
          } as any;

          const result = await insertInsightRecords([insertPayload]);

          if (!result || result.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Failed to create insight.",
                },
              ],
              isError: true,
            };
          }

          const createdInsightId = result[0];

          // Associate insight with current chat if chatId is provided
          if (chatId) {
            try {
              await saveChatInsights({
                chatId,
                insightIds: [createdInsightId],
              });
              console.log(
                `[createInsight] Associated insight ${createdInsightId} with chat ${chatId}`,
              );
            } catch (error) {
              console.error(
                "[createInsight] Failed to associate insight with chat:",
                error,
              );
              // Don't fail the insight creation if chat association fails
            }
          }

          // Associate documents if attachments are provided
          if (attachments && attachments.length > 0) {
            try {
              const result = await associateDocumentsToInsight(
                createdInsightId,
                attachments,
                session.user.id,
              );
              if (result.associated.length > 0) {
                console.log(
                  `[createInsight] Associated ${result.associated.length} documents with insight ${createdInsightId}`,
                );
              }
              if (result.failed.length > 0) {
                console.warn(
                  `[createInsight] Failed to associate ${result.failed.length} documents with insight ${createdInsightId}`,
                );
              }
            } catch (error) {
              console.error(
                "[createInsight] Failed to associate documents:",
                error,
              );
              // Don't fail the insight creation if document association fails
            }
          }

          // Notify frontend of insight change for optimistic update
          if (onInsightChange) {
            onInsightChange({
              action: "create",
              insightId: createdInsightId,
              insight: {
                id: createdInsightId,
                ...insertPayload,
              },
            });
          }

          const responseData = {
            success: true,
            message: `Successfully created insight "${title}"`,
            insightId: createdInsightId,
            title,
            description,
            importance: normalizedImportance,
            urgency: normalizedUrgency,
            myTasks: normalizedTasks || null,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(responseData, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to create insight: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // modifyInsight tool
    tool(
      "modifyInsight",
      `${[
        "**📝 WHAT THIS TOOL DOES**",
        "Update an existing insight's properties. Can modify tasks, descriptions, importance, urgency, etc.",
        "",
        "**⭐ TRACKING OPERATIONS**",
        "",
        "【Auto-track Follow-up Operations】",
        "- When there is a focused/active insight, you MUST track all subsequent related operations in the same chat",
        "- Whenever the user performs or discusses operations related to the insight, append details",
        "- Examples: user asks to create GitHub issue, user confirms task completion, file is created, etc.",
      ].join("\n")}\n\n${[
        "",
        "【Auto-complete Todos】",
        "- When myTasks exist in the insight, you MUST auto-update task status when operations complete",
        "- Common success patterns that should trigger auto-completion:",
        "  * GitHub issue/PR created successfully",
        "  * File created/modified successfully",
        "  * Task confirmed as completed by user",
        "  * API call returned success",
        "- When detecting success, update myTasks: set completed=true for the related task",
        "",
        "**🎯 COMMON USE CASES:**",
        "",
        "【1. Mark Task Complete】",
        "- 'Task completed' / 'Mark task as done' → Set completed=true",
        "- 'Todo is done' → Update task status in myTasks",
        "- Detection: After executing a tool successfully, check if it matches any myTask and auto-complete",
        "",
        "【2. Update Task Info】",
        "- 'Set deadline' → Add deadline to task",
        "- 'Assign to XX' → Set owner field",
        "- 'Update task description' → Change task text",
        "",
        "【3. Update Insight Properties】",
        "- 'Mark as urgent' → Set urgency='ASAP'",
        "- 'Lower importance' → Set importance='General'",
        "- 'Update description' → Modify description field",
        "- 'Add details' → Add detailed conversation content, error details, etc.",
        "",
        "【4. Add Update Records to Tracking】⭐ Important",
        "- User says 'update this' / 'add an update' → use timeline field to append new event",
        "- ⚠️ Do NOT call createInsight! Must use modifyInsight to append timeline",
        "- Example: user says 'there's an update on this project' → append to timeline: [{time: ..., summary: '...', label: 'Update', emoji: '🔄'}]",
        "",
        "**⚙️ TASK OWNER ASSIGNMENT**",
        "",
        "【How to Assign Owner】",
        "1. User does it themselves → use the user's own name",
        "2. Assign to others → use queryContacts tool to find contact list, use their name",
        "3. Uncertain who is responsible → ask user: 'Who should be responsible for this task?'",
        "",
        "【Examples】",
        "- '{text: \"Complete design draft\", completed: true}' → Mark task complete",
        '- \'{text: "Contact client", owner: "Zhang San"}\' → Assign to Zhang San',
        '- \'{text: "Submit report", deadline: "2025-02-10"}\' → Set deadline',
        "",
        "**📋 FIELD DESCRIPTIONS**",
        "",
        "【description - Summary Description】",
        "- Concise 1-2 sentence summary (20-60 words)",
        "- Explain what it is and why it matters",
        "- Keep it natural and conversational",
        "- Example: 'Need to create scenario demo to improve SMB customer sales credibility'",
        "",
        "【details - Detailed Information】⭐⭐⭐",
        "- Complete conversation content, error details, solution analysis, follow-up operation records, etc.",
        "- Array format, each element contains:",
        "  * content: Main content",
        "  * person: Speaker (optional)",
        "  * platform: Platform name (optional)",
        "  * time: Timestamp (optional)",
        "- Example: [{content: 'User mentioned needing scenario demo', person: 'Alice'}]",
        "",
        "**⚠️ CRITICAL: ALWAYS APPEND**",
        "- Each update will **append** new content to existing array, not replace",
        "- You should call modifyInsight to append details whenever there is a related operation or result",
        "- Don't wait for user to ask, track proactively",
        "- Tracking includes: operation results, success messages, error info, user confirmations, etc.",
        "",
        "⚠️ CRITICAL: details must be an array of objects, NOT strings!",
        '  ❌ WRONG: details: "This is conversation content"',
        '  ✅ RIGHT: details: [{content: "This is conversation content", person: "User"}]',
        "",
        "【timeline - Timeline】⭐⭐⭐",
        "- Tracks event progress, records key events and status changes",
        "- ⚠️ REQUIRED - Must add at least one timeline event to track the progress of the insight!",
        "- Array format, each element contains:",
        "  * time: timestamp (optional)",
        "  * summary: event summary description",
        "  * label: event type/category (optional)",
        "  * emoji: emoji icon (optional)",
        "- Example: [{time: 1234567890, summary: 'Task created', label: 'In Progress', emoji: '🚀'}]",
        "- Note: Each update will **append** new content to the existing array, not replace",
        "",
        "【insights - Key Insights】",
        "- Key insights and summaries extracted from content",
        "- Array of objects, each element contains:",
        "  * category: insight category",
        "  * value: insight content",
        "  * confidence: confidence level (0-100)",
        "  * evidence: supporting evidence (optional)",
        "  * byRole: role attribution (optional)",
        "- Example: [{category: 'User Feedback', value: 'Need to optimize performance', confidence: 90}]",
        "- Note: Each update will **append** new content to the existing array, not replace",
        "",
        "【myTasks - Tasks】⭐⭐⭐",
        "- Task list that needs user action",
        "- Each task contains: text (description), completed (done or not), deadline, owner",
        "- When updating, provide the complete task array",
        "",
        "**⚠️ AUTO-COMPLETE TASKS**",
        "- When insight contains myTasks, you must monitor operation results and auto-update task status",
        "- When detecting the following success patterns, auto set completed=true:",
        "  * GitHub Issue created successfully → mark related Issue creation task as complete",
        "  * PR/MR created successfully → mark related PR creation task as complete",
        "  * File created/modified successfully → mark related file creation task as complete",
        "  * Email sent successfully → mark related email sending task as complete",
        "  * User confirms task completion → mark task as complete",
        "- Update example: {insightId: 'xxx', updates: {myTasks: [{text: 'Submit Bug Issue on GitHub', completed: true}]}}",
        "",
        "【waitingForMe - Waiting for Me】",
        "- Tasks that need user response or confirmation",
        "- Same format as myTasks",
        "",
        "【waitingForOthers - Waiting for Others】",
        "- Already assigned to others, waiting for them to complete",
        "- Same format as myTasks",
        "",
        "**⚠️ CRITICAL RULES**",
        "",
        "【1. IMPORTANCE/URGENCY - Use Single Value】",
        "  ❌ WRONG: 'Important' (don't use / combination)",
        "  ✅ RIGHT: 'Important' or 'General'",
        "",
        "  Valid values:",
        "  - importance: 'Important' / 'General' / 'Not Important'",
        "  - urgency: 'As soon as possible' / 'Within 24 hours' / 'Not urgent' / 'General'",
        "",
        "【2. TASK ARRAYS - Must Be Object Arrays】",
        '  ❌ WRONG: myTasks=["task1", "task2"]',
        '  ❌ WRONG: myTasks=[{\\"text\\":\\"task\\"}"]',
        '  ✅ RIGHT: myTasks=[{text: "Follow up", completed: false, deadline: "2025-01-15", owner: "Alice"}]',
        "",
        "【3. TASK OBJECT FORMAT】",
        "  {",
        '    "text": "Task description (required)",',
        '    "completed": true/false,',
        '    "deadline": "2025-01-15 or tomorrow/next week (optional)",',
        '    "owner": "Owner name (optional)"',
        "  }",
        "",
        "【4. AUTO-TRACKING - Must Proactively Track】⭐⭐⭐",
        "  - When there is a focused insight, you must track all related follow-up operations in the same chat",
        "  - After each tool execution succeeds, call modifyInsight to append details to record the result",
        "  - When myTasks exists, auto-update completed status based on tool execution results",
        "  - Don't wait for user to ask, track proactively",
        "",
        "**💡 USAGE EXAMPLES:**",
        "",
        "- 'Mark task as done' → {insightId: 'xxx', updates: {myTasks: [{text: 'Contact client', completed: true}]}}",
        "- 'Update description' → {insightId: 'xxx', updates: {description: 'New description content'}}",
        "- 'Mark as urgent' → {insightId: 'xxx', updates: {urgency: 'ASAP'}}",
        "- 'Add new task' → {insightId: 'xxx', updates: {myTasks: [{text: 'New task', completed: false}]}}",
        "- 'Add details' → {insightId: 'xxx', updates: {details: [{content: 'User feedback: Need to add export feature', person: 'Alice'}]}}",
        "- 'Add attachments' → {insightId: 'xxx', updates: {addAttachments: ['doc-id-1', 'doc-id-2']}}",
        "- 'Remove attachments' → {insightId: 'xxx', updates: {removeAttachments: ['doc-id-1']}}",
        "",
        "**📌 CRITICAL: Notes When Modifying Title/Description**",
        "- If you need to modify the insight title, must provide new title in updates",
        "- If you need to modify the insight description, must provide new description in updates",
        "- Don't only update details/timeline without modifying title/description",
        "- The tool return value contains current insight's title and description for your reference",
        "",
        "**🔄 PARTIAL UPDATE RULES**",
        "",
        "【Only Update Provided Fields - Important】",
        "- updates only contains fields that need to be modified",
        "- Fields not provided will keep their original values",
        "- This is an incremental update (partial update), not full replacement",
        "",
        "【details/timeline/insights - Array Incremental Update】⭐",
        "- details, timeline, insights fields use **append** mode, not replace",
        "- Each call appends new content to the end of existing array",
        "- For example: originally 2 details, after adding 1 new there will be 3",
        "- Example: {insightId: 'xxx', updates: {details: [{content: 'New conversation content'}]}}",
        "",
        "【How to Modify Title/Summary】",
        "- 'Change insight title' → {insightId: 'xxx', updates: {title: 'New title'}}",
        "- 'Change insight description' → {insightId: 'xxx', updates: {description: 'New description content'}}",
        "- 'Change both title and description' → {insightId: 'xxx', updates: {title: 'New title', description: 'New description'}}",
        "",
        "【Notes】⭐",
        "- If user wants to modify title or description, must explicitly provide in updates",
        "- Don't just add details/timeline without modifying title/description, otherwise user won't see changes on insight detail page",
        "",
        "【Typical Error Example】❌",
        "- User says: 'Update progress, openloomi shipped 10 bugs today'",
        "- Error: Only updates details and timeline, doesn't update title/description",
        "- Result: Title and description on insight detail page still show old content, user doesn't perceive the update",
        "",
        "【Correct Example】✅ - Incremental Update",
        "- User says: 'Update progress, openloomi shipped 10 bugs today'",
        "- Principle: **Incrementally append** new content on top of existing title/description",
        "- Example: Original title='Daily sync team progress update'",
        "- Correct: {insightId: 'xxx', updates: {",
        "  details: [{content: 'openloomi shipped 10 bugs today'}],",
        "  title: 'Daily sync team progress update | openloomi shipped 10 bugs',",
        "  description: 'Daily sync team member progress. Latest: openloomi shipped 10 bugs today'",
        "}}",
        "- Or more concise: {insightId: 'xxx', updates: {",
        "  details: [{content: 'openloomi shipped 10 bugs today'}],",
        "  title: 'Daily sync team progress update (10 bugs)',",
        "}}",
        "",
        "【attachments - File Attachments】",
        "- Use addAttachments to add files (provide document ID array)",
        "- Use removeAttachments to remove files (provide document ID array)",
        "- Documents must be uploaded to system via file upload function first",
        "- Example: {addAttachments: ['doc-123', 'doc-456']}",
        "- ⚠️ CRITICAL: When adding attachments, include ALL document IDs in the array at once, not just the new ones",
        "",
        "⚠️ IMPORTANT: If user references an insight in the conversation (context), directly use that insight's ID, no need to ask.",
      ].join("\n")}`,
      {
        insightId: z
          .string()
          .optional()
          .describe(
            "The ID of the insight to modify. If not provided, will use the focused insight ID from context.",
          ),
        updates: z
          .object({
            description: z
              .string()
              .optional()
              .describe("New description for the insight"),
            details: z
              .array(
                z.object({
                  content: z.string().optional().describe("Main content"),
                  person: z.string().optional().describe("Speaker name"),
                  platform: z.string().optional().describe("Platform name"),
                  channel: z.string().optional().describe("Channel identifier"),
                  time: z.number().optional().describe("Timestamp"),
                }),
              )
              .optional()
              .describe(
                "Detailed information array (conversation content, error details, etc.)",
              ),
            timeline: z
              .array(
                z.object({
                  time: z.number().optional().describe("Timestamp"),
                  summary: z
                    .string()
                    .optional()
                    .describe("Brief summary of the event"),
                  label: z.string().optional().describe("Event type/category"),
                  emoji: z.string().optional().describe("Emoji icon"),
                  id: z
                    .string()
                    .optional()
                    .describe(
                      "Unique identifier for this timeline event (for tracking history)",
                    ),
                  version: z
                    .number()
                    .optional()
                    .describe(
                      "Current version number of this event (starts at 1, increments on updates)",
                    ),
                  lastUpdatedAt: z
                    .number()
                    .optional()
                    .describe("Timestamp when this event was last updated"),
                  changeCount: z
                    .number()
                    .optional()
                    .describe(
                      "Total number of times this event has been changed",
                    ),
                  urgency: z
                    .string()
                    .optional()
                    .describe(
                      "Urgency level: immediate/24h/not_urgent (for matching AI prompt output)",
                    ),
                  tags: z
                    .array(z.string())
                    .optional()
                    .describe("Keywords/tags for categorizing the event"),
                  action: z
                    .string()
                    .optional()
                    .describe(
                      "Recommended action for the user based on this timeline event (e.g., 'Review the competitor update', 'Schedule a follow-up')",
                    ),
                }),
              )
              .optional()
              .describe("Timeline array for tracking events and progress"),
            insights: z
              .array(
                z.object({
                  category: z.string().describe("Insight category"),
                  value: z.string().describe("Insight value/content"),
                  confidence: z.number().describe("Confidence level"),
                  evidence: z
                    .array(z.string())
                    .optional()
                    .describe(
                      "Supporting evidence. Include ALL evidence items in the array at once.",
                    ),
                  byRole: z.string().optional().describe("Role attribution"),
                }),
              )
              .optional()
              .describe("Key insights extracted from the content"),
            importance: z
              .string()
              .optional()
              .describe("Importance level: Important, General, Not Important"),
            urgency: z
              .string()
              .optional()
              .describe(
                "Urgency level: As soon as possible, Within 24 hours, Not urgent, General",
              ),
            myTasks: z
              .array(
                z.union([
                  z.object({
                    text: z.string().describe("Task description"),
                    completed: z
                      .boolean()
                      .default(false)
                      .describe(
                        "Whether the task is completed (default: false)",
                      ),
                    deadline: z
                      .string()
                      .optional()
                      .describe(
                        "Task deadline (e.g., '2025-01-15', 'tomorrow')",
                      ),
                    owner: z
                      .string()
                      .optional()
                      .describe("Person responsible for this task"),
                  }),
                  z.string(),
                ]),
              )
              .optional()
              .describe("My tasks array with completion status"),
            waitingForMe: z
              .array(
                z.union([
                  z.object({
                    text: z.string().describe("Task description"),
                    completed: z.boolean().default(false),
                    deadline: z.string().optional(),
                    owner: z.string().optional(),
                  }),
                  z.string(),
                ]),
              )
              .optional()
              .describe("Waiting for me tasks array with completion status"),
            waitingForOthers: z
              .array(
                z.union([
                  z.object({
                    text: z.string().describe("Task description"),
                    completed: z.boolean().default(false),
                    deadline: z.string().optional(),
                    owner: z.string().optional(),
                  }),
                  z.string(),
                ]),
              )
              .optional()
              .describe(
                "Waiting for others tasks array with completion status",
              ),
            actionRequired: z
              .boolean()
              .optional()
              .describe("Whether action is required"),
            title: z.string().optional().describe("New title for the insight"),
            addAttachments: z
              .array(z.string())
              .optional()
              .describe(
                "Array of document IDs to add to this insight. Documents must be uploaded first via file upload (document IDs are from rag_documents table). ⚠️ CRITICAL: Include ALL document IDs in the array at once, not one at a time.",
              ),
            removeAttachments: z
              .array(z.string())
              .optional()
              .describe("Array of document IDs to remove from this insight."),
            categories: z
              .array(z.string())
              .optional()
              .describe(
                "Categories for the insight (e.g., ['Marketing', 'Meetings', 'News', 'R&D']). This will replace existing categories.",
              ),
            groups: z
              .array(z.string())
              .optional()
              .describe(
                "Groups for the insight (e.g., ['Marketing', 'Sales']). This will replace existing groups.",
              ),
          })
          .optional()
          .describe("Fields to update in the insight"),
      },
      async (args) => {
        try {
          const { insightId, updates } = args;

          // Determine which insight to modify
          const targetInsightId = insightId;

          if (!targetInsightId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No insight ID provided. Please specify which insight to modify.",
                },
              ],
              isError: true,
            };
          }

          if (!updates) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No updates provided. Please specify what fields to update (e.g., description, myTasks, timeline, etc.).",
                },
              ],
              isError: true,
            };
          }

          // Get the insight and verify access
          const insightResult = await getInsightByIdForUser({
            userId: session.user.id,
            insightId: targetInsightId,
          });

          if (!insightResult) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Insight ${targetInsightId} not found or access denied.`,
                },
              ],
              isError: true,
            };
          }

          const { insight, bot } = insightResult;

          // Use the original bot ID for updating
          const targetBotId = bot.id;

          // Build the payload with only the fields that are being updated
          const payload: Partial<GeneratedInsightPayload> = {};

          if (updates.description !== undefined) {
            payload.description = updates.description;
          }

          if (updates.details !== undefined) {
            // details is already an array of objects, assign it and fill missing timestamps
            payload.details = updates.details.map((d) => ({
              ...d,
              time: d.time ?? Date.now(),
            })) as any;
          }

          if (updates.timeline !== undefined) {
            // timeline is already an array of objects, just assign it
            payload.timeline = updates.timeline as any;
          }

          if (updates.insights !== undefined) {
            // insights is an array of strings
            payload.insights = updates.insights as any;
          }

          if (updates.importance !== undefined) {
            payload.importance = normalizeImportance(updates.importance);
          }

          if (updates.urgency !== undefined) {
            payload.urgency = normalizeUrgency(updates.urgency);
          }

          if (updates.myTasks !== undefined) {
            const normalizedTasks = updates.myTasks
              .map(normalizeTask)
              .filter((task) => task.text.length > 0);
            payload.myTasks = normalizedTasks.map((task) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }));
          }

          if (updates.waitingForMe !== undefined) {
            const normalizedTasks = updates.waitingForMe
              .map(normalizeTask)
              .filter((task) => task.text.length > 0);
            payload.waitingForMe = normalizedTasks.map((task) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }));
          }

          if (updates.waitingForOthers !== undefined) {
            const normalizedTasks = updates.waitingForOthers
              .map(normalizeTask)
              .filter((task) => task.text.length > 0);
            payload.waitingForOthers = normalizedTasks.map((task) => ({
              title: task.text,
              status: task.completed ? "completed" : "pending",
              deadline: task.deadline || null,
              owner: task.owner || null,
            }));
          }

          if (updates.actionRequired !== undefined) {
            payload.actionRequired = updates.actionRequired;
          }

          if (updates.title !== undefined) {
            payload.title = updates.title;
          }

          if (updates.groups !== undefined) {
            payload.groups = updates.groups;
          }

          if (updates.categories !== undefined) {
            payload.categories = updates.categories;
          }

          // Track attachment updates separately (not part of GeneratedInsightPayload)
          const attachmentUpdates: {
            add?: string[];
            remove?: string[];
          } = {};

          if (
            updates.addAttachments !== undefined &&
            updates.addAttachments.length > 0
          ) {
            attachmentUpdates.add = updates.addAttachments;
          }

          if (
            updates.removeAttachments !== undefined &&
            updates.removeAttachments.length > 0
          ) {
            attachmentUpdates.remove = updates.removeAttachments;
          }

          // If no updates (excluding attachments), return early
          if (
            Object.keys(payload).length === 0 &&
            !attachmentUpdates.add &&
            !attachmentUpdates.remove
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No valid updates provided. Please specify at least one field to update.",
                },
              ],
              isError: true,
            };
          }

          // Create a complete payload with existing values
          const fullPayload: GeneratedInsightPayload = {
            dedupeKey: insight.dedupeKey ?? null,
            taskLabel: insight.taskLabel,
            title: updates.title || insight.title,
            description: updates.description || insight.description,
            importance: updates.importance || insight.importance,
            urgency: updates.urgency || insight.urgency,
            platform: insight.platform ?? null,
            account: insight.account ?? null,
            groups: insight.groups ?? [],
            people: insight.people ?? [],
            time: insight.time,
            // Incremental update: append new items to existing array
            details: updates.details
              ? [
                  ...(insight.details || []),
                  ...updates.details.map((d) => ({
                    ...d,
                    time: d.time ?? Date.now(),
                  })),
                ]
              : insight.details,
            timeline: updates.timeline
              ? [
                  ...(insight.timeline || []),
                  ...updates.timeline.map((t) => ({
                    ...t,
                    time: Date.now(),
                  })),
                ]
              : insight.timeline,
            insights: updates.insights
              ? [...(insight.insights || []), ...updates.insights]
              : insight.insights,
            trendDirection: insight.trendDirection ?? null,
            trendConfidence: insight.trendConfidence
              ? Number.parseFloat(insight.trendConfidence.toString())
              : null,
            sentiment: insight.sentiment ?? null,
            sentimentConfidence: insight.sentimentConfidence
              ? Number.parseFloat(insight.sentimentConfidence.toString())
              : null,
            intent: insight.intent ?? null,
            trend: insight.trend ?? null,
            issueStatus: insight.issueStatus ?? null,
            communityTrend: insight.communityTrend ?? null,
            duplicateFlag: insight.duplicateFlag ?? null,
            impactLevel: insight.impactLevel ?? null,
            resolutionHint: insight.resolutionHint ?? null,
            topKeywords: insight.topKeywords ?? [],
            topEntities: insight.topEntities ?? [],
            topVoices: insight.topVoices,
            sources: insight.sources,
            sourceConcentration: insight.sourceConcentration ?? null,
            buyerSignals: insight.buyerSignals ?? [],
            stakeholders: insight.stakeholders,
            contractStatus: insight.contractStatus ?? null,
            signalType: insight.signalType ?? null,
            confidence: insight.confidence
              ? Number.parseFloat(insight.confidence.toString())
              : null,
            scope: insight.scope ?? null,
            nextActions: insight.nextActions,
            followUps: insight.followUps,
            actionRequired:
              updates.actionRequired ?? insight.actionRequired ?? null,
            actionRequiredDetails: insight.actionRequiredDetails,
            myTasks: updates.myTasks
              ? updates.myTasks
                  .map(normalizeTask)
                  .filter((task) => task.text.length > 0)
                  .map((task) => ({
                    title: task.text,
                    status: task.completed ? "completed" : "pending",
                    deadline: task.deadline || null,
                    owner: task.owner || null,
                  }))
              : insight.myTasks,
            waitingForMe: updates.waitingForMe
              ? updates.waitingForMe
                  .map(normalizeTask)
                  .filter((task) => task.text.length > 0)
                  .map((task) => ({
                    title: task.text,
                    status: task.completed ? "completed" : "pending",
                    deadline: task.deadline || null,
                    owner: task.owner || null,
                  }))
              : insight.waitingForMe,
            waitingForOthers: updates.waitingForOthers
              ? updates.waitingForOthers
                  .map(normalizeTask)
                  .filter((task) => task.text.length > 0)
                  .map((task) => ({
                    title: task.text,
                    status: task.completed ? "completed" : "pending",
                    deadline: task.deadline || null,
                    owner: task.owner || null,
                  }))
              : insight.waitingForOthers,
            clarifyNeeded: insight.clarifyNeeded ?? null,
            categories: insight.categories ?? [],
            learning: insight.learning ?? null,
            experimentIdeas: insight.experimentIdeas,
            executiveSummary: insight.executiveSummary ?? null,
            riskFlags: insight.riskFlags,
            strategic: insight.strategic,
            client: insight.client ?? null,
            projectName: insight.projectName ?? null,
            nextMilestone: insight.nextMilestone ?? null,
            dueDate: insight.dueDate ?? null,
            paymentInfo: insight.paymentInfo ?? null,
            entity: insight.entity ?? null,
            why: insight.why ?? null,
            historySummary: insight.historySummary,
            roleAttribution: insight.roleAttribution,
            alerts: insight.alerts,
          };

          // Update the insight
          const updatedInsight = await updateInsightById({
            insightId: targetInsightId,
            botId: targetBotId,
            payload: fullPayload,
          });

          // Handle attachment updates
          const attachmentResults: {
            added?: string[];
            removed?: string[];
            failed?: { added: string[]; removed: string[] };
          } = {};

          if (attachmentUpdates.add || attachmentUpdates.remove) {
            if (attachmentUpdates.add && attachmentUpdates.add.length > 0) {
              const addResult = await associateDocumentsToInsight(
                targetInsightId,
                attachmentUpdates.add,
                session.user.id,
              );
              attachmentResults.added = addResult.associated;
              if (addResult.failed.length > 0) {
                attachmentResults.failed = {
                  added: addResult.failed,
                  removed: [],
                };
              }
            }

            if (
              attachmentUpdates.remove &&
              attachmentUpdates.remove.length > 0
            ) {
              const removeResult = await removeDocumentAssociations(
                targetInsightId,
                attachmentUpdates.remove,
                session.user.id,
              );
              attachmentResults.removed = removeResult.removed;
              if (removeResult.failed.length > 0) {
                if (!attachmentResults.failed) {
                  attachmentResults.failed = {
                    added: [],
                    removed: removeResult.failed,
                  };
                } else {
                  attachmentResults.failed.removed = removeResult.failed;
                }
              }
            }
          }

          // Notify frontend of insight change for optimistic update
          if (onInsightChange) {
            onInsightChange({
              action: "update",
              insightId: updatedInsight.id,
            });
          }

          const changes = Object.keys(updates).join(", ");

          const responseData = {
            success: true,
            message: `Successfully updated insight "${updatedInsight.title}". Changed: ${changes}`,
            insightId: updatedInsight.id,
            title: updatedInsight.title,
            description: updatedInsight.description,
            updatedFields: Object.keys(updates),
            ...(attachmentResults.added || attachmentResults.removed
              ? {
                  attachments: {
                    added: attachmentResults.added || [],
                    removed: attachmentResults.removed || [],
                    ...(attachmentResults.failed
                      ? { failed: attachmentResults.failed }
                      : {}),
                  },
                }
              : {}),
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(responseData, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to modify insight: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // deleteInsight tool
    tool(
      "deleteInsight",
      [
        "**🗑️ DELETE INSIGHT**",
        "",
        "This tool permanently deletes an insight from the database.",
        "",
        "**⚠️ IMPORTANT - IMPORTANT RULES:**",
        "- This action CANNOT be undone - deleted insights cannot be recovered",
        "- You MUST get explicit confirmation from the user before deleting",
        "- Confirm by stating the insight title and asking for confirmation",
        "",
        "**📋 WHEN TO USE:**",
        "- User explicitly asks to delete an insight/event",
        "- User wants to remove a test/temporary insight",
        "- User confirms deletion after being asked",
        "",
        "**💡 USAGE EXAMPLES:**",
        "- 'Delete this test event' → First confirm: 'Are you sure you want to delete the insight \"test event\"? (This cannot be undone)'",
        "- 'Delete insight with ID xxx' → Confirm the insight details first",
        "- 'Remove this temporary event' → Confirm before deleting",
        "",
        "⚠️ IMPORTANT: If user references an insight in the conversation (context), directly use that insight's ID, no need to ask.",
      ].join("\n"),
      {
        insightId: z
          .string()
          .optional()
          .describe(
            "The ID of the insight to delete. If not provided, will use the focused insight ID from context.",
          ),
      },
      async (args) => {
        try {
          const { insightId } = args;

          // Determine which insight to delete
          const targetInsightId = insightId || null;

          if (!targetInsightId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No insight ID provided. Please specify which insight to delete, or make sure an insight is focused.",
                },
              ],
              isError: true,
            };
          }

          console.log(
            "[Tool calling] Deleting insight:",
            JSON.stringify({
              insightId: targetInsightId,
            }),
          );

          // Get the insight and verify access
          const insightResult = await getInsightByIdForUser({
            userId: session.user.id,
            insightId: targetInsightId,
          });

          if (!insightResult) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Insight ${targetInsightId} not found or access denied.`,
                },
              ],
              isError: true,
            };
          }

          const { insight } = insightResult;

          // Delete the insight
          await deleteInsightsByIds({ ids: [targetInsightId] });

          console.log("[Tool calling] Insight deleted successfully");

          // Notify frontend of insight change for optimistic update
          if (onInsightChange) {
            onInsightChange({
              action: "delete",
              insightId: targetInsightId,
            });
          }

          const responseData = {
            success: true,
            message: `Successfully deleted insight "${insight.title}"`,
            insightId: targetInsightId,
            title: insight.title,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: `✅ ${responseData.message}`,
              },
            ],
            data: responseData,
          };
        } catch (error) {
          console.error("[Tool calling] Failed to delete insight:", error);

          // Check if it's a AppError
          if (error instanceof AppError) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `[${error.type}:${error.surface}] ${error.message}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to delete insight: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  ];
}
