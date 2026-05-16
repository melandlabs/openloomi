"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  ensureRawMessagesSQLiteMigration,
  shouldUseSQLiteRawMessageStorage,
} from "@openloomi/indexeddb/client";

export function RawMessagesMigrationInit() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      return;
    }
    if (!shouldUseSQLiteRawMessageStorage()) {
      return;
    }

    let cancelled = false;

    ensureRawMessagesSQLiteMigration({
      userId,
      batchSize: 200,
      includeArchived: true,
      includeSummaries: true,
      onProgress: (state) => {
        if (cancelled || state.status !== "running") {
          return;
        }
        console.log(
          `[Raw Messages] SQLite migration progress: ${state.migratedMessages} messages, ${state.migratedSummaries} summaries`,
        );
      },
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status === "completed") {
          console.log(
            `[Raw Messages] SQLite migration completed: ${result.migratedMessages} messages, ${result.migratedSummaries} summaries`,
          );
        } else if (result.status === "failed") {
          console.warn("[Raw Messages] SQLite migration failed:", result.error);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[Raw Messages] SQLite migration failed:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  return null;
}
