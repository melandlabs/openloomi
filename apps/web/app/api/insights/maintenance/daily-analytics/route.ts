import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/auth/remote-auth-utils";
import { runDailyInsightAnalyticsMaintenance } from "@/lib/insights/maintenance";

export const dynamic = "force-dynamic";

async function handleDailyInsightAnalyticsMaintenance(request: Request) {
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

  const result = await runDailyInsightAnalyticsMaintenance();

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return await handleDailyInsightAnalyticsMaintenance(request);
}

export async function POST(request: Request) {
  return await handleDailyInsightAnalyticsMaintenance(request);
}
