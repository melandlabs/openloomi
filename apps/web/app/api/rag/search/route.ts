import { NextResponse } from "next/server";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import { getAuthUser } from "@/lib/auth/dual-auth";
import {
  searchSimilarChunks,
  formatSearchResultsForLLM,
} from "@/lib/ai/rag/langchain-service";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { query, limit = 5, threshold = 0.7 } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 },
      );
    }

    if (query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query cannot be empty" },
        { status: 400 },
      );
    }

    // Search for similar chunks
    const results = await searchSimilarChunks(
      user.id,
      query,
      {
        limit,
        threshold,
      },
      extractCloudAuthToken(request),
    );

    // Format results for different use cases
    const formattedResults = results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      content: result.content,
      similarity: result.similarity,
      chunkIndex: result.chunkIndex,
    }));

    return NextResponse.json({
      query,
      results: formattedResults,
      count: results.length,
      context: formatSearchResultsForLLM(results),
    });
  } catch (error) {
    console.error("RAG search error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to search strategy memory",
      },
      { status: 500 },
    );
  }
}
