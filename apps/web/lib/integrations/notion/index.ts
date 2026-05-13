import "server-only";

import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

import {
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import type { IntegrationAccount } from "@/lib/db/schema";
import { AppError } from "@openloomi/shared/errors";

export type NotionStoredCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  botId?: string | null;
};

export type NotionMetadata = {
  workspaceName?: string | null;
  workspaceIcon?: string | null;
  workspaceId?: string | null;
  uploadTarget?: {
    type: "page" | "database";
    id: string;
    titleProperty?: string | null;
    name?: string | null;
    createdAt?: string | null;
  } | null;
  syncSources?: {
    pages?: string[];
    databases?: string[];
  } | null;
};

type NotionContext = {
  client: Client;
  account: IntegrationAccount;
  credentials: NotionStoredCredentials;
  metadata: NotionMetadata;
};

type UploadTarget =
  | {
      type: "page";
      id: string;
    }
  | {
      type: "database";
      id: string;
      titleProperty?: string | null;
    };

export type NotionUploadResult = {
  pageId: string;
  pageUrl: string | null;
  target: UploadTarget;
};

type PullPageContent = {
  pageId: string;
  title: string;
  url: string | null;
  text: string;
};

function buildNotionClient(token: string): Client {
  return new Client({ auth: token });
}

export async function getNotionContext(userId: string): Promise<NotionContext> {
  const account = await getIntegrationAccountByPlatform({
    userId,
    platform: "notion",
  });

  if (!account) {
    throw new AppError(
      "forbidden:api",
      "Notion is not connected. Connect your workspace to continue.",
    );
  }

  const resolvedCreds =
    loadIntegrationCredentials<NotionStoredCredentials>(account) ?? null;

  if (!resolvedCreds || !resolvedCreds.accessToken) {
    throw new AppError(
      "forbidden:api",
      "Notion credentials are missing. Reconnect your workspace.",
    );
  }

  const metadata = (account.metadata as NotionMetadata | null) ?? {};

  return {
    client: buildNotionClient(resolvedCreds.accessToken),
    account,
    credentials: resolvedCreds,
    metadata,
  };
}

function richTextToPlain(richText: Array<{ plain_text?: string }>): string {
  return richText.map((item) => item.plain_text ?? "").join("");
}

async function resolveTitleProperty(
  client: Client,
  databaseId: string,
  fallback?: string | null,
): Promise<string> {
  if (fallback && fallback.length > 0) return fallback;
  const database = await client.databases.retrieve({
    database_id: databaseId,
  });
  const props = database.properties ?? {};
  const entry = Object.entries(props).find(
    ([, value]) => (value as any)?.type === "title",
  );
  if (!entry) {
    throw new AppError(
      "bad_request:api",
      "The target database is missing a title property. Add a title column and try again.",
    );
  }
  return entry[0];
}

async function ensureUploadTarget(
  context: NotionContext,
  parentOverride?: UploadTarget | null,
): Promise<UploadTarget> {
  if (parentOverride) return parentOverride;
  const existing = context.metadata.uploadTarget;
  if (existing?.id) {
    return existing;
  }
  throw new AppError(
    "bad_request:api",
    "Select a Notion page or database as the upload destination in Integrations.",
  );
}

export async function uploadFileToNotion({
  userId,
  fileName,
  mimeType,
  fileUrl,
  textPreview,
  parent,
}: {
  userId: string;
  fileName: string;
  mimeType: string;
  fileUrl: string;
  textPreview?: string | null;
  parent?: UploadTarget | null;
}): Promise<NotionUploadResult> {
  const context = await getNotionContext(userId);
  const target = await ensureUploadTarget(context, parent ?? null);

  const safeTitle = fileName.slice(0, 200);
  const children: any[] = [];

  if (textPreview) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: textPreview.slice(0, 1800),
            },
          },
        ],
      },
    });
  }

  children.push({
    object: "block",
    type: "file",
    file: {
      type: "external",
      external: { url: fileUrl },
    },
  } as any);

  const parentInput =
    target.type === "database"
      ? { database_id: target.id }
      : { page_id: target.id };

  const properties =
    target.type === "database"
      ? {
          [await resolveTitleProperty(
            context.client,
            target.id,
            target.titleProperty,
          )]: {
            title: [
              {
                type: "text",
                text: {
                  content: safeTitle,
                },
              },
            ],
          },
        }
      : {
          title: {
            title: [
              {
                type: "text",
                text: {
                  content: safeTitle,
                },
              },
            ],
          },
        };

  const page = await context.client.pages.create({
    parent: parentInput,
    properties: properties as any,
    children,
  });

  return {
    pageId: page.id,
    pageUrl: (page as PageObjectResponse)?.url ?? null,
    target,
  };
}

