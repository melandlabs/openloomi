import { ensureRssBot, type InsightInsertInput } from "../db/queries";
import type { RssSubscription } from "../db/schema";
import type { InsertRssItem } from "@openloomi/rss";
import RSSParser from "rss-parser";
import { extractRssTags } from "@openloomi/rss";

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "openloomiRSSFetcher/1.0 (+https://openloomi.ai)";

const parser = new RSSParser({
  customFields: {
    item: ["content:encoded"],
  },
});

const rssBotCache = new Map<string, string>();

export async function fetchFeed(subscription: RssSubscription) {
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept:
      "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
  };

  if (subscription.etag) {
    headers["if-none-match"] = subscription.etag;
  }
  if (subscription.lastModified) {
    headers["if-modified-since"] = subscription.lastModified;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(subscription.sourceUrl, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");

    if (response.status === 304) {
      return {
        skipped: true,
        feedTitle: null,
        items: [],
        etag: etag ?? subscription.etag ?? null,
        lastModified: lastModified ?? subscription.lastModified ?? null,
      } as const;
    }

    if (!response.ok) {
      throw new Error(`Feed request failed with status ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);

    return {
      skipped: false,
      feedTitle: feed.title ?? null,
      items: feed.items ?? [],
      etag: etag ?? subscription.etag ?? null,
      lastModified: lastModified ?? subscription.lastModified ?? null,
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getCachedRssBotId(userId: string) {
  const cached = rssBotCache.get(userId);
  if (cached) {
    return cached;
  }
  const bot = await ensureRssBot(userId);
  rssBotCache.set(userId, bot.id);
  return bot.id;
}

export function buildInsightRecord({
  botId,
  subscription,
  item,
}: {
  botId: string;
  subscription: RssSubscription;
  item: InsertRssItem;
}): InsightInsertInput {
  const publishedAt = item.publishedAt ?? item.fetchedAt ?? new Date();
  const author = (item.metadata?.author as string | undefined) ?? undefined;
  const category =
    subscription.category ??
    (item.metadata?.subscriptionCategory as string | undefined) ??
    "rss";
  const summaryText = toPlainText(item.summary ?? null);
  const fallbackTitle =
    item.title ??
    summaryText ??
    subscription.title ??
    item.metadata?.feedTitle ??
    subscription.sourceUrl;
  const description = truncate(
    summaryText ||
      `New article from ${item.metadata?.feedTitle ?? "RSS feed"}.`,
    360,
  );
  const detailContent = buildDetailContent(item, summaryText);

  // Use dynamic tag extraction
  const tags = extractRssTags(item, subscription);

  return {
    botId,
    taskLabel: "rss_feed",
    title: truncate(fallbackTitle, 120),
    description,
    importance: "medium",
    urgency: "low",
    groups: [category],
    people: author ? [author] : [],
    time: publishedAt,
    details: [
      {
        time: Math.floor(publishedAt.getTime() / 1000),
        person: author,
        platform: "rss",
        channel: subscription.category ?? undefined,
        content: detailContent,
      },
    ],
    categories: tags.categories.length > 0 ? tags.categories : ["News"], // fallback to News if no categories matched
    topKeywords: tags.keywords.length > 0 ? tags.keywords : undefined,
    historySummary: null,
  };
}

function toPlainText(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1).trim()}…`;
}

function buildDetailContent(item: InsertRssItem, summaryText: string) {
  const parts: string[] = [];
  if (summaryText) {
    parts.push(summaryText);
  }
  if (item.content && !summaryText) {
    parts.push(toPlainText(item.content));
  }
  if (item.link) {
    parts.push(`[${item.link}](${item.link})`);
  }
  return parts.join("\n\n");
}
