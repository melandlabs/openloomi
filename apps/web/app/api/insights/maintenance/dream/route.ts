import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/auth/remote-auth-utils";
import { runInsightEmbeddingDream } from "@/lib/insights/dream";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

async function parseDreamInput(request: Request) {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};

  if (request.method !== "GET") {
    try {
      const parsed = await request.json();
      body =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = {};
    }
  }

  const getValue = (key: string) => body[key] ?? url.searchParams.get(key);

  return {
    userId:
      typeof getValue("userId") === "string"
        ? (getValue("userId") as string).trim() || undefined
        : undefined,
    botId:
      typeof getValue("botId") === "string"
        ? (getValue("botId") as string).trim() || undefined
        : undefined,
    limit: parsePositiveInteger(getValue("limit")),
    scanLimit: parsePositiveInteger(getValue("scanLimit")),
    includeArchived: parseBoolean(getValue("includeArchived")),
    dryRun: parseBoolean(getValue("dryRun")) ?? false,
    authToken:
      typeof body.cloudAuthToken === "string" ? body.cloudAuthToken : undefined,
  };
}

async function handleInsightEmbeddingDream(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (!verifyCronAuth(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = await parseDreamInput(request);
  const result = await runInsightEmbeddingDream(input);

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return await handleInsightEmbeddingDream(request);
}

export async function POST(request: Request) {
  return await handleInsightEmbeddingDream(request);
}