function extractBlockPlainText(block: BlockObjectResponse): string {
  switch (block.type) {
    case "paragraph":
      return richTextToPlain(block.paragraph.rich_text);
    case "heading_1":
      return `# ${richTextToPlain(block.heading_1.rich_text)}`;
    case "heading_2":
      return `## ${richTextToPlain(block.heading_2.rich_text)}`;
    case "heading_3":
      return `### ${richTextToPlain(block.heading_3.rich_text)}`;
    case "bulleted_list_item":
      return `- ${richTextToPlain(block.bulleted_list_item.rich_text)}`;
    case "numbered_list_item":
      return `- ${richTextToPlain(block.numbered_list_item.rich_text)}`;
    case "quote":
      return `> ${richTextToPlain(block.quote.rich_text)}`;
    case "callout":
      return richTextToPlain(block.callout.rich_text);
    case "to_do":
      return `[${block.to_do.checked ? "x" : " "}] ${richTextToPlain(block.to_do.rich_text)}`;
    case "toggle":
      return richTextToPlain(block.toggle.rich_text);
    case "code":
      return richTextToPlain(block.code.rich_text);
    case "child_page":
      return block.child_page.title ?? "";
    default:
      return "";
  }
}

async function collectChildrenText(
  client: Client,
  blockId: string,
): Promise<string[]> {
  const chunks: string[] = [];
  let cursor: string | undefined;

  do {
    const response = (await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 50,
    })) as ListBlockChildrenResponse;

    for (const entry of response.results) {
      if (entry.object !== "block") continue;
      const text = extractBlockPlainText(entry as BlockObjectResponse);
      if (text) {
        chunks.push(text);
      }
      if ((entry as BlockObjectResponse).has_children) {
        const childText = await collectChildrenText(client, entry.id);
        if (childText.length) {
          chunks.push(...childText);
        }
      }
    }

    cursor =
      response.has_more && response.next_cursor
        ? String(response.next_cursor)
        : undefined;
  } while (cursor);

  return chunks;
}

export async function pullNotionPages({
  userId,
  pageIds,
  databaseIds,
  limitPerDatabase = 10,
}: {
  userId: string;
  pageIds?: string[];
  databaseIds?: string[];
  limitPerDatabase?: number;
}): Promise<{
  pages: PullPageContent[];
}> {
  const context = await getNotionContext(userId);
  const client = context.client;
  const results: PullPageContent[] = [];

  const seen = new Set<string>();

  const resolvePage = async (pageId: string) => {
    if (!pageId || seen.has(pageId)) return;
    seen.add(pageId);
    try {
      const page = (await client.pages.retrieve({
        page_id: pageId,
      })) as PageObjectResponse;
      const plainBlocks = await collectChildrenText(client, pageId);
      const properties = page.properties ?? {};
      const titleProp = Object.values(properties).find(
        (prop: any) => prop?.type === "title",
      ) as { title?: Array<{ plain_text?: string }> } | undefined;
      const title =
        (titleProp?.title ?? [])
          .map((item) => item?.plain_text ?? "")
          .join("")
          .trim() || "Untitled";

      results.push({
        pageId,
        title,
        url: page.url ?? null,
        text: plainBlocks.join("\n").trim(),
      });
    } catch (error) {
      console.warn("[notion] Failed to pull page", pageId, error);
    }
  };

  // Parallelize page ID resolution
  await Promise.all((pageIds ?? []).map((pageId) => resolvePage(pageId)));

  for (const dbId of databaseIds ?? []) {
    let cursor: string | undefined;
    let fetched = 0;
    do {
      const query = await client.databases.query({
        database_id: dbId,
        start_cursor: cursor,
        page_size: Math.min(20, limitPerDatabase - fetched),
      });

      const pages = query.results
        .filter((item: any) => item.object === "page")
        .map((item: any) => item.id);

      // Parallelize page resolution within this query batch
      await Promise.all(
        pages
          .slice(0, limitPerDatabase - fetched)
          .map((pid: string) => resolvePage(pid)),
      );
      fetched += pages.length;

      cursor =
        query.has_more && fetched < limitPerDatabase
          ? (query.next_cursor ?? undefined)
          : undefined;
    } while (cursor && fetched < limitPerDatabase);
  }

  return { pages: results };
}

export function deriveNotionTextPreview(
  data: Buffer,
  mimeType: string,
): string | null {
  try {
    if (mimeType.startsWith("text/")) {
      return data.toString("utf8").slice(0, 1800);
    }
    if (mimeType === "application/json") {
      return JSON.stringify(JSON.parse(data.toString("utf8")), null, 2).slice(
        0,
        1800,
      );
    }
  } catch {
    return null;
  }
  return null;
}

export function mergeNotionMetadata(
  existing: NotionMetadata | null | undefined,
  next: Partial<NotionMetadata>,
): NotionMetadata {
  const base = existing ?? {};
  const merged: NotionMetadata = { ...base };

  if (next.workspaceId !== undefined) merged.workspaceId = next.workspaceId;
  if (next.workspaceName !== undefined)
    merged.workspaceName = next.workspaceName;
  if (next.workspaceIcon !== undefined)
    merged.workspaceIcon = next.workspaceIcon;
  if (next.uploadTarget !== undefined) merged.uploadTarget = next.uploadTarget;
  if (next.syncSources !== undefined) {
    const baseSync = base.syncSources ?? {};
    const nextSync: NonNullable<NotionMetadata["syncSources"]> = {};
    if (next.syncSources?.pages !== undefined) {
      nextSync.pages = next.syncSources.pages;
    }
    if (next.syncSources?.databases !== undefined) {
      nextSync.databases = next.syncSources.databases;
    }
    merged.syncSources = {
      ...baseSync,
      ...nextSync,
    };
  }

  return merged;
}
