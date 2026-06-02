/**
 * Unified Memory tool - searchUnifiedMemory
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import { searchUnifiedMemory } from "@/lib/memory/unified-search";

const memorySourceSchema = z.enum(["memory", "insights", "knowledge"]);

function formatMetadata(metadata: Record<string, unknown>): string {
  const compact: Record<string, unknown> = {};
  for (const key of [
    "platform",
    "botId",
    "channel",
    "person",
    "timestamp",
    "documentName",
    "title",
    "memoryStage",
  ]) {
    if (metadata[key] !== undefined) {
      compact[key] = metadata[key];
    }
  }
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : "{}";
}

function formatUnifiedMemoryResults(
  results: Awaited<ReturnType<typeof searchUnifiedMemory>>["results"],
): string {
  if (results.length === 0) {
    return "No relevant memory results found.";
  }

  return results
    .map((result, index) => {
      const content =
        result.content.length > 1200
          ? `${result.content.slice(0, 1200)}...`
          : result.content;
      return [
        `[${index + 1}] ${result.type} score=${result.similarity.toFixed(3)} id=${result.id}`,
        `metadata: ${formatMetadata(result.metadata)}`,
        content,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function getHitSourceSummary(
  results: Awaited<ReturnType<typeof searchUnifiedMemory>>["results"],
) {
  const stats = results.reduce<
    Record<string, { count: number; maxScore: number; totalScore: number }>
  >((acc, result) => {
    const current = acc[result.type] ?? {
      count: 0,
      maxScore: Number.NEGATIVE_INFINITY,
      totalScore: 0,
    };
    current.count += 1;
    current.maxScore = Math.max(current.maxScore, result.similarity);
    current.totalScore += result.similarity;
    acc[result.type] = current;
    return acc;
  }, {});

  const hitSourceScores = Object.fromEntries(
    Object.entries(stats).map(([source, sourceStats]) => [
      source,
      {
        count: sourceStats.count,
        maxScore: Number(sourceStats.maxScore.toFixed(3)),
        avgScore: Number(
          (sourceStats.totalScore / sourceStats.count).toFixed(3),
        ),
      },
    ]),
  );

  return {
    hitSources: Object.keys(stats),
    hitSourceCounts: Object.fromEntries(
      Object.entries(stats).map(([source, sourceStats]) => [
        source,
        sourceStats.count,
      ]),
    ),
    hitSourceScores,
  };
}

function previewLogContent(content: string, maxLength = 220): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength)}...`
    : compact;
}

function pickLogMetadata(metadata: Record<string, unknown>) {
  const keys = [
    "platform",
    "channel",
    "person",
    "timestamp",
    "title",
    "documentName",
  ];
  return Object.fromEntries(
    keys
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]]),
  );
}

/**
 * Create the unified memory search tool.
 */
export function createUnifiedMemorySearchTool(
  session: Session,
  embeddingsAuthToken?: string,
) {
  return tool(
    "searchUnifiedMemory",
    [
      "Search the user's unified memory across raw messages, extracted insights, and uploaded knowledge.",
      "",
      "**MUST USE when:**",
      "- User asks broad questions about remembered context, past conversations, documents, tasks, projects, people, or preferences",
      "- User asks something like 'what do you remember about...', 'what did we discuss...', 'find anything about...'",
      "- A keyword-only raw message search may miss semantically related content",
      "",
      "**Search strategy:**",
      "- Start with sources=['memory','insights','knowledge'] unless the user clearly asks for only one source",
      "- Use sources=['memory'] for original chat/message history",
      "- Use sources=['insights'] for summarized tasks, todos, priorities, and extracted events",
      "- Use sources=['knowledge'] for uploaded documents and strategy memory",
      "- Use a concise natural-language query; semantic search works better than long prompt dumps",
    ].join("\n"),
    {
      query: z.string().describe("Natural-language memory search query."),
      sources: z
        .array(memorySourceSchema)
        .optional()
        .describe(
          "Sources to search: memory, insights, knowledge. Defaults to all sources.",
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(8)
        .describe("Maximum number of results to return. Default is 8."),
      threshold: z.coerce
        .number()
        .min(-1)
        .max(1)
        .default(0.35)
        .describe(
          "Similarity threshold. Lower values improve recall. Default is 0.35.",
        ),
      botIds: z
        .array(z.string())
        .optional()
        .describe("Optional bot IDs to restrict raw memory/insight search."),
      documentIds: z
        .array(z.string())
        .optional()
        .describe("Optional document IDs to restrict knowledge search."),
      includeArchivedInsights: z
        .boolean()
        .default(false)
        .describe("Whether to include archived insights."),
    },
    async (args) => {
      try {
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

        const result = await searchUnifiedMemory({
          userId: session.user.id,
          query: args.query,
          sources: args.sources,
          limit: args.limit,
          threshold: args.threshold,
          botIds: args.botIds,
          documentIds: args.documentIds,
          includeArchivedInsights: args.includeArchivedInsights,
          authToken: embeddingsAuthToken,
        });
        const { hitSources, hitSourceCounts, hitSourceScores } =
          getHitSourceSummary(result.results);

        console.log("[UnifiedMemoryTool] search completed", {
          query: result.query,
          requestedSources: result.sources,
          hitSources,
          hitSourceCounts,
          hitSourceScores,
          count: result.count,
          warnings: result.warnings.map((warning) => ({
            source: warning.source,
            code: warning.code,
          })),
          topResults: result.results.slice(0, 5).map((item) => ({
            type: item.type,
            id: item.id,
            similarity: Number(item.similarity.toFixed(3)),
            metadata: pickLogMetadata(item.metadata),
            contentPreview: previewLogContent(item.content),
          })),
        });

        const text = [
          `Unified memory search results for: ${result.query}`,
          `Sources: ${result.sources.join(", ")}; count: ${result.count}`,
          `Hit sources: ${hitSources.length > 0 ? hitSources.join(", ") : "none"}`,
          result.warnings.length > 0
            ? `Warnings: ${result.warnings
                .map((warning) => `${warning.source}:${warning.code}`)
                .join(", ")}`
            : "",
          "",
          formatUnifiedMemoryResults(result.results),
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
          data: result,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to search unified memory: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
