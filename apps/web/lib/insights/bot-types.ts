import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";
import type { ExtractEmailInfo } from "../integrations/email";
import type {
  DetailData,
  InsightData,
  TimelineData,
} from "@/lib/ai/subagents/insights";
import type { BotWithAccount } from "../db/queries";
import type { UserType } from "@/app/(auth)/auth";
import type { Platform } from "@openloomi/integrations/channels/sources/types";
import type { RawMessageData } from "@openloomi/indexeddb/extractor";

export type ExtractedMessageInfoWithoutAttachments = Omit<
  ExtractedMessageInfo,
  "attachments"
>;
export type ExtractEmailInfoWithoutAttachments = Omit<
  ExtractEmailInfo,
  "attachments"
>;
export type InsightInput =
  | ExtractedMessageInfoWithoutAttachments
  | ExtractedMessageInfoWithoutAttachments[]
  | ExtractEmailInfoWithoutAttachments
  | ExtractEmailInfoWithoutAttachments[]
  | string;

export type SummaryUserContext = {
  id: string;
  type: UserType;
  slackToken?: string;
  name?: string | null;
  email?: string | null;
  token?: string; // Cloud auth token for AI Provider authentication
};

export type RefreshOptions = {
  user?: SummaryUserContext;
  force?: boolean;
  chunkSize?: number; // Optional message batch size
  byGroup?: boolean; // Whether to separate insights processing by group (default true enables new logic)
  groupConcurrency?: number; // Number of concurrent group processing (default 3)
  groupRetryMaxAttempts?: number; // Max retry attempts for single group failure (default 2)
  groupRetryDelayMs?: number; // Retry delay base (milliseconds, default 2000ms, exponential backoff)
  groups?: string[]; // Only refresh specified groups (for single insight refresh)
};

export interface RefreshResult {
  refreshed: boolean;
  rawMessages?: any[];
}

export type GroupInsightResult = {
  groupName: string;
  insights: InsightData[];
  messageCount: number;
  rawMessages?: RawMessageData[];
  error?: Error;
};

export type ChunkCapableAdapter = {
  getChatsByChunk: (
    since: number,
    chunkSize?: number,
  ) => Promise<{ messages: unknown[]; hasMore: boolean }>;
};

// Type for adapters that may have a disconnect method (either on adapter or client)
export type DisconnectableAdapter = ChunkCapableAdapter & {
  // For Telegram: adapter.client may have disconnect (checked at runtime)
  client?: unknown | null;
  // For WhatsApp/other: adapter may have its own disconnect/kill method
  disconnect?: () => Promise<undefined | boolean>;
  kill?: () => Promise<undefined | boolean>;
};

export type { DetailData, InsightData, TimelineData, BotWithAccount, Platform };
