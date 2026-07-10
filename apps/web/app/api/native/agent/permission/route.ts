/**
 * Permission Response API Route
 *
 * Handles user responses to permission requests from the native agent
 */

import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { resolveNativeAgentPermission } from "@/lib/ai/native-agent/permissions";

// POST /api/native/agent/permission - Handle permission response from frontend
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      requestId: string;
      behavior: "allow" | "deny";
      updatedInput?: Record<string, unknown>;
    };

    if (
      typeof body.requestId !== "string" ||
      !body.requestId.trim() ||
      (body.behavior !== "allow" && body.behavior !== "deny") ||
      (body.updatedInput !== undefined &&
        (!body.updatedInput ||
          typeof body.updatedInput !== "object" ||
          Array.isArray(body.updatedInput)))
    ) {
      return Response.json(
        { error: "Invalid permission response" },
        { status: 400 },
      );
    }

    const resolution = resolveNativeAgentPermission({
      requestId: body.requestId,
      ownerUserId: session.user.id,
      result: {
        behavior: body.behavior,
        updatedInput: body.updatedInput,
      },
    });

    if (resolution !== "resolved") {
      return Response.json(
        { error: "Permission request not found or already handled" },
        { status: 404 },
      );
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("[PermissionAPI] Permission response error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
