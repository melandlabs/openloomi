import { NextResponse } from "next/server";
import { getUserRAGStats } from "@/lib/ai/rag/langchain-service";
import { getAuthUser } from "@/lib/auth/dual-auth";

/**
 * GET /api/rag/stats
 * Get RAG statistics for the current user
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getUserRAGStats(user.id);

    return NextResponse.json({
      totalDocuments: stats.totalDocuments,
      totalChunks: stats.totalChunks,
      totalSize: stats.totalSize,
      documents: stats.documents,
    });
  } catch (error) {
    console.error("RAG stats error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch RAG statistics",
      },
      { status: 500 },
    );
  }
}
