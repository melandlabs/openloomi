import { type NextRequest, NextResponse } from "next/server";
import { authenticateCloudRequest } from "@/lib/auth/cloud-auth";
import { getUserContacts } from "@/lib/db/queries";

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateCloudRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const nameFilter = searchParams.get("name");
    const page = Number.parseInt(searchParams.get("page") || "1", 10);
    const pageSize = Number.parseInt(searchParams.get("pageSize") || "10", 10);

    const contacts = await getUserContacts(user.id);

    let resultContacts = contacts.map((c) => {
      const meta = c.contactMeta as Record<string, unknown> | null;
      return {
        id: c.id,
        name: c.contactName,
        type: c.type,
        botId: c.botId,
        platform: meta?.platform,
        email: meta?.email,
        phone: meta?.phone,
        lastInteraction: meta?.lastInteraction,
      };
    });

    if (nameFilter) {
      const searchTerm = nameFilter.toLowerCase();
      resultContacts = resultContacts.filter((contact) =>
        contact.name?.toLowerCase().includes(searchTerm),
      );
    }

    const totalCount = resultContacts.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedContacts = resultContacts.slice(startIndex, endIndex);
    const totalPages = Math.ceil(totalCount / pageSize);

    return NextResponse.json({
      success: true,
      contacts: paginatedContacts,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
        hasPrevious: page > 1,
      },
    });
  } catch (error) {
    console.error("[API] Failed to query contacts:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
