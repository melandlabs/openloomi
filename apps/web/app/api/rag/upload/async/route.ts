import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { randomUUID } from "node:crypto";
import { jobs } from "./job-store";
import { shouldSkipRAGEmbeddings } from "@/lib/ai/rag/langchain-service";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("file");
    const cloudAuthToken = formData.get("cloudAuthToken") as string | null;
    const skipEmbeddings = shouldSkipRAGEmbeddings(
      formData.get("skipEmbeddings") === "true",
    );

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const jobId = randomUUID();

    // Initialize job status
    jobs.set(jobId, {
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    });

    // Start processing in background
    processFileAsync(
      jobId,
      uploadedFile,
      cloudAuthToken,
      session.user.id,
      session.user.type || "free",
      skipEmbeddings,
    );

    return NextResponse.json({
      success: true,
      jobId,
      message: "Upload queued for processing",
    });
  } catch (error) {
    console.error("[Async Upload] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

async function processFileAsync(
  jobId: string,
  file: File,
  cloudAuthToken: string | null,
  userId: string,
  userType = "free",
  skipEmbeddings = false,
) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = "processing";

    // Dynamic import to avoid circular dependencies
    const { processDocumentFromFile } =
      await import("@/lib/ai/rag/langchain-service");

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    job.progress = 10;

    // Process the file with correct parameter order
    const result = await processDocumentFromFile(
      userId,
      userType,
      file.name,
      file.type,
      buffer,
      { skipEmbeddings },
      cloudAuthToken || undefined,
    );

    job.progress = 100;
    job.status = "completed";
    job.result = {
      documentId: result.documentId,
      chunksCount: result.chunksCount,
      billing: {
        tokensUsed: result.totalTokensUsed,
        creditCost: result.totalCreditCost,
      },
    };

    console.log(`[Async Upload] Job ${jobId} completed:`, job.result);
  } catch (error) {
    console.error(`[Async Upload] Job ${jobId} failed:`, error);
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Processing failed";
  }
}
