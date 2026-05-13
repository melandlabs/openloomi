import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { UserType } from "@/app/(auth)/auth";
import type { FileStorageProvider } from "@/lib/files/config";

import { db } from "./queries";
import { userFileUsage, userFiles } from "./schema";
import { AppError } from "@openloomi/shared/errors";

type StorageQuota = {
  quotaBytes: number;
  usedBytes: number;
};

export async function getUserStorageUsage(
  userId: string,
  userType: UserType,
): Promise<StorageQuota> {
  const quotaBytes = 2048_00;
  await db
    .insert(userFileUsage)
    .values({
      userId,
      usedBytes: 0,
    })
    .onConflictDoNothing();

  const [usage] = await db
    .select({
      usedBytes: userFileUsage.usedBytes,
    })
    .from(userFileUsage)
    .where(eq(userFileUsage.userId, userId));

  return {
    quotaBytes,
    usedBytes: usage?.usedBytes ?? 0,
  };
}

type CreateUserFileInput = {
  userId: string;
  userType: UserType;
  chatId?: string | null;
  messageId?: string | null;
  blobUrl: string;
  blobPathname: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageProvider?: FileStorageProvider;
  providerFileId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
};

export async function createUserFile(input: CreateUserFileInput) {
  const storageProvider = input.storageProvider ?? "vercel_blob";
  const quotaBytes = 2048_00;
  if (quotaBytes <= 0) {
    throw new AppError(
      "forbidden:chat",
      "Your current plan does not include file storage.",
    );
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(userFileUsage)
      .values({
        userId: input.userId,
        usedBytes: 0,
      })
      .onConflictDoNothing();

    let usageResult: { usedBytes: number };
    if (storageProvider === "vercel_blob") {
      const updatedUsage = await tx
        .update(userFileUsage)
        .set({
          usedBytes: sql`${userFileUsage.usedBytes} + ${input.sizeBytes}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userFileUsage.userId, input.userId),
            sql`${userFileUsage.usedBytes} + ${input.sizeBytes} <= ${quotaBytes}`,
          ),
        )
        .returning({
          usedBytes: userFileUsage.usedBytes,
        });

      if (updatedUsage.length === 0) {
        throw new AppError(
          "forbidden:chat",
          "Saving this file would exceed your storage quota.",
        );
      }

      usageResult = updatedUsage[0];
    } else {
      const [currentUsage] = await tx
        .select({
          usedBytes: userFileUsage.usedBytes,
        })
        .from(userFileUsage)
        .where(eq(userFileUsage.userId, input.userId))
        .limit(1);

      usageResult = {
        usedBytes: currentUsage?.usedBytes ?? 0,
      };
    }

    const [file] = await tx
      .insert(userFiles)
      .values({
        userId: input.userId,
        chatId: input.chatId ?? null,
        messageId: input.messageId ?? null,
        blobUrl: input.blobUrl,
        blobPathname: input.blobPathname,
        name: input.name,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        storageProvider,
        providerFileId: input.providerFileId ?? null,
        providerMetadata: input.providerMetadata ?? null,
      })
      .returning();

    return { file, usage: usageResult };
  });
}

export async function deleteUserFile({
  userId,
  fileId,
}: {
  userId: string;
  fileId: string;
}) {
  return db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(userFiles)
      .where(and(eq(userFiles.id, fileId), eq(userFiles.userId, userId)));

    if (!file) {
      throw new AppError("not_found:chat", "File not found.");
    }

    if (file.storageProvider === "vercel_blob") {
      await tx
        .update(userFileUsage)
        .set({
          usedBytes: sql`CASE WHEN ${userFileUsage.usedBytes} - ${file.sizeBytes} < 0 THEN 0 ELSE ${userFileUsage.usedBytes} - ${file.sizeBytes} END`,
          updatedAt: new Date(),
        })
        .where(eq(userFileUsage.userId, userId));
    }

    await tx
      .delete(userFiles)
      .where(and(eq(userFiles.id, fileId), eq(userFiles.userId, userId)));

    return file;
  });
}

export async function listUserFiles({
  userId,
  limit = 20,
  cursor,
}: {
  userId: string;
  limit?: number;
  cursor?: string | null;
}) {
  const conditions = [eq(userFiles.userId, userId)];
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (!Number.isFinite(cursorDate.valueOf())) {
      throw new AppError("bad_request:chat", "Invalid pagination cursor.");
    }
    conditions.push(lt(userFiles.savedAt, cursorDate));
  }

  const whereClause =
    conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select()
    .from(userFiles)
    .where(whereClause)
    .orderBy(desc(userFiles.savedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const files = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? (rows[limit]?.savedAt?.toISOString?.() ?? null)
    : null;

  return {
    files,
    nextCursor,
    hasMore,
  };
}

export async function getUserFileById({
  userId,
  fileId,
}: {
  userId: string;
  fileId: string;
}) {
  const [file] = await db
    .select()
    .from(userFiles)
    .where(and(eq(userFiles.id, fileId), eq(userFiles.userId, userId)))
    .limit(1);

  return file ?? null;
}

export async function getUserFileByBlobPathname({
  userId,
  blobPathname,
}: {
  userId: string;
  blobPathname: string;
}) {
  const [file] = await db
    .select()
    .from(userFiles)
    .where(
      and(
        eq(userFiles.blobPathname, blobPathname),
        eq(userFiles.userId, userId),
      ),
    )
    .limit(1);

  return file ?? null;
}

export async function getSavedBlobPathSet(
  blobPaths: string[],
): Promise<Set<string>> {
  if (blobPaths.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ blobPathname: userFiles.blobPathname })
    .from(userFiles)
    .where(inArray(userFiles.blobPathname, blobPaths));

  return new Set(rows.map((row: any) => row.blobPathname));
}
