import { z } from "zod";
import type { UIMessage } from "ai";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string().optional(),
  disableAction: z.boolean().optional(),
  executionId: z.string().optional(),
  executionSequence: z.number().int().positive().optional(),
  messagePhase: z.enum(["process", "final"]).optional(),
  finalizedAt: z.string().optional(),
  platformAccountId: z.uuid().optional(),
  ragDocuments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
  focusedInsightIds: z.array(z.string()).optional(),
  focusedInsights: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        details: z.any().nullable().optional(),
        timeline: z.any().nullable().optional(),
        groups: z.array(z.string()).nullable().optional(),
        platform: z.string().nullable().optional(),
      }),
    )
    .optional(),
  // Current insight ID passed when sending messages from insight detail page (backward compatible)
  currentInsightId: z.string().optional(),
  // Referenced context events: Insights added additionally by user via "Add event", used only as context
  referencedContextInsightIds: z.array(z.string()).optional(),
  // Referenced action items (insight task id, format like insightId|bucket|index|...)
  referencedTaskIds: z.array(z.string()).optional(),
  // Referenced people (corresponds to /api/people, can be id or name)
  referencedPeople: z
    .array(z.object({ id: z.string().optional(), name: z.string() }))
    .optional(),
  // Referenced channels (corresponds to integrated channel data)
  referencedChannels: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        platform: z.string().optional(),
      }),
    )
    .optional(),
  // File references selected from workspace (taskId is usually chatId)
  workspaceFileRefs: z
    .array(
      z.object({
        taskId: z.string(),
        path: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
  // Task-layer context used by the chat-first task creation flow.
  activeTaskId: z.string().optional(),
  taskCreationMode: z.boolean().optional(),
  taskTemplate: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type CustomUIDataTypes = {
  appendMessage: string;
  loadingText: {
    content: string;
    id: string;
  };
  hideLoadingText: {
    id: string;
  };
  agentPlan: {
    content: string;
    id: string;
    thought: string;
    plan: Array<{
      step: number;
      action: string;
      tool?: string | null;
    }>;
    currentStep?: number;
    requiresApproval?: boolean;
    approvalStatus?: "pending_approval" | "approved" | "rejected" | "executing";
  };
  agentPlanUpdate: {
    content: string;
    id: string;
    thought: string;
    plan: Array<{
      step: number;
      action: string;
      tool?: string | null;
    }>;
    currentStep?: number;
    requiresApproval?: boolean;
    approvalStatus?: "pending_approval" | "approved" | "rejected" | "executing";
  };
  agentStatus: {
    content: string;
    id: string;
    thought: string;
    plan: Array<{
      step: number;
      action: string;
      tool?: string | null;
    }>;
    currentStep?: number;
  };
  hideAgentStatus: {
    id: string;
  };
  insightsRefresh: {
    action: "create" | "update" | "delete";
    insightId?: string;
    insight?: {
      id: string;
      [key: string]: any;
    };
  };
  calendarConflictDetected: {
    insightId: string;
    conflictEvent: {
      title: string;
      startTime: string;
      endTime: string;
    };
    requestedEvent: {
      startTime: string;
      endTime: string;
    };
  };
  calendarSuggestedSlots: {
    insightId: string;
    slots: Array<{
      day: string;
      date: string;
      time: string;
      datetime: string;
      reason: string;
    }>;
  };
  // Workflow inquiry result types
  githubInquiryResult: {
    feature: string;
    repo: string;
    issues: Array<{
      number: number;
      title: string;
      author: string;
      state: string;
      labels: string[];
      createdAt: string;
      updatedAt: string;
      comments: number;
      assignees: string[];
      body: string;
      url: string;
      relatedEvents: Array<{
        type: string;
        author: string;
        timestamp: string;
        content: string;
      }>;
    }>;
    pullRequests: Array<{
      number: number;
      title: string;
      author: string;
      state: string;
      createdAt: string;
      updatedAt: string;
      reviewStatus: string;
      requestedReviewers: string[];
      body: string;
      url: string;
      checksStatus: string;
    }>;
    summary: string;
  };
  jiraInquiryResult: {
    feature: string;
    project: string;
    tickets: Array<{
      key: string;
      title: string;
      status: string;
      priority: string;
      issueType: string;
      assignee: {
        name: string;
        email: string;
        avatar: string;
      };
      reporter: {
        name: string;
        email: string;
      };
      created: string;
      updated: string;
      dueDate?: string;
      description: string;
      url: string;
      history: Array<{
        date: string;
        author: string;
        action: string;
        comment?: string;
      }>;
      subtasks?: Array<{
        key: string;
        summary: string;
        status: string;
      }>;
      linkedIssues?: Array<{
        key: string;
        type: string;
        summary: string;
      }>;
    }>;
    summary: string;
  };
  slackInquiryResult: {
    feature: string;
    channels: string[];
    discussions: Array<{
      channel: string;
      threadTs: string;
      timestamp: string;
      permalink: string;
      mainMessage: {
        author: {
          name: string;
          username: string;
          avatar: string;
          role: string;
        };
        text: string;
        reactions: Array<{
          emoji: string;
          count: number;
          users?: string[];
        }>;
      };
      threadReplies: Array<{
        author: {
          name: string;
          username: string;
          avatar: string;
          role: string;
        };
        timestamp: string;
        text: string;
        reactions?: Array<{
          emoji: string;
          count: number;
        }>;
      }>;
      context: {
        relatedTo: string[];
        mentions: string[];
        sentiment: string;
      };
    }>;
    summary: string;
  };
  // Workflow action types
  workflowActionPreview: {
    requiresConfirmation?: boolean;
    confirmed?: boolean;
    actions: Array<{
      type: "slack_message" | "jira_update";
      target: string;
      content: string;
    }>;
  };
  workflowActionResult: {
    results: Array<{
      type: string;
      target: string;
      status: string;
      message: string;
      timestamp: string;
    }>;
    eventId: string;
    eventName: string;
  };
  workflowEventBinding: {
    message: string;
    eventId: string;
    eventName: string;
    eventUrl: string;
    timeline: Array<{
      timestamp: string;
      type: string;
      description: string;
      source: string;
      sourceUrl?: string;
      details?: any;
    }>;
  };
  workflowEventXRay: {
    eventId: string;
    eventName: string;
    eventDescription?: string;
    timeline: Array<{
      timestamp: string;
      type: string;
      description: string;
      source: string;
      sourceUrl?: string;
      details?: any;
      author?: {
        name: string;
        avatar?: string;
      };
    }>;
    summary: string;
    relatedEntities?: Array<{
      type: string;
      id: string;
      title: string;
      url: string;
    }>;
  };
};

export type ChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
  downloadUrl?: string;
  sizeBytes?: number;
  blobPath?: string;
  source?: string;
  expired?: boolean;
  expiredAt?: string;
  cid?: string;
}

export interface ExtractedMessageInfo {
  /**
   * Original message ID (used for deduplication and unique identification)
   * For Telegram it's message.id
   * For WhatsApp it's message.id or message.key.id
   * For other platforms it's the corresponding message unique identifier
   */
  id?: string | number;
  chatType: "private" | "group" | "channel" | "unknown";
  chatName: string;
  sender: string;
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  quoted?: ExtractedMessageInfo | null;
  /**
   * Flag whether the message is sent by current user
   * true: message sent by me (outgoing)
   * false: message sent by other party (incoming)
   * undefined: unknown direction (for backward compatibility with old data or platforms that don't support direction detection)
   */
  isOutgoing?: boolean;
}
