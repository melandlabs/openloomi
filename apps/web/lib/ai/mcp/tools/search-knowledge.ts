/**
 * Search Knowledge tools - searchKnowledgeBase, getFullDocumentContent, listKnowledgeBaseDocuments
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import {
  searchSimilarChunks,
  formatSearchResultsForLLM,
  getDocumentFullContent,
  getDocument,
  getUserDocuments,
} from "@/lib/ai/rag/langchain-service";

/**
 * Create the search knowledge tools
 */
export function createSearchKnowledgeTools(
  session: Session,
  embeddingsAuthToken?: string,
) {
  return [
    // searchKnowledgeBase tool
    tool(
      "searchKnowledgeBase",
      [
        "Search the user's strategy memory for relevant information.",
        "This includes uploaded documents AND the user's focus settings (people of interest, topics of interest, etc.).",
        "",
        "**MUST USE** when:",
        "1) User asks about their documents, files, or uploaded content",
        "2) User asks questions related to their focus people, topics, or strategy",
        "",
        "**⭐ SEARCH STRATEGY - IMPORTANT:**",
        "- When searching, use MULTIPLE SEPARATE keywords instead of a single long phrase",
        "- Try different keyword combinations if first search doesn't find results",
        "- Examples:",
        "  ❌ BAD: query='openloomi PR feature new' (too specific, won't match)",
        "  ✅ GOOD: Try query='PR', then query='openloomi', then query='feature', then query='new' (multiple searches)",
        "",
        "Examples:",
        "- 'What's in this document?'",
        "- 'What do I care about?'",
        "- 'What are my priorities?'",
        "- 'What do you know about X?' → Try query='X', then query='related topic'",
        "- 'Find information about Y' → Try query='Y', then query='broader term'",
        "- 'openloomi PR feature progress' → Try query='PR', then query='openloomi', then query='feature' (multiple searches)",
        "",
        "Use this tool BEFORE answering questions about user's content or preferences.",
      ].join("\n"),
      {
        query: z
          .string()
          .describe(
            "The search query to find relevant information in the user's strategy memory",
          ),
        limit: z.coerce
          .number()
          .min(1)
          .max(20)
          .default(5)
          .describe(
            "Maximum number of relevant chunks to retrieve (default: 5, max: 20)",
          ),
        documentIds: z
          .array(z.string())
          .optional()
          .describe(
            "Optional: specific document IDs to search within. If not provided, searches all documents.",
          ),
      },
      async (args) => {
        try {
          const { query, limit = 5, documentIds } = args;

          // Validate user session
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

          const userId = session.user.id;

          // Search for similar chunks in the user's knowledge base
          const results = await searchSimilarChunks(
            userId,
            query,
            {
              limit,
              threshold: 0.5, // Lower threshold for better recall (50% similarity)
              documentIds, // Pass document IDs to filter the search
            },
            embeddingsAuthToken,
          ); // Pass auth token for embeddings API

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    documentIds && documentIds.length > 0
                      ? "No relevant information found in the specified documents."
                      : "No relevant information found in your strategy memory. Try uploading documents or rephrase your question.",
                },
              ],
              data: {
                results: [],
                count: 0,
              },
            };
          }

          // Format results for LLM
          const formattedContent = formatSearchResultsForLLM(results);

          return {
            content: [
              {
                type: "text" as const,
                text: formattedContent,
              },
            ],
            data: {
              results: results.map((r) => ({
                documentName: r.documentName,
                content: r.content,
                similarity: r.similarity,
                chunkIndex: r.chunkIndex,
              })),
              count: results.length,
            },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No results found in knowledge base.",
              },
            ],
            data: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
            isError: true,
          };
        }
      },
    ),

    // getFullDocumentContent tool
    tool(
      "getFullDocumentContent",
      [
        "Get the COMPLETE full text content of a document.",
        "",
        "Use this when the user asks to:",
        "- Summarize a document",
        "- Explain 'what's in this document'",
        "- Analyze the entire document content",
        "",
        "This provides ALL chunks concatenated together, not just relevant excerpts.",
        "Best for small documents or summarization tasks.",
      ].join("\n"),
      {
        documentId: z
          .string()
          .describe("The ID of the document to retrieve full content for"),
      },
      async (args) => {
        try {
          const { documentId } = args;

          // Validate user session
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

          const userId = session.user.id;

          // First verify the document belongs to this user
          const document = await getDocument(documentId);

          if (!document) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Document not found.",
                },
              ],
              isError: true,
            };
          }

          if (document.userId !== userId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Unauthorized: you don't have access to this document.",
                },
              ],
              isError: true,
            };
          }

          // Get full content
          const result = await getDocumentFullContent(documentId);

          return {
            content: [
              {
                type: "text" as const,
                text: result.content,
              },
            ],
            data: {
              documentId: result.documentId,
              documentName: document.fileName,
              totalChunks: result.totalChunks,
              contentLength: result.content.length,
              message: `Successfully retrieved full content of "${document.fileName}" (${result.totalChunks} chunks, ${result.content.length} characters).`,
            },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Failed to retrieve document content.",
              },
            ],
            data: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
            isError: true,
          };
        }
      },
    ),

    // listKnowledgeBaseDocuments tool
    tool(
      "listKnowledgeBaseDocuments",
      [
        "List all documents in the user's knowledge base.",
        "",
        "Use this when:",
        "- User asks 'what documents do I have', 'list my files', 'show me my knowledge base'",
        "- User wants to see what files are available in their strategy memory",
        "- User wants to know what documents they can search or analyze",
        "",
        "This returns a list of all uploaded documents with their metadata (name, size, upload date, chunk count).",
        "After listing, user can ask to search specific documents or get full content of a particular document.",
      ].join("\n"),
      {
        limit: z.coerce
          .number()
          .min(1)
          .max(100)
          .default(50)
          .describe(
            "Maximum number of documents to return (default: 50, max: 100)",
          ),
      },
      async (args) => {
        try {
          const { limit = 50 } = args;

          // Validate user session
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

          const userId = session.user.id;

          // Get all user documents
          const documents = await getUserDocuments(userId);

          if (documents.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Your knowledge base is empty. You haven't uploaded any documents yet. You can upload documents using the file upload feature in chat.",
                },
              ],
              data: {
                documents: [],
                count: 0,
              },
            };
          }

          // Format documents for display (limit the results)
          const formattedDocs = documents.slice(0, limit).map((doc: any) => ({
            id: doc.id,
            fileName: doc.fileName,
            contentType: doc.contentType,
            sizeBytes: doc.sizeBytes,
            totalChunks: doc.totalChunks,
            uploadedAt: doc.uploadedAt,
          }));

          // Build readable output
          const docList = formattedDocs
            .map(
              (d: any, i: number) =>
                `${i + 1}. **${d.fileName}** (${formatFileSize(d.sizeBytes)}, ${d.totalChunks} chunks, ${formatDate(d.uploadedAt)})`,
            )
            .join("\n");

          const header = `You have **${documents.length}** document(s) in your knowledge base:\n\n`;
          const footer =
            documents.length > limit
              ? `\n\n_Showing ${limit} of ${documents.length} documents. Upload more documents to expand your knowledge base._`
              : "";

          return {
            content: [
              {
                type: "text" as const,
                text: header + docList + footer,
              },
            ],
            data: {
              documents: formattedDocs,
              count: documents.length,
              returnedCount: formattedDocs.length,
            },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Failed to list knowledge base documents.",
              },
            ],
            data: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
            isError: true,
          };
        }
      },
    ),
  ];
}

// Helper functions for formatting
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
