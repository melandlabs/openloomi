/**
 * GET /api/mention/channels - List contact channels (platforms), for @ reference selection
 * Get all contacts from user_contacts table
 */

import { auth } from "@/app/(auth)/auth";
import { getUserContacts } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }
  const raw = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(
      Number.parseInt(raw || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      1,
    ),
    MAX_LIMIT,
  );
  try {
    // Get user contacts from user_contacts table
    const contacts = await getUserContacts(session.user.id);

    // Remove duplicates by contactName + platform (keep first occurrence)
    const uniqueContactsMap = new Map<string, (typeof contacts)[0]>();
    for (const contact of contacts) {
      // Determine platform for deduplication
      let platform = contact.type;
      if (contact.contactMeta) {
        if (typeof contact.contactMeta === "string") {
          try {
            const meta = JSON.parse(contact.contactMeta) as Record<
              string,
              unknown
            >;
            platform = (meta?.platform as string | undefined) || contact.type;
          } catch {
            // Use type as fallback
            platform = contact.type;
          }
        } else {
          platform =
            ((contact.contactMeta as Record<string, unknown>)?.platform as
              | string
              | undefined) || contact.type;
        }
      }

      const key = `${contact.contactName}:${platform || "unknown"}`;
      if (!uniqueContactsMap.has(key)) {
        uniqueContactsMap.set(key, contact);
      }
    }
    const uniqueContacts = Array.from(uniqueContactsMap.values());

    // Transform to channel format: { name, platform, description }
    const channels = uniqueContacts.slice(0, limit).map((contact) => {
      // Handle contactMeta - can be object (PostgreSQL) or string (SQLite)
      let meta: Record<string, unknown> | null = null;
      if (contact.contactMeta) {
        if (typeof contact.contactMeta === "string") {
          // SQLite: contactMeta is stored as JSON string
          try {
            meta = JSON.parse(contact.contactMeta);
          } catch {
            // Ignore parse errors
          }
        } else {
          // PostgreSQL: contactMeta is already an object
          meta = contact.contactMeta as Record<string, unknown> | null;
        }
      }

      // Determine platform from type or meta
      const platform =
        contact.type || (meta?.platform as string | undefined) || "unknown";

      // Get description from meta or use contact name
      const description =
        (meta?.description as string | undefined) || contact.contactName;

      return {
        name: contact.contactName,
        platform,
        description,
      };
    });

    return Response.json({ channels }, { status: 200 });
  } catch (error) {
    console.error("[Mention Channels] GET failed:", error);
    return new AppError(
      "bad_request:api",
      error instanceof Error ? error.message : String(error),
    ).toResponse();
  }
}
