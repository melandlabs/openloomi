import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { createRssSubscription } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import {
  DEFAULT_MAX_OPML_FEEDS,
  parseOpmlFeeds,
  type ParsedOpmlFeed,
  type SkippedOpmlFeed,
} from "@openloomi/rss";

const MAX_OPML_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing OPML file upload." },
      { status: 400 },
    );
  }

  const fileName = `${file.name ?? ""}`.toLowerCase();
  if (!fileName.endsWith(".opml")) {
    return NextResponse.json(
      { error: "Only .opml files are supported." },
      { status: 400 },
    );
  }

  if (file.size > MAX_OPML_FILE_BYTES) {
    return NextResponse.json(
      {
        error: "OPML file is too large.",
        limitBytes: MAX_OPML_FILE_BYTES,
      },
      { status: 413 },
    );
  }

  const fileContents = await file.text();

  let parsedFeeds: ParsedOpmlFeed[] = [];
  let skipped: SkippedOpmlFeed[] = [];
  let totalFound = 0;

  try {
    const result = parseOpmlFeeds(fileContents, {
      maxFeeds: DEFAULT_MAX_OPML_FEEDS,
    });
    parsedFeeds = result.feeds;
    skipped = result.skipped;
    totalFound = result.totalFound;
  } catch (error) {
    console.error("[RssImport] Failed to parse OPML file", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to parse this OPML file.",
      },
      { status: 400 },
    );
  }

  if (parsedFeeds.length === 0) {
    return NextResponse.json(
      {
        error: "No valid RSS feeds were found in this OPML file.",
        skipped,
        totalFound,
      },
      { status: 400 },
    );
  }

  let imported = 0;
  const failures = [...skipped];

  for (const feed of parsedFeeds) {
    try {
      await createRssSubscription({
        userId: session.user.id,
        sourceUrl: feed.sourceUrl,
        title: feed.title,
        category: feed.category,
        status: "active",
        sourceType: "import",
      });
      imported += 1;
    } catch (error) {
      const reason =
        error instanceof AppError
          ? error.message
          : "Unexpected error while saving this feed.";
      console.error("[RssImport] Failed to save feed", {
        error,
        sourceUrl: feed.sourceUrl,
      });
      failures.push({
        title: feed.title,
        url: feed.sourceUrl,
        reason,
      });
    }
  }

  return NextResponse.json(
    {
      imported,
      processed: parsedFeeds.length,
      totalFound,
      skipped: failures,
    },
    { status: 200 },
  );
}
