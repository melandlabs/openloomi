import { auth } from "@/app/(auth)/auth";
import { botExists } from "@/lib/db/queries";
import { resolveMemoryGraphCorrectionPolicy } from "@/lib/memory/memory-graph-correction-policy";
import { upsertRawMessagesToChroma } from "@/lib/memory/chroma-memory-index";
import {
  isReservedChatMemoryEvidenceId,
  isReservedMemoryGraphSummaryId,
  resolveUntrustedRawMemoryGraphWritePolicy,
  sanitizeUntrustedMemoryMetadata,
} from "@/lib/memory/memory-graph-write-policy";
import {
  getRawMessageManager,
  getRawMessageStorageBackend,
  isRawMessageStorageAvailable,
} from "@/lib/memory/raw-message-store";
import type {
  MemorySummaryRecord,
  RawMessage,
  RawMessageMemoryGraphCorrectionCommand,
  RawMessageMemoryGraphRollbackCommand,
  RawMessageQuery,
  RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions,
} from "@openloomi/indexeddb";
import {
  MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT,
  MEMORY_SUMMARY_WRITE_CONFLICT,
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
  runMemoryGraphCorrection,
  runMemoryGraphRollback,
  runMemoryGraphRolloutEvaluation,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const GRAPH_COMMAND_ID_MAX_LENGTH = 512;
const GRAPH_COMMAND_REASON_MAX_LENGTH = 4096;
const GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH = 512;
const GRAPH_CORRECTED_CONTENT_MAX_LENGTH = 64 * 1024;

function normalizeTimestampToMs(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if ((value as number) < 1e11) {
    return Math.floor((value as number) * 1000);
  }
  return Math.floor(value as number);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isGraphCommandBase(value: unknown): value is Record<
  string,
  unknown
> & {
  commandId: string;
  reason: string;
} {
  return (
    isRecord(value) &&
    isBoundedNonEmptyString(value.commandId, GRAPH_COMMAND_ID_MAX_LENGTH) &&
    isBoundedNonEmptyString(value.reason, GRAPH_COMMAND_REASON_MAX_LENGTH) &&
    (value.expectedVersion === undefined ||
      isBoundedNonEmptyString(
        value.expectedVersion,
        GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
      ))
  );
}

function isGraphCorrectionCommand(value: unknown): boolean {
  if (!isGraphCommandBase(value) || !isRecord(value.action)) return false;
  const action = value.action;
  if (
    !isBoundedNonEmptyString(
      action.clusterId,
      GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
    )
  ) {
    return false;
  }
  switch (action.type) {
    case "correct-summary":
      return (
        isBoundedNonEmptyString(
          action.summaryId,
          GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
        ) &&
        isBoundedNonEmptyString(
          action.correctedContent,
          GRAPH_CORRECTED_CONTENT_MAX_LENGTH,
        ) &&
        (action.correctedSummaryId === undefined ||
          isBoundedNonEmptyString(
            action.correctedSummaryId,
            GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
          ))
      );
    case "set-lifecycle":
      return [
        "forming",
        "active",
        "stable",
        "decaying",
        "superseded",
        "audit-only",
      ].includes(String(action.lifecycleStatus));
    case "remove-member":
      return (
        isBoundedNonEmptyString(
          action.nodeId,
          GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
        ) &&
        (action.separatedClusterId === undefined ||
          isBoundedNonEmptyString(
            action.separatedClusterId,
            GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
          ))
      );
    case "set-representative":
      return isBoundedNonEmptyString(
        action.representativeNodeId,
        GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
      );
    default:
      return false;
  }
}

function isGraphRollbackCommand(value: unknown): boolean {
  return (
    isGraphCommandBase(value) &&
    isBoundedNonEmptyString(
      value.summaryId,
      GRAPH_COMMAND_IDENTIFIER_MAX_LENGTH,
    )
  );
}

function withTrustedGraphCommandContext(
  command: Record<string, unknown>,
  userId: string,
): {
  trustedContext: {
    ownerScope: { userId: string };
    requestedBy: string;
  };
  command: Record<string, unknown>;
} {
  const {
    userId: _userId,
    workspaceId: _workspaceId,
    tenantId: _tenantId,
    requestedBy: _requestedBy,
    ...serverScopedCommand
  } = command;
  const trustedContext = {
    ownerScope: { userId },
    requestedBy: userId,
  };
  if (!isRecord(serverScopedCommand.action)) {
    return { trustedContext, command: serverScopedCommand };
  }
  const { correctedSummaryId: _correctedSummaryId, ...serverScopedAction } =
    serverScopedCommand.action;
  return {
    trustedContext,
    command: { ...serverScopedCommand, action: serverScopedAction },
  };
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalMemoryTier(
  value: unknown,
): "short" | "mid" | "long" | undefined {
  return value === "short" || value === "mid" || value === "long"
    ? value
    : undefined;
}

function optionalRelationKeys(
  value: unknown,
): RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions["relationKeys"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const relationKeys = {
    relationGroup:
      typeof value.relationGroup === "string" ? value.relationGroup : undefined,
    relationValue:
      typeof value.relationValue === "string" ? value.relationValue : undefined,
    relationScope:
      typeof value.relationScope === "string" ? value.relationScope : undefined,
  };

  return Object.values(relationKeys).some(Boolean) ? relationKeys : undefined;
}

function parseShadowDiagnosticsOptions(
  value: unknown,
): RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const shadowDiagnostics: RunMemoryForgettingCycleSerializableShadowDiagnosticsOptions =
    {};
  const enabled = optionalBoolean(value.enabled);
  const dryRun = optionalBoolean(value.dryRun);
  const limit = optionalFiniteNumber(value.limit);
  const olderThan = optionalFiniteNumber(value.olderThan);
  const candidateTier = optionalMemoryTier(value.candidateTier);
  const relationKeys = optionalRelationKeys(value.relationKeys);
  const minConfidence = optionalFiniteNumber(value.minConfidence);

  if (enabled !== undefined) shadowDiagnostics.enabled = enabled;
  if (dryRun !== undefined) shadowDiagnostics.dryRun = dryRun;
  if (limit !== undefined) shadowDiagnostics.limit = limit;
  if (olderThan !== undefined) shadowDiagnostics.olderThan = olderThan;
  if (candidateTier !== undefined) {
    shadowDiagnostics.candidateTier = candidateTier;
  }
  if (relationKeys !== undefined) shadowDiagnostics.relationKeys = relationKeys;
  if (minConfidence !== undefined) {
    shadowDiagnostics.minConfidence = minConfidence;
  }
  if (isRecord(value.metadata)) {
    shadowDiagnostics.metadata = { ...value.metadata };
  }

  return Object.keys(shadowDiagnostics).length > 0
    ? shadowDiagnostics
    : undefined;
}

function parseForgettingCycleOptions(value: unknown) {
  const options = isRecord(value) ? value : {};
  return {
    dryRun: options.dryRun === true,
    hardDeleteArchivedOlderThan:
      typeof options.hardDeleteArchivedOlderThan === "number"
        ? options.hardDeleteArchivedOlderThan
        : undefined,
    shadowDiagnostics: parseShadowDiagnosticsOptions(options.shadowDiagnostics),
  };
}

function toRawSourceItem(message: RawMessage): RawMessage & {
  sourceType: "raw";
} {
  return {
    ...message,
    sourceType: "raw",
  };
}

function toSummarySourceItem(
  summary: MemorySummaryRecord,
): MemorySummaryRecord & {
  sourceType: "summary";
} {
  return {
    ...summary,
    sourceType: "summary",
  };
}

function scopedQuery(query: RawMessageQuery | undefined, userId: string) {
  return {
    ...(query ?? {}),
    userId,
  };
}

async function queryRawMessagesWithFallback(
  query: RawMessageQuery,
  userId: string,
) {
  const manager = await getRawMessageManager();
  const pageSize = query.pageSize ?? query.limit ?? 50;
  const minRaw =
    query.minRawResultsWithoutFallback ?? query.pageSize ?? query.limit ?? 50;

  const result = await queryMemoryWithFallback(manager, {
    userId,
    keywords: query.keywords,
    startTime: normalizeTimestampToMs(query.startTime),
    endTime: normalizeTimestampToMs(query.endTime),
    limit: pageSize,
    pageSize,
    offset: query.offset,
    reverse: query.reverse ?? true,
    tiers: query.memoryStages,
    dimensions: {
      platform: query.platform,
      channel: query.channel,
      person: query.person,
      botId: query.botId,
    },
    minRawResultsWithoutFallback: minRaw,
    includeDeprecated: query.includeDeprecated,
  });

  return result.items
    .map((item) => {
      if (item.sourceType === "summary") {
        return toSummarySourceItem({
          summaryId: item.summary.summaryId,
          userId: item.summary.userId,
          summaryTier: item.summary.summaryTier,
          sourceTier: item.summary.sourceTier,
          startTimestamp: item.summary.startTimestamp,
          endTimestamp: item.summary.endTimestamp,
          messageCount: item.summary.messageCount,
          sourceRecordIds: item.summary.sourceRecordIds,
          keyPoints: item.summary.keyPoints,
          keywords: item.summary.keywords,
          keywordsText: item.summary.keywords.join(" "),
          summaryText: item.summary.summaryText,
          dimensions: item.summary.dimensions,
          qualityScore: item.summary.qualityScore,
          createdAt: item.summary.createdAt,
          updatedAt: item.summary.updatedAt,
        });
      }

      const rawMaybe = (
        item.record.metadata as Record<string, unknown> | undefined
      )?.__rawMessage;
      if (rawMaybe && typeof rawMaybe === "object") {
        return toRawSourceItem(rawMaybe as RawMessage);
      }

      return toRawSourceItem({
        messageId: item.record.id,
        platform:
          typeof item.record.dimensions?.platform === "string"
            ? String(item.record.dimensions.platform)
            : "unknown",
        botId:
          typeof item.record.dimensions?.botId === "string"
            ? String(item.record.dimensions.botId)
            : "unknown",
        userId: item.record.userId,
        channel:
          typeof item.record.dimensions?.channel === "string"
            ? String(item.record.dimensions.channel)
            : undefined,
        person:
          typeof item.record.dimensions?.person === "string"
            ? String(item.record.dimensions.person)
            : undefined,
        timestamp: Math.floor(item.record.timestamp / 1000),
        content: item.record.text ?? "",
        attachments: [],
        embedding: item.record.embedding,
        embeddingModel: item.record.embeddingModel,
        embeddingContentHash: item.record.embeddingContentHash,
        embeddingDimensions: item.record.embeddingDimensions,
        embeddingUpdatedAt: item.record.embeddingUpdatedAt,
        metadata:
          (item.record.metadata as Record<string, unknown> | undefined) ??
          undefined,
        createdAt: item.record.timestamp,
        memoryStage: item.record.tier,
        accessCount: item.record.accessCount,
        lastAccessAt: item.record.lastAccessAt,
        importanceScore: item.record.importanceScore,
        archivedAt: item.record.archivedAt,
        isPinned: item.record.isPinned,
      });
    })
    .slice(0, pageSize);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  if (!isRawMessageStorageAvailable()) {
    return Response.json({
      available: false,
      reason: "not_available",
    });
  }

  const manager = await getRawMessageManager();
  return Response.json({
    available: true,
    storage: getRawMessageStorageBackend(),
    stats: await manager.getStats(),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : "";
    const userId = session.user.id;
    if (action === "graphCorrection" || action === "graphRollback") {
      const policy = resolveMemoryGraphCorrectionPolicy(userId);
      if (!policy.enabled) {
        return Response.json(
          {
            success: false,
            reason:
              action === "graphRollback"
                ? "memory_graph_rollback_forbidden"
                : "memory_graph_correction_forbidden",
            reasonCodes: policy.reasonCodes,
          },
          { status: 403 },
        );
      }
    }
    if (!isRawMessageStorageAvailable()) {
      return Response.json(
        {
          success: false,
          reason: "not_available",
          message: "Raw message storage is not available in this environment.",
        },
        { status: 409 },
      );
    }
    const manager = await getRawMessageManager();

    switch (action) {
      case "store": {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
          return new AppError(
            "bad_request:api",
            "messages array is required and must not be empty",
          ).toResponse();
        }

        for (const message of messages as Array<Partial<RawMessage>>) {
          if (
            typeof message.messageId !== "string" ||
            message.messageId.trim().length === 0 ||
            typeof message.botId !== "string" ||
            message.botId.trim().length === 0
          ) {
            return new AppError(
              "bad_request:api",
              "Each message must have a non-empty messageId and botId",
            ).toResponse();
          }
          if (isReservedChatMemoryEvidenceId(message.messageId)) {
            return Response.json(
              { success: false, reason: "raw_message_reserved_id" },
              { status: 409 },
            );
          }
        }

        const botIds = [
          ...new Set(
            (messages as Array<Partial<RawMessage>>).map(
              (message) => message.botId as string,
            ),
          ),
        ];
        const ownedBots = await Promise.all(
          botIds.map((id) => botExists({ id, userId })),
        );
        if (ownedBots.some((ownedBot) => !ownedBot)) {
          return new AppError(
            "forbidden:api",
            "Raw messages may only reference bots owned by the current user",
          ).toResponse();
        }

        const existingMessages = await Promise.all(
          [
            ...new Set(
              (messages as Array<Partial<RawMessage>>).map(
                (message) => message.messageId as string,
              ),
            ),
          ].map((messageId) => manager.getMessageById(messageId)),
        );
        if (
          existingMessages.some(
            (existing) => existing !== null && existing.userId !== userId,
          )
        ) {
          return Response.json(
            { success: false, reason: "raw_message_scope_conflict" },
            { status: 409 },
          );
        }

        const now = Math.floor(Date.now() / 1000);
        const normalized = messages.map(
          ({ metadata, ...message }: Partial<RawMessage>) => ({
            ...message,
            metadata: sanitizeUntrustedMemoryMetadata(metadata),
            userId,
            createdAt: message.createdAt ?? now,
          }),
        ) as RawMessage[];
        const graphPolicy = resolveUntrustedRawMemoryGraphWritePolicy();
        const stored = await storeRawMessagesWithGraphEvolution({
          storage: manager,
          messages: normalized,
          graphEvolution: { enabled: graphPolicy.enabled },
        });
        await upsertRawMessagesToChroma(normalized);
        return Response.json({
          success: true,
          stored: stored.ids.length,
          errors: 0,
          graphEvolution: stored.graphEvolution,
          graphPolicy,
          graphLifecycle: {
            status: "disabled",
            reasonCodes: ["memory_graph_lifecycle_untrusted_raw_baseline_only"],
          },
        });
      }

      case "query": {
        const query = scopedQuery(body.query, userId);
        if (query.includeSummaryFallback) {
          return Response.json({
            success: true,
            items: await queryRawMessagesWithFallback(query, userId),
          });
        }

        const messages = await manager.queryMessages(query);
        return Response.json({
          success: true,
          items: messages.map(toRawSourceItem),
        });
      }

      case "queryGrouped": {
        const grouped = await manager.queryMessagesGrouped(
          scopedQuery(body.query, userId),
        );
        return Response.json({ success: true, grouped });
      }

      case "stats": {
        return Response.json({
          success: true,
          stats: await manager.getStats(),
        });
      }

      case "clearOld": {
        const olderThan = Number(body.olderThan);
        if (!Number.isFinite(olderThan)) {
          return new AppError(
            "bad_request:api",
            "olderThan must be a finite timestamp",
          ).toResponse();
        }
        const deleted = await manager.deleteOldMessages(olderThan, userId);
        return Response.json({ success: true, deleted });
      }

      case "updateEmbeddings": {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        const updated = await manager.updateMessageEmbeddings(updates, userId);
        const updatedMessages = (
          await Promise.all(
            updates.map(async (update: { messageId?: unknown }) => {
              if (typeof update.messageId !== "string") {
                return null;
              }
              return manager.getMessageById(update.messageId);
            }),
          )
        ).filter((message): message is RawMessage => message !== null);
        await upsertRawMessagesToChroma(updatedMessages);
        return Response.json({ success: true, updated });
      }

      case "semanticSearch": {
        const queryEmbedding = Array.isArray(body.queryEmbedding)
          ? body.queryEmbedding
          : [];
        if (queryEmbedding.length === 0) {
          return Response.json({ success: true, items: [] });
        }

        const items =
          typeof manager.searchMessagesSemantically === "function"
            ? await manager.searchMessagesSemantically({
                ...(body.options ?? {}),
                userId,
                queryEmbedding,
              })
            : [];
        return Response.json({ success: true, items });
      }

      case "upsertSummaries": {
        const summaries = Array.isArray(body.summaries) ? body.summaries : [];
        if (
          summaries.some(
            (summary: Partial<MemorySummaryRecord>) =>
              typeof summary.summaryId === "string" &&
              isReservedMemoryGraphSummaryId(summary.summaryId),
          )
        ) {
          return Response.json(
            { success: false, reason: "memory_summary_reserved_id" },
            { status: 409 },
          );
        }
        await manager.upsertSummaries(
          summaries.map((summary: Partial<MemorySummaryRecord>) => ({
            ...summary,
            userId,
          })) as MemorySummaryRecord[],
        );
        return Response.json({ success: true, stored: summaries.length });
      }

      case "forgettingCycle": {
        const result = await runMemoryForgettingCycle(
          manager,
          userId,
          parseForgettingCycleOptions(body.options),
        );
        return Response.json({
          success: true,
          result,
          graphLifecyclePolicy: {
            enabled: false,
            reasonCodes: [
              "memory_graph_lifecycle_untrusted_action_disabled",
              "memory_graph_lifecycle_scope_discarded",
            ],
          },
        });
      }

      case "graphCorrection": {
        if (!isGraphCorrectionCommand(body.command)) {
          return new AppError(
            "bad_request:api",
            "command object is required",
          ).toResponse();
        }
        const trusted = withTrustedGraphCommandContext(
          body.command as Record<string, unknown>,
          userId,
        );
        const result = await runMemoryGraphCorrection({
          storage: manager,
          trustedContext: trusted.trustedContext,
          command:
            trusted.command as unknown as RawMessageMemoryGraphCorrectionCommand,
        });
        return Response.json({ success: true, result });
      }

      case "graphRollback": {
        if (!isGraphRollbackCommand(body.command)) {
          return new AppError(
            "bad_request:api",
            "command object is required",
          ).toResponse();
        }
        const trusted = withTrustedGraphCommandContext(
          body.command as Record<string, unknown>,
          userId,
        );
        const result = await runMemoryGraphRollback({
          storage: manager,
          trustedContext: trusted.trustedContext,
          command:
            trusted.command as unknown as RawMessageMemoryGraphRollbackCommand,
        });
        return Response.json({ success: true, result });
      }

      case "graphRolloutEvaluation": {
        const options = isRecord(body.options) ? body.options : {};
        const result = await runMemoryGraphRolloutEvaluation({
          storage: manager,
          userId,
          scenarioId:
            typeof options.scenarioId === "string"
              ? options.scenarioId
              : "memory-graph-runtime-rollout",
          workspaceId: undefined,
          tenantId: undefined,
          queryEmbedding: Array.isArray(options.queryEmbedding)
            ? options.queryEmbedding.filter(
                (value: unknown): value is number =>
                  typeof value === "number" && Number.isFinite(value),
              )
            : undefined,
          pollutedArtifactIds: Array.isArray(options.pollutedArtifactIds)
            ? options.pollutedArtifactIds.filter(
                (value: unknown): value is string => typeof value === "string",
              )
            : undefined,
        });
        return Response.json({ success: true, result });
      }

      default:
        return new AppError(
          "bad_request:api",
          `Unsupported raw message action: ${action || "(missing)"}`,
        ).toResponse();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT ||
        error.message === MEMORY_SUMMARY_WRITE_CONFLICT)
    ) {
      return Response.json(
        { success: false, reason: error.message },
        { status: 409 },
      );
    }
    console.error("[Raw Messages API] Error:", error);
    return new AppError(
      "bad_request:database",
      error instanceof Error ? error.message : String(error),
    ).toResponse();
  }
}
