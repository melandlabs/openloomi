/**
 * GET  /api/loop/channels → list all custom signal channels
 * PUT  /api/loop/channels → upsert a single custom channel
 *   body = Omit<CustomChannel, "createdAt">
 *
 * Custom channels are a per-user extension to the FALLBACK_CONNECTORS
 * list. Each entry is a Composio-backed puller: the watcher invokes
 * `toolSlug` on `toolkit` at `pollIntervalSec` cadence and appends a
 * `LoopSignal` per record to `signals.jsonl`. Composio's own
 * connection state is owned by the user's composio account — this
 * file is pure loop-side configuration.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { customChannels, validateCustomChannel } from "@/lib/loop";
import { log } from "@/lib/loop";
import { CUSTOM_CHANNEL_ID_RE } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ channels: customChannels.list() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list custom channels failed" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    await auth().catch(() => null);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "body must be a JSON object" },
        { status: 400 },
      );
    }
    if (typeof body.id !== "string" || !CUSTOM_CHANNEL_ID_RE.test(body.id)) {
      return NextResponse.json(
        {
          error:
            "id must be snake_case, 2-41 chars, start with a letter (e.g. stripe_charges)",
        },
        { status: 400 },
      );
    }
    if (
      typeof body.label !== "string" ||
      typeof body.toolkit !== "string" ||
      typeof body.toolSlug !== "string" ||
      typeof body.signalType !== "string"
    ) {
      return NextResponse.json(
        { error: "label, toolkit, toolSlug, signalType are required" },
        { status: 400 },
      );
    }
    const result = validateCustomChannel({
      id: body.id,
      label: body.label,
      toolkit: body.toolkit,
      toolSlug: body.toolSlug,
      pollIntervalSec:
        typeof body.pollIntervalSec === "number" ? body.pollIntervalSec : 600,
      signalType: body.signalType,
      ...(typeof body.payloadShape === "string"
        ? { payloadShape: body.payloadShape }
        : {}),
      ...(Array.isArray(body.eventFilter)
        ? { eventFilter: body.eventFilter as never }
        : {}),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const upsert = customChannels.upsert(result.channel);
    log(
      `[loop.customChannels] ${upsert.created ? "created" : "updated"} ${result.channel.id}`,
    );
    return NextResponse.json({ channel: upsert.channel });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "upsert custom channel failed",
      },
      { status: 500 },
    );
  }
}
